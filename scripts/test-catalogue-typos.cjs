const assert=require('node:assert/strict');const {planParameterQuestion}=require('../.tmp/test/parameterQuery');const {correctCatalogueTypos}=require('../.tmp/test/catalogueTypos');const {matchSuggestionCandidates}=require('../.tmp/test/qna/suggestionMatching');
const config={enabled:true,table:'Fields',column:'Field',options:['Assigned Sales Category','MonthIndex'],fields:[{name:'Assigned Sales Category',table:'T',column:'Category',type:'text',values:['Electronics']},{name:'MonthIndex',table:'T',column:'MonthIndex',type:'number'}],time:{monthIndexField:'MonthIndex'}};
const run=q=>planParameterQuestion(q,config,['Rent Measure']);const expected=run('Show Rent Measure by Assigned Sales Category for June 2024');
for(const q of ['show Rnet Measure by Assigned Sales Category for June 2024','show Rent Measur by Assigned Sales Catgory for June 2024','what is the Rnet Measure of Assigned Sales Category in June 2024']){const p=run(q);assert.deepEqual(p.measures,expected.measures);assert.deepEqual(p.groups,expected.groups);assert.deepEqual(p.filters,expected.filters);assert(p.summary.some(s=>s.startsWith('Interpreted')));}
const names=['Rent Measure','Assigned Sales Category'];
for(const q of ['Rent Measure where Assigned Sales Category = "Catgory"','Rent Measure GL (2575)','Rent Measure excluding Assigned Sales Category','Rent Measure before 2024'])assert.equal(correctCatalogueTypos(q,{names,values:[]}).question,q);
assert.equal(correctCatalogueTypos('Rnet Measure',{names,values:['Rnet']}).question,'Rnet Measure');
assert.throws(()=>correctCatalogueTypos('Cost',{names:['Coat','Cast'],values:[]}),/Did you mean/);
assert.throws(()=>run('Rnet Measure excluding Assigned Sales Category'),/Could not safely interpret/);
assert.equal(matchSuggestionCandidates([{label:'Rent Measure',detail:'Measure'}],'rnet',8)[0].label,'Rent Measure');
assert.equal(matchSuggestionCandidates([{label:'2575',detail:'GL'}],'2576',8).length,0);
console.log('Offline typo matching: exact query equivalence, transpositions, omissions, protected values/codes/operators, ambiguity and suggestions passed.');

assert.equal(correctCatalogueTypos('Rnet Measure where Category = Rent Measur',{names,values:[]}).question,'Rent Measure where Category = Rent Measur');
