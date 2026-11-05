import { Inbox, CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import {Button} from './Button';
import { ProctoOwlMascot } from '@/components/brand/ProctoOwlMascot';
import styles from './Feedback.module.css';
import { borderProps } from './Border';

export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="loading-skeleton" role="status" aria-label="Đang tải">{Array.from({ length: rows }, (_, index) => <span key={index} aria-hidden="true" />)}</div>;
}

export function EmptyState({ title = 'Chưa có dữ liệu', children, mascot = false }: { title?: string; children?: ReactNode; mascot?: boolean }) {
  return <div className={`empty-state-box ${mascot?styles.withMascot:''}`}>
    {mascot?<ProctoOwlMascot variant="empty-state" className={styles.owl}/>:<div className="empty-state-icon" aria-hidden="true"><Inbox size={24} strokeWidth={1.5} /></div>}
    <strong>{title}</strong>{children && <div className="empty-state-description">{children}</div>}</div>;
}
export function ErrorState({message='Không tải được dữ liệu. Vui lòng thử lại.',onRetry,loading=false}:{message?:string;onRetry?:()=>void;loading?:boolean}){
  return <div className="error-state-box" role="alert" {...borderProps('danger')}><span className="empty-state-icon" aria-hidden="true"><CircleAlert size={24} /></span><p>{message}</p>{onRetry&&<Button variant="warning" loading={loading} onClick={onRetry}>Thử lại</Button>}</div>;
}
