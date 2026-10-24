'use client';
import Link from 'next/link';
import { Ellipsis } from 'lucide-react';
import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState,type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';

export type ActionMenuItem={label:string;href?:string;onSelect?:()=>void;disabled?:boolean;reason?:string;tone?:'warning'|'danger'};

/** Shared row/card overflow menu; business state stays with the caller. */
export function ActionMenu({label,items,note,className='',disabled=false}:{label:string;items:ActionMenuItem[];note?:string;className?:string;disabled?:boolean}){
  const [open,setOpen]=useState(false);const [position,setPosition]=useState({left:0,top:0,maxHeight:400});
  const trigger=useRef<HTMLButtonElement>(null);const menu=useRef<HTMLDivElement>(null);const id=useId();
  const dismiss=useCallback((restore=false)=>{setOpen(false);if(restore)trigger.current?.focus();},[]);
  useLayoutEffect(()=>{
    if(!open)return;
    function place(){
      const anchor=trigger.current?.getBoundingClientRect(),dropdown=menu.current;if(!anchor||!dropdown)return;
      const viewport=window.visualViewport,topEdge=(viewport?.offsetTop??0)+12,bottomEdge=(viewport?.offsetTop??0)+(viewport?.height??innerHeight)-12;
      if(anchor.bottom<topEdge||anchor.top>bottomEdge){dismiss();return;}
      const leftEdge=(viewport?.offsetLeft??0)+12,rightEdge=(viewport?.offsetLeft??0)+(viewport?.width??innerWidth)-12;
      const width=Math.min(248,rightEdge-leftEdge),height=Math.min(dropdown.scrollHeight,bottomEdge-topEdge);
      const above=anchor.top-topEdge,below=bottomEdge-anchor.bottom,useAbove=below<height+8&&above>below;
      const maxHeight=Math.max(44,(useAbove?above:below)-8),shown=Math.min(height,maxHeight);
      setPosition({left:Math.max(leftEdge,Math.min(anchor.right-width,rightEdge-width)),top:Math.max(topEdge,useAbove?anchor.top-shown-8:anchor.bottom+8),maxHeight});
    }
    place();window.addEventListener('resize',place);window.visualViewport?.addEventListener('resize',place);window.visualViewport?.addEventListener('scroll',place);
    const resize=new ResizeObserver(place);if(menu.current)resize.observe(menu.current);
    const scroll=(event:Event)=>{if(!(event.target instanceof Node)||!menu.current?.contains(event.target))place();};
    window.addEventListener('scroll',scroll,true);
    return()=>{resize.disconnect();window.removeEventListener('resize',place);window.visualViewport?.removeEventListener('resize',place);window.visualViewport?.removeEventListener('scroll',place);window.removeEventListener('scroll',scroll,true);};
  },[open,dismiss]);
  useEffect(()=>{
    if(!open)return;
    const frame=requestAnimationFrame(()=>menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({preventScroll:true}));
    const outside=(event:Event)=>{if(event.target instanceof Node&&!menu.current?.contains(event.target)&&!trigger.current?.contains(event.target))dismiss();};
    document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);
    return()=>{cancelAnimationFrame(frame);document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);};
  },[open,dismiss]);
  function navigate(event:KeyboardEvent<HTMLDivElement>){
    const nodes=Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')??[]),index=nodes.indexOf(document.activeElement as HTMLElement);
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismiss(true);}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?nodes.length-1:(index+(event.key==='ArrowDown'?1:-1)+nodes.length)%nodes.length;nodes[next]?.focus();
    }
    if(event.key==='Tab'){
      event.preventDefault();const scope=trigger.current?.closest('[role="dialog"]')??document;
      const outside=Array.from(scope.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(node=>!menu.current?.contains(node)&&node.getClientRects().length>0);
      const anchor=outside.indexOf(trigger.current!);dismiss();(event.shiftKey?trigger.current:outside[anchor+1]??trigger.current)?.focus();
    }
  }
  return <span className={`action-menu ${className}`}><button ref={trigger} type="button" className="ui-button ui-button-icon action-menu-trigger" disabled={disabled} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} id={`${id}-trigger`} onClick={()=>setOpen(value=>!value)} onKeyDown={event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setOpen(true);}}}><Ellipsis size={20} aria-hidden="true" /></button>
    {open&&createPortal(<div ref={menu} id={id} role="menu" aria-labelledby={`${id}-trigger`} className="action-menu-panel" data-in-dialog={!!trigger.current?.closest('[role="dialog"]')} style={position} onKeyDown={navigate}>
      {items.map((item,index)=><div key={item.label}>{item.tone==='danger'&&items[index-1]?.tone!=='danger'&&<div role="separator" className="action-menu-separator"/>}
        {item.href&&!item.disabled?<Link href={item.href} role="menuitem" tabIndex={-1} className={`action-menu-item ${item.tone??''}`} onClick={()=>dismiss(true)}>{item.label}</Link>:<button type="button" role="menuitem" tabIndex={-1} disabled={item.disabled} title={item.disabled?item.reason??note:undefined} className={`action-menu-item ${item.tone??''}`} onClick={()=>{dismiss(true);item.onSelect?.();}}>{item.label}</button>}
      </div>)}{note&&<p className="action-menu-note">{note}</p>}
    </div>,document.body)}</span>;
}
