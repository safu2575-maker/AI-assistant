import { summaryIcon } from './summaryIcons';
import { settingsActionIcon } from './settingsActionIcon';
export interface CardEntry {label:string;value:string;raw?:number|null;key:string;}
/** Local display controls never change the model query or totals. */
export function summaryCardRows(card:HTMLElement,rows:HTMLElement,entries:CardEntry[],initialSort:string,select:(key:string,event:MouseEvent)=>void,register:(button:HTMLButtonElement,key:string)=>void,paint:()=>void,total?:string){
 if(total!==undefined){const footer=document.createElement('div');footer.className='askbics-summary-total';const label=document.createElement('strong');label.textContent='Grand Total';const value=document.createElement('strong');value.textContent=total;footer.append(label,value);rows.after(footer);}
 let sort=initialSort,bars=true,compact=false;
 const title=card.querySelector('strong')!;const head=document.createElement('div');head.className='askbics-summary-card-head';title.replaceWith(head);head.append(title);
 const icon=summaryIcon(card.dataset.icon);icon.classList.add('askbics-summary-heading-icon');
 const copy=document.createElement('div');copy.className='askbics-summary-heading-copy';title.title=title.textContent||'';copy.append(title);head.replaceChildren(icon,copy);
 const columns=document.createElement('div');columns.className='askbics-summary-columns';for(const label of ['#',card.dataset.field||'Member',card.dataset.measure||'Amount']){const cell=document.createElement('span');cell.textContent=label;cell.title=label;columns.append(cell);}rows.before(columns); const more=document.createElement('button');more.type='button';settingsActionIcon(more,'more','Summary card options');more.setAttribute('aria-haspopup','menu');more.setAttribute('aria-expanded','false');head.append(more);
 let menu:HTMLElement|undefined;
 const close=()=>{menu?.remove();menu=undefined;more.setAttribute('aria-expanded','false');document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);};
 const outside=(e:Event)=>{if(!menu?.contains(e.target as Node)&&!more.contains(e.target as Node))close();};
 const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();more.focus();}};
 const draw=()=>{
 const ordered=[...entries];if(sort==='Name'||sort==='Name descending')ordered.sort((a,b)=>(sort==='Name'?1:-1)*a.label.localeCompare(b.label));if(sort==='Value'||sort==='Value ascending')ordered.sort((a,b)=>(sort==='Value'?1:-1)*((b.raw??0)-(a.raw??0)));
 const min=Math.min(0,...entries.map(e=>e.raw??0)),max=Math.max(0,...entries.map(e=>e.raw??0)),range=max-min,zero=range?-min/range*100:0;
 rows.replaceChildren();for(const [index,e] of ordered.entries()){const b=document.createElement('button');b.type='button';b.title=(e.label||'Unassigned')+': '+e.value;b.setAttribute('aria-pressed','false');
 const check=document.createElement('span');check.className='askbics-summary-check';check.textContent='✓';check.setAttribute('aria-hidden','true');
 const rank=document.createElement('span');rank.className='askbics-summary-rank';rank.textContent=String(index+1);check.append(rank);
 const name=document.createElement('span');name.className='askbics-summary-name';name.textContent=e.label||'Unassigned';
 const amount=document.createElement('span');amount.className='askbics-summary-amount';
 if(bars){const bar=document.createElement('span');bar.className='askbics-summary-bar';const raw=e.raw??0;bar.style.left=(raw<0?zero-(range?Math.abs(raw)/range*100:0):zero)+'%';bar.style.width=(range?Math.abs(raw)/range*100:0)+'%';if(raw<0)bar.classList.add('negative');amount.append(bar);if(min<0&&max>0){const baseline=document.createElement('span');baseline.className='askbics-summary-zero';baseline.style.left=zero+'%';amount.append(baseline);}}
 const text=document.createElement('span');text.className='askbics-summary-number';text.textContent=compact&&e.raw!=null&&!e.value.includes('%')?new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(e.raw):e.value;amount.append(text);b.append(check,name,amount);b.onclick=event=>select(e.key,event);register(b,e.key);rows.append(b);
 }paint();};
 more.onclick=()=>{if(menu){close();return;}menu=document.createElement('div');menu.className='askbics-transactions-menu askbics-summary-options';menu.setAttribute('role','menu');
 const option=(label:string,checked:boolean,run:()=>void)=>{const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',String(checked));b.textContent=(checked?'✓  ':'    ')+label;b.onclick=()=>{run();close();draw();more.focus();};menu!.append(b);};
 for(const [value,label] of [['Model order','Model order'],['Value','Value: highest first'],['Value ascending','Value: lowest first'],['Name','Name: A–Z'],['Name descending','Name: Z–A']])option(label,sort===value,()=>sort=value);
 const separator=()=>{const hr=document.createElement('hr');menu!.append(hr);};separator();option('Show data bars',bars,()=>bars=!bars);separator();option('Full numbers',!compact,()=>compact=false);option('Compact numbers',compact,()=>compact=true);
 document.body.append(menu);const r=more.getBoundingClientRect();menu.style.position='fixed';menu.style.zIndex='1500';menu.style.left=Math.max(8,Math.min(r.right-menu.offsetWidth,window.innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(r.bottom+4,window.innerHeight-menu.offsetHeight-8))+'px';more.setAttribute('aria-expanded','true');document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
 menu.onkeydown=e=>{const items=Array.from(menu!.querySelectorAll('button'));const i=items.indexOf(document.activeElement as HTMLButtonElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}};menu.querySelector('button')?.focus();};
 const cleanup=new MutationObserver(()=>{if(!card.isConnected){close();cleanup.disconnect();}});cleanup.observe(document.body,{childList:true,subtree:true});draw();
}
