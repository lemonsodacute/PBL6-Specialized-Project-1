import type { ClassEnrollment } from '@/types';

export const classEnrollments: ClassEnrollment[] = [
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `enrollment-${String(index + 1).padStart(3, '0')}`,
    class_id: 'class-web-001',
    student_id: `user-student-${String(index + 1).padStart(3, '0')}`,
    enrolled_at: '2026-08-02T08:00:00.000Z',
  })),
];
