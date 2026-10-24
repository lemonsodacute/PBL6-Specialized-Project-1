import type {Notification,NotificationType} from '@/types';
import {listQuery,readCollection} from './collection-query';

export const notificationTypes:{value:NotificationType;label:string}[]=[
  {value:'support_message',label:'Tin nhắn hỗ trợ'},
  {value:'violation_alert',label:'Cảnh báo giám sát'},
  {value:'exam_summary',label:'Tổng kết kỳ thi'},
  {value:'attempt_terminated',label:'Kết thúc bài thi'},
  {value:'profile_verification_request',label:'Yêu cầu xác minh'},
  {value:'profile_verification_result',label:'Kết quả xác minh'},
  {value:'student_card_update',label:'Cập nhật thẻ'},
  {value:'student_card_notice',label:'Thông báo thẻ'},
];
export type NotificationQuery={page?:number;limit?:number;is_read?:string;type?:string};
export function notificationQuery(query:NotificationQuery){return listQuery(query);}
export function readNotifications(response:unknown){
  const result=readCollection<Notification>(response);
  if(result.data.some(item=>!item||typeof item.id!=='string'||!item.id||typeof item.title!=='string'
    ||typeof item.message!=='string'||typeof item.type!=='string'||typeof item.is_read!=='boolean'||typeof item.created_at!=='string'))throw new Error('Invalid notifications');
  return result;
}
export function notificationTarget(item:Notification,role:string):string|null{
  if(item.type==='support_message'&&item.related_conversation_id){
    const id=encodeURIComponent(item.related_conversation_id);
    return role==='admin'?`/admin/messages?conversation=${id}`:`/${role==='teacher'?'teacher':'student'}?chat=${id}`;
  }
  const exam=item.related_exam_id?encodeURIComponent(item.related_exam_id):null;
  const attempt=item.related_attempt_id?encodeURIComponent(item.related_attempt_id):null;
  if(item.type==='profile_verification_request'&&role==='admin')return `/dashboard/users${item.related_student_id?`?student_id=${encodeURIComponent(item.related_student_id)}`:''}`;
  if(role==='student'){
    if(item.type==='profile_verification_result')return '/student/profile';
    if(item.type==='student_card_update'||item.type==='student_card_notice')return '/student/profile#identity-heading';
    if(attempt)return `/student/attempts/${attempt}/result`;
    if(exam)return '/student/exams';
  }
  if(role==='teacher'||role==='admin'){
    if(exam&&attempt&&item.related_proctor_event_id)return `/dashboard/monitor/${exam}/${attempt}?event=${encodeURIComponent(item.related_proctor_event_id)}${item.proctor_event_simulated?'&simulation=1':''}`;
    if(exam&&attempt)return `/dashboard/monitor/${exam}/${attempt}`;
    if(exam)return `/dashboard/exams/${exam}/report`;
  }
  return null;
}
export function notificationTime(value:string){
  const timestamp=new Date(value).getTime();
  if(!Number.isFinite(timestamp))return 'Chưa rõ thời gian';
  const seconds=Math.max(0,Math.floor((Date.now()-timestamp)/1000));
  if(seconds<60)return 'Vừa xong';
  if(seconds<3600)return `${Math.floor(seconds/60)} phút trước`;
  if(seconds<86400)return `${Math.floor(seconds/3600)} giờ trước`;
  return `${Math.floor(seconds/86400)} ngày trước`;
}
