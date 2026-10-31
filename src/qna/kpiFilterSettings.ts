import { decorateSettingsAction } from "./settingsActionIcon";
import { settingsSelect } from './settingsSelect';
import { settingsMultiSelect } from './settingsMultiSelect';
export interface KpiFilter { field:string; values:string[] }
export function kpiFilterSettings(fields:string[],load:(field:string)=>Promise<string[]>, kind='KPI',changed:()=>void=()=>{}) {
 let rules:KpiFilter[]=[];
 const element=document.createElement('section');element.className='askbics-kpi-filters';
 const heading=document.createElement('h4');heading.textContent=kind+' filters';const help=document.createElement('p');help.textContent=kind==='Cash flow'?'Apply these filters only to starting payments, before rows load. Values in one field use OR; different fields use AND. Linked document lookups retain company and security scope without these starting filters.':kind==='Waterfall'?'Apply filters before loading the waterfall data. Values within a field use OR; different fields use AND. Existing filters still apply.':kind==='Group'?'Apply these filters when this measure group is used. Values within a field use OR; different fields use AND. Existing filters still apply.':kind==='Always'?'Restrict every answer to these values. Values within a field use OR; different fields use AND. Questions can narrow this scope but cannot override it. Remove a filter to disable it.':'Apply these filters to this KPI and its calculation inputs. Values within a field use OR; different fields use AND. Existing filters still apply.';
 const list=document.createElement('div');
 const button=(text:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.className='askbics-settings-action';b.textContent=text;decorateSettingsAction(b,text);b.onclick=action;return b;};
 const render=()=>{list.replaceChildren();rules.forEach((rule,index)=>{
  const card=document.createElement('div');card.className='askbics-group-member';
  const select=document.createElement('select');select.setAttribute('aria-label',kind+' filter field '+(index+1));
  for(const name of [...new Set(['',...fields,...(rule.field?[rule.field]:[])])]){const option=document.createElement('option');option.value=name;option.textContent=name||'Choose a field…';select.append(option);}select.value=rule.field;
  const control=settingsMultiSelect(kind+' filter values '+(index+1),rule.values,values=>{rule.values=values;changed();},()=>load(rule.field),'Select values…',kind==='Cash flow'?{max:100}:{});control.reset(rule.values,!rule.field);
  const fieldLabel=document.createElement('label');fieldLabel.textContent='Field';fieldLabel.append(select);
  const valueLabel=document.createElement('div');valueLabel.textContent='Allowed values';valueLabel.append(control.element);
  card.append(fieldLabel,valueLabel,button('Remove filter',()=>{rules.splice(index,1);render();changed();}));list.append(card);settingsSelect(select);
  select.onchange=()=>{rule.field=select.value;rule.values=[];control.reset([],!rule.field);changed();};

 });};
 element.append(heading,help,list,button('Add filter',()=>{rules.push({field:'',values:[]});render();changed();}));
 return {element,set:(next:KpiFilter[])=>{rules=structuredClone(next);render();},read:()=>structuredClone(rules),validate:()=>{
  if(rules.some(rule=>!fields.includes(rule.field)||!rule.values.length))throw new Error('Choose a field and select at least one value for every '+kind+' filter.');
  if(new Set(rules.map(r=>r.field)).size!==rules.length)throw new Error('Use one filter per field; add alternative values to the same filter.');

 }};
}
