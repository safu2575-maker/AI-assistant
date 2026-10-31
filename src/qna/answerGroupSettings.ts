import { kpiFilterSettings } from './kpiFilterSettings';
import { decorateSettingsAction, settingsActionIcon } from "./settingsActionIcon";
import { settingsMultiSelect } from "./settingsMultiSelect";
import { AnswerGroup, validateAnswerGroups } from '../answerGroups';
import { settingsSelect } from './settingsSelect';
export function answerGroupSettings(current:AnswerGroup[]|undefined,fields:string[],measures:string[],reserved:string[],loadValues:(field:string)=>Promise<string[]>=async()=>[]) {
 let items=structuredClone(current||[]),editing:string|undefined,members:string[]=[],hiddenMembers:string[]=[],dragged=-1,filters:Array<{field:string;values:string[]}>=[];
 const element=document.createElement('section');element.className='askbics-answer-groups';
 const editor=document.createElement('div');editor.className='askbics-group-editor';editor.hidden=true;
 const about=document.createElement('details'),summary=document.createElement('summary');summary.textContent='About groups';about.append(summary);element.append(about);
 const help=document.createElement('p');help.textContent='Field groups show multiple columns together. Measure groups show separate measures, including Custom KPIs. For a hidden calculation dependency, use a Custom KPI: only the KPI result is displayed. Uncheck a member to hide it. Hidden detail fields are not added to the grouping, and hidden measures are requested only if a Custom KPI depends on them.';about.append(help);
 const label=(text:string,input:HTMLElement)=>{const l=document.createElement('label');l.textContent=text;l.append(input);editor.append(l);};
 const identity=document.createElement('div');identity.className='askbics-group-identity';
 const kind=document.createElement('select');for(const [value,text] of [['field','Field group'],['measure','Measure group']]){const o=document.createElement('option');o.value=value;o.textContent=text;kind.append(o);}label('Group type',kind);const refreshKind=settingsSelect(kind);
 const name=document.createElement('input');label('Group name',name);identity.append(name.parentElement!,kind.parentElement!);editor.append(identity);
 const aliases=document.createElement('input');aliases.placeholder='unit details, tenant profile';label('Synonyms (comma-separated)',aliases);
 const picker=document.createElement('select');label('Add field or measure',picker);const refresh=settingsSelect(picker);
 const measureFilters=kpiFilterSettings(fields,loadValues,'Group');measureFilters.element.hidden=true;
 const selected=document.createElement('div'),list=document.createElement('div'),status=document.createElement('p');status.setAttribute('role','status');
 const button=(text:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.className='askbics-settings-action';b.textContent=text;decorateSettingsAction(b,text);b.onclick=action;return b;};
 const populate=()=>{picker.replaceChildren();for(const value of ['',...(kind.value==='field'?fields:measures).filter(v=>!members.includes(v))]){const o=document.createElement('option');o.value=value;o.textContent=value||'Choose…';picker.append(o);}refresh();};
 const drawMembers=()=>{selected.replaceChildren();selected.className=kind.value==='field'?'askbics-group-members is-field':'askbics-group-members is-measure';measureFilters.element.hidden=kind.value!=='measure';if(members.length){const header=document.createElement('div');header.className='askbics-group-columns';const label=document.createElement('span');label.textContent='Show in answers';header.append(label);selected.append(header);}members.forEach((member,index)=>{const row=document.createElement('div');row.className='askbics-group-row';const text=document.createElement('span');text.textContent=member;const visible=document.createElement('input');visible.type='checkbox';visible.checked=!hiddenMembers.includes(member);visible.setAttribute('aria-label','Show '+member+' in answers');visible.title='Show in answers';visible.onchange=()=>{hiddenMembers=visible.checked?hiddenMembers.filter(m=>m!==member):[...hiddenMembers,member];};row.append(text,button('Remove',()=>{members.splice(index,1);hiddenMembers=hiddenMembers.filter(m=>m!==member);drawMembers();}));const card=document.createElement('div');card.className='askbics-group-member';card.dataset.memberIndex=String(index);
 const move=(target:number)=>{if(target<0||target>=members.length||target===index)return;const [moved]=members.splice(index,1);members.splice(target,0,moved);drawMembers();selected.querySelector<HTMLButtonElement>('[data-member-index="'+target+'"] .is-drag-handle')?.focus();status.textContent=member+' moved to position '+(target+1)+'.';};
 const handle=button('',()=>{});settingsActionIcon(handle,'grip','Reorder '+member+'; drag or use Up and Down arrow keys');row.prepend(handle);
 handle.onkeydown=event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();move(index+(event.key==='ArrowUp'?-1:1));}};
 let target=index;
 const finish=()=>{card.classList.remove('is-dragging');selected.querySelectorAll('.is-drop-target').forEach(node=>node.classList.remove('is-drop-target'));dragged=-1;};
 handle.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();handle.focus();dragged=index;target=index;handle.setPointerCapture(event.pointerId);card.classList.add('is-dragging');};
 handle.onpointermove=event=>{if(dragged!==index)return;const hit=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-member-index]');if(hit&&selected.contains(hit)){target=Number(hit.dataset.memberIndex);selected.querySelectorAll('.is-drop-target').forEach(node=>node.classList.remove('is-drop-target'));if(target!==index)hit.classList.add('is-drop-target');}};
 handle.onpointerup=event=>{if(dragged!==index)return;handle.releasePointerCapture(event.pointerId);finish();move(target);};
 handle.onpointercancel=finish;
 
 const visibility=document.createElement('label');visibility.className='askbics-group-visibility';visibility.title='Show in answers';visibility.prepend(visible);row.insertBefore(visibility,row.lastChild);card.append(row);
 if(kind.value==='field'){
  const label=document.createElement('div');label.className='askbics-group-member-filter';
  const control=settingsMultiSelect('Filter values for '+member,filters.find(f=>f.field===member)?.values||[],values=>{filters=filters.filter(f=>f.field!==member);if(values.length)filters.push({field:member,values});},()=>loadValues(member),'All values');
  label.append(control.element);row.insertBefore(label,row.lastChild);
 }
 selected.append(card);});populate();};
 picker.onchange=()=>{if(picker.value&&!members.includes(picker.value)&&members.length<10){members.push(picker.value);drawMembers();}};
 kind.onchange=()=>{members=[];hiddenMembers=[];filters=[];measureFilters.set([]);drawMembers();};
 const reset=()=>{editor.hidden=true;editing=undefined;name.value='';aliases.value='';members=[];hiddenMembers=[];filters=[];drawMembers();};
 const draw=()=>{list.replaceChildren();for(const type of ['field','measure']){const entries=items.filter(g=>g.kind===type);if(!entries.length)continue;const heading=document.createElement('h4');heading.textContent=type==='field'?'Field groups':'Measure groups';list.append(heading);for(const item of entries){const row=document.createElement('div');row.className='askbics-group-row';const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=item.enabled;enabled.setAttribute('aria-label','Enable '+item.name);enabled.onchange=()=>item.enabled=enabled.checked;const text=document.createElement('span');text.textContent=item.name+' · '+item.members.length+' '+(item.kind==='field'?'fields':'measures');text.title=item.members.join(' → ');row.append(enabled,text,button('Edit',()=>{if(editing===item.id&&!editor.hidden){name.focus();return;}if(!commit())return;editing=item.id;kind.value=item.kind;refreshKind();kind.dispatchEvent(new Event('change'));name.value=item.name;aliases.value=item.aliases.join(', ');members=item.members.slice();hiddenMembers=item.hiddenMembers?.slice()||[];filters=structuredClone(item.filters||[]);measureFilters.set(item.kind==='measure'?item.filters||[]:[]);editor.hidden=false;drawMembers();name.focus();}),button('Delete',()=>{items=items.filter(g=>g.id!==item.id);if(editing===item.id)reset();draw();}));list.append(row);}}};
 const commit=()=>{if(editor.hidden)return true;try{if(kind.value==='measure')measureFilters.validate();const item:AnswerGroup={id:editing||crypto.randomUUID(),name:name.value.trim(),kind:kind.value as AnswerGroup['kind'],aliases:aliases.value.split(',').map(v=>v.trim()).filter(Boolean),members:members.slice(),hiddenMembers:hiddenMembers.slice(),filters:kind.value==='field'?filters.filter(f=>members.includes(f.field)&&f.values.length):measureFilters.read(),enabled:items.find(g=>g.id===editing)?.enabled??true};const next=items.some(g=>g.id===item.id)?items.map(g=>g.id===item.id?item:g):[...items,item];validateAnswerGroups(next,fields,measures,reserved);items=next;reset();draw();return true;}catch(error){status.textContent=(error as Error).message;return false;}};
 const add=button('Add group',()=>{if(!commit())return;reset();editor.hidden=false;name.focus();});
 editor.append(selected,measureFilters.element,button('Cancel edit',()=>{reset();status.textContent='';}));
 element.prepend(list);element.append(add,editor,status);populate();draw();
 return {element,read:()=>structuredClone(items),validate:()=>{try{if(!commit())return false;validateAnswerGroups(items,fields,measures,reserved);return true;}catch(error){status.textContent=(error as Error).message;return false;}}};
}
