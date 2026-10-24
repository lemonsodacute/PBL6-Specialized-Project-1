'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, EmptyState, LoadingSkeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { classroomDate, type ClassroomSession } from '@/lib/classroom';
import { friendlyError } from '@/lib/uiErrors';
import { useCollectionState,useServerCollection } from '@/lib/collections';
import { CollectionToolbar,CollectionPagination,EmptySearchState } from '@/components/collections/CollectionToolbar';
import { StudentPageHeader } from '@/components/student/StudentPageHeader';

export default function StudentLiveClasses() {
  const collection=useCollectionState({status:''},'active');
  const {rows:items,total,loading,error,reload:load}=useServerCollection<ClassroomSession>(collection,params=>api.liveClasses.list(params));
  const [notice, setNotice] = useState('');
  useEffect(() => { const notice = new URLSearchParams(window.location.search).get('notice'); setNotice(notice === 'ended' ? 'Buổi học đã kết thúc. Camera và mic đã được đóng.' : notice === 'access' ? 'Bạn không có quyền truy cập buổi học này.' : ''); const timer = window.setInterval(() => { void load(true); }, 10000); return () => window.clearInterval(timer); }, [load]);
  const sorted = [...items].sort((a, b) => Number(b.status === 'ongoing') - Number(a.status === 'ongoing') || new Date(b.scheduled_start).getTime() - new Date(a.scheduled_start).getTime());
  return <div className="workspace-page classroom-page"><StudentPageHeader title="Lớp học trực tuyến"/>{notice && <p className="classroom-notice" role="status">{notice}</p>}{error && <p className="classroom-alert" role="alert">{error}</p>}{<Card><CollectionToolbar actions={<Button variant="outline" onClick={() => void load()}>Làm mới</Button>} state={collection} placeholder="Tìm lớp hoặc buổi học..." filters={[{key:'status',label:'Trạng thái',options:[{value:'scheduled',label:'Sắp diễn ra'},{value:'ongoing',label:'Đang diễn ra'},{value:'ended',label:'Đã kết thúc'},{value:'cancelled',label:'Đã hủy'}]}]} sorts={[{value:'active',label:'Đang học trước'},{value:'newest',label:'Lịch gần nhất'},{value:'oldest',label:'Lịch cũ nhất'}]}/></Card>}{loading ? <LoadingSkeleton rows={3} /> : sorted.length ? <div className="classroom-session-list">{sorted.map(item => <Card className="classroom-session-card" key={item.id} data-chat-avoid><div><Badge className={`status-badge ${item.status === 'ongoing' ? 'exam-status-ongoing' : item.status === 'scheduled' ? 'exam-status-published' : 'exam-status-closed'}`}>{({ scheduled: 'Sắp diễn ra', ongoing: 'Đang diễn ra', ended: 'Đã kết thúc', cancelled: 'Đã hủy' })[item.status]}</Badge><h2>{item.title}</h2><p>{item.class_name}</p><small>Giảng viên: {item.teacher_name || '—'}</small>{item.description && <p>{item.description}</p>}<p>{classroomDate(item.scheduled_start)} – {classroomDate(item.scheduled_end)}</p></div>{item.status === 'ongoing' && <Link href={`/live-class/${item.id}`} className="ui-button ui-button-filled-pill">Tham gia phòng</Link>}</Card>)}</div> : !error&&<Card><EmptySearchState mascot state={collection}/></Card>}<CollectionPagination state={collection} total={total} count={items.length} loading={loading}/></div>;
}
