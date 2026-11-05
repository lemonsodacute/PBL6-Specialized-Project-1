/** Browser QA entry for an already active test attempt. Uses the same media and sampling hooks as the exam. */
import React, { useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useExamMedia } from '@/components/proctoring/useExamMedia';
import { useProctorInput } from '@/components/proctoring/useProctorInput';

function Camera() {
  const attempt = location.hash.slice(1);
  const video = useRef<HTMLVideoElement | null>(null);
  const media = useExamMedia(true, false, attempt);
  const attach = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    media.attachVideo(el);
  }, [media.attachVideo]);
  useProctorInput(attempt, media.ready, video);
  return <><button onClick={() => void media.acquire()}>Start QA camera</button><video ref={attach} autoPlay muted playsInline /></>;
}
createRoot(document.getElementById('root')!).render(<Camera />);
