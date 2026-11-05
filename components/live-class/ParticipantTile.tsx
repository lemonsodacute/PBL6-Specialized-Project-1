'use client';
import { useEffect, useRef } from 'react';
import type { ClassroomParticipant } from '@/lib/classroom';
import { userInitials } from '@/lib/profile';
import { Hand, Mic, MicOff } from 'lucide-react';

export function ParticipantTile({ participant, teacherId }: { participant: ClassroomParticipant; teacherId: string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element || !participant.video) return;
    const track = participant.video; track.attach(element);
    return () => { track.detach(element); };
  }, [participant.video]);
  return <article className={`classroom-tile ${participant.speaking ? 'speaking' : ''}`} data-participant-id={participant.id}><video ref={video} autoPlay muted playsInline className={participant.camera ? '' : 'camera-off'} aria-label={`Camera ${participant.name}`} /><div className="classroom-avatar" hidden={participant.camera && Boolean(participant.video)}>{userInitials(participant.name)}</div>{participant.hand && <span className="classroom-hand" aria-label="Đang giơ tay"><Hand size={20}/></span>}{participant.reaction && <span className="classroom-reaction" role="status" aria-label={`Cảm xúc ${participant.name}`}>{participant.reaction}</span>}<div className="classroom-tile-label"><strong>{participant.name}{participant.local ? ' (Bạn)' : ''}</strong>{participant.id === teacherId && <span className="classroom-teacher-badge">Giảng viên</span>}<span aria-label={participant.mic ? 'Mic bật' : 'Mic tắt'}>{participant.mic ? <Mic size={16}/> : <MicOff size={16}/>}</span><span className="classroom-camera-state">{participant.camera ? 'Camera bật' : 'Camera tắt'}</span></div></article>;
}

export function ClassroomMediaTrack({ track, audio = false, label }: { track: import('@/lib/classroom').ClassroomMedia; audio?: boolean; label?: string }) {
  const element = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => { const target = element.current; if (!target) return; track.attach(target); return () => { track.detach(target); }; }, [track]);
  return audio ? <audio ref={element} autoPlay /> : <video ref={element} autoPlay muted playsInline aria-label={label} />;
}
