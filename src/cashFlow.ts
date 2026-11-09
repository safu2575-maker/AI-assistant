/** Cash allocations are separate from posting amounts: a path never adds its intermediate balances. */
export type CashRole = 'bank' | 'intermediate' | 'destination';
export interface CashRule { account:string; role:CashRole; category:string }
export interface CashSetup {
 allocationPolicy?:'verified'|'proportional';
 fields:Record<string,string>; measure:string; rules:CashRule[]; displayColumns?:string[];
 scope?: {companies:string[]; filters:Array<{field:string;values:string[]}>; from?:string;to?:string};
}
export interface CashPosting {
 company:string; year:string; document:string; item:string; account:string; currency:string;
 /** Original payment lines funding an incoming clearing-group edge; no pairwise matching is implied. */
 settlementSources?:CashPosting[]; settlementPaths?:CashPosting[][];
 date:string; amount:number; clearing?:string; clearingYear?:string; clearingDate?:string;
 reference?:string; referenceYear?:string; referenceItem?:string; partner?:string; type?:string; accountDescription?:string; sourceValues?:Record<string,string>;
}
export interface CashGroup {id:string;payments:CashPosting[];selectedRoots:string[];destinations:Array<{account:string;description:string;amount:number}>;paths:CashPosting[][]}
export interface CashAllocation { groupId?:string;basis?:string; root:string; amount:number; category:string; account:string; status:string; path:CashPosting[] }
export interface CashResult { groups?:CashGroup[]; allocations:CashAllocation[]; receipts:number; payments:number; unresolved:number; roots:number; complete:boolean }
export const cashKey=(p:CashPosting)=>JSON.stringify([p.company,p.year,p.document,p.item]);
const docKey=(p:CashPosting)=>JSON.stringify([p.company,p.year,p.document,p.currency]);
const clearingKey=(p:CashPosting)=>JSON.stringify([p.company,p.clearingYear,p.clearing,p.account,p.partner||'',p.currency]);
export const cashFields = [
 ['company','Company code',true],['year','Fiscal year',false],['document','Document number',true],
 ['item','Line item',false],['account','Account',false],['currency','Currency',false],['date','Posting date',false],
 ['clearing','Clearing document',true],['clearingYear','Clearing fiscal year',false],['clearingDate','Clearing date',false],
 ['reference','Invoice reference',false],['referenceYear','Invoice reference year',false],['referenceItem','Invoice reference item',false],
 ['partner','Vendor/customer identifier',false],['type','Document type',false],['accountDescription','Account description',false]
] as const;
export function validateCashSetup(s:CashSetup,fields:string[],measures:string[]) {
 if(s?.allocationPolicy!==undefined&&!['verified','proportional'].includes(s.allocationPolicy))throw new Error('Choose a valid cash allocation policy.');
 if(!s||!s.fields||!Array.isArray(s.rules))throw new Error('Configure cash-flow field mappings and account rules.');
 for(const [key,label,required] of cashFields)if((required||s.fields[key])&&!fields.includes(s.fields[key]))throw new Error('Choose an available '+label+' field.');
 const mapped=Object.values(s.fields).filter(Boolean);if(new Set(mapped).size!==mapped.length)throw new Error('Use a separate source field for each mapping.');
 if(!measures.includes(s.measure))throw new Error('Choose a signed posting amount measure (debit positive, credit negative).');
 if(s.scope){if(!Array.isArray(s.scope.companies)||s.scope.companies.length>50||new Set(s.scope.companies).size!==s.scope.companies.length||s.scope.companies.some(v=>typeof v!=='string'||!v.trim()))throw new Error('Choose up to 50 company values.');if(!Array.isArray(s.scope.filters)||s.scope.filters.length>10||new Set(s.scope.filters.map(f=>f.field)).size!==s.scope.filters.length||s.scope.filters.some(f=>!fields.includes(f.field)||!Array.isArray(f.values)||!f.values.length||f.values.length>100||f.values.some(v=>typeof v!=='string'||!v.trim())))throw new Error('Choose distinct available starting-filter fields and 1–100 values per field.');}
 if(s.displayColumns && (!Array.isArray(s.displayColumns)||s.displayColumns.length>10||!s.displayColumns.length||new Set(s.displayColumns).size!==s.displayColumns.length||s.displayColumns.some(f=>!fields.includes(f)&&f!==s.measure)||!s.displayColumns.some(f=>f!==s.measure)))throw new Error('Choose 1–10 available starting-posting columns, including at least one field.');
 if(s.fields.year&&(!s.fields.clearingYear||(s.fields.reference&&!s.fields.referenceYear)))throw new Error('With fiscal year mapped, also map the fiscal years for clearing and invoice references.');
 if(!s.fields.year&&(s.fields.clearingYear||s.fields.referenceYear))throw new Error('Map document fiscal year when reference fiscal years are used.');
 if(s.fields.referenceItem&&!s.fields.item)throw new Error('Map line item when invoice reference item is used.');

 const accounts=new Set<string>();for(const r of s.rules){if(!r.account.trim()||accounts.has(r.account)||!['bank','intermediate','destination'].includes(r.role)||r.role==='destination'&&!r.category.trim())throw new Error('Use unique accounts, valid roles and a category for each destination.');accounts.add(r.account);}
}
export interface CashScope {allocationPolicy?:'verified'|'proportional';company:string;currency:string;from:string;to:string;allDates?:boolean;banks?:string[];startKeys?:string[];complete:boolean;maxDepth?:number;maxSteps?:number}
export interface CashCheckpoint {phase:'loading'|'tracing';reason:string;company:string;document?:string;depth?:number;steps?:number;queries?:number;rows?:number;automatic?:boolean}
export interface CashContinuation {active:()=>boolean;pause:(checkpoint:CashCheckpoint)=>Promise<void>}
/** Existing synchronous callers retain their original bounded behaviour. */
export function traceCash(postings:CashPosting[],rules:CashRule[],scope:CashScope):CashResult {
 const iterator=traceCashWork(postings,rules,scope,false);const next=iterator.next();if(next.done!==true)throw new Error('Unexpected synchronous cash-flow pause.');return next.value;
}
/** Generator retains allocation capacities, pending groups, path and cycle state across pauses. */
export async function traceCashResumable(postings:CashPosting[],rules:CashRule[],scope:CashScope,continuation:CashContinuation):Promise<CashResult> {
 const iterator=traceCashWork(postings,rules,scope,true);
 try{while(true){if(!continuation.active())throw new Error('Cash-flow request cancelled.');const next=iterator.next();if(next.done===true)return next.value;if(next.value.automatic)await new Promise<void>(resolve=>setTimeout(resolve,0));else await continuation.pause(next.value);}}
 finally{iterator.return(undefined as never);}
}
function* traceCashWork(postings:CashPosting[],rules:CashRule[],scope:CashScope,resumable:boolean):Generator<CashCheckpoint,CashResult,void> {
 const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 if(!scope.company||(!scope.allDates&&(!validDate(scope.from)||!validDate(scope.to)||scope.from>scope.to)))throw new Error('Choose company and a valid date range.');
 const documents=new Map<string,CashPosting[]>(),clearings=new Map<string,CashPosting[]>(),ids=new Set<string>();
 const role=new Map(rules.map(r=>[r.account,r]));
 const rows=postings.filter(p=>p.company===scope.company&&p.currency===scope.currency);
 const put=(map:Map<string,CashPosting[]>,key:string,p:CashPosting)=>{const a=map.get(key)||[];a.push(p);map.set(key,a);};
 for(const p of rows){const issues:string[]=[];if(!p.document)issues.push('Document number is missing');if(!p.item)issues.push('Line item is missing');if(!scope.allDates&&!validDate(p.date))issues.push('Posting date is invalid: '+JSON.stringify(p.date));if(!Number.isFinite(p.amount))issues.push('Posting amount is not a finite number: '+String(p.amount));if(issues.length){const label=(value:string)=>value?JSON.stringify(value):'(blank)';throw new Error('Posting validation failed (identity/date/amount). Company: '+label(p.company)+'; Fiscal year: '+label(p.year)+'; Document: '+label(p.document)+'; Line item: '+label(p.item)+'. '+issues.join('; ')+'. No posting was skipped.');}const key=cashKey(p);if(ids.has(key))throw new Error('Duplicate posting identity: '+p.document+'/'+p.item+'. Map source/ledger data to one unique posting dataset.');ids.add(key);if(!scope.allDates&&p.date>scope.to)continue;put(documents,docKey(p),p);if(p.clearing&&(scope.allDates||(p.clearingDate&&validDate(p.clearingDate)&&p.clearingDate<=scope.to)))put(clearings,clearingKey(p),p);}
 const postingKeys=new Map(rows.map(p=>[p,cashKey(p)]));
 const keyOf=(p:CashPosting)=>postingKeys.get(p)||cashKey(p);
 const starts=new Set(scope.startKeys),banks=new Set(scope.banks);
 // Cache immutable group statistics once; shared clearing groups can serve thousands of roots.
 const pools=new Map<CashPosting[],{positive:CashPosting[];negative:CashPosting[];positiveTotal:number;negativeTotal:number;balance:number}>();
 const stats=(pool:CashPosting[])=>{let value=pools.get(pool);if(!value){const positive=pool.filter(p=>p.amount>0),negative=pool.filter(p=>p.amount<0);value={positive,negative,positiveTotal:positive.reduce((n,p)=>n+Math.abs(p.amount),0),negativeTotal:negative.reduce((n,p)=>n+Math.abs(p.amount),0),balance:pool.reduce((n,p)=>n+p.amount,0)};pools.set(pool,value);}return value;};
 const references=new Map<string,CashPosting[]>();
 const roots=rows.filter(p=>(scope.allDates||(p.date>=scope.from&&p.date<=scope.to))&&(scope.startKeys?.length?starts.has(keyOf(p)):scope.banks?.length?banks.has(p.account):role.get(p.account)?.role==='bank')&&p.amount!==0);
 const allocations:CashAllocation[]=[];let steps=0,depthBudget=scope.maxDepth??40,stepBudget=scope.maxSteps??100000;let stopped=false;const used=new Map<string,number>(),epsilon=1e-7;
 const emit=(root:CashPosting,p:CashPosting,amount:number,status:string,path:CashPosting[],category='Unresolved')=>allocations.push({root:keyOf(root),amount:Math.sign(root.amount)*amount,category,account:p.account,status,path});
 for(const root of roots){
  type Pending={p:CashPosting;amount:number;path:CashPosting[];seen:Set<string>;depth:number};
  const pending=new Map<string,Pending[]>();
  const walk=function*(p:CashPosting,amount:number,mode:'document'|'link',path:CashPosting[],seen:Set<string>,depth:number,groupedSources?:CashPosting[],groupedPaths?:CashPosting[][]):Generator<CashCheckpoint,void,void>{
   if(path.length>1&&keyOf(p)===keyOf(root)){emit(root,p,amount,'Cycle detected',path);return;}
   ++steps;
   if(resumable){
    if(depth>512||steps>1000000){stopped=true;emit(root,p,amount,depth>512?'Safety depth limit reached (512 transitions)':'Safety work limit reached (1000000 steps)',path);return;}
    if(depth>depthBudget||steps>stepBudget){yield {phase:'tracing',reason:depth>depthBudget?'Traversal depth batch reached':'Traversal work batch reached',company:p.company,document:p.document,depth,steps};depthBudget=Math.max(depthBudget,depth)+40;stepBudget=Math.max(stepBudget,steps)+100000;}
    if(steps%250===0)yield {phase:'tracing',reason:'Yield to keep the visual responsive',company:p.company,steps,automatic:true};
   }else if(steps>(scope.maxSteps??100000)||depth>(scope.maxDepth??40)){emit(root,p,amount,'Processing limit reached',path);return;}
   const state=keyOf(p)+':'+mode;if(seen.has(state)){emit(root,p,amount,'Cycle detected',path);return;}const nextSeen=new Set(seen);nextSeen.add(state);
   const rule=role.get(p.account);
   if(path.length>1&&mode==='link'&&!p.clearing&&!p.reference){
    const category=rule?.role==='bank'?'Internal transfers':rule?.category||p.accountDescription|| (p.account?'Account '+p.account:'Ending document '+p.document);
    emit(root,p,amount,'Resolved',path,category);return;
   }   let pool:CashPosting[]=[];
   if(mode==='document')pool=documents.get(docKey(p))||[];
   else if(p.reference){const referenceKey=JSON.stringify([p.company,p.referenceYear||'',p.reference,p.currency,p.account,p.referenceItem||'',p.partner||'']);let matches=references.get(referenceKey);if(!matches){matches=(documents.get(JSON.stringify([p.company,p.referenceYear||'',p.reference,p.currency]))||[]).filter(q=>q.account===p.account&&(!p.referenceItem||q.item===p.referenceItem)&&(!p.partner||q.partner===p.partner));references.set(referenceKey,matches);}pool=matches;}
   else if(p.clearing){
    if(!scope.allDates&&(!p.clearingDate||!validDate(p.clearingDate))){emit(root,p,amount,'Clearing date unavailable',path);return;}
    if(!scope.allDates&&p.clearingDate!>scope.to){emit(root,p,amount,'Cleared after reporting cutoff',path);return;}
    pool=clearings.get(clearingKey(p))||[];
   }
   const group=stats(pool);const candidates=p.amount>0?group.negative:group.positive;
   if(!candidates.length){emit(root,p,amount,'Missing linked posting',path);return;}
   // A multi-source/multi-target group does not establish pairwise allocations.
   const sources=p.amount>0?group.positive:group.negative;
   const targetTotal=p.amount>0?group.negativeTotal:group.positiveTotal;
   const unbalanced=mode==='document'&&Math.abs(group.balance)>epsilon;
   if(unbalanced){emit(root,p,amount,'Document does not balance in available data',path);return;}
   if(candidates.length>1&&((sources.length>1&&!groupedSources)||Math.abs(amount-targetTotal)>epsilon)) {
    if(scope.complete&&mode==='link'&&p.clearing&&!p.reference&&sources.length>1&&!groupedSources){const key=clearingKey(p)+':'+Math.sign(p.amount);const waiting=pending.get(key)||[];waiting.push({p,amount,path,seen,depth});pending.set(key,waiting);}
    else emit(root,p,amount,'Allocation unclear',path);
    return;
   }
   let remainder=amount;
   for(const q of candidates){
    if(nextSeen.has(keyOf(q)+':'+(mode==='document'?'link':'document'))){emit(root,q,remainder,'Cycle detected',[...path,q]);remainder=0;break;}
    const capacityKey=mode+':'+keyOf(q);const available=Math.max(0,Math.abs(q.amount)-(used.get(capacityKey)||0));
    const take=Math.min(remainder,available);if(take<=epsilon)continue;used.set(capacityKey,(used.get(capacityKey)||0)+take);
    yield* walk(q,take,mode==='document'?'link':'document',[...path,groupedSources?{...q,settlementSources:groupedSources,settlementPaths:groupedPaths}:q],nextSeen,depth+1);remainder-=take;
   }
   if(remainder>epsilon)emit(root,p,remainder,'Insufficient unallocated amount',path);
  };
  yield* walk(root,Math.abs(root.amount),'document',[root],new Set(),0);
  // Join only fully funded clearing groups for this one root. Individual source-to-invoice
  // matches remain unknown; retain all incoming paths as group evidence instead of inventing pairs.
  while(pending.size){
   let joined=false;
   for(const [key,waiting] of pending){
    const first=waiting[0],group=stats(clearings.get(clearingKey(first.p))||[]);
    const sources=first.p.amount>0?group.positive:group.negative,targets=first.p.amount>0?group.negative:group.positive;
    const contributions=new Map<string,number>();let funded=0;
    for(const item of waiting){const id=keyOf(item.p);contributions.set(id,(contributions.get(id)||0)+item.amount);funded+=item.amount;}
    const total=first.p.amount>0?group.negativeTotal:group.positiveTotal;
    if(contributions.size!==sources.length||sources.some(p=>Math.abs((contributions.get(keyOf(p))||0)-Math.abs(p.amount))>epsilon)||Math.abs(funded-total)>epsilon||targets.some(p=>(used.get('link:'+keyOf(p))||0)>epsilon))continue;
    pending.delete(key);joined=true;
    const prefix=[...first.path];for(const item of waiting){let n=0;while(n<prefix.length&&n<item.path.length&&keyOf(prefix[n])===keyOf(item.path[n]))n++;prefix.length=n;}
    const seen=new Set<string>();let depth=0;for(const item of waiting){for(const state of item.seen)seen.add(state);depth=Math.max(depth,item.depth);}seen.delete(keyOf(first.p)+':link');
    yield* walk(first.p,funded,'link',prefix,seen,depth,sources,waiting.map(item=>item.path));
    break;
   }
   if(!joined){for(const waiting of pending.values())for(const item of waiting)emit(root,item.p,item.amount,'Allocation unclear',item.path);pending.clear();}
  }
 }
 return {allocations,receipts:roots.reduce((n,p)=>n+Math.max(0,p.amount),0),payments:roots.reduce((n,p)=>n+Math.max(0,-p.amount),0),unresolved:allocations.filter(a=>a.status!=='Resolved').reduce((n,a)=>n+Math.abs(a.amount),0),roots:roots.length,complete:scope.complete&&!stopped};
}

/** Original lines supporting a trace, including non-pairwise clearing-group evidence. */
export function cashEvidence(path:CashPosting[]):CashPosting[]{
 const result=new Map<string,CashPosting>(),seen=new Set<CashPosting>(),arrays=new Set<CashPosting[]>(),groups=new Set<CashPosting[][]>();const pending:CashPosting[]=[];
 const add=(rows:CashPosting[])=>{if(arrays.has(rows))return;arrays.add(rows);for(const row of rows)pending.push(row);};add(path);let cursor=0;
 while(cursor<pending.length){const p=pending[cursor++];if(seen.has(p))continue;seen.add(p);result.set(cashKey(p),p);if(p.settlementSources)add(p.settlementSources);if(p.settlementPaths&&!groups.has(p.settlementPaths)){groups.add(p.settlementPaths);for(const branch of p.settlementPaths)add(branch);}}
 return [...result.values()];
}
