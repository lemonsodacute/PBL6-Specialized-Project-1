'use client';
import { useParams } from 'next/navigation';
import { ProctorConsole } from '@/components/proctoring/ProctorConsole';

export default function MonitorPage() {
  const { examId, attemptId } = useParams<{ examId: string; attemptId?: string }>();
  return <ProctorConsole key={examId} examId={examId} linkedAttemptId={attemptId} />;
}
