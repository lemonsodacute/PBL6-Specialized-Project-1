'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useCollectionState,useServerCollection } from '@/lib/collections';
import { Button,Card,Table,LoadingSkeleton,Badge,ActionMenu,ConfirmDialog } from '@/components/ui';
import { CollectionToolbar,CollectionPagination,EmptySearchState,commonSorts } from '@/components/collections/CollectionToolbar';
import { friendlyError } from '@/lib/uiErrors';
import { TeacherClassList } from './TeacherClassList';
import { ClassCollectionList } from './ClassCollectionList';
export type ClassRow={id:string;name:string;description:string|null;students_count:number;exams_count:number;created_at:string;teacher:{id:string;full_name:string;email:string}|null};
export function ClassCollection({role}:{role:'admin'|'teacher'|'student'}) {
  const state=useCollectionState({teacher_id:''});const result=useServerCollection<ClassRow>(state,params=>api.classes.list(params));
  const [confirm,setConfirm]=useState<ClassRow|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function remove(){if(!confirm||busy)return;setBusy(true);setError('');try{await api.classes.delete(confirm.id);setConfirm(null);await result.reload();}catch(cause){setError(friendlyError(cause));}finally{setBusy(false);}}
  if(role==='teacher') return <TeacherClassList state={state} rows={result.rows} total={result.total} loading={result.loading} error={result.error||error} onRetry={result.reload}/>;
  if(role==='student') return <ClassCollectionList audience="student" state={state} rows={result.rows} total={result.total} loading={result.loading} error={result.error||error} onRetry={result.reload}
    accessDenied={state.ready&&typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('error')==='class_access'}/>;
  const prefix='/admin/classes';
  return <div className="workspace-page">
    <Card><CollectionToolbar actions={<Link className="ui-button ui-button-primary" href="/admin/classes/new">+ Tạo lớp học</Link>} state={state} placeholder="Tìm lớp học..." sorts={commonSorts} filters={[{key:'teacher_id',label:'Giảng viên',source:'teachers',options:[]}]}/></Card>
    {(result.error||error)&&<Card role="alert"><p>{result.error||error}</p><Button onClick={()=>void result.reload()}>Thử lại</Button></Card>}
    {result.loading?<LoadingSkeleton rows={4}/>:!result.error&&<Card borderRole="classes">{result.rows.length?<Table label="Danh sách lớp học"><thead><tr><th>Tên lớp</th><th>Giảng viên</th><th>Sinh viên</th><th>Đề thi</th><th>Ngày tạo</th><th>Thao tác</th></tr></thead><tbody>{result.rows.map(item=><tr key={item.id}><td><Link className="table-link" href={`${prefix}/${item.id}`}>{item.name}</Link><small className="table-description">{item.description??'—'}</small></td><td>{item.teacher?.full_name??'Chưa phân công'}</td><td><Badge>{item.students_count}</Badge></td><td>{item.exams_count}</td><td>{new Date(item.created_at).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</td><td><div className="row-actions"><Link className="ui-button ui-button-outline ui-button-sm" href={`${prefix}/${item.id}`}>Xem / Sửa</Link><ActionMenu label={`Thao tác lớp ${item.name}`} items={[{label:'Xóa',tone:'danger',onSelect:()=>{setError('');setConfirm(item);}}]}/></div></td></tr>)}</tbody></Table>:<EmptySearchState mascot state={state}/>}<CollectionPagination state={state} total={result.total} count={result.rows.length}/></Card>}
    <ConfirmDialog open={!!confirm} title="Xóa lớp học" description={`Xóa lớp ${confirm?.name??''}?`} confirmLabel="Xác nhận xóa" busy={busy} error={error} onCancel={()=>setConfirm(null)} onConfirm={()=>void remove()}>{confirm&&(confirm.students_count>0||confirm.exams_count>0)&&<p>Lớp có {confirm.students_count} sinh viên và {confirm.exams_count} đề thi được giao. Dữ liệu liên kết sẽ bị xóa theo lớp.</p>}</ConfirmDialog>
  </div>;
}
