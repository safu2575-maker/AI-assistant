const assert=require('node:assert/strict');
const {planParameterQuestion:plan}=require('../.tmp/test/parameterQuery');
const c={enabled:true,table:'P',column:'Field',options:['Tenant','City'],fields:[{name:'Tenant',table:'T',column:'Tenant',aliases:['Tenant Name']},{name:'City',table:'T',column:'City'}]};
for(const marker of ['blank','BLANK','(blank)','(BLANK)',"''",'""',"('')",'(" ")'])for(const join of [' ',' = '])for(const connector of ['where','for']){
 const p=plan(`Rent ${connector} Tenant${join}${marker}`,c,['Rent']);assert(p.filters.some(f=>f.target.column==='Tenant'&&f.values[0]===null),marker+join+connector);
}
for(const q of ['Rent where Tenant blank; City = Riyadh','Rent where City = Riyadh; Tenant blank','Rent where Tenant blank and City = Riyadh','Rent where Tenant blank and City blank','Rent for Tenant Name (blank)'])assert(plan(q,c,['Rent']).filters.length);
assert.throws(()=>plan('Rent blank',c,['Rent']));assert.throws(()=>plan(`Rent where Tenant (' ")`,c,['Rent']));
const literal=plan('Rent where Tenant = "blank"',c,['Rent']);assert.equal(literal.filters[0].values[0],'blank');
console.log('Blank shorthand, case, parentheses, empty quotes, explicit equals, aliases, multiple filters and ambiguous-input rejection passed.');
