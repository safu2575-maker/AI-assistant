import { filterShortcuts } from "../filterShortcuts";
import { fieldLayout } from '../fieldLayout';
export function questionShortcuts(input:HTMLInputElement,fields:()=>string[]){
 const host=document.createElement('div');host.className='askbics-question-shortcuts';
 const preview=document.createElement('div');preview.setAttribute('aria-live','polite');preview.hidden=true;
 const help=document.createElement('details'),heading=document.createElement('summary');heading.textContent='Question shortcuts';help.append(heading);
 const note=document.createElement('p');note.textContent='After a field: (p) parent, (r) rows, (c) columns. Filters: where <field name> (f) = <value>. Blank: where <field name> (blank). Replace placeholders with your data. Keywords ignore capitalization. Parent needs a child row field. Press Ask to apply.';help.append(note);
 const options=document.createElement('div');help.append(options);host.append(preview,help);
 let timer:ReturnType<typeof setTimeout>|undefined;
 const update=()=>{
  const names=fields();const config={fields:names.map(name=>({name,table:'',column:''}))};
  try{const parsed=fieldLayout(input.value,config);const rows=[...parsed.roles].filter(([,r])=>r!=='column').map(([n,r])=>n+(r==='parent'?' (parent)':'')),cols=[...parsed.roles].filter(([,r])=>r==='column').map(([n])=>n);preview.textContent=[rows.length?'Rows: '+rows.join(' → '):'',cols.length?'Columns: '+cols.join(', '):'', /\b(?:where|with)\s+/i.test(input.value)?'Filters: '+filterShortcuts(input.value,config).split(/\b(?:where|with)\s+/i).slice(1).join(' '):''].filter(Boolean).join(' · ');}catch(e){preview.textContent=(e as Error).message;}
  preview.hidden=!preview.textContent;options.replaceChildren();
  const cursor=input.selectionStart??input.value.length,before=input.value.slice(0,cursor).trimEnd();
  const field=names.sort((a,b)=>b.length-a.length).find(n=>before.toLowerCase().endsWith(n.toLowerCase())&&(before.length===n.length||/[\s,;]/.test(before[before.length-n.length-1])));
  if(!field)return;
  for(const [label,token] of [['Parent',' (p)'],['Rows',' (r)'],['Columns',' (c)'],['Filter',' (f) = '],['Blank',' (blank)']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.title=field+token;b.onclick=()=>{input.setRangeText(token,input.selectionStart??cursor,input.selectionEnd??cursor,'end');input.focus();input.dispatchEvent(new Event('input',{bubbles:true}));help.open=false;};options.append(b);}
 };
 input.addEventListener('input',()=>{if(timer)clearTimeout(timer);timer=setTimeout(update,160);});input.addEventListener('click',update);help.addEventListener('toggle',()=>{if(help.open)update();});
 return host;
}
