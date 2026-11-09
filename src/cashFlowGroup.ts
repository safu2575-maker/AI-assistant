import {CashPosting,CashScope,CashRule,CashContinuation,CashResult,CashGroup,cashKey,cashEvidence,traceCashResumable} from './cashFlow';

/** Retry a wholly ambiguous connected component as one funded group. Never replace
 * confirmed/partial allocations, infer missing funding, or expose synthetic postings. */
export async function resolveCashGroup(rows:CashPosting[],roots:CashPosting[],rules:CashRule[],scope:CashScope,c:CashContinuation,original:CashResult):Promise<CashResult> {
 if(!scope.complete||!original.complete||!original.allocations.length||original.allocations.some(a=>a.status!=='Allocation unclear')||roots.some(p=>!p.account))return original;
 const accounts=new Set([...roots.map(p=>p.account),...(scope.banks||[]),...rules.filter(r=>r.role==='bank').map(r=>r.account)]);
 const banks=rows.filter(p=>p.company===scope.company&&p.currency===scope.currency&&accounts.has(p.account)&&p.amount!==0&&(scope.allDates||p.date<=scope.to));
 const sign=Math.sign(roots[0].amount);
 if(banks.length<2||banks.some(p=>Math.sign(p.amount)!==sign||p.clearing||p.reference)||!roots.every(p=>banks.some(b=>cashKey(b)===cashKey(p))))return original;
 const total=banks.reduce((n,p)=>n+Math.abs(p.amount),0);
 if(!Number.isFinite(total)||!total)return original;
 let document='__askbics_group__';const documents=new Set(rows.map(p=>p.document));while(documents.has(document))document+='_';
 const base:CashPosting={company:scope.company,currency:scope.currency,year:'',document,item:'root',account:'',date:scope.allDates?roots[0].date:scope.from,amount:sign*total};
 const funding=banks.map((p,i):CashPosting=>({...base,item:'fund-'+i,account:p.account,amount:-p.amount,reference:p.document,referenceYear:p.year,referenceItem:p.item,partner:p.partner}));
 const checked=await traceCashResumable([...rows,base,...funding],rules,{...scope,startKeys:[cashKey(base)]},c);
 if(!checked.complete||checked.unresolved>1e-7||checked.allocations.some(a=>a.status!=='Resolved'||!a.account||accounts.has(a.account))||Math.abs(checked.allocations.reduce((n,a)=>n+Math.abs(a.amount),0)-total)>1e-7)return original;
 const real=(p:CashPosting)=>p.document!==document;
 const clean=(p:CashPosting):CashPosting=>{const {settlementSources:_sources,settlementPaths:_paths,...row}=p;return row;};
 const paths=checked.allocations.map(a=>cashEvidence(a.path).filter(real).map(clean));
 const destinations=new Map<string,{account:string;description:string;amount:number;posting:CashPosting}>();
 for(const a of checked.allocations){const end=clean(a.path.at(-1)!);const value=destinations.get(a.account)||{account:a.account,description:end.accountDescription||a.category,amount:0,posting:end};value.amount+=a.amount;destinations.set(a.account,value);}
 const group:CashGroup={id:JSON.stringify(banks.map(cashKey).sort()),payments:banks,selectedRoots:roots.map(cashKey),destinations:[...destinations.values()].map(({account,description,amount})=>({account,description,amount})),paths};
 const result={...original,groups:[group]};
 if(destinations.size>1&&scope.allocationPolicy!=='proportional')return result;
 const estimated=destinations.size>1;
 const targets=[...destinations.values()];
 // Keep the optional Cartesian payment/destination output bounded. Group evidence
 // remains available when expanding individual estimates would overwhelm the UI.
 if(roots.length*targets.length>10000)return result;
 const allocations=roots.flatMap(root=>{
  let remaining=root.amount;
  return targets.map((target,i)=>{
   const amount=i===targets.length-1?remaining:root.amount*Math.abs(target.amount)/total;remaining-=amount;
   return {root:cashKey(root),amount,category:target.description,account:target.account,status:estimated?'Estimated':'Resolved',groupId:group.id,basis:estimated?'Proportional estimate from verified group destination totals':'Verified destination only; invoice pairing not established',path:[root,{...target.posting,settlementSources:banks,settlementPaths:paths}]};
  });
 });
 return {...result,allocations,unresolved:estimated?original.unresolved:0};
}
