import {cashSelectionFilters} from './cashFlowSelection';
import {TransactionScope} from './answerTransactions';
import { AdvancedFilter, BasicFilter } from 'powerbi-models';
import { applyAlwaysFilter } from './alwaysFilter';
import { CashPosting, CashSetup, cashFields, validateCashSetup } from './cashFlow';
import { ParameterConfig, ParameterPlan } from './parameterQuery';
import { QnaResponse, QnaTable } from './qna/types';
const postingGroups=(setup:CashSetup)=>[...new Set([...cashFields.map(([key])=>setup.fields[key]).filter(Boolean),...(setup.displayColumns||[]).filter(f=>f!==setup.measure)])];
export interface CashRequest {phase?:'starts'|'links'; selectionScopes?:TransactionScope[]; filters?:Array<{field:string;values:string[]}>;from?:string;to?:string;currency?:string; banks?:string[]; link?:{field:string;values:string[]};}
export const cashQuestion=(setup:CashSetup,company:string,request:CashRequest={})=>';cashflow:'+encodeURIComponent(JSON.stringify({fields:setup.fields,measure:setup.measure,displayColumns:setup.displayColumns,company,...request}));
export const cashValuesQuestion=(field:string,companyField:string,companies:string[])=>';cashflow:'+encodeURIComponent(JSON.stringify({valuesField:field,companyField,companies}));
export async function answerCashFlow(question:string,config:ParameterConfig,measures:string[],load:(plan:ParameterPlan)=>Promise<QnaResponse>):Promise<QnaResponse> {
 const request=JSON.parse(decodeURIComponent(question.slice(';cashflow:'.length)));
 const selected=request.selectionScopes?cashSelectionFilters(request.selectionScopes,config,measures):[];
 const resolve=(name:string)=>{const f=config.fields.find(f=>f.name===name);if(!f)throw new Error('Cash-flow filter field is unavailable: '+name);return f;};
 const basic=(name:string,values:string[])=>{const f=resolve(name);if(!Array.isArray(values)||!values.length||values.length>100||values.some(v=>typeof v!=='string'||!v.trim()))throw new Error('Choose 1–100 exact filter values.');const typed=values.map(v=>{if(f.type==='date'){if(!Number.isFinite(Date.parse(v)))throw new Error('Invalid date filter value.');return new Date(v).toISOString();}return f.type==='number'?Number(v):v;});if(typed.some(v=>typeof v==='number'&&!Number.isFinite(v)))throw new Error('Invalid numeric filter value.');return new BasicFilter({table:f.table,column:f.column},'In',typed).toJSON();};
 if(request.selectionContext){
 const setup=request.setup as CashSetup;validateCashSetup(setup,config.fields.map(f=>f.name),measures);
 if(!selected.length)throw new Error('Selected cell filters are missing.');
 const groups=[setup.fields.company,...(setup.fields.currency?[setup.fields.currency]:[])];
 return load(applyAlwaysFilter({groups,measures:[setup.measure],filters:selected,summary:[],presentation:'table',cashFlowData:true,cashFlowRowLimit:201,summaryCard:true},config));
 } if(request.valuesField){resolve(request.valuesField);const filters=request.companies?.length&&request.companyField!==request.valuesField?[basic(request.companyField,request.companies)]:[];return load(applyAlwaysFilter({groups:[request.valuesField],measures:[],filters,summary:[],listOnly:true,cashFlowData:true,cashFlowRowLimit:201,summaryCard:true},config));}
 const setup:CashSetup={fields:request.fields,measure:request.measure,displayColumns:request.displayColumns,rules:[]};validateCashSetup(setup,config.fields.map(f=>f.name),measures);
 if(config.customKpis?.some(k=>k.name===setup.measure))throw new Error('Use a native signed posting amount, not a Custom KPI.');
 if(typeof request.company!=='string'||!request.company.trim())throw new Error('Choose a company code.');
 const filters:any[]=[basic(setup.fields.company,[request.company])];
 if(request.currency){if(!setup.fields.currency)throw new Error('Map currency first.');filters.push(basic(setup.fields.currency,[request.currency]));}
 if(request.phase==='links'){
  if(!request.link||![setup.fields.document,setup.fields.clearing].includes(request.link.field))throw new Error('Choose a mapped document or clearing reference for linked lookups.');filters.push(basic(request.link.field,request.link.values));
 }else if(request.phase==='starts'){
  filters.push(...selected);
  if(!Array.isArray(request.filters)||request.filters.length>10)throw new Error('Choose up to 10 starting filters.');
  const merged=new Map<string,string[]>();for(const rule of request.filters){if(merged.has(rule.field))throw new Error('Use one starting filter per field.');merged.set(rule.field,rule.values);}
  const add=(field:string,values:string[])=>merged.set(field,merged.has(field)?merged.get(field)!.filter(v=>values.some(x=>x.toLowerCase()===v.toLowerCase())):values);
  if(request.banks?.length){if(!setup.fields.account)throw new Error('Map Account before selecting bank accounts.');add(setup.fields.account,request.banks);}
  else if(setup.fields.accountDescription&&merged.size===0)add(setup.fields.accountDescription,['Bank','Cash','Bank account','Cash account']);
  if(merged.has(setup.fields.date)&&(request.from||request.to)){const start=Date.parse(request.from),end=Date.parse(request.to)+86400000;merged.set(setup.fields.date,merged.get(setup.fields.date)!.filter(v=>Date.parse(v)>=start&&Date.parse(v)<end));}
  for(const [field,values] of merged){if(field===setup.fields.company){if(!values.includes(request.company))throw new Error('Starting company filter conflicts with Company values.');continue;}if(field===setup.fields.currency&&request.currency){if(!values.includes(request.currency))throw new Error('Starting currency filter conflicts with Currency.');continue;}filters.push(basic(field,values));}
  if(request.from||request.to){const valid=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;if(!setup.fields.date||!valid(request.from)||!valid(request.to)||request.from>request.to)throw new Error('Choose a valid starting-payment period and map Posting date.');const f=resolve(setup.fields.date);const end=new Date(request.to+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+1);if(!merged.has(setup.fields.date))filters.push(new AdvancedFilter({table:f.table,column:f.column},'And',{operator:'GreaterThanOrEqual',value:request.from+'T00:00:00.000Z'},{operator:'LessThan',value:end.toISOString()}).toJSON());}
 }
 if(request.partitions!==undefined){
  if(!Array.isArray(request.partitions)||request.partitions.length>128)throw new Error('Invalid cash-flow paging partitions.');
  for(const part of request.partitions){if(!postingGroups(setup).includes(part.field)||typeof part.exclude!=='boolean'||!Array.isArray(part.values)||!part.values.length||part.values.length>1000||part.values.some((v:unknown)=>v!==null&&!['string','number','boolean'].includes(typeof v)))throw new Error('Invalid cash-flow paging field or values.');const field=resolve(part.field);filters.push(new BasicFilter({table:field.table,column:field.column},part.exclude?'NotIn':'In',part.values).toJSON());}
 }
 // One Basic filter per target: native hosts may replace repeated filters on one column.
 for(const name of new Set([...(request.partitions||[]).map((p:any)=>p.field),...(request.selectionScopes?config.fields.map(f=>f.name):[])] as string[])){
  const f=resolve(name);const matching=filters.filter(raw=>raw.target?.table===f.table&&raw.target?.column===f.column&&Array.isArray(raw.values));
  if(!matching.length)continue;
  let allowed:any[]|undefined;const excluded:any[]=[];
  for(const filter of matching){if(filter.operator==='In')allowed=allowed?allowed.filter(v=>filter.values.includes(v)):filter.values;else excluded.push(...filter.values);}
  const values=allowed?allowed.filter(v=>!excluded.includes(v)):[...new Set(excluded)];
  for(const filter of matching)filters.splice(filters.indexOf(filter),1);
  filters.push(new BasicFilter({table:f.table,column:f.column},allowed?'In':'NotIn',values).toJSON());
 }
 const plan=applyAlwaysFilter({groups:postingGroups(setup),measures:[setup.measure],filters,summary:['Cash-flow posting data'],presentation:'table',summaryCard:true,cashFlowData:true,cashFlowRowLimit:5000},config);
 return load(plan);
}
/** Reject formatted amounts: tracing requires original numeric values. */
export function cashPostings(table:QnaTable,setup:CashSetup):CashPosting[] {
 const indices=Object.fromEntries(cashFields.filter(([key])=>setup.fields[key]).map(([key])=>[key,table.columns.indexOf(setup.fields[key])]));
 if(Object.values(indices).some(i=>i<0))throw new Error('The model did not return all mapped posting fields. Check the field parameter and Show selected field.');
 const amountIndex=table.columns.indexOf(setup.measure);if(amountIndex<0)throw new Error('Posting amount is missing from the result.');
 if(setup.displayColumns?.some(f=>!table.columns.includes(f)))throw new Error('The model did not return all selected starting-posting columns. Add them to the visual fields or field parameter.');
 // Stable field-name order makes identities independent of returned column order.
 const identityColumns=postingGroups(setup).filter(name=>name!==setup.measure).sort().map(name=>[name,table.columns.indexOf(name)] as const);
 return table.rows.map((row,index)=>{
  const p:any={sourceValues:Object.fromEntries(table.columns.map((name,i)=>[name,String(row[i]??"—")]))};for(const [key,column] of Object.entries(indices)){const raw=table.modelGroupValues?.[index]?table.modelGroupValues[index][column]:row[column];p[key]=raw==null||raw==='—'?'':String(raw);if(['date','clearingDate'].includes(key))p[key]=p[key].slice(0,10);}
  for(const key of ['year','currency','date','clearingYear','referenceYear','account']){if(setup.fields[key]&&!p[key]&&['year','currency','date'].includes(key))throw new Error('A posting is missing its mapped '+key+'.');if(!setup.fields[key])p[key]='';}
  if(!setup.fields.item)p.item='group:'+JSON.stringify(identityColumns.map(([name,column])=>[name,table.modelGroupValues?.[index]?.[column]!==undefined?table.modelGroupValues[index][column]:row[column]??null]));
  if((p.clearing&&setup.fields.clearingYear&&!p.clearingYear)||(p.reference&&setup.fields.referenceYear&&!p.referenceYear))throw new Error('A linked posting is missing its mapped reference fiscal year.');
  const amount=table.modelRawRows?.[index]?.[amountIndex];if(typeof amount!=='number'||!Number.isFinite(amount))throw new Error('Cash flow requires raw numeric posting amounts; formatted or blank amounts cannot be traced.');p.amount=amount;return p as CashPosting;
 });
}
