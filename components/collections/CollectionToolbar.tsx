'use client';
import { Search, X } from 'lucide-react';
import { Button, Input, Select,EmptyState } from '@/components/ui';
import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import type { CollectionState } from '@/lib/collections';
import styles from './CollectionToolbar.module.css';
import { RemoteFilterSelect,type LookupSource } from './RemoteFilterSelect';
import { ProctoOwlMascot } from '@/components/brand/ProctoOwlMascot';

export type FilterSpec={key:string;label:string;options:{value:string;label:string}[];type?:'date'|'datetime-local'|'number';source?:LookupSource};
export function SearchInput({label,placeholder,value,onChange}:{label:string;placeholder:string;value:string;onChange:(value:string)=>void}) {
  return <label className={`${styles.field} ${styles.searchField}`}><span>{label}</span><div className={styles.search}><Search size={18} aria-hidden="true" /><Input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={event=>onChange(event.target.value)}/>{value&&<button className={styles.clearSearch} type="button" aria-label="Xóa từ khóa tìm kiếm" onClick={()=>onChange('')}><X size={18} aria-hidden="true" /></button>}</div></label>;
}
export function CollectionToolbar({state,placeholder,filters=[],sorts,search=true,searchLabel,disabled=false,actions,mascot=false}:{state:CollectionState;placeholder:string;filters?:FilterSpec[];sorts?:FilterSpec['options'];search?:boolean;searchLabel?:string;disabled?:boolean;actions?:ReactNode;mascot?:boolean}) {
  const root=useRef<HTMLDivElement>(null);const [mascotHeight,setMascotHeight]=useState(0);const hasActions=Boolean(actions);
  useEffect(()=>{
    const node=root.current;if(!mascot||!node||!hasActions)return;
    const fields=node.querySelector('fieldset')!,buttons=node.lastElementChild!;
    const measure=()=>{
      const form=fields.getBoundingClientRect(),actions=buttons.getBoundingClientRect();
      // A wrapped action row has filters above it, rather than unused space.
      const room=actions.left>=form.right?Math.min(104,Math.floor(actions.top-form.top-12)):0;
      setMascotHeight(room>=80?room:0);
    };
    const observer=new ResizeObserver(measure);observer.observe(node);observer.observe(fields);observer.observe(buttons);measure();
    return()=>observer.disconnect();
  },[mascot,hasActions]);
  const [expanded,setExpanded]=useState(false);const primary=filters.length>4?filters.slice(0,3):filters;const extra=filters.length>4?filters.slice(3):[];
  const extraCount=extra.filter(filter=>state.values[filter.key]).length;
  useEffect(()=>{if(extraCount)setExpanded(true);},[extraCount]);
  const field=(filter:FilterSpec)=>filter.source?<RemoteFilterSelect key={filter.key} source={filter.source} label={filter.label} value={state.values[filter.key]??''} onChange={value=>state.set(filter.key,value)}/>:<label key={filter.key} className={styles.field}><span>{filter.label}</span>{filter.type?<Input type={filter.type} aria-label={filter.label} value={String(state.values[filter.key]??'')} onChange={event=>state.set(filter.key,event.target.value)}/>:<Select aria-label={filter.label} value={String(state.values[filter.key]??'')} onChange={event=>state.set(filter.key,event.target.value)}><option value="">Tất cả</option>{filter.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</Select>}</label>;
  const fields=<fieldset disabled={disabled} className={styles.toolbar} role="search" aria-label="Tìm kiếm và lọc danh sách">
    {search&&<SearchInput label={searchLabel??placeholder} placeholder={placeholder} value={state.values.q} onChange={value=>state.set('q',value)}/>}
    {primary.map(field)}
    {sorts&&<label className={styles.field}><span>Sắp xếp</span><Select aria-label="Sắp xếp" value={state.values.sort} onChange={event=>state.set('sort',event.target.value)}>{sorts.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</Select></label>}
    {extra.length>0&&<Button variant="outline" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>Thêm bộ lọc{extraCount?` (${extraCount})`:''}</Button>}
    {state.active&&<Button variant="ghost" onClick={state.clear}>Xóa bộ lọc</Button>}
    {expanded&&extra.length>0&&<div className={styles.extraFilters}>{extra.map(field)}</div>}
  </fieldset>;
  return actions?<div ref={root} className={styles.toolbarWithActions}>{fields}<div className={`${styles.actions} ${mascot?styles.mascotActions:''}`}>
    {mascot&&<span className={styles.toolbarMascot} hidden={!mascotHeight} style={{height:mascotHeight}} aria-hidden="true"><ProctoOwlMascot variant="peek" direction="left" /></span>}{actions}</div></div>:fields;
}
export function CollectionPagination({state,total,count,loading=false}:{state:CollectionState;total:number|null;count:number;loading?:boolean}) {
  const page=Number(state.values.page),limit=Number(state.values.limit);const pages=Math.max(1,Math.ceil((total??count)/limit));
  useEffect(()=>{if(!loading&&total!==null&&page>pages)state.set('page',String(pages));},[loading,total,page,pages,state.set]);
  const numbers=Array.from(new Set([1,pages,page-1,page,page+1].filter(value=>value>=1&&value<=pages))).sort((a,b)=>a-b);
  return <div className={styles.pagination}><span role="status">{total===null?`Đã tải ${count} kết quả`:`Hiển thị ${count?((page-1)*limit+1):0}–${count?((page-1)*limit+count):0} trên ${total} kết quả`}</span>
    <label className={styles.pageSize}>Mỗi trang<Select aria-label="Số kết quả mỗi trang" value={state.values.limit} onChange={event=>state.set('limit',event.target.value)} disabled={loading}>{[20,50,100].map(size=><option key={size} value={size}>{size}</option>)}</Select></label>
    {total!==null&&<nav className={styles.pages} aria-label="Phân trang"><Button variant="outline" disabled={loading||page<=1} aria-label="Trang trước" onClick={()=>state.set('page',String(page-1))}>‹</Button>{numbers.map((number,index)=><span key={number}>{index>0&&number-numbers[index-1]>1&&<span> … </span>}<Button variant={number===page?'primary':'outline'} disabled={loading} aria-label={`Trang ${number}`} aria-current={number===page?'page':undefined} onClick={()=>state.set('page',String(number))}>{number}</Button></span>)}<Button variant="outline" disabled={loading||page>=pages} aria-label="Trang sau" onClick={()=>state.set('page',String(page+1))}>›</Button></nav>}
  </div>;
}
export function EmptySearchState({state,mascot=false}:{state:CollectionState;mascot?:boolean}) {return <EmptyState mascot={mascot} title="Không tìm thấy kết quả phù hợp.">{state.active&&<Button variant="outline" onClick={state.clear}>Xóa bộ lọc</Button>}</EmptyState>;}
export const commonSorts=[{value:'newest',label:'Mới nhất'},{value:'oldest',label:'Cũ nhất'},{value:'name',label:'Tên A–Z'}];
