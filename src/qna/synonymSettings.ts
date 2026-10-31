import { settingsActionIcon } from "./settingsActionIcon";
import { QnaLayoutSettings } from './types';
import { settingsSelect } from './settingsSelect';
import { settingsCombobox } from './settingsCombobox';
export function synonymSettings(current:QnaLayoutSettings,fields:string[],measures:string[],load:(field:string)=>Promise<string[]>) {
    const synonyms=Object.fromEntries(Object.entries(current.synonyms||{}).map(([key,values])=>[key,[...values]]));
    const enabled={...current.synonymEnabled};let values=(current.valueSynonyms||[]).map(r=>({...r,aliases:[...r.aliases]}));
    const element=document.createElement('div');element.className='askbics-qna__synonym-settings askbics-synonym-manager';
    const title=document.createElement('h4');title.textContent='Add synonym';element.append(title);
    const pick=(name:string,choices:string[])=>{const label=document.createElement('label');label.textContent=name;const select=document.createElement('select');select.setAttribute('aria-label',name);choices.forEach(text=>{const option=document.createElement('option');option.value=text;option.textContent=text||'Choose…';select.append(option);});label.append(select);element.append(label);return select;};
    const type=pick('Synonym type',['Field','Measure','Field value']);
    const target=pick('Field or measure',['',...fields]);
    const valueLabel=document.createElement('label');valueLabel.textContent='Original value';const value=document.createElement('input');value.setAttribute('aria-label','Original field value');valueLabel.append(value);element.append(valueLabel);
    const aliasLabel=document.createElement('label');aliasLabel.textContent='Synonyms';const input=document.createElement('input');input.setAttribute('aria-label','Synonyms to add');input.placeholder='Type an alias and press Enter';aliasLabel.append(input);element.append(aliasLabel);
    const chips=document.createElement('div');chips.className='askbics-synonym-alias-chips';element.append(chips);
    const actions=document.createElement('div');actions.className='askbics-synonym-manager-actions';const save=document.createElement('button');save.type='button';save.textContent='Add synonyms';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel edit';cancel.hidden=true;actions.append(save,cancel);element.append(actions);
    const status=document.createElement('p');status.setAttribute('role','status');element.append(status);
    const lists=document.createElement('div');element.append(lists);
    const refreshType=settingsSelect(type,false),refreshTarget=settingsSelect(target),picker=settingsCombobox(value);
    let draft:string[]=[],editing:{kind:string;name:string;value:string}|undefined;
    const drawChips=()=>{chips.replaceChildren();draft.forEach(alias=>{const chip=document.createElement('button');chip.type='button';chip.textContent=alias+' ×';chip.setAttribute('aria-label','Remove alias '+alias);chip.onclick=()=>{draft=draft.filter(a=>a!==alias);drawChips();};chips.append(chip);});};
    const addAlias=()=>{const alias=input.value.trim();if(alias&&!draft.some(a=>a.toLowerCase()===alias.toLowerCase()))draft.push(alias);input.value='';drawChips();};
    input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addAlias();}};
    const populate=()=>{target.replaceChildren();['',...(type.value==='Measure'?measures:fields)].forEach(name=>{const option=document.createElement('option');option.value=name;option.textContent=name||'Choose…';target.append(option);});refreshTarget();valueLabel.hidden=type.value!=='Field value';};
    const reset=()=>{editing=undefined;draft=[];input.value=value.value='';target.value='';refreshTarget();drawChips();save.textContent='Add synonyms';cancel.hidden=true;title.textContent='Add synonym';};
    type.onchange=()=>{reset();populate();};cancel.onclick=reset;
    target.onchange=async()=>{value.value='';picker.update([]);const name=target.value;if(type.value==='Field value'&&name)try{const items=await load(name);if(target.value===name)picker.update(items);}catch{status.textContent='Values could not be loaded. Type the exact original value.';}};
    const render=()=>{
        lists.replaceChildren();let count=0;
        const group=(heading:string,items:Array<{name:string;value?:string;aliases:string[];on:boolean;toggle:(on:boolean)=>void;remove:()=>void}>)=>{
            if(!items.length)return;count+=items.length;const section=document.createElement('section');const h=document.createElement('h4');h.textContent=heading;section.append(h);
            for(const item of items){const row=document.createElement('div');row.className='askbics-synonym-entry';const check=document.createElement('input');check.type='checkbox';check.checked=item.on;check.setAttribute('aria-label','Enable synonyms for '+item.name+(item.value?' · '+item.value:''));check.onchange=()=>item.toggle(check.checked);
                const text=document.createElement('div');const name=document.createElement('strong');name.textContent=item.name+(item.value?' · '+item.value:'');const aliases=document.createElement('span');aliases.textContent=item.aliases.join(', ');text.append(name,aliases);
                const edit=document.createElement('button');edit.type='button';edit.textContent='Edit';edit.setAttribute('aria-label','Edit synonyms for '+name.textContent);settingsActionIcon(edit,'edit','Edit synonyms for '+name.textContent);edit.onclick=()=>{type.value=item.value!==undefined?'Field value':measures.includes(item.name)?'Measure':'Field';refreshType();populate();target.value=item.name;refreshTarget();value.value=item.value||'';draft=[...item.aliases];input.value='';drawChips();editing={kind:type.value,name:item.name,value:item.value||''};save.textContent='Update synonyms';title.textContent='Edit synonym';cancel.hidden=false;input.focus();};
                const remove=document.createElement('button');remove.type='button';remove.textContent='Delete';remove.setAttribute('aria-label','Delete synonyms for '+name.textContent);settingsActionIcon(remove,'delete','Delete synonyms for '+name.textContent);remove.onclick=()=>{item.remove();reset();render();};row.append(check,text,edit,remove);section.append(row);
            }lists.append(section);
        };
        group('Fields & measures',Object.entries(synonyms).filter(([,a])=>a.length).map(([name,aliases])=>({name,aliases,on:enabled[name]!==false,toggle:on=>enabled[name]=on,remove:()=>{delete synonyms[name];delete enabled[name];}})));
        group('Field values',values.filter(r=>r.aliases.length).map(r=>({name:r.field,value:r.value,aliases:r.aliases,on:r.enabled!==false,toggle:on=>r.enabled=on,remove:()=>{values=values.filter(v=>v!==r);}})));
        if(!count){const empty=document.createElement('p');empty.textContent='No synonyms added yet.';lists.append(empty);}
    };
    save.onclick=()=>{addAlias();const name=target.value,original=value.value.trim();if(!name||!draft.length||(type.value==='Field value'&&!original)){status.textContent='Choose a target and add at least one alias. Field values also need an original value.';return;}
        if(type.value==='Field value'&&(/[;|="\r\n]/.test(original)||draft.some(a=>/[;|="\r\n]/.test(a)||/^(explain|variance|var|change|difference|breakdown|where|with|by|for|and|or|top|bottom|ytd|ttm|vs|versus|not|excluding|before|after)$/i.test(a)))){status.textContent='Use plain values and aliases without query instructions or filter separators.';return;}
        if(editing&&(editing.kind!==type.value||editing.name!==name||editing.value!==original)){if(editing.kind==='Field value')values=values.filter(r=>r.field!==editing!.name||r.value!==editing!.value);else{delete synonyms[editing.name];delete enabled[editing.name];}}
        if(type.value==='Field value'){const existing=values.find(r=>r.field===name&&r.value===original);if(existing)existing.aliases=[...draft];else values.push({field:name,value:original,aliases:[...draft]});}else synonyms[name]=[...draft];
        reset();render();status.textContent='Synonyms updated. Save settings to apply.';
    };
    populate();render();return {element,read:()=>({synonyms,synonymEnabled:enabled,valueSynonyms:values}),validate:()=>{const clean=!editing&&!draft.length&&!input.value.trim()&&!value.value.trim();if(!clean)status.textContent='Add or update the pending synonyms, or cancel the edit, before saving settings.';return clean;}};
}
