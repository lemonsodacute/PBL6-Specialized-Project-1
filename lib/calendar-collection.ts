import {readCollection,type ListParams} from './collection-query';

// A calendar loads its visible date window, never the complete exam history.
// Continue bounded pages only when that window itself has more than 100 events.
export async function readCalendarWindow<T>(loader:(params:ListParams)=>Promise<unknown>,from:Date,to:Date,active:()=>boolean){
  const rows:T[]=[];
  for(let page=1;active();page++){
    const result=readCollection<T>(await loader({from_time:from.toISOString(),to_time:to.toISOString(),page,limit:100}));
    if(!active())return [];
    rows.push(...result.data);
    if(result.meta?.total===undefined||rows.length>=result.meta.total||!result.data.length)break;
  }
  return rows;
}
