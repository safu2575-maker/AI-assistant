import { summaryIcon, summaryIcons } from './summaryIcons';
import { settingsSelect } from './settingsSelect';
import { settingsActionIcon } from './settingsActionIcon';
export interface SummaryCard { field:string; title:string; measure:string; sort:string; hideBlanks:boolean; icon?:string; }
export interface SummaryCards { enabled:boolean; cards:SummaryCard[]; }
export function summaryCardSettings(initial:SummaryCards|undefined,fields:string[],measures:string[]){
 const element=document.createElement('div');element.className='askbics-summary-settings';
 const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=!!initial?.enabled;
 const label=document.createElement('label');label.className='askbics-summary-toggle';label.append(enabled,'Enable summary cards');element.append(label);
 const note=document.createElement('p');note.textContent='Choose transaction fields for up to 10 cards. Drag the handle to change their order.';element.append(note);
 const cards=(initial?.cards||[]).map(c=>({...c}));const list=document.createElement('div');element.append(list);
 const add=document.createElement('button');add.type='button';add.className='askbics-settings-action';add.textContent='+ Add card';element.append(add);
 const status=document.createElement('span');status.setAttribute('role','status');status.className='askbics-summary-status';element.append(status);
 let dragged=-1;
 let editing:SummaryCard|undefined;
 const draw=()=>{list.replaceChildren();add.disabled=cards.length>=10;cards.forEach((c,i)=>{
 const row=document.createElement('section');row.className='askbics-summary-editor';row.dataset.cardIndex=String(i);
 const head=document.createElement('div');head.className='askbics-summary-editor-head';
 const handle=document.createElement('button');handle.type='button';settingsActionIcon(handle,'grip','Reorder card '+(i+1)+'; drag or use Up and Down arrow keys');
 const caption=document.createElement('strong');caption.textContent=c.title||c.field||'Card '+(i+1);
 const edit=document.createElement('button');edit.type='button';settingsActionIcon(edit,'edit',editing===c?'Close card editor':'Edit card '+(i+1));edit.setAttribute('aria-expanded',String(editing===c));edit.dataset.editCard=String(i);edit.onclick=()=>{editing=editing===c?undefined:c;draw();list.querySelector<HTMLButtonElement>('[data-edit-card="'+i+'"]')?.focus();};
 const remove=document.createElement('button');remove.type='button';settingsActionIcon(remove,'delete','Delete card '+(i+1));remove.onclick=()=>{if(editing===c)editing=undefined;cards.splice(i,1);draw();add.focus();};head.append(handle,caption,edit,remove);row.append(head);
 const move=(target:number)=>{if(target<0||target>=cards.length||target===i)return;cards.splice(target,0,cards.splice(i,1)[0]);draw();list.querySelector<HTMLButtonElement>('[data-card-index="'+target+'"] .is-drag-handle')?.focus();status.textContent='Card moved to position '+(target+1)+'.';};
 handle.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();move(i+(e.key==='ArrowUp'?-1:1));}};
 let target=i;
 handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();handle.focus();dragged=i;target=i;handle.setPointerCapture(e.pointerId);};
 handle.onpointermove=e=>{if(dragged!==i)return;const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-card-index]');if(hit&&list.contains(hit)){target=Number(hit.dataset.cardIndex);list.querySelectorAll('.is-drop-target').forEach(n=>n.classList.remove('is-drop-target'));hit.classList.add('is-drop-target');}};
 const finish=()=>{dragged=-1;list.querySelectorAll('.is-drop-target').forEach(n=>n.classList.remove('is-drop-target'));};
 handle.onpointerup=e=>{if(dragged!==i)return;handle.releasePointerCapture(e.pointerId);finish();move(target);};handle.onpointercancel=finish;
 if(editing!==c){row.classList.add('is-compact');const summary=document.createElement('div');summary.className='askbics-summary-editor-description';summary.textContent=(c.field||'Choose a field')+' · '+(c.measure||'Transaction measure');row.append(summary);list.append(row);return;}
 const grid=document.createElement('div');grid.className='askbics-summary-editor-grid';row.append(grid);
 const select=(title:string,options:Array<[string,string]>,value:string,change:(v:string)=>void)=>{const l=document.createElement('label');l.append(title);const s=document.createElement('select');s.setAttribute('aria-label',title+' for card '+(i+1));for(const [v,text] of options){const o=document.createElement('option');o.value=v;o.textContent=text;s.append(o);}s.value=value;s.onchange=()=>{change(s.value);caption.textContent=c.title||c.field||'Card '+(i+1);};l.append(s);grid.append(l);settingsSelect(s,true,title==='Icon'?summaryIcon:undefined);};
 select('Field',[['','Choose field…'],...fields.map(f=>[f,f] as [string,string])],c.field,v=>c.field=v);
 select('Measure',[['','Transaction measure'],...measures.map(m=>[m,m] as [string,string])],c.measure,v=>c.measure=v);
 const titleLabel=document.createElement('label');titleLabel.append('Title (optional)');const title=document.createElement('input');title.placeholder='Use field name';title.setAttribute('aria-label','Title for card '+(i+1));title.value=c.title;title.oninput=()=>{c.title=title.value;caption.textContent=c.title||c.field||'Card '+(i+1);};titleLabel.append(title);grid.append(titleLabel);
 select('Sort',[['Model order','Model order'],['Name','Name: A–Z'],['Value','Value: highest first']],c.sort||'Model order',v=>c.sort=v);
 select('Icon',summaryIcons,c.icon||'chart',v=>c.icon=v);
 const blank=document.createElement('input');blank.type='checkbox';blank.checked=c.hideBlanks;blank.onchange=()=>c.hideBlanks=blank.checked;const bl=document.createElement('label');bl.className='askbics-summary-toggle';bl.title='Hide this card only when all field values are blank. If any value is present, show all rows, including blanks.';bl.append(blank,'Hide empty cards');row.append(bl);list.append(row);
 });};add.onclick=()=>{editing={field:'',title:'',measure:'',sort:'Model order',hideBlanks:true};cards.push(editing);draw();list.lastElementChild?.scrollIntoView({block:'nearest'});};draw();
 return {element,read:():SummaryCards=>{if(enabled.checked&&cards.some(c=>!fields.includes(c.field)||c.measure&&!measures.includes(c.measure)))throw new Error('Summary cards: choose an available field and measure for each card.');return {enabled:enabled.checked,cards};}};
}
