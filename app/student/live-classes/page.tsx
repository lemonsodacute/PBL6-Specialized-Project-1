'use client';
import { useEffect, useState } from 'react';
import { Button, Card, LoadingSkeleton } from '@/components/ui';
import { api } from '@/lib/api';
import type { ClassroomSession } from '@/lib/classroom';
import { useCollectionState,useServerCollection } from '@/lib/collections';
import { CollectionToolbar,CollectionPagination,EmptySearchState } from '@/components/collections/CollectionToolbar';
import { StudentPageHeader } from '@/components/student/StudentPageHeader';
import { StudentLiveClassCard } from '@/components/student/StudentLiveClassCard';
import styles from '@/components/student/StudentLiveClasses.module.css';

export default function StudentLiveClasses() {
  const collection=useCollectionState({status:''},'active');
  const {rows:items,total,loading,error,reload:load}=useServerCollection<ClassroomSession>(collection,params=>api.liveClasses.list(params));
  const [notice, setNotice] = useState('');
  useEffect(() => { const notice = new URLSearchParams(window.location.search).get('notice'); setNotice(notice === 'ended' ? 'Buổi học đã kết thúc. Camera và mic đã được đóng.' : notice === 'removed' ? 'Bạn đã được giảng viên đưa ra khỏi lớp.' : notice === 'access' ? 'Bạn không có quyền truy cập buổi học này.' : ''); const timer = window.setInterval(() => { void load(true); }, 10000); return () => window.clearInterval(timer); }, [load]);
  const sorted = [...items].sort((a, b) => Number(b.status === 'ongoing') - Number(a.status === 'ongoing') || new Date(b.scheduled_start).getTime() - new Date(a.scheduled_start).getTime());
  return <div className={`workspace-page classroom-page ${styles.page}`} data-student-online-classes>
    <StudentPageHeader title="Lớp học trực tuyến" />
    {notice && <p className="classroom-notice" role="status">{notice}</p>}
    {error && <p className="classroom-alert" role="alert">{error}</p>}
    <Card className={styles.toolbarCard}>
      <CollectionToolbar actions={<Button className={styles.refresh} variant="outline" onClick={() => void load()}>Làm mới</Button>}
        state={collection} placeholder="Tìm lớp hoặc buổi học..."
        filters={[{key:'status',label:'Trạng thái',options:[{value:'scheduled',label:'Sắp diễn ra'},{value:'ongoing',label:'Đang diễn ra'},{value:'ended',label:'Đã kết thúc'},{value:'cancelled',label:'Đã hủy'}]}]}
        sorts={[{value:'active',label:'Đang học trước'},{value:'newest',label:'Lịch gần nhất'},{value:'oldest',label:'Lịch cũ nhất'}]} />
    </Card>
    {loading ? <LoadingSkeleton rows={3} /> : sorted.length
      ? <div className={`classroom-session-list ${styles.grid}`}>{sorted.map(item => <StudentLiveClassCard key={item.id} session={item} />)}</div>
      : !error && <Card><EmptySearchState mascot state={collection} /></Card>}
    <CollectionPagination state={collection} total={total} count={items.length} loading={loading} />
  </div>;
}
