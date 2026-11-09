import {sameCashPostingAmount} from './cashFlowAmount';
import {CashPosting,CashSetup,cashKey,CashContinuation} from './cashFlow';
import {cashQuestion} from './cashFlowQuery';
/** Load a bounded relationship graph, never the whole company ledger. */
export async function loadCashLinks(setup:CashSetup,company:string,currency:string,roots:CashPosting[],load:(q:string)=>Promise<{rows:CashPosting[];complete:boolean}>,active:()=>boolean,progress:(text:string)=>void,continuation?:CashContinuation) {
 const rows=new Map<string,CashPosting>(roots.map(p=>[cashKey(p),p]));
 let frontier=[...rows.values()];
 const seen=new Set<string>();let calls=0,complete=true,queryBudget=100,rowBudget=20000;
 for(let depth=0;depth<(continuation?1024:40);depth++){
  if(!active())throw new Error('Cash-flow request cancelled.');
  if(continuation&&depth>0&&depth%40===0){await continuation.pause({phase:'loading',reason:'Document discovery batch reached (40 rounds)',company,depth,queries:calls,rows:rows.size});if(!active())throw new Error('Cash-flow request cancelled.');}
  const documents=new Set<string>(),clearings=new Set<string>();
  for(const p of frontier){documents.add(p.document);if(p.reference)documents.add(p.reference);if(p.clearing)clearings.add(p.clearing);}
  const next:CashPosting[]=[];
  for(const [field,values] of [[setup.fields.document,documents],[setup.fields.clearing,clearings]] as const){
   const pending=[...values].filter(v=>!seen.has(JSON.stringify([field,v])));
   for(let i=0;i<pending.length;i+=40){
    if(!active())throw new Error('Cash-flow request cancelled.');
    if(continuation){
     if(calls>=1000||rows.size>=100000)return {rows:[...rows.values()],complete:false,reason:'Loading safety limit reached: 1000 queries or 100000 postings. Narrow the scope.'};
     if(calls>=queryBudget||rows.size>=rowBudget){await continuation.pause({phase:'loading',reason:calls>=queryBudget?'Linked-query batch reached (100 queries)':'Loaded-posting batch reached (20000 postings)',company,depth,queries:calls,rows:rows.size});if(!active())throw new Error('Cash-flow request cancelled.');queryBudget=calls+100;rowBudget=rows.size+20000;}
    }else if(calls>=100||rows.size>=20000)return {rows:[...rows.values()],complete:false};
    const batch=pending.slice(i,i+40);batch.forEach(v=>seen.add(JSON.stringify([field,v])));calls++;
    progress(`Loading linked documents · batch ${calls} · ${rows.size.toLocaleString()} postings`);
    const response=await load(cashQuestion(setup,company,{phase:'links',currency,link:{field,values:batch}}));
    if(!active())throw new Error('Cash-flow request cancelled.');complete=complete&&response.complete;
    for(const p of response.rows){if(p.company!==company||p.currency!==currency)continue;const key=cashKey(p);const prior=rows.get(key);if(prior&&!sameCashPostingAmount(prior.amount,p.amount))throw new Error('Posting amounts changed between queries. Refresh the data and map a unique line item. Conflict: '+JSON.stringify({company:p.company,year:p.year,document:p.document,item:p.item,previousAmount:prior.amount,returnedAmount:p.amount,lookupField:field,lookupValues:batch}));if(!prior){rows.set(key,p);next.push(p);}if(rows.size>=(continuation?100000:20000))return {rows:[...rows.values()],complete:false,reason:continuation?'Loaded-posting safety limit reached (100000 postings). Narrow the scope.':undefined};}
   }
  }
  if(!next.length)return {rows:[...rows.values()],complete};
  frontier=next;
 }
 return {rows:[...rows.values()],complete:false,reason:'Document discovery limit reached.'};
}
