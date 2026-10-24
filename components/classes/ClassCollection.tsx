'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useCollectionState,useServerCollection } from '@/lib/collections';
import { Button,Card,Table,LoadingSkeleton,Modal,Badge,ActionMenu,ConfirmDialog } from '@/components/ui';
import { CollectionToolbar,CollectionPagination,EmptySearchState,commonSorts } from '@/components/collections/CollectionToolbar';
import { friendlyError } from '@/lib/uiErrors';
import { BookOpen, ArrowRight } from 'lucide-react';
import { StudentPageHeader } from '@/components/student/StudentPageHeader';
type ClassRow={id:string;name:string;description:string|null;students_count:number;exams_count:number;created_at:string;teacher:{id:string;full_name:string;email:string}|null};
export function ClassCollection({role}:{role:'admin'|'teacher'|'student'}) {
  const state=useCollectionState({teacher_id:''});const result=useServerCollection<ClassRow>(state,params=>api.classes.list(params));
  const [confirm,setConfirm]=useState<ClassRow|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function remove(){if(!confirm||busy)return;setBusy(true);setError('');try{await api.classes.delete(confirm.id);setConfirm(null);await result.reload();}catch(cause){setError(friendlyError(cause));}finally{setBusy(false);}}
  const prefix=role==='admin'?'/admin/classes':role==='teacher'?'/dashboard/classes':'/student/classes';
  return <div className="workspace-page">
    {role==='student'&&<StudentPageHeader title="Lớp học phần"/>}
    {role==='student'&&state.ready&&typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('error')==='class_access'&&<Card role="alert">Bạn không có quyền xem lớp học này.</Card>}
    <Card><CollectionToolbar actions={role==='admin'?<Link className="ui-button ui-button-primary" href="/admin/classes/new">+ Tạo lớp học</Link>:undefined} state={state} placeholder="Tìm lớp học..." sorts={commonSorts} filters={role==='admin'?[{key:'teacher_id',label:'Giảng viên',source:'teachers',options:[]}]:[]}/></Card>
    {(result.error||error)&&<Card role="alert"><p>{result.error||error}</p><Button onClick={()=>void result.reload()}>Thử lại</Button></Card>}
    {result.loading?<LoadingSkeleton rows={4}/>:!result.error&&<Card className={role==='student'?'student-course-results':undefined}>{result.rows.length?role==='student'?<div className="student-course-grid">{result.rows.map(item=><Card className="student-course-card" key={item.id} data-chat-avoid>
      <span className="course-icon"><BookOpen size={24} aria-hidden="true"/></span>
      <h2><Link href={`${prefix}/${item.id}`}>{item.name}</Link></h2>
      {item.description&&<p>{item.description}</p>}
      <p>Giảng viên: {item.teacher?.full_name??'Chưa phân công'}</p>
      <footer><span>{item.students_count!==undefined?`${item.students_count} sinh viên`:'Chưa có sĩ số'}</span><Link href={`${prefix}/${item.id}`}>Mở lớp<ArrowRight size={17} aria-hidden="true"/></Link></footer>
    </Card>)}</div>:<Table label="Danh sách lớp học"><thead><tr><th>Tên lớp</th><th>Giảng viên</th><th>Sinh viên</th>{role==='admin'&&<><th>Đề thi</th><th>Ngày tạo</th><th>Thao tác</th></>}</tr></thead><tbody>{result.rows.map(item=><tr key={item.id}><td><Link className="table-link" href={`${prefix}/${item.id}`}>{item.name}</Link><small className="table-description">{item.description??'—'}</small></td><td>{item.teacher?.full_name??'Chưa phân công'}</td><td><Badge>{item.students_count}</Badge></td>{role==='admin'&&<><td>{item.exams_count}</td><td>{new Date(item.created_at).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</td><td><div className="row-actions"><Link className="ui-button ui-button-outline ui-button-sm" href={`${prefix}/${item.id}`}>Xem / Sửa</Link><ActionMenu label={`Thao tác lớp ${item.name}`} items={[{label:'Xóa',tone:'danger',onSelect:()=>{setError('');setConfirm(item);}}]}/></div></td></>}</tr>)}</tbody></Table>:<EmptySearchState mascot state={state}/>}<CollectionPagination state={state} total={result.total} count={result.rows.length}/></Card>}
    <ConfirmDialog open={!!confirm} title="Xóa lớp học" description={`Xóa lớp ${confirm?.name??''}?`} confirmLabel="Xác nhận xóa" busy={busy} error={error} onCancel={()=>setConfirm(null)} onConfirm={()=>void remove()}>{confirm&&(confirm.students_count>0||confirm.exams_count>0)&&<p>Lớp có {confirm.students_count} sinh viên và {confirm.exams_count} đề thi được giao. Dữ liệu liên kết sẽ bị xóa theo lớp.</p>}</ConfirmDialog>
  </div>;
}
