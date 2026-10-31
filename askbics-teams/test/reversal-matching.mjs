import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {ModelSession}=createRequire(import.meta.url)('../dist/visual-server.cjs');
const model={name:'Reversal fixture',datasetId:'11111111-1111-1111-1111-111111111111',measures:[{name:'Amount',modelName:'Amount'}],dimensions:['ID','Document','Reversed','Company'].map(name=>({name,table:'Ledger',column:name,type:'text'}))};
const data=[{ID:'1',Document:'D1',Reversed:null,Company:'A',Amount:1000},{ID:'2',Document:'D2',Reversed:'D1',Company:'A',Amount:-1000},{ID:'3',Document:'D3',Reversed:null,Company:'A',Amount:100},{ID:'4',Document:'D4',Reversed:'Outside',Company:'A',Amount:-40},{ID:'5',Document:'D5',Reversed:null,Company:'B',Amount:800}];
const queries=[];
const fetcher=async(url,init)=>{const dax=JSON.parse(init.body).queries[0].query;queries.push(dax);let selected=data;for(const f of dax.matchAll(/TREATAS\(\{([^}]*)\},\s*'Ledger'\[([^\]]+)\]\)/g)){const values=JSON.parse('['+f[1]+']');selected=selected.filter(r=>values.includes(r[f[2]]));}const groups=[...dax.matchAll(/"G\d+", 'Ledger'\[([^\]]+)\]/g)].map(m=>m[1]);let rows;if(dax.startsWith('EVALUATE ROW('))rows=[{'[M0]':selected.reduce((s,r)=>s+r.Amount,0)}];else{const buckets=new Map();for(const r of selected){const key=JSON.stringify(groups.map(n=>r[n]));buckets.set(key,[...(buckets.get(key)||[]),r]);}rows=[...buckets].map(([k,rs])=>({...Object.fromEntries(JSON.parse(k).map((v,i)=>['[G'+i+']',v])),'[M0]':rs.reduce((s,r)=>s+r.Amount,0)}));}return new Response(JSON.stringify({results:[{tables:[{rows}]}]}));};
const session=new ModelSession(model,'fixture',fetcher);
const settings={alwaysFilter:{field:'Company',values:['A']},analysis:{draft:{transactionFields:['ID'],transactionRule:{name:'Reversal pairs',enabled:true,keyField:'ID',formula:'',reversal:{documentField:'Document',reversalField:'Reversed',amountMeasure:'Amount',partitionFields:['Company']}}}}};
for(const [view,ids,total] of [['included',['3','4'],60],['excluded',['1','2'],0],['all',['1','2','3','4'],60]]){const a=await session.answer(';transactions:'+encodeURIComponent(JSON.stringify([{question:'Show Amount',transactionRuleView:view}])),settings);assert(a.table,JSON.stringify(a));assert.deepEqual(a.table.rows.map(r=>r[0]),ids);assert.equal(a.table.modelRawTotals[1],total);assert.equal(a.transactionRule.reviewCount,1);assert(a.transactionRule.reversal);}
assert(queries.every(q=>q.includes("'Ledger'[Company]")));
console.log('Teams document matching: both pair members filtered, unmatched review, all views, model totals and Always filters passed.');

settings.analysis.draft.transactionRule.reversal.method='lookup';
settings.analysis.draft.transactionRule.reversal.amountMeasure='';
for(const [view,ids,total] of [['included',['1','3','4'],1060],['excluded',['2'],-1000],['all',['1','2','3','4'],60]]){
 const a=await session.answer(';transactions:'+encodeURIComponent(JSON.stringify([{question:'Show Amount',transactionRuleView:view}])),settings);
 assert(a.table,JSON.stringify(a));assert.deepEqual(a.table.rows.map(r=>r[0]),ids);assert.equal(a.table.modelRawTotals[1],total);assert(a.transactionRule.referenceLookup);
}
console.log('Reference lookup: all three scoped views preserve rows and use model totals; no automatic opposite-side exclusion.');
