import {cashFlowScope} from './cashFlowScope';
import {CashSetup, cashFields, validateCashSetup} from '../cashFlow';
import {cashDescriptionField} from '../cashFlowStarts';
import {settingsSelect} from './settingsSelect';
import {settingsMultiSelect} from './settingsMultiSelect';

/** Settings-modal draft. Only the modal's Save settings commits it. */
export function cashFlowSettings(current:CashSetup|undefined,fields:string[],measures:string[],loadValues:(field:string,companyField:string,companies:string[])=>Promise<string[]>=async()=>[]) {
 const element=document.createElement('div');element.className='askbics-cash-settings';
 let dirty=false,columns=current?.displayColumns?.slice()||[];
 const mapped:Record<string,HTMLSelectElement>={};const refreshers=new Map<HTMLSelectElement,()=>void>();
 const select=(name:string,values:string[],value:string,help:string,parent:HTMLElement=element)=>{
  const label=document.createElement('label');label.append(name);label.dataset.settingsHelp=help;
  const input=document.createElement('select');input.setAttribute('aria-label',name);
  for(const v of [...new Set(['',...values,...(value?[value]:[])])]){const option=document.createElement('option');option.value=v;option.textContent=v||'Choose…';input.append(option);}
  input.value=value;input.onchange=()=>{dirty=true;};label.append(input);parent.append(label);refreshers.set(input,settingsSelect(input,true));return input;
 };
 const help:Record<string,string>={company:'Keeps document connections within the selected company.',document:'Connects posting lines in the same document. Map fiscal year under Advanced when numbers repeat.',clearing:'Connects cleared items across documents. Blank outgoing references end a path; missing linked data stays unresolved.',account:'Optional account code for labels and configured starting bank accounts. It does not set intermediate or destination roles.',accountDescription:'Optional readable account label. Exact Bank, Cash, Bank account or Cash account labels identify starting postings automatically.'};
 for(const key of ['company','document','clearing','account','accountDescription']){const definition=cashFields.find(f=>f[0]===key)!;mapped[key]=select(definition[1]+(definition[2]?' *':''),fields,current?.fields[key]||(key==='accountDescription'?cashDescriptionField(fields,Object.values(current?.fields||{})):''),help[key]);}
 const measure=select('Signed posting amount *',measures,current?.measure||'','Native signed posting measure: debit positive and credit negative. The same measure supplies starting amounts and tracing calculations.');
 const advanced=document.createElement('details');advanced.className='askbics-settings-disclosure';const summary=document.createElement('summary');summary.textContent='Advanced · years, currency, dates and references';advanced.append(summary);element.append(advanced);
 for(const [key,label] of cashFields)if(!mapped[key])mapped[key]=select(label,fields,current?.fields[key]||'','Optional for the simple sample. Map years for repeated document numbers, currency for mixed currencies, line item for distinct postings, and dates for period reporting. Reference mappings must use matching document years and line identities.',advanced);
 const caption=document.createElement('label');caption.append('Starting-posting columns (maximum 10)');caption.dataset.settingsHelp='Choose up to 10 available source columns, including at least one field. Destination account, Destination description, Destination amount and Details are added automatically. Empty selection uses the mapped document, account label and amount. Hidden tracing fields are still loaded.';
 const picker=settingsMultiSelect('Starting-posting columns (maximum 10)',columns,v=>{columns=v;dirty=true;},async()=>[...fields,measure.value].filter(Boolean),'Use default columns',{max:10,allowCustom:false});caption.append(picker.element);element.append(caption);
 let previousMeasure=measure.value;measure.onchange=()=>{dirty=true;columns=columns.map(c=>c===previousMeasure?measure.value:c).filter(Boolean);previousMeasure=measure.value;picker.reset(columns);};
 const scope=cashFlowScope(fields,mapped.company.value,current?.scope,loadValues,()=>{dirty=true;mapped.company.value=scope.companyField();refreshers.get(mapped.company)?.();});element.append(scope.element);
 mapped.company.addEventListener('change',()=>scope.setCompany(mapped.company.value));
 const note=document.createElement('p');note.className='askbics-qna__settings-note';note.textContent='Save settings, then open Cash flow to choose the company and run the trace. Fields must be added to the visual or its grouping parameter. Clearing relationships determine intermediate steps and destinations.';element.append(note);
 const status=document.createElement('p');status.setAttribute('role','alert');element.append(status);
 const read=():CashSetup|undefined=>{if(!dirty)return current;const setup:CashSetup={fields:Object.fromEntries(Object.entries(mapped).map(([key,input])=>[key,input.value])),measure:measure.value,rules:current?.rules||[],displayColumns:columns.length?columns:undefined,scope:{...current?.scope,...scope.read()}};validateCashSetup(setup,fields,measures);return setup;};
 return {element,read,validate:()=>{try{read();status.textContent='';return true;}catch(error){status.textContent=(error as Error).message;return false;}}};
}
