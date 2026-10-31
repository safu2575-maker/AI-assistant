const assert=require('node:assert/strict');const {planParameterQuestion:plan}=require('../.tmp/test/parameterQuery');
const names=['Tenant','City','Year'];const c={enabled:true,table:'P',column:'Field',options:names,fields:names.map(name=>({name,table:'T',column:name}))};
for(const token of ['(f)','(F)','(filter)','filter','FILTER']){const p=plan(`Rent by Tenant as rows, Year as columns where City ${token} = Riyadh`,c,['Rent']);assert.deepEqual(p.groups,['Tenant','Year']);assert.equal(p.matrixRowCount,1);assert(p.filters.some(f=>f.target.column==='City'&&f.values[0]==='Riyadh'));}
assert.throws(()=>plan('Rent where City (f)',c,['Rent']),/Choose a value/);
assert.equal(plan('Rent where City = F',c,['Rent']).filters[0].values[0],'F');
assert.equal(plan('Rent where City (F) = blank',c,['Rent']).filters[0].values[0],null);
console.log('Filter markers, natural as-rows/columns, missing-value validation, literal F and blank filters passed.');
