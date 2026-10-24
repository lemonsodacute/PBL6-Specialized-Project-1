'use client';
import {useEffect,useState} from 'react';

/** Reconcile with the authenticated API; never optimistically mark other exams submitted. */
export function useStudentExamRefresh(reload:(background?:boolean)=>Promise<void>,studentId?:string){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{
    if(!studentId)return;
    const refresh=()=>{if(document.visibilityState==='visible')void reload(true);};
    const submitted=(event:Event)=>{
      const detail=(event as CustomEvent<{studentId?:string}>).detail;
      if(!detail?.studentId||detail.studentId===studentId)refresh();
    };
    const clock=window.setInterval(()=>setNow(Date.now()),1000),poll=window.setInterval(refresh,15_000);
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);window.addEventListener('student-exam-updated',submitted);
    return()=>{window.clearInterval(clock);window.clearInterval(poll);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('student-exam-updated',submitted);};
  },[reload,studentId]);
  return now;
}
