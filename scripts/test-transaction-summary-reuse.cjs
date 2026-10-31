const assert=require('node:assert/strict');
const {reuseTransactionSummary:reuse}=require('../.tmp/test/qna/transactionSummaryReuse');
const t={columns:['Group','ID','Rent'],rows:[['A','1','10'],['A','2','20'],['B','3','-5']],rowIndices:[[],[],[]],analysisGroupCount:2,modelResultComplete:true,summaryAdditiveMeasures:['Rent'],modelGroupValues:[['A','1'],['A','2'],['B','3']],modelRawRows:[[null,null,10],[null,null,20],[null,null,-5]]};
assert.deepEqual(reuse(t,'Group','Rent').modelRawRows,[[null,30],[null,-5]]);
assert.equal(reuse({...t,modelResultComplete:false},'Group','Rent'),undefined);
assert.equal(reuse({...t,summaryAdditiveMeasures:[]},'Group','Rent'),undefined);
assert.equal(reuse({...t,modelRawRows:[]},'Group','Rent'),undefined);
assert.equal(reuse(t,'Missing','Rent'),undefined);
assert.deepEqual(reuse({...t,modelRawRows:[[null,null,null],[null,null,null],[null,null,0]]},'Group','Rent').modelRawRows,[[null,null],[null,0]]);
console.log('Transaction summary reuse checks passed');

assert.deepEqual(reuse(t,'Group','Rent').modelTotals,['Grand Total','25']);
