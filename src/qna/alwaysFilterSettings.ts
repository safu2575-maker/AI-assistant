import { AlwaysFilter, alwaysFilterRules } from '../alwaysFilter';
import { kpiFilterSettings } from './kpiFilterSettings';
export function alwaysFilterSettings(current:AlwaysFilter|undefined,fields:string[],load:(field:string)=>Promise<string[]>) {
 const editor=kpiFilterSettings(fields,load,'Always');
 editor.element.classList.add('askbics-always-filter');
 editor.set(alwaysFilterRules(current));
 const status=document.createElement('p');status.setAttribute('role','status');editor.element.append(status);
 return {element:editor.element,read:():AlwaysFilter|undefined=>{const rules=editor.read();return rules.length?rules:undefined;},validate:()=>{try{editor.validate();status.textContent='';return true;}catch(error){status.textContent=(error as Error).message;return false;}}};
}
