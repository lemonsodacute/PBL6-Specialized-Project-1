'use client';
import {useMemo} from 'react';

import Link from 'next/link';
import {Button,Card,EmptyState,LoadingSkeleton} from '@/components/ui';
import {useAuth} from '@/components/auth/AuthContext';
import {StudentExamCard,type StudentExamListItem} from '@/components/student/StudentExamCard';
import {useStudentExamRefresh} from '@/components/student/useStudentExamRefresh';
import {api} from '@/lib/api';
import {readCollection,useCollectionState,useServerCollection} from '@/lib/collections';
import {CollectionToolbar,EmptySearchState} from '@/components/collections/CollectionToolbar';
import {actionableExamGroups,groupStudentActionableExams} from '@/lib/studentExamStatus';
import {StudentPageHeader} from '@/components/student/StudentPageHeader';

export default function StudentExamsPage(){
  const {user}=useAuth(),collection=useCollectionState({period:''});
  const {rows:exams,loading,error,reload}=useServerCollection<StudentExamListItem>(collection,async params=>{
    // The student endpoint filters before returning all actionable exams. Old page/sort
    // URL parameters cannot hide an active attempt or change section priorities.
    const result=readCollection<StudentExamListItem>(await api.exams.list({...params,actionable_only:true,period:undefined,page:undefined,limit:undefined,sort:'newest'}));
    return {data:result.data};
  },undefined,user?.id??'');
  const now=useStudentExamRefresh(reload,user?.id);
  const grouped=useMemo(()=>{
    const groups=groupStudentActionableExams(exams,user?.id,now);
    if(collection.values.period){
      for(const group of actionableExamGroups)groups[group]=groups[group].filter(item=>item.state.status===collection.values.period);
    }
    return groups;
  },[exams,user?.id,now,collection.values.period]);
  const count=actionableExamGroups.reduce((sum,group)=>sum+grouped[group].length,0);
  return <div className="workspace-page student-exams-page">
    <StudentPageHeader title="Bài kiểm tra"/>
    <p>Tiếp tục bài đang làm, bắt đầu bài đang mở hoặc xem lịch kiểm tra sắp tới. Bài đã hoàn thành nằm trong <Link className="table-link" href="/student/grades">Điểm số / Kết quả</Link>.</p>
    {(collection.active||exams.length>10)&&<Card><CollectionToolbar state={collection} placeholder="Tìm đề thi..." filters={[{key:'period',label:'Trạng thái',options:[{value:'in_progress',label:'Đang làm'},{value:'open',label:'Đang diễn ra'},{value:'upcoming',label:'Sắp diễn ra'}]}]}/></Card>}
    {loading&&<LoadingSkeleton rows={5}/>}{error&&<Card><p role="alert">{error}</p><Button variant="warning" onClick={()=>void reload()}>Thử lại</Button></Card>}
    {!loading&&!error&&actionableExamGroups.map(group=>grouped[group].length?<section className="student-exam-section" key={group}><div className="student-exam-section-heading" data-chat-avoid><h2>{{upcoming:'Sắp diễn ra',current:'Đang làm',open:'Đang diễn ra'}[group]}</h2><span>{grouped[group].length} đề thi</span></div><div className="student-exam-grid">{grouped[group].map(({exam,state})=><StudentExamCard key={exam.id} exam={exam} state={state}/>)}</div></section>:null)}
    {!loading&&!error&&!count&&<Card>{collection.active?<EmptySearchState mascot state={collection}/>:<EmptyState mascot title="Hiện không có bài kiểm tra cần làm."><Link className="table-link" href="/student/grades">Xem điểm số / kết quả</Link></EmptyState>}</Card>}
  </div>;
}
