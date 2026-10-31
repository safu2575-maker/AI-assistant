import {ClearingSettings,validateDocument} from '../clearingDetails';
import {settingsSelect} from './settingsSelect';
import {settingsMultiSelect} from './settingsMultiSelect';
export function documentSettings(initial:ClearingSettings|undefined,fields:string[],measures:string[],transactionFields:()=>string[]){
 const element=document.createElement('div');element.className='askbics-document-settings';
 const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=initial?.enabled||false;const label=document.createElement('label');label.append(enabled,'Enable document links');element.append(label);
 const select=(name:string,options:string[],value:string)=>{const l=document.createElement('label'),s=document.createElement('select');s.setAttribute('aria-label',name);for(const v of ['',...options]){const o=document.createElement('option');o.value=v;o.textContent=v||'Choose…';s.append(o);}s.value=value;l.append(name,s);element.append(l);settingsSelect(s,true);return s;};
 const reference=select('Document number field',fields,initial?.referenceField||''),company=select('Company code field',fields,initial?.companyField||''),year=select('Document fiscal year field',fields,initial?.yearField||''),measure=select('Document amount measure',measures,initial?.measure||'');
 const reuse=document.createElement('input');reuse.type='checkbox';reuse.checked=!initial?.columns?.length;const reuseLabel=document.createElement('label');reuseLabel.append(reuse,'Use transaction columns');element.append(reuseLabel);
 let columns=initial?.columns||[];const choices=settingsMultiSelect('Document detail columns',columns,v=>columns=v,async()=>fields,'Choose columns');const columnLabel=document.createElement('label');columnLabel.append('Document detail columns',choices.element);element.append(columnLabel);const refresh=()=>columnLabel.hidden=reuse.checked;reuse.onchange=refresh;refresh();
 const note=document.createElement('p');note.textContent='Opens related items with the same document number, company and fiscal year. Question, period and selected-category filters do not restrict this lookup. Transaction rules do not restrict this lookup. Always filters remain applied. Include these three fields in transaction columns. Blank document numbers are not links.';element.append(note);
 return {element,read:()=>{const c:ClearingSettings={enabled:enabled.checked,referenceField:reference.value,companyField:company.value,yearField:year.value,measure:measure.value,columns:reuse.checked?[]:columns};validateDocument(c,fields,measures,transactionFields());return c;}};
}
