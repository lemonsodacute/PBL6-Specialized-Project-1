'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {useAuth} from '@/components/auth/AuthContext';
import {apiFetch} from '@/lib/api';
import {notificationQuery,readNotifications,type NotificationQuery} from '@/lib/notifications';
import type {Notification} from '@/types';
import {subscribeVisibleRefresh} from '@/lib/visible-refresh';

type Mutation={revision:number;kind:'one'|'all';id?:string};
type Inbox={userId:string|null;count:number|null;countError:boolean;mutation:Mutation|null;
  refreshCount:()=>Promise<void>;markRead:(item:Notification)=>Promise<void>;markAll:()=>Promise<void>};
const Context=createContext<Inbox|null>(null);

export function NotificationsProvider({children}:{children:ReactNode}){
  const {user,authReady}=useAuth();const userId=authReady&&user?user.id:null;
  const activeUser=useRef(userId);activeUser.current=userId;
  const [count,setCount]=useState<number|null>(null);const [countFor,setCountFor]=useState<string|null>(null);
  const [countError,setCountError]=useState(false);const [mutation,setMutation]=useState<Mutation|null>(null);
  const countEpoch=useRef(0),revision=useRef(0),pending=useRef(new Map<string,Promise<void>>());
  const refreshCount=useCallback(async()=>{
    if(!userId||pending.current.size)return;
    const request=++countEpoch.current;
    try{
      const response=await apiFetch<{data:{count:number}}>('/notifications/unread-count');
      if(!Number.isInteger(response.data?.count)||response.data.count<0)throw new Error('Invalid count');
      if(request===countEpoch.current&&activeUser.current===userId){setCount(response.data.count);setCountFor(userId);setCountError(false);}
    }catch{if(request===countEpoch.current&&activeUser.current===userId){setCountError(true);setCount(null);setCountFor(userId);}}
  },[userId]);
  useEffect(()=>{
    countEpoch.current++;setCount(null);setCountFor(null);setCountError(false);setMutation(null);pending.current.clear();
    if(!userId)return;
    void refreshCount();const refresh=()=>{if(document.visibilityState==='visible')void refreshCount();};
    const timer=window.setInterval(refresh,15_000);
    window.addEventListener('notification-preferences-updated',refresh);
    window.addEventListener('support-chat-updated',refresh);
    window.addEventListener('proctor-notifications-updated',refresh);
    const unsubscribe=subscribeVisibleRefresh(refresh);
    return()=>{countEpoch.current++;unsubscribe();window.clearInterval(timer);window.removeEventListener('notification-preferences-updated',refresh);window.removeEventListener('support-chat-updated',refresh);window.removeEventListener('proctor-notifications-updated',refresh);};
  },[userId,refreshCount]);
  const writeRead=useCallback((kind:'one'|'all',item?:Notification):Promise<void>=>{
    if(!userId)return Promise.reject(new Error('No active session'));
    if(item?.is_read)return Promise.resolve();
    const key=kind==='all'?'all':item!.id;const existing=pending.current.get(key);if(existing)return existing;
    countEpoch.current++;
    const operation:Promise<void>=apiFetch(kind==='all'?'/notifications/read-all':`/notifications/${encodeURIComponent(item!.id)}/read`,{method:'PATCH'}).then(()=>{
        if(activeUser.current!==userId)return;
        setCount(value=>kind==='all'?0:value===null?null:Math.max(0,value-1));setCountFor(userId);
        setMutation({kind,id:item?.id,revision:++revision.current});
      }).finally(()=>{
        if(pending.current.get(key)===operation)pending.current.delete(key);
        if(activeUser.current===userId)void refreshCount();
      });
    pending.current.set(key,operation);return operation;
  },[userId,refreshCount]);
  return <Context.Provider value={{userId,count:countFor===userId?count:null,countError,mutation,refreshCount,
    markRead:item=>writeRead('one',item),markAll:()=>writeRead('all')}}>{children}</Context.Provider>;
}
export function useNotifications(){const value=useContext(Context);if(!value)throw new Error('NotificationsProvider required');return value;}

export function useNotificationFeed(query:NotificationQuery,enabled=true){
  const {userId,mutation}=useNotifications();const key=notificationQuery(query),scope=`${userId}|${key}`;
  const [items,setItems]=useState<Notification[]>([]),[total,setTotal]=useState<number|null>(null);
  const [loadedScope,setLoadedScope]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(false);
  const epoch=useRef(0),activeScope=useRef(scope);activeScope.current=scope;
  const handled=useRef(mutation?.revision??0);
  const reload=useCallback(async(background=false)=>{
    if(!userId||!enabled)return;
    const request=++epoch.current;
    if(!background){setLoading(true);setItems([]);setTotal(null);}
    setError(false);
    try{
      const response=readNotifications(await apiFetch<unknown>(`/notifications?${key}`));
      if(request===epoch.current&&activeScope.current===scope){setItems(response.data);setTotal(response.meta?.total??null);setLoadedScope(scope);}
    }catch{if(request===epoch.current&&activeScope.current===scope)setError(true);}
    finally{if(request===epoch.current)setLoading(false);}
  },[key,scope,userId,enabled]);
  useEffect(()=>{
    if(!userId||!enabled){epoch.current++;setLoading(false);return;}
    void reload();const refresh=()=>{if(document.visibilityState==='visible')void reload(true);};const timer=window.setInterval(refresh,15_000);
    window.addEventListener('notification-preferences-updated',refresh);
    window.addEventListener('support-chat-updated',refresh);
    window.addEventListener('proctor-notifications-updated',refresh);
    const unsubscribe=subscribeVisibleRefresh(refresh);
    return()=>{epoch.current++;unsubscribe();window.clearInterval(timer);window.removeEventListener('notification-preferences-updated',refresh);window.removeEventListener('support-chat-updated',refresh);window.removeEventListener('proctor-notifications-updated',refresh);};
  },[userId,enabled,reload]);
  useEffect(()=>{
    if(!mutation||mutation.revision===handled.current)return;
    handled.current=mutation.revision;epoch.current++;
    setItems(current=>current.map(item=>mutation.kind==='all'||item.id===mutation.id?{...item,is_read:true}:item));
    if(enabled)void reload(true);
  },[mutation,enabled,reload]);
  return {items:loadedScope===scope?items:[],total:loadedScope===scope?total:null,
    loading:enabled&&!!userId&&(loading||!error&&loadedScope!==scope),error:error||enabled&&!userId,reload};
}
