import {sameCashPostingAmount} from './cashFlowAmount';
import {CashPosting,cashKey} from './cashFlow';
export interface CashPage {rows:CashPosting[];complete:boolean;groups?:Record<string,unknown>[];reason?:string}
/** Exhaustive In/NotIn partitions, independent of model sort order. Parent samples are replaced, never summed. */
export async function pageCashFlow(question:string,fetch:(q:string)=>Promise<CashPage>,active:()=>boolean,progress:(n:number)=>void):Promise<CashPage>{
 let pages=0;const visit=async(q:string,depth:number):Promise<CashPage>=>{
  if(!active())throw new Error('Cash-flow request cancelled.');
  const result=await fetch(q);progress(++pages);if(!active())throw new Error('Cash-flow request cancelled.');
  if(result.complete||result.reason)return result;
  const request=JSON.parse(decodeURIComponent(q.slice(';cashflow:'.length))),parts=request.partitions||[];
  if(depth>=128||!result.groups?.length)return {...result,reason:'Automatic paging could not finish within its partition limit. Narrow the starting scope.'};
  const fixed=new Set(parts.filter((p:any)=>!p.exclude&&p.values.length===1).map((p:any)=>p.field));
  let chosen:string|undefined,values:unknown[]=[];
  for(const field of Object.keys(result.groups[0]).sort()){
   if(fixed.has(field))continue;
   const unique=[...new Map(result.groups.map(row=>[JSON.stringify(row[field]),row[field]])).values()];
   if(unique.some(v=>v!==null&&!['string','number','boolean'].includes(typeof v)))continue;
   if(unique.length>1&&unique.length>values.length){chosen=field;values=unique;}
  }
  if(!chosen)return {...result,reason:'Available grouping fields cannot separate this incomplete response. Map a unique line item and narrow the scope.'};
  values=values.slice(0,Math.min(1000,Math.max(1,Math.floor(values.length/2))));
  const children:CashPage[]=[];
  for(const exclude of [false,true])children.push(await visit(';cashflow:'+encodeURIComponent(JSON.stringify({...request,partitions:[...parts,{field:chosen,values,exclude}]})),depth+1));
  const rows=new Map<string,CashPosting>();for(const child of children)for(const row of child.rows){const key=cashKey(row),old=rows.get(key);if(old&&!sameCashPostingAmount(old.amount,row.amount))throw new Error('Posting amounts changed between query partitions. Refresh data and map a unique line item.');if(old)throw new Error('Overlapping cash-flow query partitions. Refresh data and check posting identity.');rows.set(key,row);}
  return {rows:[...rows.values()],complete:children.every(c=>c.complete),reason:children.find(c=>c.reason)?.reason};
 };return visit(question,0);
}
