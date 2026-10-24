'use client';
import { useEffect, useRef } from 'react';
import type { ClassroomParticipant } from '@/lib/classroom';
import { userInitials } from '@/lib/profile';

export function ParticipantTile({ participant, teacherId }: { participant: ClassroomParticipant; teacherId: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element || !participant.video) return;
    const track = participant.video; track.attach(element);
    return () => { track.detach(element); };
  }, [participant.video]);
  useEffect(() => {
    const element = audio.current;
    if (!element || !participant.audio) return;
    const track = participant.audio; track.attach(element);
    return () => { track.detach(element); };
  }, [participant.audio]);
  return <article className={`classroom-tile ${participant.speaking ? 'speaking' : ''}`} data-participant-id={participant.id}><video ref={video} autoPlay muted playsInline className={participant.camera ? '' : 'camera-off'} aria-label={`Camera ${participant.name}`} /><audio ref={audio} autoPlay /><div className="classroom-avatar" hidden={participant.camera && Boolean(participant.video)}>{userInitials(participant.name)}</div><div className="classroom-tile-label"><strong>{participant.name}{participant.local ? ' (Bạn)' : ''}</strong>{participant.id === teacherId && <span className="classroom-teacher-badge">Giảng viên</span>}<span aria-label={participant.mic ? 'Mic bật' : 'Mic tắt'}>{participant.mic ? '● Mic' : '○ Mic'}</span><span aria-label={participant.camera ? 'Camera bật' : 'Camera tắt'}>{participant.camera ? '● Camera' : '○ Camera'}</span></div></article>;
}
