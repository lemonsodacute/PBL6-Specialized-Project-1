'use client';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';


import { friendlyError } from '@/lib/uiErrors';

import { useCallback, useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Badge, Button, Card, EmptyState, LoadingSkeleton, Table,ConfirmDialog,Toast } from '@/components/ui';
import { api,ApiError } from '@/lib/api';
import { readCollection,useCollectionState } from '@/lib/collections';
import { CollectionToolbar,CollectionPagination,EmptySearchState,commonSorts } from '@/components/collections/CollectionToolbar';
import { RemoteFilterSelect } from '@/components/collections/RemoteFilterSelect';

type Student = { student_code?:string|null;id: string; full_name: string; email: string };
type ClassDetail = { students_count?:number; id: string; name: string; description: string | null; teacher?: { full_name: string } | null; students?: Student[] };
type Enrollment = { id: string; student_id: string; enrolled_at?: string; student?: Student };

const unwrap = <T,>(response: unknown): T => (response as { data: T }).data;
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

export default function ClassDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const collection=useCollectionState({},'name');const [total,setTotal]=useState<number|null>(null);
  const [classItem, setClassItem] = useState<ClassDetail | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [removingStudent,setRemovingStudent]=useState<string|null>(null);const [removing,setRemoving]=useState(false);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [memberError,setMemberError]=useState(''),[notice,setNotice]=useState('');
  const [availableRevision,setAvailableRevision]=useState(0);const membershipBusy=useRef(false);

  const generation=useRef(0);
  const load = useCallback(async () => {
    const version=++generation.current;setLoading(true);setError('');
    try {
      const [classResponse, enrollmentResponse] = await Promise.all([api.classes.get(id,{include_students:false}), api.classes.enrollments(id,collection.params)]);
      if(version!==generation.current)return;
      setClassItem(unwrap<ClassDetail>(classResponse));
      const result=readCollection<Enrollment>(enrollmentResponse);setEnrollments(result.data);setTotal(result.meta?.total??null);
      setError('');
    } catch (cause) {
      if(version===generation.current){setEnrollments([]);setError(friendlyError(cause, 'Không tải được thông tin lớp học.'));}
    } finally {
      if(version===generation.current)setLoading(false);
    }
  }, [id,collection.key]);

  useEffect(() => { if(collection.ready) void load(); return()=>{generation.current++;}; }, [load,collection.ready]);

  const removeStudent = async (studentId: string) => {
    if(membershipBusy.current)return;membershipBusy.current=true;setRemoving(true);setMemberError('');setNotice('');
    try {
      await api.classes.unenroll(id, studentId);setRemovingStudent(null);
      setSelectedStudentId('');setAvailableRevision(value=>value+1);setNotice('Đã xóa sinh viên khỏi lớp.');
      await load();
    } catch (cause) {
      setMemberError(friendlyError(cause, 'Không thể xoá học sinh khỏi lớp.'));
    }finally{membershipBusy.current=false;setRemoving(false);}
  };

  const addStudent = async () => {
    if (!selectedStudentId||membershipBusy.current) return;
    membershipBusy.current=true;setAdding(true);setMemberError('');setNotice('');
    try {
      await api.classes.enroll(id, { student_id: selectedStudentId });
      setSelectedStudentId('');setAvailableRevision(value=>value+1);setNotice('Đã thêm sinh viên vào lớp.');
      await load();
    } catch (cause) {
      if(cause instanceof ApiError&&['STUDENT_ALREADY_ENROLLED','ALREADY_ENROLLED'].includes(cause.code??'')){
        setSelectedStudentId('');setAvailableRevision(value=>value+1);await load();
      }
      setMemberError(friendlyError(cause, 'Không thể thêm học sinh vào lớp.'));
    } finally {
      membershipBusy.current=false;setAdding(false);
    }
  };

  if (loading && !classItem) return <div className="workspace-page"><LoadingSkeleton rows={3} /></div>;
  if (!classItem) return <div className="workspace-page"><Card><p role="alert">{error || 'Không tìm thấy lớp học.'}</p><Button variant="outline" onClick={() => router.push('/dashboard/classes')}><ArrowLeft className="inline-icon" aria-hidden="true" /> Quay lại danh sách lớp</Button></Card></div>;

  const students = enrollments.map((enrollment) => enrollment.student).filter((student): student is Student => Boolean(student));
  return <div className="workspace-page"><ConfirmDialog open={!!removingStudent} title="Xóa sinh viên khỏi lớp?" description="Sinh viên sẽ không còn truy cập nội dung được giao qua lớp này." busy={removing} error={memberError} onCancel={()=>setRemovingStudent(null)} onConfirm={()=>{if(removingStudent)void removeStudent(removingStudent);}}/><Link className="back-link" href="/dashboard/classes"><ArrowLeft className="inline-icon" aria-hidden="true" /> Quay lại danh sách lớp</Link><PageHeader mode="context" context="Lớp học"  title={<>{classItem.name}</>}  actions={<> <Badge>{classItem.teacher?.full_name ?? 'Lớp của tôi'}</Badge> </>} />{classItem.description&&<p className="detail-meta">{classItem.description}</p>}{notice&&<Toast severity="low">{notice}</Toast>}{memberError&&<p role="alert">{memberError}</p>}<Card><div className="card-toolbar"><div><h2>Danh sách học sinh</h2><p>{classItem.students_count??total??students.length} học sinh đang được gán vào lớp này.</p></div><div className="action-row"><RemoteFilterSelect source="students" classId={id} refreshKey={availableRevision} disabled={adding||removing} label="Sinh viên để thêm" value={selectedStudentId} onChange={setSelectedStudentId}/><Button disabled={!selectedStudentId || adding || removing} onClick={() => void addStudent()}>{adding ? 'Đang thêm...' : 'Thêm thành viên'}</Button></div></div><div>{error&&<p role="alert">{error}<Button onClick={()=>void load()}>Thử lại</Button></p>}</div><CollectionToolbar state={collection} placeholder="Tìm theo tên, MSSV hoặc email..." sorts={commonSorts}/><CollectionPagination state={collection} total={total} count={students.length} loading={loading||collection.pending}/>
{loading?<LoadingSkeleton rows={3}/>:error?null:students.length ? <Table><thead><tr><th>Học sinh</th><th>MSSV</th><th>Email</th><th>Ngày tham gia</th><th /></tr></thead><tbody>{students.map((student) => { const enrollment = enrollments.find((item) => item.student_id === student.id); return <tr key={student.id}><td><strong>{student.full_name}</strong></td><td>{student.student_code||'—'}</td><td>{student.email}</td><td>{formatDate(enrollment?.enrolled_at)}</td><td><Button variant="danger" size="sm" disabled={adding||removing} onClick={() => {setMemberError('');setRemovingStudent(student.id);}}>Xoá khỏi lớp</Button></td></tr>; })}</tbody></Table> : collection.active?<EmptySearchState state={collection}/>:<EmptyState title="Chưa có học sinh">Lớp này chưa có học sinh nào được gán.</EmptyState>}</Card></div>;
}
