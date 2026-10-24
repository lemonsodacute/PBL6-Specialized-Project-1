'use client';
import { Bell, CircleCheck, IdCard, TriangleAlert } from 'lucide-react';
import {SeverityBadge} from '@/components/ui/Badge';
import {notificationTime} from '@/lib/notifications';
import type {Notification} from '@/types';
import styles from './Notifications.module.css';

export function NotificationIcon({type}:{type?:Notification['type']}){
  const Icon = type === 'profile_verification_result' || type === 'student_card_notice' ? CircleCheck
    : type === 'student_card_update' ? IdCard
    : type === 'violation_alert' || type === 'attempt_terminated' ? TriangleAlert : Bell;
  return <Icon size={20} strokeWidth={1.7} aria-hidden="true" />;
}
export function NotificationItem({item,onOpen,disabled=false}:{item:Notification;onOpen:(item:Notification)=>void;disabled?:boolean}){
  const validTime=Number.isFinite(new Date(item.created_at).getTime());
  return <button type="button" className={`${styles.item} ${item.is_read?'':styles.unread}`} disabled={disabled} onClick={()=>onOpen(item)}>
    <span className={styles.icon}><NotificationIcon type={item.type}/></span>
    <span className={styles.content}><span className={styles.title}>{!item.is_read&&<span className={styles.dot} aria-label="Chưa đọc"/>}{item.title}</span>
      <span className={styles.message}>{item.message}</span><span className={styles.meta}>
        <time dateTime={validTime?item.created_at:undefined} title={validTime?new Date(item.created_at).toLocaleString('vi-VN'):undefined}>{notificationTime(item.created_at)}</time>
        {item.severity&&<SeverityBadge severity={item.severity}/>}</span></span>
  </button>;
}
export function NotificationEmpty({filtered=false}:{filtered?:boolean}){
  return <div className={styles.empty}><span className={styles.emptyIcon}><NotificationIcon/></span><p>{filtered?'Không có thông báo phù hợp với bộ lọc.':'Chưa có thông báo mới.'}</p></div>;
}
export function NotificationSkeleton(){return <div className={styles.skeleton} role="status" aria-label="Đang tải thông báo">{[0,1,2].map(index=><div key={index} aria-hidden="true"><span/><span/><span/></div>)}</div>;}
