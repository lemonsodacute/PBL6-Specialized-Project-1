'use client';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui';
import { PageHeader } from '@/components/ui/PageHeader';
import { ExamEditor } from '@/components/teacher/ExamEditor';

export default function ExamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  return <div className="workspace-page"><PageHeader mode="context" context="Đề thi"  title="Chỉnh sửa đề thi"  />
    <Card className="form-panel"><ExamEditor examId={id} onCancel={() => router.push('/dashboard/exams')} onSaved={() => router.push('/dashboard/exams')} /></Card>
  </div>;
}
