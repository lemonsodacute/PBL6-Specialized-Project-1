import type { User } from '@/types';
const date = '2026-09-01T08:00:00.000Z';
export const admin: User = { id: 'user-admin-001', full_name: 'Lê Hoàng Admin', email: 'admin@quizlet.local', password_hash: 'mock-hash', role: 'admin', phone: '0900000001', avatar_url: null, is_active: true, last_login_at: date, created_at: date, updated_at: date };
export const teachers: User[] = [
  { id: 'user-teacher-001', full_name: 'Nguyễn Thị Lan', email: 'lan.nguyen@quizlet.local', password_hash: 'mock-hash', role: 'teacher', phone: '0900000011', avatar_url: null, is_active: true, last_login_at: date, created_at: date, updated_at: date },
  { id: 'user-teacher-002', full_name: 'Trần Minh Quân', email: 'quan.tran@quizlet.local', password_hash: 'mock-hash', role: 'teacher', phone: '0900000012', avatar_url: null, is_active: true, last_login_at: date, created_at: date, updated_at: date },
];
export const students: User[] = ['Phạm Minh Anh', 'Đỗ Gia Bảo', 'Vũ Khánh Linh', 'Hoàng Đức Minh', 'Bùi Ngọc Mai', 'Lý Quang Huy', 'Đặng Thu Hà', 'Phan Nhật Nam'].map((full_name, index) => ({ id: `user-student-${String(index + 1).padStart(3, '0')}`, full_name, email: `student${index + 1}@quizlet.local`, password_hash: 'mock-hash', role: 'student', phone: `09100000${String(index + 1).padStart(2, '0')}`, avatar_url: null, is_active: true, last_login_at: date, created_at: date, updated_at: date }));
export const users: User[] = [admin, ...teachers, ...students];
