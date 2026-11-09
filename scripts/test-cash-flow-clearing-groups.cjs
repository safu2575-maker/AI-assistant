const assert=require('node:assert/strict');
const {traceCash,cashKey,cashEvidence}=require('../.tmp/test/cashFlow');
const {cashFlowTable}=require('../.tmp/test/cashFlowTable');
const p=(document,item,account,amount,clearing='')=>({company:'2396',year:'2026',currency:'QAR',date:'2026-01-01',document,item,account,amount,clearing,clearingYear:'2026',clearingDate:'2026-01-01',partner:'V1'});
const run=(rows,extra={})=>traceCash(rows,[],{company:'2396',currency:'QAR',allDates:true,from:'',to:'',complete:true,startKeys:[cashKey(rows[0])],...extra});
const bank=p('PAY','1','BANK',-100),vendors=[60,30,10].map((n,i)=>p('PAY',String(i+2),'VENDOR',n,'C'));
const invoices=[60,30,10].flatMap((n,i)=>[p('INV'+i,'1','VENDOR',-n,'C'),p('INV'+i,'2','EXP',n)]);
const rows=[bank,...vendors,...invoices];
let result=run(rows);
assert.equal(result.unresolved,0);assert.equal(result.payments,100);assert.deepEqual(result.allocations.map(a=>a.amount),[-60,-30,-10]);
assert.ok(result.allocations.every(a=>a.path.some(p=>p.settlementSources?.length===3)));
assert.ok(result.allocations.every(a=>a.path.some(p=>p.settlementPaths?.length===3)));
const table=cashFlowTable(result.allocations,{fields:{document:'document'},measure:'Amount',rules:[]});
assert.equal(table.rows.length,1);assert.equal(table.entries[0].length,3);assert.equal(table.total([0])[table.columns.indexOf('Destination amount')],'-100.00');
assert.equal(new Set(result.allocations.flatMap(a=>cashEvidence(a.path).map(cashKey))).size,rows.length);
// Source amounts need not match individual invoices: aggregate evidence proves full settlement.
result=run([bank,p('PAY','2','VENDOR',55,'C'),p('PAY','3','VENDOR',45,'C'),...invoices]);assert.equal(result.unresolved,0);
// Equal invoice amounts are distinct posting identities, not duplicates.
const equal=[p('P','1','BANK',-90),...Array.from({length:3},(_,i)=>p('P',String(i+2),'VENDOR',30,'E')),...Array.from({length:3},(_,i)=>[p('I'+i,'1','VENDOR',-30,'E'),p('I'+i,'2','EXP',30)]).flat()];
assert.equal(run(equal).allocations.length,3);assert.equal(run(equal).unresolved,0);
// Screenshot-like downstream GR/IR join: 62,850 resolved plus two 32,000 branches.
const downstream=[p('1500005336','1','BANK',-126850),p('1500005336','2','VENDOR',126850,'PAYCLEAR'),p('A','1','VENDOR',-62850,'PAYCLEAR'),p('A','2','INVENTORY',62850),...['5100011942','5100011943'].flatMap(doc=>[p(doc,'1','VENDOR',-32000,'PAYCLEAR'),p(doc,'2','GRIR',32000,'GRIRCLEAR')]),p('GR','1','GRIR',-32000,'GRIRCLEAR'),p('GR','2','GRIR',-32000,'GRIRCLEAR'),p('GR','3','INVENTORY',64000)];
result=run(downstream);assert.equal(result.unresolved,0);assert.equal(result.payments,126850);assert.equal(result.allocations.reduce((n,a)=>n+a.amount,0),-126850);assert.equal(result.allocations.length,3);
assert.equal(cashFlowTable(result.allocations,{fields:{document:'document'},measure:'Amount',rules:[]}).rows.length,1);
assert.ok(result.allocations.some(a=>cashEvidence(a.path).some(p=>p.document==='5100011942')&&cashEvidence(a.path).some(p=>p.document==='5100011943')));
// Partial, incomplete, cross-payment and conflicting-reference cases must not be guessed.
assert.equal(run(rows,{complete:false}).unresolved,100);
const partial=[{...bank,amount:-50},...vendors.map(p=>({...p,amount:p.amount/2})),...invoices];assert.equal(run(partial).unresolved,50);
const extra=[...rows,p('OTHER','1','VENDOR',20,'C'),p('EXTRA','1','VENDOR',-20,'C'),p('EXTRA','2','EXP',20)];assert.equal(run(extra).unresolved,100);
const payments=[p('P1','1','BANK',-60),p('P1','2','VENDOR',60,'C'),p('P2','1','BANK',-40),p('P2','2','VENDOR',40,'C'),...invoices];assert.equal(run(payments,{startKeys:[cashKey(payments[0]),cashKey(payments[2])]}).unresolved,100);
assert.ok(run(rows.map(p=>p.document==='INV1'&&p.account==='EXP'?{...p,amount:29}:p)).unresolved>0);
assert.equal(run(rows,{allDates:false,from:'2026-01-01',to:'2026-01-31'}).unresolved,0);
assert.equal(run(rows.map(p=>({...p,clearingDate:'2026-02-01'})),{allDates:false,from:'2026-01-01',to:'2026-01-31'}).unresolved,100);
assert.ok(run(rows,{maxSteps:3}).unresolved>0);assert.ok(run(rows,{maxDepth:1}).unresolved>0);
const reversed=run(rows.map(p=>({...p,amount:-p.amount})));assert.equal(reversed.receipts,100);assert.equal(reversed.unresolved,0);
assert.equal(run([...rows,...rows.map(p=>({...p,company:'OTHER'}))]).unresolved,0);
const many=[p('B','1','BANK',-500),...Array.from({length:500},(_,i)=>p('B',String(i+2),'VENDOR',1,'LARGE')),...Array.from({length:500},(_,i)=>[p('L'+i,'1','VENDOR',-1,'LARGE'),p('L'+i,'2','EXP',1)]).flat()];const large=run(many);assert.equal(large.unresolved,0);assert.equal(large.allocations.length,500);assert.equal(cashEvidence(large.allocations.flatMap(a=>a.path)).length,many.length);
console.log('Clearing groups: exact full funding, same-GL grouping, equal amounts, downstream joins, evidence, partial/competing groups, cutoff and limits passed.');
