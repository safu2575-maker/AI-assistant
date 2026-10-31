import { settingsPopup } from './settingsPopup';
/** Shared draft-only filter picker. Search never changes the selected values. */
export function settingsMultiSelect(label:string, initial:string[], change:(values:string[])=>void, load:()=>Promise<string[]>, emptyLabel='Select values…', options:{max?:number;allowCustom?:boolean}={}) {
 const element=document.createElement('div');element.className='askbics-settings-select askbics-settings-multiselect';
 const trigger=document.createElement('button');trigger.type='button';trigger.className='askbics-settings-select__trigger';trigger.setAttribute('aria-label',label);trigger.setAttribute('aria-expanded','false');
 const caption=document.createElement('span'),chevron=document.createElement('span');chevron.className='askbics-settings-select__chevron';chevron.setAttribute('aria-hidden','true');trigger.append(caption,chevron);
 const popup=document.createElement('div');popup.className='askbics-settings-select__popup';popup.hidden=true;
 const search=document.createElement('input');search.type='search';search.placeholder='Search values…';search.setAttribute('aria-label','Search '+label);
 const clear=document.createElement('button');clear.type='button';clear.className='askbics-settings-action';clear.textContent='Clear selection';
 const list=document.createElement('div');list.className='askbics-settings-select__options';
 const hint=document.createElement('p');hint.setAttribute('role','status');
 popup.append(search,clear,list,hint);element.append(trigger,popup);
 let values=[...new Set(initial)],items:string[]=[],loaded=false,generation=0;
 const summary=()=>{caption.textContent=values.length===1?values[0]:values.length?values.length+' values selected':emptyLabel;clear.disabled=!values.length;};
 const draw=()=>{list.replaceChildren();const query=search.value.trim();const all=[...new Set([...values,...items])];const matches=all.filter(value=>value.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  for(const value of matches.slice(0,200)){const row=document.createElement('label');row.className='askbics-settings-multiselect__option';const check=document.createElement('input');check.type='checkbox';check.checked=values.includes(value);check.disabled=!check.checked&&values.length>=(options.max??Infinity);const text=document.createElement('span');text.textContent=value;row.append(check,text);check.onchange=()=>{values=check.checked?[...values,value]:values.filter(v=>v!==value);change([...values]);summary();if(options.max){for(const input of Array.from(list.querySelectorAll<HTMLInputElement>('input')))input.disabled=!input.checked&&values.length>=options.max;hint.textContent=values.length>=options.max?'Maximum '+options.max+' selected.':'';}};list.append(row);}
  if(options.allowCustom!==false&&values.length<(options.max??Infinity)&&query&&!all.includes(query)){const exact=document.createElement('button');exact.type='button';exact.textContent='Add exact value “'+query+'”';exact.onclick=()=>{values.push(query);change([...values]);search.value='';summary();draw();search.focus();};list.append(exact);}
  if(matches.length>200)hint.textContent='Showing 200 values. Search to narrow the list.';
 };
 const close=()=>{popup.hidden=true;trigger.setAttribute('aria-expanded','false');search.value='';};
 settingsPopup(element,close);
 trigger.onclick=()=>{if(!popup.hidden){close();return;}popup.hidden=false;trigger.setAttribute('aria-expanded','true');search.value='';draw();search.focus();if(!loaded){loaded=true;const request=generation;hint.textContent='Loading values…';void load().then(next=>{if(request!==generation)return;items=next;loaded=next.length>0;hint.textContent=next.length?'':'No values available yet. Reopen to retry, or search and add an exact value.';draw();}).catch(()=>{if(request!==generation)return;loaded=false;hint.textContent='Values could not be loaded. Search and add an exact value.';});}};
 search.oninput=()=>{hint.textContent='';draw();};
 clear.onclick=()=>{values=[];change([]);summary();draw();};
 element.addEventListener('keydown',event=>{if(event.key==='Escape'&&!popup.hidden){event.preventDefault();event.stopPropagation();close();trigger.focus();}});
 element.addEventListener('focusout',event=>{if(event.relatedTarget instanceof Node && !element.contains(event.relatedTarget))close();});
 summary();
 return {element,reset:(next:string[],disabled=false)=>{generation++;loaded=false;items=[];values=[...next];trigger.disabled=disabled;close();summary();}};
}
