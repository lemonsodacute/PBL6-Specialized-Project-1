import { ConnectionState as LKState, Room, RoomEvent, Track, type Participant } from 'livekit-client';
import type { ClassroomChat, ClassroomDevices, ClassroomParticipant, ClassroomTransport, ConnectionState, RoomToken } from './classroom';
import { ClassroomError, validateClassroomUrl } from './classroom-errors';

export class LiveKitClassroom implements ClassroomTransport {
  private room = new Room({ adaptiveStream: true, dynacast: true, stopLocalTrackOnUnpublish: true, videoCaptureDefaults: { resolution: { width: 1280, height: 720, frameRate: 24 } } });
  private listeners = new Set<() => void>();
  private closed = false;
  private history: ClassroomChat[] = [];
  constructor() {
    const update = () => { for (const fn of this.listeners) fn(); };
    for (const event of [RoomEvent.ConnectionStateChanged, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged, RoomEvent.AudioPlaybackStatusChanged, RoomEvent.Reconnected]) this.room.on(event, update);
    this.room.on(RoomEvent.Disconnected, () => { this.stopTracks(); update(); });
    this.room.on(RoomEvent.DataReceived, (data, sender, _kind, topic) => {
      if (topic !== 'classroom-chat' || !sender || data.length > 4096) return;
      try {
        const text = JSON.parse(new TextDecoder().decode(data)).text;
        if (typeof text !== 'string' || !text.trim() || text.length > 1000) return;
        this.addMessage(sender, text.trim());
        update();
      } catch { /* Ignore malformed data packets. */ }
    });
  }
  private addMessage(sender: Participant, text: string) {
    this.history = [...this.history.slice(-199), { id: crypto.randomUUID(), sender: sender.identity, name: sender.name || sender.identity, text, time: Date.now() }];
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async connect(token: RoomToken) {
    try {
      const url = token.server_url || token.url;
      validateClassroomUrl(url);
      await this.room.connect(url, token.token);
      if (this.closed) throw new Error('Đã rời phòng.');
    } catch (error) { await this.disconnect(); throw error; }
  }
  async publish({ camera, microphone, videoDevice, audioDevice }: ClassroomDevices) {
    let failed = false;
    // Device failure must never disconnect the room or prevent the other device.
    for (const [enabled, activate, deviceId] of [
      [microphone, this.room.localParticipant.setMicrophoneEnabled.bind(this.room.localParticipant), audioDevice],
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
    this.stopTracks();
    await this.room.disconnect(true);
    this.room.removeAllListeners();
    this.listeners.clear();
  }
  connectionState(): ConnectionState {
    const state = this.room.state;
    return state === LKState.Connected ? 'CONNECTED' : state === LKState.Connecting ? 'CONNECTING' : state === LKState.Reconnecting || state === LKState.SignalReconnecting ? 'RECONNECTING' : 'DISCONNECTED';
  }
  participants(): ClassroomParticipant[] {
    if (!['CONNECTED', 'RECONNECTING'].includes(this.connectionState())) return [];
    return [this.room.localParticipant, ...this.room.remoteParticipants.values()].map(p => ({
      id: p.identity, sid: p.sid, name: p.name || p.identity, local: p === this.room.localParticipant,
      mic: p.isMicrophoneEnabled, camera: p.isCameraEnabled, speaking: p.isSpeaking,
      video: p.getTrackPublication(Track.Source.Camera)?.track,
      audio: p === this.room.localParticipant ? undefined : p.getTrackPublication(Track.Source.Microphone)?.track,
    }));
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
    await this.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ text })), { reliable: true, topic: 'classroom-chat' });
    this.addMessage(this.room.localParticipant, text);
    for (const fn of this.listeners) fn();
  }
  startAudio() { return this.room.startAudio(); }
  audioBlocked() { return !this.room.canPlaybackAudio; }
}
