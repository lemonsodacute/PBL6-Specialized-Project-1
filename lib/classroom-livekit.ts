import { ConnectionState as LKState, Room, RoomEvent, Track, DisconnectReason, ConnectionError, ConnectionErrorReason } from 'livekit-client';
import type { ClassroomChat, ClassroomDevices, ClassroomParticipant, ClassroomTransport, ConnectionState, RoomToken } from './classroom';
import { api } from './api';
import { defaultClassroomPolicy, type ClassroomPolicy } from './classroom';
import { ClassroomError, validateClassroomUrl } from './classroom-errors';
import type { RecordingState } from './class-recordings';

export class LiveKitClassroom implements ClassroomTransport {
  private room = new Room({ adaptiveStream: true, dynacast: true, stopLocalTrackOnUnpublish: true, videoCaptureDefaults: { resolution: { width: 1280, height: 720, frameRate: 24 } } });
  private listeners = new Set<() => void>();
  private closed = false;
  private history: ClassroomChat[] = [];
  private sessionId = '';
  private currentNotice = '';
  private recordingState: RecordingState | null = null;
  private reactions = new Map<string, { emoji: string; until: number }>();
  private reactionTimer?: ReturnType<typeof setTimeout>;
  constructor() {
    const update = () => { for (const fn of this.listeners) fn(); };
    for (const event of [RoomEvent.ConnectionStateChanged, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged, RoomEvent.AudioPlaybackStatusChanged, RoomEvent.Reconnected, RoomEvent.RoomMetadataChanged, RoomEvent.ParticipantMetadataChanged, RoomEvent.ConnectionQualityChanged, RoomEvent.ParticipantPermissionsChanged]) this.room.on(event, update);
    this.room.on(RoomEvent.Disconnected, reason => {
      if (reason === DisconnectReason.PARTICIPANT_REMOVED) this.currentNotice = 'removed';
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) this.currentNotice = 'duplicate';
      if (reason === DisconnectReason.ROOM_DELETED) this.currentNotice = 'ended';
      this.stopTracks(); update();
    });
    this.room.on(RoomEvent.DataReceived, (data, sender, _kind, topic) => {
      if (data.length > 8192) return;
      try {
        const value = JSON.parse(new TextDecoder().decode(data));
        // Server packets have no participant sender. Never trust a client's
        // claimed name, host prompt or chat permission.
        if (topic === 'classroom-chat' && !sender && typeof value.id === 'string' && typeof value.text === 'string' && value.text.length <= 1000 && typeof value.name === 'string' && typeof value.time === 'number') this.addMessage(value);
        if (topic === 'classroom-control' && !sender && ['removed', 'request_unmute'].includes(value.type)) this.currentNotice = value.type;
        if (topic === 'classroom-recording' && !sender && typeof value.active === 'boolean' && typeof value.status === 'string') this.recordingState = value;
        if (topic === 'classroom-reaction' && sender && ['👍', '👏', '❤️', '😂', '🎉'].includes(value.emoji)) this.showReaction(sender.identity, value.emoji);
        update();
      } catch { /* Ignore malformed data packets. */ }
    });
  }
  private addMessage(message: ClassroomChat) {
    if (!this.history.some(item => item.id === message.id)) this.history = [...this.history.slice(-199), message];
  }
  private showReaction(identity: string, emoji: string) {
    if ((this.reactions.get(identity)?.until || 0) > Date.now() + 2500) return;
    this.reactions.set(identity, { emoji, until: Date.now() + 4000 });
    clearTimeout(this.reactionTimer);
    this.reactionTimer = setTimeout(() => { for (const [id, value] of this.reactions) if (value.until <= Date.now()) this.reactions.delete(id); this.emit(); }, 4100);
  }
  private emit() { for (const fn of this.listeners) fn(); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  recording() { return this.recordingState; }
  async connect(token: RoomToken) {
    try {
      this.sessionId = token.room_name.replace(/^classroom-/, '');
      const url = token.server_url || token.url;
      validateClassroomUrl(url);
      await this.room.connect(url, token.token);
      if (this.closed) throw new Error('Đã rời phòng.');
    } catch (error) {
      await this.disconnect();
      if (!navigator.onLine) throw new ClassroomError('INTERNET_OFFLINE');
      if (error instanceof ConnectionError) {
        if (error.reason === ConnectionErrorReason.NotAllowed) throw new ClassroomError('TOKEN_EXPIRED');
        if (error.reason === ConnectionErrorReason.ServiceNotFound) throw new ClassroomError('ROOM_UNAVAILABLE');
      }
      throw error;
    }
  }
  async publish({ camera, microphone, videoDevice, audioDevice, outputDevice }: ClassroomDevices) {
    let failed = false;
    if (outputDevice) await this.room.switchActiveDevice('audiooutput', outputDevice).catch(() => { failed = true; });
    // Device failure must never disconnect the room or prevent the other device.
    for (const [enabled, activate, deviceId] of [
      [microphone && (this.room.localParticipant.permissions?.canPublishSources?.includes(Track.sourceToProto(Track.Source.Microphone)) ?? true), this.room.localParticipant.setMicrophoneEnabled.bind(this.room.localParticipant), audioDevice],
      [camera, this.room.localParticipant.setCameraEnabled.bind(this.room.localParticipant), videoDevice],
    ] as const) {
      if (!enabled || this.closed) continue;
      try {
        const publication = await activate(true, deviceId ? { deviceId } : undefined);
        if (this.closed) publication?.track?.stop();
      } catch { failed = true; }
    }
    if (failed && !this.closed) throw new ClassroomError('DEVICE_PERMISSION_ERROR');
  }
  private stopTracks() {
    for (const publication of this.room.localParticipant.trackPublications.values()) publication.track?.stop();
  }
  async disconnect() {
    this.closed = true;
    clearTimeout(this.reactionTimer); this.reactions.clear();
    this.stopTracks();
    try { await this.room.disconnect(true); }
    finally { this.stopTracks(); this.room.removeAllListeners(); this.listeners.clear(); }
  }
  connectionState(): ConnectionState {
    const state = this.room.state;
    return state === LKState.Connected ? 'CONNECTED' : state === LKState.Connecting ? 'CONNECTING' : state === LKState.Reconnecting || state === LKState.SignalReconnecting ? 'RECONNECTING' : 'DISCONNECTED';
  }
  participants(): ClassroomParticipant[] {
    if (!['CONNECTED', 'RECONNECTING'].includes(this.connectionState())) return [];
    return [this.room.localParticipant, ...this.room.remoteParticipants.values()].map(p => {
      let metadata: { host?: boolean; hand?: string } = {};
      try { metadata = JSON.parse(p.metadata || '{}'); } catch {}
      const reaction = this.reactions.get(p.identity);
      return ({
      id: p.identity, sid: p.sid, name: p.name || 'Người tham gia', local: p === this.room.localParticipant,
      host: metadata.host === true, hand: metadata.hand || undefined, quality: p.connectionQuality,
      reaction: reaction && reaction.until > Date.now() ? reaction.emoji : undefined,
      screen: p.getTrackPublication(Track.Source.ScreenShare)?.track,
      screenAudio: p === this.room.localParticipant ? undefined : p.getTrackPublication(Track.Source.ScreenShareAudio)?.track,
      mic: p.isMicrophoneEnabled, camera: p.isCameraEnabled, speaking: p.isSpeaking,
      video: p.getTrackPublication(Track.Source.Camera)?.track,
      audio: p === this.room.localParticipant ? undefined : p.getTrackPublication(Track.Source.Microphone)?.track,
    }); });
  }
  localSid() { return this.room.localParticipant.sid; }
  messages() { return this.history; }
  async microphone(enabled: boolean) {
    const publication = await this.room.localParticipant.setMicrophoneEnabled(enabled);
    if (this.closed) { publication?.track?.stop(); throw new Error('Đã rời phòng.'); }
  }
  async camera(enabled: boolean) {
    const publication = await this.room.localParticipant.setCameraEnabled(enabled);
    if (this.closed) { publication?.track?.stop(); throw new Error('Đã rời phòng.'); }
  }
  async chat(text: string) {
    const response = await api.liveClasses.chat(this.sessionId, text);
    this.addMessage(response.data); this.emit();
  }
  async screenShare(enabled: boolean) {
    const publication = await this.room.localParticipant.setScreenShareEnabled(enabled, { audio: true });
    if (this.closed) { publication?.track?.stop(); this.stopTracks(); }
  }
  async switchDevice(kind: MediaDeviceKind, deviceId: string) {
    await this.room.switchActiveDevice(kind, deviceId);
    if (this.closed) this.stopTracks();
  }
  async reaction(emoji: string) {
    if (!['👍', '👏', '❤️', '😂', '🎉'].includes(emoji)) return;
    await this.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ emoji })), { reliable: false, topic: 'classroom-reaction' });
    this.showReaction(this.room.localParticipant.identity, emoji); this.emit();
  }
  policy(): ClassroomPolicy {
    try { return { ...defaultClassroomPolicy, ...JSON.parse(this.room.metadata || '{}').policy }; }
    catch { return defaultClassroomPolicy; }
  }
  notice() { return this.currentNotice; }
  dismissNotice() { this.currentNotice = ''; this.emit(); }
  startAudio() { return this.room.startAudio(); }
  audioBlocked() { return !this.room.canPlaybackAudio; }
}
