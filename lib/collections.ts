'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { friendlyError } from './uiErrors';

import { listQuery, readCollection, type ListParams, type CollectionResponse } from './collection-query';
export { listQuery, readCollection, type ListParams, type CollectionResponse } from './collection-query';
type CollectionValues = Record<string,string> & {q:string;page:string;limit:string;sort:string};
export function useCollectionState(defaultFilters: Record<string,string> = {}, defaultSort='newest',persist=true) {
  const defaults=useRef<CollectionValues>({q:'',page:'1',limit:'20',sort:defaultSort,...defaultFilters});
  const [values,setValues]=useState(defaults.current); const [ready,setReady]=useState(false); const [debounced,setDebounced]=useState('');
  const currentValues=useRef(values);currentValues.current=values;
  useEffect(() => {
    if(!persist){setReady(true);return;}
    function read() {
      const query=new URLSearchParams(location.search); const next={...defaults.current};
      Object.keys(next).forEach(key => { if (query.has(key)) next[key as keyof typeof next]=query.get(key)!; });
      if (!/^[1-9]\d*$/.test(next.page)) next.page='1';
      if (!['20','50','100'].includes(next.limit)) next.limit='20';
      setValues(next);setDebounced(next.q.trim());setReady(true);
    }
    read();window.addEventListener('popstate',read);return () => window.removeEventListener('popstate',read);
  },[]);
  useEffect(() => { const timer=setTimeout(() => setDebounced(values.q.trim()),350);return () => clearTimeout(timer); },[values.q]);
  useEffect(() => {
    if (!ready || !persist) return;
    const query=new URLSearchParams(location.search);
    Object.keys(defaults.current).forEach(key => { const raw=values[key as keyof typeof values];const value=key==='q'?raw.trim():raw; if (!value || value === defaults.current[key as keyof typeof defaults.current]) query.delete(key);else query.set(key,value); });
    const target=location.pathname+(query.size?'?'+query.toString():'')+location.hash;
    if (target !== location.pathname+location.search+location.hash) window.history.replaceState(window.history.state,'',target);
  },[values,ready,persist]);
  const serialized=JSON.stringify({...values,q:debounced,page:Number(values.page),limit:Number(values.limit)});
  const params=useMemo(() => JSON.parse(serialized) as ListParams,[serialized]);
  const set=useCallback((key:string,value:string) => {
    // A filter/page action applies the current search immediately. Otherwise
    // the request can combine new filters with the previous debounced query.
    if(key!=='q')setDebounced(currentValues.current.q.trim());
    setValues(current => ({...current,[key]:value,...(key==='page'?{}:{page:'1'})}));
  },[]);
  const clear=useCallback(() => {setValues({...defaults.current});setDebounced('');},[]);
  const active=Object.entries(defaults.current).some(([key,value]) => !['page','limit','sort'].includes(key) && (key==='q'?values.q.trim():values[key as keyof typeof values]) !== value);
  return {values,params,ready,set,clear,active,pending:values.q.trim()!==debounced,key:listQuery(params)};
}
export type CollectionState = ReturnType<typeof useCollectionState>;
export function useServerCollection<T>(state: CollectionState, loader: (params:ListParams) => Promise<unknown>, message='Không tải được danh sách. Vui lòng thử lại.',scope='') {
  const [rows,setRows]=useState<T[]>([]);const [meta,setMeta]=useState<CollectionResponse<T>['meta']>();
  const [loading,setLoading]=useState(true);const [error,setError]=useState('');const request=useRef(0);
  const latest=useRef({loader,params:state.params,message,set:state.set});latest.current={loader,params:state.params,message,set:state.set};
  const reload=useCallback(async (background=false) => {
    const version=++request.current;if(!background){setLoading(true);setRows([]);}setError('');
    try {const result=readCollection<T>(await latest.current.loader(latest.current.params)); if (version===request.current) {
      const lastPage=result.meta?.total!==undefined?Math.max(1,Math.ceil(result.meta.total/Number(latest.current.params.limit??20))):null;
      if(lastPage!==null&&Number(latest.current.params.page)>lastPage){latest.current.set('page',String(lastPage));return;}
      setRows(result.data);setMeta(result.meta);
    } }
    catch(cause) {if(version===request.current) {setRows([]);setError(friendlyError(cause,latest.current.message));setMeta(undefined);} }
    finally {if(version===request.current) setLoading(false);}
  },[]);
  useEffect(() => {if(state.ready) void reload();return () => {request.current++;};},[state.key,state.ready,reload,scope]);
  return {rows,meta,total:meta?.total ?? null,loading:loading||state.pending,error,reload};
}
