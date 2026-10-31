import { ValueSynonym } from '../valueSynonyms';
import { settingsSelect } from './settingsSelect';
import { settingsCombobox } from './settingsCombobox';
export function valueSynonymSettings(current:ValueSynonym[]|undefined,fields:string[],load:(field:string)=>Promise<string[]>) {
    let rules=(current||[]).map(r=>({...r,aliases:[...r.aliases]}));
    const element=document.createElement('fieldset');element.className='askbics-qna__value-synonym-settings';
    const legend=document.createElement('legend');legend.textContent='Field value synonyms';
    const help=document.createElement('p');help.textContent='Choose a field and its full value, then add familiar names. Select an original value from your data and enter the alternative names users may type. Answers keep the original value. Duplicate aliases require an explicit field filter.';
    const field=document.createElement('select');field.setAttribute('aria-label','Value synonym field');
    for(const name of ['',...fields]){const option=document.createElement('option');option.value=name;option.textContent=name||'Choose a field';field.append(option);}
    const value=document.createElement('input');value.setAttribute('aria-label','Original field value');value.placeholder='Choose or type the full value';
    const aliases=document.createElement('input');aliases.setAttribute('aria-label','Value synonyms');aliases.placeholder='Aliases separated by commas, e.g. home, HL';
    const add=document.createElement('button');add.type='button';add.textContent='Add / update value synonyms';
    const list=document.createElement('div'),status=document.createElement('p');status.setAttribute('role','status');
    element.append(legend,help,field,value,aliases,add,status,list);settingsSelect(field);const picker=settingsCombobox(value);
    field.onchange=async()=>{const name=field.value;value.value='';picker.update([]);if(name)try{const items=await load(name);if(name===field.value)picker.update(items);}catch{status.textContent='Could not load values. You can type the full value.';}};
    const render=()=>{list.replaceChildren();rules.forEach(rule=>{
        const row=document.createElement('div');const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=rule.enabled!==false;enabled.setAttribute('aria-label',`Enable value synonyms for ${rule.field}: ${rule.value}`);enabled.onchange=()=>rule.enabled=enabled.checked;
        const text=document.createElement('span');text.textContent=`${rule.field} · ${rule.value}: ${rule.aliases.join(', ')}`;
        const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove value synonyms for ${rule.field}: ${rule.value}`);remove.onclick=()=>{rules=rules.filter(r=>r!==rule);render();};row.append(enabled,text,remove);list.append(row);
    });};
    add.onclick=()=>{const names=[...new Set(aliases.value.split(',').map(a=>a.trim()).filter(Boolean))];
        if(!fields.includes(field.value)||!value.value.trim()||!names.length){status.textContent='Choose a field, enter its full value and add at least one synonym.';return;}
        if(/[;|="\r\n]/.test(value.value)||names.some(a=>/[;|="\r\n]/.test(a)||/^(explain|variance|var|change|difference|breakdown|where|with|by|for|and|or|top|bottom|ytd|ttm|vs|versus|not|excluding|before|after)$/i.test(a))){status.textContent='Use plain value names and aliases, without query instructions or filter separators.';return;}
        const entry={field:field.value,value:value.value.trim(),aliases:names};rules=rules.filter(r=>r.field!==entry.field||r.value!==entry.value);rules.push(entry);value.value='';aliases.value='';status.textContent='Value synonyms added. Save settings to apply.';render();};
    render();return {element,read:()=>rules.map(r=>({...r,aliases:[...r.aliases]})),validate:()=>{const valid=!value.value.trim()&&!aliases.value.trim();if(!valid)status.textContent='Click Add / update value synonyms before saving, or clear the unfinished entry.';return valid;}};
}
