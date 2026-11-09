const assert=require('node:assert/strict');const {AcceptedSuggestions}=require('../.tmp/test/qna/acceptedSuggestions');
const s=new AcceptedSuggestions();const text='Show Rent GL (2575)';s.accept(text,{start:10,end:text.length,text:'GL (2575)',kind:'value',name:'2575',field:'GL',canonical:'GL (2575)'});
assert.equal(s.snapshot()[0].field,'GL');s.sync('Please '+text);assert.equal(s.snapshot()[0].start,17);assert.equal(s.resolve('Please '+text),'Please '+text);
s.sync('Please '+text+' in June 2024');assert.equal(s.snapshot().length,1);
s.sync('Please Show Rent GL (2576) in June 2024');assert.equal(s.snapshot().length,0);
s.accept('rental',{start:0,end:6,text:'rental',kind:'measure',name:'Rent Measure',canonical:'Rent Measure'});assert.equal(s.resolve('rental'),'Rent Measure');s.sync('');assert.equal(s.snapshot().length,0);
console.log('Accepted identities: prefix/suffix edits, changed value invalidation, canonical synonym and clear passed.');
