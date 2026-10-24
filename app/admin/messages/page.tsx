import { Suspense } from 'react';
import { AdminInbox } from '@/components/chat/AdminInbox';

export default function MessagesPage() {
  return <Suspense fallback={<p role="status">Đang tải hộp thư...</p>}><AdminInbox /></Suspense>;
}
