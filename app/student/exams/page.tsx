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
import {CalendarDays} from 'lucide-react';
import {ProctoOwlMascot} from '@/components/brand/ProctoOwlMascot';
import styles from '@/components/student/StudentExams.module.css';

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
  return <div className={`workspace-page student-exams-page ${styles.page}`}>
    <div className={styles.hero}><div><p className={styles.eyebrow}>Bài kiểm tra</p><StudentPageHeader title="Làm kiểm tra"/><p className={styles.description}>Xem lịch thi, chuẩn bị thiết bị theo yêu cầu của đề và bắt đầu khi đến giờ.</p></div><div className={styles.heroAside}><span className={styles.today}><CalendarDays size={18} aria-hidden="true"/>{new Intl.DateTimeFormat('vi-VN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(now)}</span><ProctoOwlMascot variant="compact" size="sm" className={styles.owl}/></div></div>
    {(collection.active||exams.length>10)&&<Card><CollectionToolbar state={collection} placeholder="Tìm đề thi..." filters={[{key:'period',label:'Trạng thái',options:[{value:'in_progress',label:'Đang làm'},{value:'open',label:'Đang diễn ra'},{value:'upcoming',label:'Sắp diễn ra'}]}]}/></Card>}
    {loading&&<LoadingSkeleton rows={5}/>}{error&&<Card><p role="alert">{error}</p><Button variant="warning" onClick={()=>void reload()}>Thử lại</Button></Card>}
    {!loading&&!error&&actionableExamGroups.map(group=>grouped[group].length?<section className="student-exam-section" data-exam-group={group} key={group}><div className="student-exam-section-heading" data-chat-avoid><h2>{{upcoming:'Sắp diễn ra',current:'Đang làm',open:'Đang diễn ra'}[group]}</h2><span>{grouped[group].length} đề thi</span></div><div className="student-exam-grid">{grouped[group].map(({exam,state})=><StudentExamCard key={exam.id} exam={exam} state={state} playful/>)}</div></section>:null)}
    {!loading&&!error&&!count&&<Card>{collection.active?<EmptySearchState mascot state={collection}/>:<EmptyState mascot title="Hiện không có bài kiểm tra cần làm."><Link className="table-link" href="/student/grades">Xem điểm số / kết quả</Link></EmptyState>}</Card>}
  </div>;
}
