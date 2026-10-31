import {CashAllocation, CashSetup, cashKey} from './cashFlow';
export function cashFlowTable(allocations:CashAllocation[],setup:CashSetup) {
 const selected=setup.displayColumns||[setup.fields.document,setup.fields.accountDescription||setup.fields.account,setup.measure].filter(Boolean);
 // Keep a label field first so the shared Grand Total row can retain its label.
 const columns=[...selected.filter(f=>f!==setup.measure),...selected.filter(f=>f===setup.measure)];
 const groups=new Map<string,CashAllocation[]>();
 for(const a of allocations){const end=a.path[a.path.length-1];const key=JSON.stringify([a.root,a.account||[end.company,end.year,end.document],a.category,a.status]);const group=groups.get(key)||[];group.push(a);groups.set(key,group);}
 const entries=[...groups.values()];
 const formatter=new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});const format=(n:number)=>formatter.format(n);
 const rows=entries.map(group=>{const a=group[0],root=a.path[0];return [...columns.map(f=>f===setup.measure?format(root.amount):root.sourceValues?.[f]??String(root[Object.keys(setup.fields).find(k=>setup.fields[k]===f) as keyof typeof root]||'—')),a.status==='Resolved'?(a.account||a.category):`Unresolved · ${a.status}`,a.status==='Resolved'?(a.path[a.path.length-1].accountDescription||'—'):'—',format(group.reduce((sum,v)=>sum+v.amount,0)),'View trace'];});
 const total=(indices:number[])=>{const unique=new Map<string,number>();let amount=0;for(const i of indices){const group=entries[i];if(!group)continue;unique.set(cashKey(group[0].path[0]),group[0].path[0].amount);amount+=group.reduce((n,a)=>n+a.amount,0);}return [...columns.map((c,i)=>i===0?'Grand Total':c===setup.measure?format([...unique.values()].reduce((n,v)=>n+v,0)):''),'','',format(amount),''];};
 return {columns:[...columns,'Destination account','Destination description','Destination amount','Details'],rows,entries,total};
}
