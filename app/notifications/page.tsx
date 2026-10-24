'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {useAuth} from '@/components/auth/AuthContext';
import { Button, Card, ErrorState } from '@/components/ui';
import {CollectionPagination,CollectionToolbar} from '@/components/collections/CollectionToolbar';
import {NotificationEmpty,NotificationItem,NotificationSkeleton} from '@/components/notifications/NotificationItem';
import {useNotificationFeed,useNotifications} from '@/components/notifications/NotificationsProvider';
import {useCollectionState} from '@/lib/collections';
import {notificationTarget,notificationTypes} from '@/lib/notifications';
import type {Notification} from '@/types';
import styles from '@/components/notifications/Notifications.module.css';

export default function NotificationsPage(){
  const {user}=useAuth();const router=useRouter();const collection=useCollectionState({is_read:'',type:''});const inbox=useNotifications();
  const feed=useNotificationFeed({page:Number(collection.values.page),limit:Number(collection.values.limit),is_read:collection.values.is_read,type:collection.values.type},collection.ready);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function read(item?:Notification){if(busy)return;setBusy(true);setError('');try{
    if(item){await inbox.markRead(item);const target=notificationTarget(item,user?.role??'');if(target){router.push(target);if(item.type==='profile_verification_result')window.dispatchEvent(new Event('profile-verification-updated'));if(item.type==='student_card_update'||item.type==='student_card_notice')window.dispatchEvent(new Event('student-card-updated'));}}
    else await inbox.markAll();
  }catch{setError('Không thể đánh dấu thông báo đã đọc. Vui lòng thử lại.');}finally{setBusy(false);}}
  const failed=feed.error||inbox.countError;
  return <div className={`workspace-page ${styles.page}`}>
    <Card><CollectionToolbar actions={<Button variant="outline" disabled={!inbox.count} loading={busy} onClick={()=>void read()}>Đánh dấu tất cả đã đọc</Button>} state={collection} search={false} placeholder="Thông báo" disabled={busy} filters={[
      {key:'is_read',label:'Trạng thái đọc',options:[{value:'false',label:'Chưa đọc'},{value:'true',label:'Đã đọc'}]},
      {key:'type',label:'Loại thông báo',options:notificationTypes},
    ]}/></Card>
    {error&&<p role="alert">{error}</p>}
    {failed?<Card><ErrorState message="Không thể tải thông báo." onRetry={()=>{void inbox.refreshCount();void feed.reload();}}/></Card>:
      feed.loading?<Card><NotificationSkeleton/></Card>:<Card className={`${styles.listCard} ${styles.fullList}`}><div role="region" aria-label="Danh sách thông báo">{feed.items.length?feed.items.map(item=><NotificationItem key={item.id} item={item} disabled={busy} onOpen={item=>void read(item)}/>):<NotificationEmpty filtered={collection.active}/>}</div></Card>}
    {!failed&&<CollectionPagination state={collection} total={feed.total} count={feed.items.length} loading={feed.loading||busy}/>}
  </div>;
}
