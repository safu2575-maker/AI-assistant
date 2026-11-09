import { validateCalculationGroups, calculationKpis } from '../calculationGroups';
import { validateCashSetup, CashSetup } from '../cashFlow';
import { validateClearing, validateDocument } from "../clearingDetails";
import { validateTransactionRule } from "../transactionRules";
import { validateAnswerGroups, AnswerGroup } from "../answerGroups";
import { compileKpis } from "../customKpis";
import { QnaLayoutSettings } from './types';
export interface SettingsBackup { format:'askBICS-settings'; version:1; visualVersion:string; exportedAt:string; host:string; fields?:string[]; measures?:string[]; layout:Partial<QnaLayoutSettings>; data?:unknown; reports?:Array<{id:string;name:string;question:string;createdAt:number}> }
import { AgingSetup, validateAging } from "../aging";
const keys=['calculationGroups','aging','summarizeHiddenFields','waterfall','answerGroups','customKpis','conversationMode','cardinalityFallbackEnabled','cardinalityMatrixThresholdPct','cardinalityMaxColumnValues','cardinalityLowToHighHierarchy','autocompleteFields','autocompleteMeasures','defaultMeasure','additiveMeasures','startup','revenue','synonyms','synonymEnabled','valueSynonyms','alwaysFilter','analysis'];
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string');
export function reviewBackup(text:string, fields:string[], measures:string[]) {
 if(text.length>2000000)throw new Error('Backup exceeds 2 MB.');
 const backup=JSON.parse(text,(key,value)=>{if(['__proto__','constructor','prototype'].includes(key))throw new Error('Unsafe property in backup.');return value;}) as SettingsBackup;
 if(backup?.format!=='askBICS-settings'||backup.version!==1||!backup.layout||typeof backup.layout!=='object'||Array.isArray(backup.layout))throw new Error('Unsupported or invalid settings backup. Expected format version 1.');
 const accepted:Partial<QnaLayoutSettings>={}, report:string[]=[];let blocked=false;
 const available=[...measures];
 if(backup.layout.customKpis!==undefined){try{const compiled=compileKpis(backup.layout.customKpis,measures);if(backup.layout.customKpis?.some(k=>k.filters?.some(f=>!fields.includes(f.field))))throw new Error('A KPI filter field is unavailable.');available.push(...compiled.names);accepted.customKpis=backup.layout.customKpis;}catch(error){blocked=true;report.push('Blocked: custom KPIs — '+(error as Error).message);}}

 if(backup.layout.calculationGroups!==undefined){try{validateCalculationGroups(backup.layout.calculationGroups,available,fields);available.push(...calculationKpis(backup.layout.calculationGroups).filter(k=>k.enabled).map(k=>k.name));accepted.calculationGroups=backup.layout.calculationGroups;}catch(error){blocked=true;report.push('Blocked: Calculation groups — '+(error as Error).message);}}
 const field=(v:unknown)=>typeof v==='string'&&fields.includes(v), measure=(v:unknown)=>typeof v==='string'&&available.includes(v);
 for(const [key,value] of Object.entries(backup.layout) as [string,unknown][]) {
  let valid=true;
  if(!keys.includes(key)&&key!=='cashFlow'){report.push(`Skipped: ${key} — unsupported setting.`);continue;}
  switch(key){
   case 'cashFlow':try{validateCashSetup(value as CashSetup,fields,available);}catch{valid=false;blocked=true;}break;
   case 'waterfall': {const r=value as QnaLayoutSettings['waterfall'];valid=!!r&&(r.field===''||field(r.field)||!!backup.layout.answerGroups?.some(g=>g.enabled&&g.kind==='field'&&g.name===r.field))&&(r.measure===''||measure(r.measure))&&[r.positiveColor,r.negativeColor,r.totalColor].every(c=>c===undefined||/^#[0-9a-f]{6}$/i.test(c))&&(r.labelLayout===undefined||['auto','slanted','horizontal'].includes(r.labelLayout))&&(r.numberStyle===undefined||['compact','full'].includes(r.numberStyle))&&(r.sort===undefined||['auto','label','source','financial','positive'].includes(r.sort))&&(r.selection===undefined||typeof r.selection==='boolean');break;}
   case 'answerGroups':try { validateAnswerGroups(value as AnswerGroup[],fields,available,Object.values(backup.layout.synonyms||{}).flat()); } catch { valid=false; } break;
   case 'aging':try{validateAging(value as AgingSetup[],fields,available);}catch{valid=false;blocked=true;}break;
   case 'calculationGroups':valid=!!accepted.calculationGroups;break;
   case 'customKpis':valid=!!accepted.customKpis;break;
   case 'conversationMode':valid=['latest','history'].includes(value as string);break;
   case 'cardinalityFallbackEnabled':case 'cardinalityLowToHighHierarchy':valid=typeof value==='boolean';break;
   case 'cardinalityMatrixThresholdPct':valid=typeof value==='number'&&value>=1&&value<=100;break;
   case 'cardinalityMaxColumnValues':valid=typeof value==='number'&&value>=0&&value<=30;break;
   case 'summarizeHiddenFields':valid=strings(value)&&value.every(name=>field(name)||!!backup.layout.answerGroups?.some(g=>g.kind==='field'&&g.name===name));break;
   case 'autocompleteFields':valid=strings(value)&&value.every(field);break;
   case 'autocompleteMeasures':case 'additiveMeasures':valid=strings(value)&&value.every(measure);break;
   case 'defaultMeasure':valid=value===''||measure(value);break;
   case 'synonyms':valid=!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([name,a])=>(field(name)||measure(name))&&strings(a));break;
   case 'synonymEnabled':valid=!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([name,a])=>(field(name)||measure(name))&&typeof a==='boolean');break;
   case 'valueSynonyms':valid=Array.isArray(value)&&value.every(r=>r&&typeof r==='object'&&field(r.field)&&typeof r.value==='string'&&strings(r.aliases)&&(r.enabled===undefined||typeof r.enabled==='boolean'));break;
   case 'alwaysFilter': {const r=value as QnaLayoutSettings['alwaysFilter'];const rules=Array.isArray(r)?r:[r];valid=rules.length>0&&rules.every(item=>!!item&&field(item.field)&&strings(item.values)&&item.values.length>0&&item.values.every(v=>v.trim()));blocked=blocked||!valid;break;}
   case 'startup': {const r=value as QnaLayoutSettings['startup'];valid=!!r&&typeof r.enabled==='boolean'&&strings(r.fields)&&r.fields.every(field)&&(r.measure===''||measure(r.measure));break;}
   case 'revenue': {const r=value as QnaLayoutSettings['revenue'];valid=!!r&&(r.field===''||field(r.field))&&typeof r.value==='string'&&(!r.childFields||(strings(r.childFields)&&r.childFields.every(field)));break;}
   case 'analysis': {const r=value as QnaLayoutSettings['analysis'];try{for(const d of [r?.draft,r?.published])if(d){validateClearing(d.clearing,fields,available,d.transactionFields);validateDocument(d.document,fields,available,d.transactionFields);validateTransactionRule(d.transactionRule,fields,available,d.transactionFields);}}catch{blocked=true;valid=false;report.push('Blocked: invalid transaction rule or clearing setup. Correct its fields or formula before importing.');break;}valid=!!r&&typeof r==='object'&&[r.draft,r.published].filter(Boolean).every(d=>d&&(d.measure===''||measure(d.measure))&&strings(d.hierarchy)&&d.hierarchy.every(field)&&strings(d.breakdownKeywords)&&strings(d.varianceKeywords)&&['prior-year','previous-period'].includes(d.comparison)&&['ask','last-month'].includes(d.missingPeriod)&&Number.isFinite(d.top)&&d.top>=0&&['neutral','increase','decrease'].includes(d.favourable)&&['others','variancePercent','totals'].every(k=>typeof d[k as keyof typeof d]==='boolean')&&(!d.transactionFields||(strings(d.transactionFields)&&d.transactionFields.length<=10&&d.transactionFields.every(field)))&&(!d.excludedDimensions||(strings(d.excludedDimensions)&&d.excludedDimensions.every(field))));break;}
  }
  if(valid){Object.assign(accepted,{[key]:value});report.push(`Ready: ${key}${['valueSynonyms','alwaysFilter','revenue'].includes(key)?' — values unverified; confirm they exist in the model.':''}`);}else report.push(`${key==='alwaysFilter'?'Blocked':'Skipped'}: ${key} — invalid settings or missing field/measure. Correct the backup or map the missing name before importing.`);
 }
 return {backup,accepted,report,blocked};
}
export function mergeBackup(current:QnaLayoutSettings,incoming:Partial<QnaLayoutSettings>,replace:boolean):QnaLayoutSettings {
 const defaults:QnaLayoutSettings={calculationGroups:[],aging:[],summarizeHiddenFields:[],waterfall:undefined,conversationMode:'latest',cardinalityFallbackEnabled:true,cardinalityMatrixThresholdPct:25,cardinalityMaxColumnValues:5,cardinalityLowToHighHierarchy:true,autocompleteFields:[],autocompleteMeasures:[],synonyms:{},synonymEnabled:{},valueSynonyms:[],defaultMeasure:'',additiveMeasures:[],analysis:undefined,startup:undefined,revenue:undefined,alwaysFilter:undefined,customKpis:[],answerGroups:[]};
 if(replace)return {...defaults,...incoming};
 return {...current,...incoming,calculationGroups:incoming.calculationGroups?[...(current.calculationGroups||[]).filter(a=>!incoming.calculationGroups!.some(b=>a.id===b.id||a.name.toLowerCase()===b.name.toLowerCase())),...incoming.calculationGroups]:current.calculationGroups,aging:incoming.aging?[...(current.aging||[]).filter(a=>!incoming.aging!.some(b=>a.name.toLowerCase()===b.name.toLowerCase())),...incoming.aging]:current.aging,answerGroups:incoming.answerGroups?[...(current.answerGroups||[]).filter(a=>!incoming.answerGroups!.some(b=>a.name.toLowerCase()===b.name.toLowerCase())),...incoming.answerGroups]:current.answerGroups,customKpis:incoming.customKpis?[...(current.customKpis||[]).filter(a=>!incoming.customKpis!.some(b=>a.name.toLowerCase()===b.name.toLowerCase())),...incoming.customKpis]:current.customKpis,synonyms:{...current.synonyms,...incoming.synonyms},synonymEnabled:{...current.synonymEnabled,...incoming.synonymEnabled},valueSynonyms:incoming.valueSynonyms?[...(current.valueSynonyms||[]).filter(a=>!incoming.valueSynonyms!.some(b=>a.field===b.field&&a.value===b.value)),...incoming.valueSynonyms]:current.valueSynonyms};
}
