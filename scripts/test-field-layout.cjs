const assert=require('node:assert/strict');const {planParameterQuestion:plan}=require('../.tmp/test/parameterQuery');const {outlineModelRows}=require('../.tmp/test/modelOutline');
const c={enabled:true,table:'P',column:'Field',options:['Assigned Group','Tenant','Year'],fields:['Assigned Group','Tenant','Year'].map(name=>({name,table:'T',column:name}))};
for(const [p,r,col] of [['parent','row','column'],['(p)','(r)','(c)'],['PARENT','Rows','CoLuM'],['(Parent)','(R)','(C)'],['parent','rows','col']]){const out=plan(`Rent by Assigned Group ${p}, Tenant ${r}, Year ${col}`,c,['Rent']);assert.deepEqual(out.groups,['Assigned Group','Tenant','Year']);assert.equal(out.matrixRowCount,2);assert.equal(out.explicitParent,true);assert.equal(out.presentation,'matrix');}
assert.throws(()=>plan('Rent by Assigned Group parent',c,['Rent']),/child/);
assert.throws(()=>plan('Rent by Tenant row, Tenant column',c,['Rent']),/Conflicting/);
assert.throws(()=>plan('Rent by Tenant row as a bar chart',c,['Rent']),/matrix/);
const t=outlineModelRows({columns:['Group','Tenant','2026'],rows:[['A','One','10%'],['A','Two','20%'],['B','Three','40%']],rowIndices:[[],[],[]],modelTotals:['Grand Total','','25%']},2);
assert.deepEqual(t.rows,[['A','—'],['One','10%'],['Two','20%'],['B','—'],['Three','40%']]);assert.deepEqual(t.matrix.hasChildren,[true,false,false,true,false]);assert.deepEqual(t.modelTotals,['Grand Total','25%']);
console.log('Field layout words, mixed case, shortcuts, conflicts, child validation and nonadditive outline totals passed.');

const {pivotModelTable}=require('../.tmp/test/modelPivot');
const {wideCategoryFields}=require('../.tmp/test/columnLayout');
const source=(field,count)=>({columns:['Group',field,'Amount'],rows:Array.from({length:count},(_,i)=>['A',String(i+1),String(i+1)]),rowIndices:Array.from({length:count},()=>[]),modelTotals:['Grand Total','',String(count*(count+1)/2)],modelEditor:{rows:['Group'],columns:[field],measures:['Amount'],filters:[]}});
assert.equal(pivotModelTable(source('Vendor',12),2).modelPivot.columnValues.length,12);
const wide=pivotModelTable(source('Vendor',13),2);
assert.equal(wide.modelPivot,undefined);assert.equal(wide.rows.length,13);
assert.deepEqual(wide.modelEditor.rows,['Group','Vendor']);assert.deepEqual(wide.modelEditor.columns,[]);
assert.deepEqual(wide.modelTotals,['Grand Total','','91']);assert.match(wide.columnLayoutNotice,/12/);
for(const field of ['Month','Year','FiscalYear','Fiscal_Month'])assert.equal(pivotModelTable(source(field,20),2).modelPivot.columnValues.length,20);
assert.equal(pivotModelTable(source('PeriodKey',20),2,undefined,1,['PeriodKey']).modelPivot.columnValues.length,20);
const mixed={columns:['Group','Year','Vendor','Amount'],rows:Array.from({length:13},(_,i)=>['A','2026','Vendor '+i,String(i)]),rowIndices:Array.from({length:13},()=>[]),modelRawRows:Array.from({length:13},(_,i)=>[null,null,null,i]),modelSelections:Array.from({length:13},()=>[])};
const mixedPivot=pivotModelTable(mixed,3,undefined,1);
assert.deepEqual(mixedPivot.modelPivot.rowFields,['Group','Vendor']);assert.deepEqual(mixedPivot.modelPivot.columnFields,['Year']);assert.equal(mixedPivot.rows.length,13);
assert.deepEqual(wideCategoryFields(['Year','Vendor'],[['2025','A'],['2026','A']]),[],'years do not inflate category cardinality');
assert.deepEqual(wideCategoryFields(['Group','Vendor'],Array.from({length:16},(_,i)=>[Math.floor(i/4),i%4])),[0,1],'combined categories must also fit');

const {buildContext}=require('../.tmp/test/dataAdapter');
const {GlobalQnaEngine}=require('../.tmp/test/qna/engine');
const local=new GlobalQnaEngine(buildContext({columns:[{displayName:'Group',roles:{fields:true}},{displayName:'Vendor',roles:{fields:true}},{displayName:'Year',roles:{fields:true}},{displayName:'Amount',roles:{measures:true},type:{numeric:true}}],rows:Array.from({length:13},(_,i)=>['A','Vendor '+i,String(2000+i),i+1])}));
const localWide=local.configuredAnswer('matrix',['Group'],['Vendor'],['Amount']);
assert.match(localWide.text,/more than 12/);assert.equal(localWide.table.columns.length,2);
assert.ok(localWide.table.rows.some(row=>row[0]==='Vendor 12'),'no category is truncated');
const localYears=local.configuredAnswer('matrix',['Group'],['Year'],['Amount']);
assert.equal(localYears.table.columns.length,15,'13 years plus row label and total remain visible');
const filtered=local.configuredAnswer('matrix',['Group'],['Vendor'],['Amount'],[{field:{name:'Vendor',key:'Vendor',values:[],uniqueValues:[]},indices:Array.from({length:12},(_,i)=>i)}]);
assert.equal(filtered.table.columnLayoutNotice,undefined,'count distinct members after filters');
console.log('Column readability: 12/13 boundary, no truncation, time exceptions, mixed layouts, filtered counts and preserved totals passed.');
