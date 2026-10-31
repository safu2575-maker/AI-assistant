const assert=require('node:assert/strict');
const {reviewBackup,mergeBackup}=require('../.tmp/test/qna/settingsBackup');
const base={format:'askBICS-settings',version:1,layout:{synonyms:{Tenant:['client']},alwaysFilter:{field:'Tenant',values:['A']}}};
assert.equal(reviewBackup(JSON.stringify(base),['Tenant'],['Rent']).blocked,false);
assert.equal(reviewBackup(JSON.stringify(base),[],['Rent']).blocked,true);
assert.throws(()=>reviewBackup('{"format":"askBICS-settings","version":1,"layout":{"__proto__":{}}}',[],[]));
assert.throws(()=>reviewBackup(JSON.stringify({...base,version:2}),[],[]));
assert.equal(reviewBackup(JSON.stringify({...base,layout:{synonyms:{Missing:['x']}}}),['Tenant'],[]).accepted.synonyms,undefined);
const current={conversationMode:'latest',cardinalityFallbackEnabled:true,cardinalityMatrixThresholdPct:25,cardinalityMaxColumnValues:5,cardinalityLowToHighHierarchy:true,synonyms:{Tenant:['old'],City:['place']},alwaysFilter:base.layout.alwaysFilter};
const merged=mergeBackup(current,{synonyms:{Tenant:['new']}},false);
assert.deepEqual(merged.synonyms,{Tenant:['new'],City:['place']});assert.deepEqual(merged.alwaysFilter,current.alwaysFilter);assert.deepEqual(current.synonyms.Tenant,['old']);
assert.deepEqual(mergeBackup(current,{synonyms:{Tenant:['new']}},true).synonyms,{Tenant:['new']});
console.log('Settings backup validation, version rejection, missing fields, always-filter blocking and merge checks passed.');
const multiple={...base,layout:{alwaysFilter:[{field:'Tenant',values:['A','B']},{field:'City',values:['Riyadh']}]}};
assert.equal(reviewBackup(JSON.stringify(multiple),['Tenant','City'],[]).blocked,false);
assert.equal(reviewBackup(JSON.stringify(multiple),['Tenant'],[]).blocked,true);
assert.deepEqual(mergeBackup(current,multiple.layout,false).alwaysFilter,multiple.layout.alwaysFilter);

const visibilityBackup={...base,layout:{summarizeHiddenFields:['Tenant','Details'],answerGroups:[{id:'details',name:'Details',kind:'field',members:['Tenant','City'],aliases:[],enabled:true}]}};
assert.deepEqual(reviewBackup(JSON.stringify(visibilityBackup),['Tenant','City'],['Rent']).accepted.summarizeHiddenFields,['Tenant','Details']);
assert.deepEqual(mergeBackup({...current,summarizeHiddenFields:['Tenant']},{},false).summarizeHiddenFields,['Tenant']);
assert.deepEqual(mergeBackup({...current,summarizeHiddenFields:['Tenant']},{},true).summarizeHiddenFields,[]);

const cashFlow={fields:{company:'Company',document:'Document',clearing:'Clearing',account:'Account',accountDescription:'Description'},measure:'Amount',rules:[],displayColumns:['Document','Amount'],scope:{companies:['9720','9760'],filters:[{field:'Input',values:['Cash and bank']}],from:'2026-10-01',to:'2026-10-31'}};
const cashFields=['Company','Document','Clearing','Account','Description','Input'];
const reviewed=reviewBackup(JSON.stringify({...base,layout:{cashFlow}}),cashFields,['Amount']);assert.equal(reviewed.blocked,false);assert.deepEqual(reviewed.accepted.cashFlow,cashFlow);
for(const replace of [true,false])assert.deepEqual(mergeBackup(current,reviewed.accepted,replace).cashFlow,cashFlow);
assert.equal(reviewBackup(JSON.stringify({...base,layout:{cashFlow}}),cashFields.filter(f=>f!=='Input'),['Amount']).blocked,true);
