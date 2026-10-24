import {Children,Fragment,cloneElement,isValidElement,type ReactNode,type ReactElement} from 'react';
type ElementProps={children?:ReactNode;colSpan?:number;className?:string;role?:string;'data-label'?:string;'data-wide'?:boolean};
function flatten(children:ReactNode):ReactNode[]{return Children.toArray(Children.map(children,child=>isValidElement<ElementProps>(child)&&child.type===Fragment?flatten(child.props.children):child));}
function text(node:ReactNode):string{return flatten(node).map(child=>typeof child==='string'||typeof child==='number'?String(child):isValidElement<ElementProps>(child)?text(child.props.children):'').join(' ').trim();}
function headerLabels(children:ReactNode):string[]{
  const head=flatten(children).find(child=>isValidElement(child)&&child.type==='thead') as ReactElement<ElementProps>|undefined;
  const row=head&&flatten(head.props.children).find(child=>isValidElement(child)&&child.type==='tr') as ReactElement<ElementProps>|undefined;
  return row?flatten(row.props.children).map(cell=>text(cell)||'Thao tác'):[];
}
function annotate(children:ReactNode,labels:string[]):ReactNode{
  return flatten(children).map(child=>{
    if(!isValidElement<ElementProps>(child))return child;
    if(child.type==='thead'||child.type==='tbody'||child.type==='tfoot')return cloneElement(child,{role:'rowgroup'},annotate(child.props.children,labels));
    if(child.type==='tr')return cloneElement(child,{role:'row'},flatten(child.props.children).map((cell,index)=>{
      if(!isValidElement<ElementProps>(cell))return cell;
      const wide=(cell.props.colSpan??1)>1;
      return cloneElement(cell,{role:cell.type==='th'?'columnheader':'cell','data-label':wide?undefined:labels[index],'data-wide':wide||undefined});
    }));
    return child;
  });
}
export function Table({children,label='Bảng dữ liệu',mobile='cards'}:{children:ReactNode;label?:string;mobile?:'cards'|'scroll'}){
  return <div className={`table-wrap table-mobile-${mobile}`} role="region" aria-label={label} tabIndex={0}><table role="table" className="ui-table">{annotate(children,headerLabels(children))}</table></div>;
}
