'use client';
import Link from 'next/link';
import {useEffect,useId,useLayoutEffect,useRef,useState,type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {usePathname,useRouter} from 'next/navigation';
import {useAuth} from '@/components/auth/AuthContext';
import {Button} from '@/components/ui';
import {NotificationEmpty,NotificationIcon,NotificationItem,NotificationSkeleton} from '@/components/notifications/NotificationItem';
import {useNotificationFeed,useNotifications} from '@/components/notifications/NotificationsProvider';
import {notificationTarget} from '@/lib/notifications';
import type {Notification} from '@/types';
import styles from '@/components/notifications/Notifications.module.css';

export function NotificationBell(){
  const {user}=useAuth();const router=useRouter(),pathname=usePathname();
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),heading=useRef<HTMLHeadingElement>(null);
  const id=useId();const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[actionError,setActionError]=useState('');
  const [position,setPosition]=useState({left:16,top:72,maxHeight:520});
  const inbox=useNotifications();const feed=useNotificationFeed({page:1,limit:8},open);
  function close(restore=false){setOpen(false);if(restore)trigger.current?.focus();}
  useEffect(()=>setOpen(false),[pathname]);
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{const anchor=trigger.current?.getBoundingClientRect();if(!anchor)return;const width=Math.min(400,window.innerWidth-32),top=anchor.bottom+10;setPosition({left:Math.max(16,Math.min(anchor.right-width,window.innerWidth-width-16)),top,maxHeight:Math.max(120,Math.min(520,window.innerHeight-top-16))});};
    const scroll=(event:Event)=>{if(!(event.target instanceof Node)||!panel.current?.contains(event.target))place();};
    place();window.addEventListener('resize',place);window.addEventListener('scroll',scroll,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',scroll,true);};
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const frame=requestAnimationFrame(()=>heading.current?.focus());
    const outside=(event:Event)=>{if(event.target instanceof Node&&!root.current?.contains(event.target)&&!panel.current?.contains(event.target))close();};
    const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}};
    document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);
    return()=>{cancelAnimationFrame(frame);document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  function tab(event:KeyboardEvent<HTMLDivElement>){
    if(event.key!=='Tab')return;
    const nodes=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')??[]);
    if(event.shiftKey&&(document.activeElement===heading.current||document.activeElement===nodes[0])){event.preventDefault();close(true);}
    else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){
      event.preventDefault();const header=trigger.current?.closest('header');const outside=Array.from(header?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')??[]).filter(node=>node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden');
      const next=outside[outside.indexOf(trigger.current!)+1];close();(next??trigger.current)?.focus();
    }
  }
  async function openItem(item:Notification){
    if(busy)return;setBusy(true);setActionError('');
    try{
      await inbox.markRead(item);const target=notificationTarget(item,user?.role??'');
      if(target){close();router.push(target);if(item.type==='profile_verification_result')window.dispatchEvent(new Event('profile-verification-updated'));if(item.type==='student_card_update'||item.type==='student_card_notice')window.dispatchEvent(new Event('student-card-updated'));}
    }catch{setActionError('Không thể đánh dấu thông báo đã đọc. Vui lòng thử lại.');}
    finally{setBusy(false);}
  }
  async function markAll(){if(busy)return;setBusy(true);setActionError('');try{await inbox.markAll();}catch{setActionError('Không thể đánh dấu tất cả đã đọc. Vui lòng thử lại.');}finally{setBusy(false);}}
  const failed=feed.error||inbox.countError;
  return <div className="notification-bell-wrap" ref={root}>
    <button ref={trigger} type="button" className="notification-bell" aria-label={`Thông báo${inbox.count?`, ${inbox.count} chưa đọc`:''}`} aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>{setActionError('');setOpen(value=>!value);if(!open)void inbox.refreshCount();}}>
      <NotificationIcon/>{inbox.count!==null&&inbox.count>0&&<span className="notification-count">{inbox.count>99?'99+':inbox.count}</span>}
    </button>
    {open&&createPortal(<div ref={panel} id={id} role="region" aria-label="Thông báo" className={`${styles.panel} ui-card notification-panel`} style={position} onKeyDown={tab}>
      <div className={styles.header}><h2 ref={heading} tabIndex={-1}>Thông báo</h2><button className={styles.markAll} type="button" disabled={busy||!inbox.count} aria-busy={busy||undefined} onClick={()=>void markAll()}>Đánh dấu tất cả đã đọc</button></div>
      {actionError&&<div className={styles.feedback} role="alert"><p>{actionError}</p></div>}
      <div className={styles.list} data-notification-list>
        {failed?<div className={styles.feedback} role="alert"><p>Không thể tải thông báo.</p><Button variant="outline" size="sm" onClick={()=>{void inbox.refreshCount();void feed.reload();}}>Thử lại</Button></div>:
          feed.loading?<NotificationSkeleton/>:feed.items.length?feed.items.slice(0,8).map(item=><NotificationItem key={item.id} item={item} disabled={busy} onOpen={item=>void openItem(item)}/>):<NotificationEmpty/>}
      </div>
      <div className={styles.footer}><Link href="/notifications" onClick={()=>close()}>Xem tất cả thông báo</Link></div>
    </div>,document.body)}
  </div>;
}
