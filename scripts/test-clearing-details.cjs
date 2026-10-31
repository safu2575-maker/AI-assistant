const assert=require('node:assert/strict');
const {answerTransactions,transactionQuestion}=require('../.tmp/test/answerTransactions');
const {validateClearing}=require('../.tmp/test/clearingDetails');
const fields=['Clearing','Company','Clearing Year','ID','Year'];
const clearing={enabled:true,referenceField:'Clearing',companyField:'Company',yearField:'Clearing Year',measure:'Amount',columns:['ID']};
const config={table:'P',column:'Field',enabled:true,options:fields,fields:fields.map(name=>({name,table:'T',column:name})),analysis:{draft:{transactionFields:fields,clearing}}};
(async()=>{
 const calls=[];const load=async p=>{calls.push(p);return {text:'',table:{columns:[...p.groups,...p.measures],rows:[['1','100']],rowIndices:[[]],modelTotals:['Grand Total','100']}};};
 const scope={question:'Show Amount for September 2026',clearingDetails:true,clearingValues:['000123','1000',2026],inheritedFilters:[{target:{table:'T',column:'ID'},operator:'In',values:['1','2']}]};
 scope.lookupFilters=[{target:{table:'T',column:'ID'},operator:'In',values:['restricted-by-rule']}];
 const result=await answerTransactions(transactionQuestion([scope]),config,['Amount'],load);
 assert.deepEqual(calls[0].groups,['ID']);assert.deepEqual(calls[0].measures,['Amount']);
 for(const [column,value] of [['Clearing','000123'],['Company','1000'],['Clearing Year',2026]])assert(calls[0].filters.some(f=>f.target.column===column&&f.values[0]===value));
 assert(!calls[0].filters.some(f=>f.target.column==='ID'));assert(!calls[0].filters.some(f=>f.target.column==='Year'));assert.equal(result.table.clearing,undefined);assert.deepEqual(result.table.modelTotals,['Grand Total','100']);
 await assert.rejects(()=>answerTransactions(transactionQuestion([{...scope,clearingValues:['000123','',2026]}]),config,['Amount'],load),/required/);
 assert.throws(()=>validateClearing(clearing,fields,['Amount'],['ID']),/Include clearing/);
 assert.throws(()=>validateClearing({...clearing,columns:['missing']},fields,['Amount'],fields),/available clearing/);
 const restored=JSON.parse(JSON.stringify(config));assert.deepEqual(restored.analysis.draft.clearing,clearing);
 console.log('Clearing lookup: exact company/year/reference, leading zeros, inherited filters, custom columns, model totals, validation and saved configuration passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
const {settingsHelp}=require('../.tmp/test/qna/settingsHelp');
for(const label of ['Enable clearing links','Clearing document field','Company code field','Clearing fiscal year field','Clearing amount measure','Use transaction columns','Clearing detail columns']){
 if(!settingsHelp(label))throw new Error('Missing clearing setting help: '+label);
}
