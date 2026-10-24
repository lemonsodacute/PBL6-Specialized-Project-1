'use client';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { readCollection } from '@/lib/collection-query';
import { Input,Select,Button } from '@/components/ui';
import styles from './CollectionToolbar.module.css';
import {IconButton} from '@/components/ui/Button';
type Option={id:string;name?:string;title?:string;full_name?:string;email?:string;student_code?:string|null};
export type LookupSource='classes'|'exams'|'teachers'|'students';
const label=(item:Option)=>item.name??item.title??[item.full_name,item.student_code??item.email].filter(Boolean).join(' · ');
export function RemoteFilterSelect({source,label:heading,value,onChange,classId,refreshKey=0,disabled=false}:{source:LookupSource;label:string;value:string;onChange:(value:string)=>void;classId?:string;refreshKey?:number;disabled?:boolean}) {
  const [query,setQuery]=useState('');const [items,setItems]=useState<Option[]>([]);const [selected,setSelected]=useState<Option|null>(null);const [error,setError]=useState(false);const [retry,setRetry]=useState(0);
  const [loadedScope,setLoadedScope]=useState(''),[selectedScope,setSelectedScope]=useState('');
  const selectionScope=`${source}|${classId??''}|${refreshKey}`;
  const scope=`${selectionScope}|${query.trim()}|${retry}`;
  const loading=loadedScope!==scope,visibleItems=loading?[]:items;
  const [searchOpen,setSearchOpen]=useState(false);
  useEffect(()=>{
    let active=true;const timer=setTimeout(async()=>{
      try{
        const params={q:query.trim(),page:1,limit:20,sort:'name'};
        const response=source==='classes'?await api.classes.list(params):source==='exams'?await api.exams.list(params):source==='teachers'?await api.users.list({...params,role:'teacher'}):classId?await api.classes.availableStudents(classId,params):null;
        if(active){setItems(readCollection<Option>(response).data);setError(false);setLoadedScope(scope);}
      }catch{if(active){setItems([]);setError(true);setLoadedScope(scope);}}
    },350);return()=>{active=false;clearTimeout(timer);};
  },[query,source,classId,retry,refreshKey,scope]);
  useEffect(()=>{
    if(!value){setSelected(null);return;}let active=true;
    const found=loadedScope===scope?items.find(item=>item.id===value):null;if(found){setSelected(found);setSelectedScope(selectionScope);return;}
    if(source==='students'){setSelected(current=>current?.id===value?current:null);return;}
    (async()=>{try{
      const response=source==='classes'?await api.classes.get(value,{include_students:false}):source==='teachers'?await api.users.get(value):await api.exams.list({exam_id:value,page:1,limit:20});
      const option=source==='exams'?readCollection<Option>(response).data[0]:(response as {data:Option}).data;
      if(active){setSelected(option??null);setSelectedScope(selectionScope);}
    }catch{if(active)setSelected(null);}})();return()=>{active=false;};
  },[value,items,source,loadedScope,scope,selectionScope]);
  const currentSelected=selectedScope===selectionScope?selected:null;
  const options=currentSelected&&!visibleItems.some(item=>item.id===currentSelected.id)?[currentSelected,...visibleItems]:visibleItems;
  const empty=source==='students'&&!loading&&!error&&options.length===0;
  const placeholder=source!=='students'?'Tất cả':loading?'Đang tải sinh viên...':empty?(query.trim()?'Không tìm thấy sinh viên phù hợp.':'Không còn sinh viên để thêm.'):'Chọn sinh viên';
  return <div className={styles.field}><span>{heading}</span><div className={styles.lookupControl}>
    <Select aria-label={heading} value={value} disabled={disabled||loading||empty||error} aria-busy={loading||undefined} onChange={event=>onChange(event.target.value)}><option value="">{placeholder}</option>{value&&!options.some(item=>item.id===value)&&<option value={value} disabled>Lựa chọn không còn khả dụng</option>}{options.map(item=><option value={item.id} key={item.id}>{label(item)}</option>)}</Select>
    <IconButton label={`Tìm ${heading.toLowerCase()}`} disabled={disabled} aria-expanded={searchOpen} onClick={()=>setSearchOpen(value=>!value)}><Search size={18} aria-hidden="true" /></IconButton></div>
    {(searchOpen||query)&&<Input autoFocus disabled={disabled} type="search" aria-label={`Tìm ${heading.toLowerCase()}`} placeholder={`Tìm ${heading.toLowerCase()}...`} value={query} onChange={event=>setQuery(event.target.value)}/>}
    {empty&&<span role="status">{query.trim()?'Không tìm thấy sinh viên phù hợp.':'Không còn sinh viên để thêm.'}</span>}
    {!loading&&error&&<span role="alert">Không tải được lựa chọn. <Button disabled={disabled} variant="ghost" size="sm" onClick={()=>setRetry(value=>value+1)}>Thử lại</Button></span>}
  </div>;
}
