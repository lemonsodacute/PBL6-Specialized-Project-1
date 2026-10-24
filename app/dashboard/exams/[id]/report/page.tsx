'use client';
import { useParams } from 'next/navigation';
import { TeacherResults } from '@/components/teacher/TeacherResults';
export default function ExamReportPage() {
  const { id } = useParams<{ id: string }>();
  return <TeacherResults examId={id} />;
}
