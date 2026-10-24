'use client';
import type {ReactNode} from 'react';
import {Modal} from './Modal';
import {Button} from './Button';

export function ConfirmDialog({open,title,description,children,confirmLabel='Xác nhận',tone='danger',busy=false,disabled=false,error,onCancel,onConfirm}:{open:boolean;title:string;description?:ReactNode;children?:ReactNode;confirmLabel?:string;tone?:'danger'|'warning'|'success';busy?:boolean;disabled?:boolean;error?:string;onCancel:()=>void;onConfirm:()=>void}){
  return <Modal open={open} title={title} size="small" onClose={()=>{if(!busy)onCancel();}}>
    {description&&<p className="confirm-description">{description}</p>}{children}
    {error&&<p className="field-error" role="alert">{error}</p>}
    <div className="modal-actions"><Button variant="outline" disabled={busy} onClick={onCancel}>Hủy</Button><Button variant={tone} disabled={disabled} loading={busy} onClick={onConfirm}>{confirmLabel}</Button></div>
  </Modal>;
}
