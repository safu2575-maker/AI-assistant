import {resolveCashGroup} from './cashFlowGroup';
import {CashPosting,CashScope,CashRule,CashContinuation,CashResult,cashKey,traceCashResumable} from './cashFlow';
export interface CashPath {root:string;path:CashPosting[];status:string}
const doc=(p:CashPosting)=>JSON.stringify([p.company,p.year,p.document,p.currency]);
const clearing=(p:CashPosting)=>JSON.stringify([p.company,p.clearingYear,p.clearing,p.account,p.partner||'',p.currency]);
/** Relationship evidence only: never creates an allocation. */
export async function discoverCashPaths(rows:CashPosting[],scope:CashScope,continuation:CashContinuation):Promise<CashPath[]> {
 const documents=new Map<string,CashPosting[]>(),groups=new Map<string,CashPosting[]>();
 const put=(m:Map<string,CashPosting[]>,k:string,p:CashPosting)=>{const a=m.get(k)||[];a.push(p);m.set(k,a);};
 for(const p of rows){if(p.company!==scope.company||p.currency!==scope.currency)continue;put(documents,doc(p),p);if(p.clearing)put(groups,clearing(p),p);}
 const output:CashPath[]=[];let work=0;
 const starts=new Set(scope.startKeys);
 for(const root of rows.filter(p=>starts.has(cashKey(p)))){
  const stack=[{p:root,path:[root],link:false,seen:new Set<string>()}];
  while(stack.length){if(!continuation.active())throw new Error('Cash-flow request cancelled.');const state=stack.pop()!,{p,path,link}=state;const emit=(status:string)=>output.push({root:cashKey(root),path,status});
   if(++work>100000||output.length>=10000){emit('Path discovery limit reached');return output;}
   if(work%250===0)await new Promise(r=>setTimeout(r,0));
   if(!p.document||!p.item){emit('Invalid posting identity');continue;}
   const key=cashKey(p)+':'+link;if(state.seen.has(key)){emit('Cycle detected');continue;}if(path.length>512){emit('Path depth limit reached');continue;}
   const seen=new Set(state.seen);seen.add(key);
   if(link&&!p.clearing&&!p.reference){emit('Destination found');continue;}
   let pool:CashPosting[];
   if(!link)pool=documents.get(doc(p))||[];
   else if(p.reference)pool=(documents.get(JSON.stringify([p.company,p.referenceYear||'',p.reference,p.currency]))||[]).filter(q=>q.account===p.account&&(!p.referenceItem||q.item===p.referenceItem)&&(!p.partner||q.partner===p.partner));
   else {if(!scope.allDates&&(!p.clearingDate||p.clearingDate>scope.to)){emit('Clearing date unavailable or after cutoff');continue;}pool=groups.get(clearing(p))||[];}
   const candidates=pool.filter(q=>cashKey(q)!==cashKey(p)&&q.amount*p.amount<0&&(scope.allDates||q.date<=scope.to));
   if(!candidates.length){emit('Missing linked posting');continue;}
   if(stack.length+candidates.length>10000){emit('Path branch limit reached');continue;}
   for(const q of candidates)stack.push({p:q,path:[...path,q],link:!link,seen});
  }
 }
 return output;
}
/** Partition only disconnected document/reference/clearing components; shared settlements remain together. */
export async function traceCashComponents(rows:CashPosting[],rules:CashRule[],scope:CashScope,c:CashContinuation):Promise<CashResult&{verifiedRoots:string[]}> {
 const parent=rows.map((_,i)=>i),find=(i:number):number=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};const keys=new Map<string,number>();
 rows.forEach((p,i)=>{for(const key of ['d:'+doc(p),...(p.clearing?['c:'+clearing(p)]:[]),...(p.reference?['d:'+JSON.stringify([p.company,p.referenceYear||'',p.reference,p.currency])]:[])]){const prior=keys.get(key);if(prior===undefined)keys.set(key,i);else parent[find(i)]=find(prior);}});
 const parts=new Map<number,CashPosting[]>();rows.forEach((p,i)=>{const k=find(i),a=parts.get(k)||[];a.push(p);parts.set(k,a);});
 const result:CashResult&{verifiedRoots:string[]}={allocations:[],receipts:0,payments:0,unresolved:0,roots:0,complete:scope.complete,verifiedRoots:[]};const starts=new Set(scope.startKeys);
 for(const part of parts.values()){const roots=part.filter(p=>starts.has(cashKey(p)));if(!roots.length)continue;let r:CashResult;
  try{r=await traceCashResumable(part,rules,{...scope,startKeys:roots.map(cashKey)},c);r=await resolveCashGroup(part,roots,rules,scope,c,r);if(r.complete)result.verifiedRoots.push(...roots.map(cashKey));}
  catch(error){if(!c.active())throw error;const reason=(error as Error).message;if(!/Posting validation failed|Duplicate posting identity/.test(reason))throw error;r={allocations:roots.map(p=>({root:cashKey(p),amount:p.amount,category:'Unresolved',account:p.account,status:'Unverified · '+reason,path:[p]})),receipts:roots.reduce((n,p)=>n+Math.max(0,p.amount),0),payments:roots.reduce((n,p)=>n+Math.max(0,-p.amount),0),unresolved:roots.reduce((n,p)=>n+Math.abs(p.amount),0),roots:roots.length,complete:false};}
  if(r.groups)(result.groups??=[]).push(...r.groups);
  result.allocations.push(...r.allocations);result.receipts+=r.receipts;result.payments+=r.payments;result.unresolved+=r.unresolved;result.roots+=r.roots;result.complete=result.complete&&r.complete;
 }
 return result;
}
