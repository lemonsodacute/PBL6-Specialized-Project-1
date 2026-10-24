import type { Metadata } from 'next';
import { LandingPage } from '@/components/public/LandingPage';

export const metadata: Metadata = {
  title: 'ProctoOwl - Giám thị AI hỗ trợ thi trực tuyến',
  description: 'Nền tảng hỗ trợ quản lý bài thi, lớp học, xác minh danh tính và giám sát thi trực tuyến.',
  openGraph: {
    title: 'ProctoOwl - Giám thị AI hỗ trợ thi trực tuyến',
    description: 'Hỗ trợ tổ chức bài thi, xác minh danh tính, giám sát và quản lý kết quả. Giảng viên đưa ra quyết định cuối cùng.',
    type: 'website',
    locale: 'vi_VN',
  },
};

export default function HomePage() {
  return <LandingPage />;
}
