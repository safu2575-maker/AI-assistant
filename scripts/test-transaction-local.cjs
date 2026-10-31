const assert = require('node:assert/strict');
const {filterTransactionRows: filter} = require('../.tmp/test/qna/transactionLocal');
const table = {columns:['Group','City','Amount'], analysisGroupCount:2, modelResultComplete:true, summaryAdditiveMeasures:['Amount'],
 rows:[['A','X','10'],['B','X','20'],['B','Y','30'],['C','Y','—']], rowIndices:[[0],[1],[2],[3]],
 modelGroupValues:[['A','X'],['B','X'],['B','Y'],['C','Y']], modelRawRows:[[null,null,10],[null,null,20],[null,null,30],[null,null,null]],
 modelSelections:[['id0'],['id1'],['id2'],['id3']], transactionExcludedRows:[1,2], transactionReviewRows:{2:'Review'}, drillScopes:[{question:'Amount in 2026'}]};
const selected=new Map([['Group',new Set(['"A"','"B"'])],['City',new Set(['"X"'])]]);
const result=filter(table,selected);
assert.deepEqual(result.rowIndices,[[0],[1]],'OR within a field, AND across fields');
assert.deepEqual(result.modelRawTotals,[null,null,30]);
assert.deepEqual(result.modelSelections,[['id0'],['id1']]);
assert.deepEqual(result.transactionExcludedRows,[1]);
assert.deepEqual(result.drillScopes[0].summaryFilters,[{field:'Group',values:['A','B']},{field:'City',values:['X']}]);
assert.equal(filter(table,selected,'City').rows.length,3,'facets omit their own filter');
assert.equal(filter(table,new Map()).rows.length,4,'clear restores all loaded rows');
assert.equal(filter({...table,modelResultComplete:false},selected),undefined);
assert.equal(filter({...table,summaryAdditiveMeasures:[]},selected),undefined,'ratios require model evaluation');
assert.equal(filter({...table,modelRawRows:undefined},selected),undefined);
assert.equal(filter(table,new Map([['Missing',new Set(['1'])]])),undefined);
assert.equal(table.rows.length,4,'source remains immutable');
console.log('Local transactions: completeness, raw totals, OR/AND, facets, identities and drill scopes passed.');
