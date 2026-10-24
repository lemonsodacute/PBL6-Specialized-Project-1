'use client';

import { ArrowLeft } from 'lucide-react';
import { friendlyError } from '@/lib/uiErrors';

import { useCallback, useEffect, useState,useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, Card, EmptyState, Input, LoadingSkeleton, Select, Table, Textarea, Toast,ConfirmDialog,PageHeader } from '@/components/ui';
import { api,ApiError } from '@/lib/api';
import { readCollection,useCollectionState,useServerCollection } from '@/lib/collections';
import { CollectionToolbar,CollectionPagination,EmptySearchState,commonSorts } from '@/components/collections/CollectionToolbar';
import { RemoteFilterSelect } from '@/components/collections/RemoteFilterSelect';

type User = { student_code?:string|null;id: string; full_name: string; email: string };
type ClassData = { students_count?:number;id: string; name: string; description: string | null; homeroom_teacher_id: string; teacher: User | null };
type Enrollment = { id: string; student_id: string; student: User };
type Assignment = { id: string; exam_id: string; class_id: string; exam?: { id: string; title: string; status: string; start_time?: string; end_time?: string } | null };
type Tab = 'info' | 'students' | 'exams';
const unwrap = <T,>(response: unknown): T => ((response as { data?: T }).data ?? response) as T;

export default function AdminClassDetailPage() {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const isNew = id === 'new';
  const collection=useCollectionState({},'name');const [total,setTotal]=useState<number|null>(null);
  const [tab, setTab] = useState<Tab>('info'); const [classData, setClassData] = useState<ClassData>({ id: '', name: '', description: '', homeroom_teacher_id: '', teacher: null });
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selectedStudent, setSelectedStudent] = useState(''); const [bulkText, setBulkText] = useState(''); const [bulkResult, setBulkResult] = useState<string[]>([]);
  const [removingStudent,setRemovingStudent]=useState<string|null>(null);const [removing,setRemoving]=useState(false);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [memberError,setMemberError]=useState(''),[adding,setAdding]=useState(false),[bulkAdding,setBulkAdding]=useState(false);
  const [availableRevision,setAvailableRevision]=useState(0);const membershipBusy=useRef(false);

  const generation=useRef(0);
  const assignmentState=useCollectionState({},'newest',false);
  const assignmentResult=useServerCollection<Assignment>(assignmentState,params=>isNew?Promise.resolve({data:[],meta:{total:0,page:1,limit:20}}):api.examAssignments.list({...params,classId:id}),undefined,id);
  const load = useCallback(async () => {
    const version=++generation.current;setLoading(true);
    try {
      if (!isNew) {
        const [classResponse, enrollmentResponse] = await Promise.all([api.classes.get(id,{include_students:false}), api.classes.enrollments(id,collection.params)]);
        if(version!==generation.current)return;
        setClassData(current=>current.id===id?{...current,students_count:unwrap<ClassData>(classResponse).students_count}:unwrap<ClassData>(classResponse)); const result=readCollection<Enrollment>(enrollmentResponse);setEnrollments(result.data);setTotal(result.meta?.total??null);
      }
      setError('');
    } catch (cause) { if(version===generation.current){setEnrollments([]);setError(friendlyError(cause, 'Không tải được thông tin lớp học.'));} }
    finally { if(version===generation.current)setLoading(false); }
  }, [id, isNew,collection.key]);
  useEffect(() => { if(collection.ready) void load();return()=>{generation.current++;}; }, [load,collection.ready]);


  const save = async () => { if (!classData.name.trim()) return setError('Tên lớp là bắt buộc.'); if (!classData.homeroom_teacher_id) return setError('Vui lòng chọn giáo viên chủ nhiệm.'); setSaving(true); setError(''); try { const response = isNew ? await api.classes.create({ name: classData.name.trim(), description: classData.description?.trim() || null, homeroom_teacher_id: classData.homeroom_teacher_id }) : await api.classes.update(id, { name: classData.name.trim(), description: classData.description?.trim() || null, homeroom_teacher_id: classData.homeroom_teacher_id }); setNotice('Đã lưu thông tin lớp học.'); if (isNew) router.replace(`/admin/classes/${unwrap<ClassData>(response).id}`); } catch (cause) { setError(friendlyError(cause, 'Không thể lưu lớp học.')); } finally { setSaving(false); } };
  const refreshMembers = async () => {setSelectedStudent('');setAvailableRevision(value=>value+1);await load();};
  const addStudent = async (studentId: string) => {
    if(!studentId||membershipBusy.current)return;membershipBusy.current=true;setAdding(true);setMemberError('');setNotice('');
    try {await api.classes.enroll(id,{student_id:studentId});setNotice('Đã thêm sinh viên vào lớp.');await refreshMembers();}
    catch(cause){
      if(cause instanceof ApiError&&['STUDENT_ALREADY_ENROLLED','ALREADY_ENROLLED'].includes(cause.code??''))await refreshMembers();
      setMemberError(friendlyError(cause,'Không thể thêm sinh viên.'));
    }finally{membershipBusy.current=false;setAdding(false);}
  };
  const removeStudent = async (studentId: string) => {
    if(membershipBusy.current)return;membershipBusy.current=true;setRemoving(true);setMemberError('');setNotice('');
    try {await api.classes.unenroll(id,studentId);setNotice('Đã xoá sinh viên khỏi lớp.');setRemovingStudent(null);await refreshMembers();}
    catch(cause){setMemberError(friendlyError(cause,'Không thể xoá sinh viên.'));}
    finally{membershipBusy.current=false;setRemoving(false);}
  };
  const addBulk = async () => {
    if(!bulkText.trim()||membershipBusy.current)return;membershipBusy.current=true;setBulkAdding(true);setMemberError('');setNotice('');
    const values=bulkText.split(/[\n,;]+/).map(value=>value.trim().toLowerCase()).filter(Boolean),failed:string[]=[];
    const seen=new Set(enrollments.map(item=>item.student_id));
    try {
      for(const value of values){
        try {
          const candidates=readCollection<User>(await api.classes.availableStudents(id,{q:value,page:1,limit:100})).data;
          const student=candidates.find(item=>item.email.toLowerCase()===value||item.full_name.toLowerCase()===value);
          if(!student||seen.has(student.id)){failed.push(`${value}: không tìm thấy hoặc đã có trong lớp`);continue;}
          await api.classes.enroll(id,{student_id:student.id});seen.add(student.id);
        }catch(cause){failed.push(`${value}: ${friendlyError(cause,'Không thể thêm sinh viên.')}`);}
      }
      setBulkResult(failed);setBulkText('');setNotice(`Đã xử lý ${values.length-failed.length}/${values.length} dòng.`);await refreshMembers();
    }finally{membershipBusy.current=false;setBulkAdding(false);}
  };

  if (loading && !classData.id && !isNew) return <div className="space-y-6"><LoadingSkeleton rows={5} /></div>;
  if (error && !classData.id && !isNew) return <div className="space-y-6"><Card><p role="alert" className="text-red-600">{error}</p><Button variant="outline" onClick={() => router.push('/admin/classes')}>Quay lại</Button></Card></div>;
  return <div className="space-y-6"><ConfirmDialog open={!!removingStudent} title="Xóa sinh viên khỏi lớp?" description="Sinh viên sẽ không còn truy cập nội dung được giao qua lớp này." busy={removing} error={memberError} onCancel={()=>setRemovingStudent(null)} onConfirm={()=>{if(removingStudent)void removeStudent(removingStudent);}}/><Button variant="outline" onClick={() => router.push('/admin/classes')}><ArrowLeft className="inline-icon" aria-hidden="true" /> Quay lại</Button><PageHeader mode="context" context="Lớp học" title={isNew ? 'Tạo lớp học mới' : classData.name}/>{error && <Card><p role="alert" className="text-red-600">{error}</p></Card>}{memberError&&<Card><p role="alert">{memberError}</p></Card>}{notice && <Toast severity="low">{notice}</Toast>}{!isNew && <div className="flex gap-5 overflow-x-auto border-b border-slate-200"><button className={`pb-2 ${tab === 'info' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-slate-500'}`} onClick={() => setTab('info')}>Thông tin</button><button className={`pb-2 ${tab === 'students' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-slate-500'}`} onClick={() => setTab('students')}>Sinh viên ({classData.students_count??'—'})</button><button className={`pb-2 ${tab === 'exams' ? 'border-b-2 border-blue-600 font-semibold text-blue-600' : 'text-slate-500'}`} onClick={() => setTab('exams')}>Đề thi ({assignmentResult.total??'—'})</button></div>}
    {tab === 'info' && <Card className="form-panel form-stack"><label className="block space-y-2"><span className="font-medium">Tên lớp <span className="text-red-500">*</span></span><Input value={classData.name} onChange={(event) => setClassData((current) => ({ ...current, name: event.target.value }))} /></label><label className="block space-y-2"><span className="font-medium">Mô tả</span><Textarea rows={4} value={classData.description ?? ''} onChange={(event) => setClassData((current) => ({ ...current, description: event.target.value }))} /></label><label className="block space-y-2"><span className="font-medium">Giáo viên chủ nhiệm <span className="text-red-500">*</span></span><RemoteFilterSelect source="teachers" label="Giáo viên chủ nhiệm" value={classData.homeroom_teacher_id} onChange={value=>setClassData(current=>({...current,homeroom_teacher_id:value}))}/></label><div className="form-actions"><Button variant="outline" onClick={() => router.push('/admin/classes')}>Huỷ</Button><Button variant="success" onClick={() => void save()} disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu'}</Button></div></Card>}
    {tab === 'students' && <div className="space-y-5"><Card className="space-y-4"><h3 className="font-semibold">Thêm sinh viên</h3><div className="form-toolbar"><RemoteFilterSelect source="students" classId={id} refreshKey={availableRevision} disabled={adding||removing||bulkAdding} label="Sinh viên để thêm" value={selectedStudent} onChange={setSelectedStudent}/><Button onClick={() => void addStudent(selectedStudent)} disabled={!selectedStudent||adding||removing||bulkAdding}>{adding?'Đang thêm...':'Thêm'}</Button></div><Textarea disabled={adding||removing||bulkAdding} rows={3} placeholder="Dán email hoặc họ tên, mỗi dòng một tài khoản..." value={bulkText} onChange={(event) => setBulkText(event.target.value)} /><div className="form-toolbar"><small className="text-slate-500">Không trùng sinh viên; dòng không tìm thấy sẽ được báo lại.</small><Button variant="outline" onClick={() => void addBulk()} disabled={!bulkText.trim()||adding||removing||bulkAdding}>{bulkAdding?'Đang thêm...':'Thêm hàng loạt'}</Button></div>{bulkResult.length > 0 && <div className="rounded bg-orange-50 p-3 text-sm text-orange-800"><strong>Dòng chưa thêm:</strong><ul className="list-inside list-disc">{bulkResult.map((item) => <li key={item}>{item}</li>)}</ul></div>}</Card><Card><CollectionToolbar state={collection} placeholder="Tìm theo tên, MSSV hoặc email..." sorts={commonSorts}/><CollectionPagination state={collection} total={total} count={enrollments.length} loading={loading||collection.pending}/>{loading?<LoadingSkeleton rows={3}/>:error?null:enrollments.length ? <Table><thead><tr><th>Sinh viên</th><th>MSSV</th><th>Email</th><th /></tr></thead><tbody>{enrollments.map((enrollment) => <tr key={enrollment.id}><td>{enrollment.student.full_name}</td><td>{enrollment.student.student_code||'—'}</td><td>{enrollment.student.email}</td><td className="text-right"><Button variant="danger" size="sm" disabled={adding||removing||bulkAdding} onClick={() => {setMemberError('');setRemovingStudent(enrollment.student_id);}}>Xoá khỏi lớp</Button></td></tr>)}</tbody></Table> : collection.active?<EmptySearchState state={collection}/>:<EmptyState title="Chưa có sinh viên">Lớp chưa có sinh viên nào.</EmptyState>}</Card></div>}
    {tab === 'exams' && <Card><CollectionToolbar state={assignmentState} placeholder="Tìm đề thi..." sorts={commonSorts}/>{assignmentResult.error&&<p role="alert">{assignmentResult.error}<Button onClick={()=>void assignmentResult.reload()}>Thử lại</Button></p>}{assignmentResult.loading?<LoadingSkeleton rows={3}/>:assignmentResult.error?null:assignmentResult.rows.length ? <Table><thead><tr><th>Đề thi</th><th>Trạng thái</th><th>Thời gian</th><th /></tr></thead><tbody>{assignmentResult.rows.map((assignment) => <tr key={assignment.id}><td>{assignment.exam?.title ?? assignment.exam_id}</td><td>{assignment.exam?.status ?? '—'}</td><td>{assignment.exam?.start_time ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(assignment.exam.start_time)) : '—'}</td><td className="text-right"><a className="table-link" href={`/dashboard/exams/${assignment.exam_id}`}>Xem đề thi</a></td></tr>)}</tbody></Table> : assignmentState.active?<EmptySearchState state={assignmentState}/>:<EmptyState title="Chưa có đề thi">Chưa có đề thi nào được giao cho lớp này.</EmptyState>}<CollectionPagination state={assignmentState} total={assignmentResult.total} count={assignmentResult.rows.length} loading={assignmentResult.loading}/></Card>}
  </div>;
}
