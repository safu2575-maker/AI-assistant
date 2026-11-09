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

for(const allocationPolicy of ['verified','proportional']){
 const configured={...cashFlow,allocationPolicy};const checked=reviewBackup(JSON.stringify({...base,layout:{cashFlow:configured}}),cashFields,['Amount']);
 assert.equal(checked.blocked,false);for(const replace of [true,false])assert.equal(mergeBackup(current,checked.accepted,replace).cashFlow.allocationPolicy,allocationPolicy);
}
assert.equal(reviewBackup(JSON.stringify({...base,layout:{cashFlow:{...cashFlow,allocationPolicy:'guess'}}}),cashFields,['Amount']).blocked,true);

// Calculation settings survive JSON export/import with stable IDs and ordered definitions.
const calculationGroups=[{version:1,id:'finance',name:'Finance',description:'Finance defaults',enabled:true,defaultMeasure:'Rent',defaultField:'Tenant',measures:[
 {id:'rent-a',name:'Tenant rent',description:'Tenant A',formula:"('Rent', [Tenant] = 'A')",enabled:true,format:'number',decimals:2,total:'recalculate',defaultMeasure:'Rent',defaultField:'Tenant'},
 {id:'ratio',name:'Rent ratio',description:'Dependent KPI',formula:"@[Tenant rent] / ('Rent')",enabled:true,format:'percentage',decimals:3,total:'custom',totalFormula:"DIVIDE(@[Tenant rent], ('Rent'))"},
 {id:'disabled',name:'Hidden KPI',description:'Retain disabled definitions',formula:"('Rent')",enabled:false,format:'number',decimals:0,total:'hide'}
]},{version:1,id:'ops',name:'Operations',description:'Disabled group',enabled:false,measures:[]}];
const calculationBackup=JSON.stringify({...base,layout:{calculationGroups}});
const calculationReview=reviewBackup(calculationBackup,['Tenant'],['Rent']);
assert.equal(calculationReview.blocked,false);
assert.deepEqual(calculationReview.accepted.calculationGroups,calculationGroups);
for(const replace of [false,true])assert.deepEqual(mergeBackup(current,calculationReview.accepted,replace).calculationGroups,calculationGroups);
const existingGroup={...calculationGroups[1],id:'other',name:'Other'};
assert.deepEqual(mergeBackup({...current,calculationGroups:[existingGroup,calculationGroups[0]]},calculationReview.accepted,false).calculationGroups,[existingGroup,...calculationGroups]);
assert.equal(reviewBackup(calculationBackup,[],['Rent']).blocked,true);
assert.equal(reviewBackup(calculationBackup,['Tenant'],[]).blocked,true);
const broken=JSON.parse(calculationBackup);broken.layout.calculationGroups[0].measures[1].formula='@[Missing KPI]';
assert.equal(reviewBackup(JSON.stringify(broken),['Tenant'],['Rent']).blocked,true);
assert.equal(reviewBackup(JSON.stringify({...base,layout:{}}),['Tenant'],['Rent']).blocked,false);
console.log('Calculation group backup: IDs, order, formulas, defaults, formats, totals, disabled state, dependencies, merge/replace and missing catalogues passed.');
const agingSetup={name:'Customer',dateField:'Due',basis:'Due date',measure:'Balance',group:'Customer',asOfField:'Snapshot',defaultDate:'',display:'detailed',buckets:require('../.tmp/test/aging').defaultAgingBuckets(),additive:true};
const agingBackup={...base,layout:{aging:[agingSetup]}};
const checkedAging=reviewBackup(JSON.stringify(agingBackup),['Due','Customer','Snapshot'],['Balance']);assert.equal(checkedAging.blocked,false);assert.equal(checkedAging.accepted.aging[0].additive,true);
for(const replace of [false,true])assert.equal(mergeBackup(current,checkedAging.accepted,replace).aging[0].additive,true);
assert.equal(reviewBackup(JSON.stringify({...agingBackup,layout:{aging:[{...agingSetup,additive:'yes'}]}}),['Due','Customer','Snapshot'],['Balance']).blocked,true);

const overallAging=reviewBackup(JSON.stringify({...agingBackup,layout:{aging:[{...agingSetup,group:''}]}}),['Due','Snapshot'],['Balance']);assert.equal(overallAging.blocked,false);for(const replace of [false,true])assert.equal(mergeBackup(current,overallAging.accepted,replace).aging[0].group,'');
