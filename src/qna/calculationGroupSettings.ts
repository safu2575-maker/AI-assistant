import { pairFormulaDelimiter } from './formulaTyping';

import { positionFormulaCompletion } from './formulaCompletionPosition';

import { CalculationGroup, CalculationMeasure, validateCalculationGroups, calculationReferences, remapCalculation } from '../calculationGroups';

import { CalculationError, calculationDiagnostic, calculationFilterCompletion, calculationFunctions, formatCalculation, parseCalculation, quoteCalculation, readCalculationQuote, tokenizeCalculation, walkCalculation } from '../calculationFormula';

import { settingsActionIcon, settingsMenuAction } from './settingsActionIcon';

import { settingsSelect } from './settingsSelect';

import { installSettingsHelp } from './settingsHelp';

export function calculationGroupSettings(current:CalculationGroup[]|undefined,measures:string[],fields:string[],loadValues:(field:string)=>Promise<string[]>,preview:(groups:CalculationGroup[],question:string)=>Promise<import('./types').QnaResponse>,readValues?:(field:string)=>string[]) {

 const previewDrafts=new Map<string,string>();

 const valueCache=new Map<string,Promise<string[]>>();

 const valuesFor=(field:string)=>{let task=valueCache.get(field);if(!task){task=loadValues(field).catch(e=>{valueCache.delete(field);throw e;});valueCache.set(field,task);}return task;};

 let groups=structuredClone(current||[]),selected: string|undefined=current?.[0]?.id,dragId='',revision=0,disposeHelp=()=>{},pendingDelete='';

 let selectedCalculation:string|undefined;
 let openOptionsFor:string|undefined;


 const element=document.createElement('section');element.className='askbics-calculation-groups';

 const sidebar=document.createElement('div'),editor=document.createElement('div');sidebar.className='askbics-calculation-sidebar';editor.className='askbics-calculation-editor';

 const search=document.createElement('input');search.placeholder='Search calculation groups…';search.setAttribute('aria-label','Search calculation groups');

 const list=document.createElement('div');list.className='askbics-calculation-group-list';const status=document.createElement('p');status.setAttribute('role','status');

 const action=(parent:HTMLElement,label:string,fn:()=>void)=>{const b=document.createElement('button');b.type='button';b.className='askbics-settings-action';b.textContent=label;b.onclick=()=>{try{fn();}catch(e){status.textContent=(e as Error).message;}};parent.append(b);return b;};

 const fold=(parent:HTMLElement,title:string)=>{const details=document.createElement('details'),summary=document.createElement('summary');details.className='askbics-calculation-options';summary.textContent=title;details.append(summary);parent.append(details);return details;};

 const id=()=>crypto.randomUUID();

 const createGroup=()=>{const group:CalculationGroup={version:1,id:id(),name:'New calculation group',description:'',enabled:true,measures:[]};groups.push(group);selected=group.id;selectedCalculation=undefined;render(true);};

 sidebar.append(search);action(sidebar,'Add group',createGroup).classList.add('is-primary');sidebar.append(list);element.append(sidebar,editor,status);

 const input=(parent:HTMLElement,label:string,value:string,change:(value:string)=>void,help:string,multiline=false)=>{const wrap=document.createElement('label');const caption=document.createElement('span');caption.textContent=label;caption.dataset.settingsHelp=help;const field=multiline?document.createElement('textarea'):document.createElement('input');field.value=value;field.setAttribute('aria-label',label);field.oninput=()=>change(field.value);wrap.append(caption,field);parent.append(wrap);return field;};

 const select=(parent:HTMLElement,label:string,value:string,options:string[],change:(value:string)=>void,help:string)=>{const wrap=document.createElement('label'),caption=document.createElement('span');caption.textContent=label;caption.dataset.settingsHelp=help;const field=document.createElement('select');field.setAttribute('aria-label',label);for(const name of ['',...options]){const option=document.createElement('option');option.value=name;option.textContent=({number:'Number',percentage:'Percentage',recalculate:'Recalculate in total context',hide:'Hide Grand Total',custom:'Custom total formula'} as Record<string,string>)[name]||name||'Use inherited default';field.append(option);}field.value=value;field.onchange=()=>change(field.value);wrap.append(caption,field);parent.append(wrap);settingsSelect(field);};

 const toggle=(parent:HTMLElement,label:string,checked:boolean,change:(value:boolean)=>void)=>{const wrap=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=checked;check.onchange=()=>change(check.checked);wrap.append(check,document.createTextNode(label));parent.append(wrap);};



 const render=(newGroup=false)=>{search.hidden=groups.length<5;pendingDelete='';disposeHelp();revision++;list.replaceChildren();editor.replaceChildren();status.textContent='';

  groups.forEach((g,index)=>{

   if(!g.name.toLowerCase().includes(search.value.toLowerCase()))return;

   const row=document.createElement('div');row.dataset.groupIndex=String(index);

   const handle=document.createElement('button');handle.type='button';

   settingsActionIcon(handle,'grip','Reorder '+g.name+'; drag or use Up and Down arrow keys');row.append(handle);

   const move=(target:number)=>{if(target<0||target>=groups.length||target===index)return;groups.splice(target,0,groups.splice(index,1)[0]);render();list.querySelector<HTMLButtonElement>('[data-group-index="'+target+'"] .is-drag-handle')?.focus();status.textContent=g.name+' moved to position '+(target+1)+'.';};

   handle.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();move(index+(e.key==='ArrowUp'?-1:1));}};

   let target=index;

   const finish=()=>{dragId='';list.querySelectorAll('.is-drop-target').forEach(n=>n.classList.remove('is-drop-target'));};

   handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();handle.focus();dragId=g.id;target=index;handle.setPointerCapture(e.pointerId);};

   handle.onpointermove=e=>{if(dragId!==g.id)return;const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-group-index]');if(hit&&list.contains(hit)){target=Number(hit.dataset.groupIndex);list.querySelectorAll('.is-drop-target').forEach(n=>n.classList.remove('is-drop-target'));hit.classList.add('is-drop-target');}};

   handle.onpointerup=e=>{if(dragId!==g.id)return;handle.releasePointerCapture(e.pointerId);finish();move(target);};handle.onpointercancel=finish;handle.onlostpointercapture=finish;

   const text=document.createElement('div');text.className='askbics-calculation-group-caption';const name=document.createElement('strong');name.textContent=g.name;const small=document.createElement('small');small.textContent=g.measures.length+' calculation'+(g.measures.length===1?'':'s')+(g.enabled?'':' · Disabled');text.append(name,small);row.append(text);

   const edit=action(row,'Edit '+g.name,()=>{selected=g.id;selectedCalculation=undefined;render();});settingsActionIcon(edit,'edit','Edit '+g.name);edit.setAttribute('aria-expanded',String(selected===g.id));list.append(row);

  });

  if(!groups.some(group=>group.id===selected))selected=groups[0]?.id;const g=groups.find(g=>g.id===selected);editor.hidden=!g;sidebar.hidden=!!g;if(!g)return;

  const groupHead=document.createElement('div');groupHead.className='askbics-calculation-actions';editor.append(groupHead);

  action(groupHead,'Duplicate group',()=>{const copy=structuredClone(g);copy.id=id();copy.name+=' copy';const renames=new Map(copy.measures.map(m=>[m.name,m.name+' copy']));copy.measures.forEach(m=>{m.name=renames.get(m.name)!;m.id=id();if(m.formula.trim())m.formula=remapCalculation(m.formula,renames);if(m.totalFormula)m.totalFormula=remapCalculation(m.totalFormula,renames);});groups.push(copy);selected=copy.id;selectedCalculation=undefined;render();});

  const deleteGroup=action(groupHead,'Delete group',()=>{const names=new Set(g.measures.map(m=>m.name.toLowerCase()));if(groups.filter(x=>x!==g).some(x=>x.measures.some(m=>[m.formula,m.totalFormula||''].filter(Boolean).some(source=>calculationReferences(source).some(n=>names.has(n.toLowerCase()))))))throw new Error('Another group depends on these calculations. Remove its references first.');if(pendingDelete!==g.id){pendingDelete=g.id;status.textContent='Click Delete group again to confirm deletion of '+g.name+'.';return;}groups=groups.filter(x=>x!==g);selected=undefined;render();});settingsActionIcon(deleteGroup,'delete','Delete group');deleteGroup.classList.remove('askbics-settings-icon');deleteGroup.append(document.createTextNode('Delete group'));

  input(editor,'Group name',g.name,v=>{g.name=v;title.textContent=v;const tab=Array.from(groupSwitch.children).find(node=>(node as HTMLElement).dataset.groupId===g.id);if(tab)tab.textContent=v+' ('+g.measures.length+')';},'Unique group name suggested by #.');input(editor,'Description',g.description,v=>g.description=v,'Explain the business purpose of this group.');toggle(editor,'Enable group',g.enabled,v=>g.enabled=v);

  select(editor,'Default measure',g.defaultMeasure||'',measures,v=>g.defaultMeasure=v,'Model measure used for field-value shorthand. Without a default field, accessible fields are checked for a unique match; ambiguous values require an explicit field. No raw column aggregation is inferred.');select(editor,'Default filter field',g.defaultField||'',fields,v=>g.defaultField=v,'Restricts field-value shorthand to this field. Leave empty to resolve a unique value across accessible configured fields. Model measure names take precedence; use an explicit [Field] filter to disambiguate.');

  const groupFields=Array.from(editor.children).filter(child=>child!==groupHead);

  const heading=document.createElement('div');heading.className='askbics-calculation-heading';

  

  const title=document.createElement('strong');title.textContent=g.name;heading.append(title);

  const menu=action(heading,'Group actions',()=>{groupHead.hidden=!groupHead.hidden;menu.setAttribute('aria-expanded',String(!groupHead.hidden));});settingsActionIcon(menu,'more','Group actions');menu.setAttribute('aria-expanded','false');groupHead.hidden=true;groupHead.className='askbics-qna__period-menu askbics-calculation-group-menu';heading.append(groupHead);groupHead.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();groupHead.hidden=true;menu.setAttribute('aria-expanded','false');menu.focus();}};heading.addEventListener('focusout',e=>{if(e.relatedTarget instanceof Node&&!heading.contains(e.relatedTarget)){groupHead.hidden=true;menu.setAttribute('aria-expanded','false');}});

  editor.prepend(heading);

  const workspaceNav=document.createElement('div');workspaceNav.className='askbics-calculation-workspace-nav';

  const workspaceTools=document.createElement('div');workspaceTools.className='askbics-calculation-workspace-tools';

  action(workspaceTools,'Add group',createGroup).classList.add('is-primary');

  const groupSwitch=document.createElement('div');groupSwitch.className='askbics-settings-tabs askbics-calculation-switcher';groupSwitch.setAttribute('aria-label','Calculation groups');groupSwitch.setAttribute('role','tablist');

  groups.forEach(group=>{
   let pressed=false,dragging=false,suppressClick=false,startX=0,startY=0,targetId=group.id;
   const button=action(groupSwitch,group.name+' ('+group.measures.length+')',()=>{if(suppressClick)return;selected=group.id;selectedCalculation=undefined;render();});
   button.setAttribute('role','tab');button.tabIndex=group.id===g.id?0:-1;button.dataset.groupId=group.id;
   button.setAttribute('aria-selected',String(group.id===g.id));button.setAttribute('aria-pressed',String(group.id===g.id));
   button.setAttribute('aria-description','Drag to reorder. Left and Right switch groups; Alt+Left and Alt+Right reorder this group.');button.setAttribute('aria-keyshortcuts','Alt+ArrowLeft Alt+ArrowRight');
   button.title=group.name+(group.enabled?'':' · Disabled')+' · Drag to reorder';
   const moveTo=(target:string)=>{const from=groups.indexOf(group),to=groups.findIndex(x=>x.id===target);if(to<0||from===to)return;groups.splice(to,0,groups.splice(from,1)[0]);render();editor.querySelector<HTMLButtonElement>('[data-group-id="'+group.id+'"]')?.focus({preventScroll:true});status.textContent=group.name+' moved to position '+(to+1)+'.';};
   button.onkeydown=e=>{if(e.altKey&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const i=groups.indexOf(group),target=i+(e.key==='ArrowRight'?1:-1);if(target>=0&&target<groups.length)moveTo(groups[target].id);return;}if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const i=groups.indexOf(group),next=e.key==='Home'?0:e.key==='End'?groups.length-1:(i+(e.key==='ArrowRight'?1:-1)+groups.length)%groups.length;selected=groups[next].id;selectedCalculation=undefined;render();editor.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')?.focus();}};
   const finish=()=>{pressed=false;dragging=false;button.classList.remove('is-dragging');groupSwitch.querySelectorAll('.is-drop-target').forEach(n=>n.classList.remove('is-drop-target'));};
   button.onpointerdown=e=>{if(e.button!==0)return;pressed=true;dragging=false;suppressClick=false;startX=e.clientX;startY=e.clientY;targetId=group.id;button.setPointerCapture(e.pointerId);};
   button.onpointermove=e=>{if(!pressed)return;if(!dragging&&Math.hypot(e.clientX-startX,e.clientY-startY)<6)return;dragging=true;suppressClick=true;e.preventDefault();button.classList.add('is-dragging');const box=groupSwitch.getBoundingClientRect();if(e.clientX<box.left+20)groupSwitch.scrollLeft-=12;else if(e.clientX>box.right-20)groupSwitch.scrollLeft+=12;const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-group-id]');if(hit&&groupSwitch.contains(hit)){targetId=hit.dataset.groupId!;groupSwitch.querySelectorAll('.is-drop-target').forEach(n=>n.classList.remove('is-drop-target'));if(hit!==button)hit.classList.add('is-drop-target');}};
   button.onpointerup=e=>{if(!pressed)return;const moved=dragging,target=targetId;finish();if(button.hasPointerCapture(e.pointerId))button.releasePointerCapture(e.pointerId);if(moved){e.preventDefault();moveTo(target);setTimeout(()=>{suppressClick=false;},0);}};
   button.onpointercancel=()=>{finish();suppressClick=false;};button.onlostpointercapture=finish;button.draggable=false;
  });

  workspaceNav.append(workspaceTools,groupSwitch);editor.prepend(workspaceNav);

  const count=document.createElement('small');count.textContent=g.measures.length+' calculation'+(g.measures.length===1?'':'s');title.after(count);




  const groupSettings=document.createElement('div');groupSettings.className='askbics-calculation-group-settings';groupSettings.hidden=!newGroup;editor.append(groupSettings);

  const settingsTitle=document.createElement('strong');settingsTitle.textContent='Group settings';groupSettings.append(settingsTitle);

  groupFields.forEach(child=>groupSettings.append(child));

  const calculations=document.createElement('div');calculations.id='calc-group-panel-'+g.id;calculations.setAttribute('role','tabpanel');calculations.setAttribute('aria-label',g.name+' calculations');groupSwitch.querySelectorAll('[role=tab]').forEach(tab=>tab.setAttribute('aria-controls',calculations.id));editor.append(calculations);calculations.hidden=newGroup;

  const settings=action(groupHead,'Group settings',()=>{groupSettings.hidden=!groupSettings.hidden;calculations.hidden=!groupSettings.hidden;groupHead.hidden=true;menu.setAttribute('aria-expanded','false');settings.setAttribute('aria-expanded',String(!groupSettings.hidden));});settingsActionIcon(settings,'edit','Group settings');settings.classList.remove('askbics-settings-icon');settings.append(document.createTextNode('Group settings'));settings.setAttribute('aria-expanded',String(newGroup));settings.title='Edit the group name, description and defaults. Changes remain drafts until Save settings.';

  action(groupSettings,'Done',()=>{groupSettings.hidden=true;calculations.hidden=false;settings.setAttribute('aria-expanded','false');});

  heading.hidden=!!selectedCalculation;workspaceNav.hidden=!!selectedCalculation;editor.classList.toggle('is-editing-calculation',!!selectedCalculation);

  const addRow=document.createElement('div');addRow.className='askbics-calculation-kpi-add';addRow.hidden=!!selectedCalculation;calculations.append(addRow);
  const kpiName=document.createElement('input');kpiName.setAttribute('aria-label','New KPI name');kpiName.placeholder='Type KPI name';kpiName.title='Add KPI names first. Drafts remain disabled until a formula is defined.';addRow.append(kpiName);
  const checkName=(name:string,except?:CalculationMeasure)=>{if(!name||name.length>100||/[\[\];]/.test(name))throw new Error('Enter a KPI name of 1–100 characters without brackets or semicolons.');if(measures.some(n=>n.toLowerCase()===name.toLowerCase())||groups.some(group=>group.name.toLowerCase()===name.toLowerCase()||group.measures.some(m=>m!==except&&m.name.toLowerCase()===name.toLowerCase())))throw new Error('A group, measure or KPI already uses this name.');};
  const add=action(addRow,'Add KPI',()=>{const name=kpiName.value.trim();checkName(name);const m:CalculationMeasure={id:id(),name,description:'',formula:'',enabled:false,format:'number',decimals:2,total:'recalculate'};g.measures.push(m);render();editor.querySelector<HTMLInputElement>('input[aria-label="New KPI name"]')?.focus();});add.classList.add('is-primary');
  kpiName.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();add.click();}};

  const calculationList=document.createElement('div');calculationList.hidden=!!selectedCalculation;calculationList.className='askbics-calculation-compact-list askbics-calculation-kpi-list';calculations.append(calculationList);
  const kpiTable=document.createElement('table');kpiTable.setAttribute('aria-label',g.name+' KPIs');const tableHead=kpiTable.createTHead().insertRow();for(const label of ['KPI / Calculation name','Options','Status','Actions']){const th=document.createElement('th');th.scope='col';th.textContent=label;if(label==='Status')th.dataset.settingsHelp='Draft KPIs have no formula and stay disabled. Edit a draft, enter a formula, then choose Done to validate and enable it. Disabled formulas stay stored but are not included in answers.';tableHead.append(th);}const tableBody=kpiTable.createTBody();calculationList.append(kpiTable);

  const empty=document.createElement('p');empty.className='askbics-calculation-empty';calculations.append(empty);

  const updateEmpty=()=>{empty.hidden=!!selectedCalculation||g.measures.length>0;empty.textContent='No calculations or KPIs yet. Add one to this group.';};



  g.measures.forEach((m,index)=>{const details=document.createElement('details');details.className='askbics-calculation-card';details.dataset.calculationIndex=String(index);details.open=true;details.hidden=selectedCalculation!==m.id;const summary=document.createElement('summary');const caption=document.createElement('span');caption.textContent=m.name;summary.append(caption);details.append(summary);calculations.append(details);const body=document.createElement('div');details.append(body);

   input(body,'Calculation name',m.name,v=>{m.name=v;caption.textContent=v;breadcrumb.textContent=g.name+' › '+v;},'Unique answer-column name. References use @[Calculation name].');input(body,'Calculation description',m.description,v=>m.description=v,'Business explanation, preserved with settings.');let activateOnDone=!m.formula.trim();toggle(body,'Enable calculation',m.enabled,v=>{m.enabled=v;activateOnDone=false;});

   select(body,'Measure override',m.defaultMeasure||'',measures,v=>m.defaultMeasure=v,'Overrides the group default measure for this calculation.');select(body,'Field override',m.defaultField||'',fields,v=>m.defaultField=v,'Overrides the group default field.');

   const code=document.createElement('div');code.className='askbics-calculation-code';body.append(code);const formula=input(code,'Formula',m.formula,v=>{m.formula=v;paint();},'Use single quotes, paired apostrophes or double quotation marks for quoted names. Brackets and quotes close automatically outside values/comments. Syntax and unknown-name errors are underlined in red; a short red explanation appears directly below the editor. Suggestions appear only after typing a name or value prefix (case-insensitive). Use Ctrl+Space to reopen matching suggestions, arrows to select, Enter/Tab to insert and Escape to close. Type inside quotes for measure and accessible value suggestions labelled Value — Field. Selecting a value inserts an explicit field filter using the default measure. A default measure is required; the default field is suggested first, with other accessible fields also available. Use (Rental + ServiceCharge, [Year] = 2026) for shared filters, or nest individually filtered measures. Inner explicit filters override outer filters on the same field; other fields are inherited. Explicit filters override AskBICS question predicates on that field; report/RLS and Always filters remain.',true) as HTMLTextAreaElement;

   const surface=document.createElement('div');surface.className='askbics-formula-surface';formula.replaceWith(surface);surface.append(formula);

   const underline=document.createElement('pre');underline.className='askbics-formula-underline';underline.setAttribute('aria-hidden','true');surface.append(underline);

   const syncUnderline=()=>{const style=getComputedStyle(formula);for(const key of ['font','lineHeight','letterSpacing','padding','borderWidth','boxSizing','tabSize','wordSpacing'] as const)underline.style[key]=style[key];underline.style.width=formula.offsetWidth+'px';underline.style.height=formula.offsetHeight+'px';underline.scrollTop=formula.scrollTop;underline.scrollLeft=formula.scrollLeft;for(const key of ['font','lineHeight','letterSpacing','padding','borderWidth','boxSizing','tabSize','wordSpacing'] as const)highlight.style[key]=style[key];highlight.style.width=formula.offsetWidth+'px';highlight.style.height=formula.offsetHeight+'px';highlight.scrollTop=formula.scrollTop;highlight.scrollLeft=formula.scrollLeft;};

   formula.addEventListener('scroll',syncUnderline);formula.addEventListener('mouseup',syncUnderline);

   formula.spellcheck=false;formula.rows=9;const highlight=document.createElement('pre');highlight.className='askbics-calculation-highlight';highlight.setAttribute('aria-hidden','true');surface.insertBefore(highlight,formula);

   const undo:string[]=[formula.value],redo:string[]=[];const record=()=>{if(undo.at(-1)!==formula.value){undo.push(formula.value);if(undo.length>100)undo.shift();redo.length=0;}};

   const errors=document.createElement('p');errors.setAttribute('role','status');errors.className='askbics-calculation-diagnostic';surface.after(errors);

   const showSyntaxError=(error:unknown)=>{

    const at=Math.max(0,Math.min(formula.value.length,error instanceof CalculationError?error.at:0));

    underline.replaceChildren(document.createTextNode(formula.value.slice(0,at)));const problem=document.createElement('mark');problem.textContent=formula.value[at]||' ';underline.append(problem,document.createTextNode(formula.value.slice(at+1)+'\n'));requestAnimationFrame(syncUnderline);

    formula.setAttribute('aria-invalid','true');errors.classList.add('is-error');errors.textContent=calculationDiagnostic(formula.value,error);



   };

   const suggestions=document.createElement('div');suggestions.className='askbics-calculation-suggestions';suggestions.setAttribute('role','region');suggestions.setAttribute('aria-label','Formula suggestions');const completionAnchor=document.createElement('div');completionAnchor.className='askbics-calculation-completion';code.prepend(completionAnchor);completionAnchor.append(surface.parentElement!,suggestions);let active=0,suggestRevision=0;

   const paint=()=>{requestAnimationFrame(syncUnderline);record();underline.replaceChildren();highlight.replaceChildren();formula.removeAttribute('aria-invalid');errors.classList.remove('is-error');if(!formula.value.trim()){errors.textContent='Draft — enter a formula, then choose Done to validate and enable this KPI.';return;}try{let tokens;try{tokens=tokenizeCalculation(formula.value);}catch(error){highlight.textContent=formula.value+'\n';throw error;}const pairs=new Map<number,number>(),stack:number[]=[];tokens.forEach(t=>{if(t.kind!=='symbol')return;if(t.value==='(')stack.push(t.start);if(t.value===')'){const open=stack.pop();if(open!==undefined){pairs.set(open,t.start);pairs.set(t.start,open);}}});const caret=formula.selectionStart,bracket=pairs.has(caret)?caret:pairs.has(caret-1)?caret-1:-1;let pos=0;for(const t of tokens){highlight.append(document.createTextNode(formula.value.slice(pos,t.start)));const span=document.createElement('span');span.className='calc-token-'+t.kind;if(t.start===bracket||t.start===pairs.get(bracket))span.classList.add('calc-token-match');span.textContent=t.text;highlight.append(span);pos=t.end;}highlight.append(document.createTextNode(formula.value.slice(pos)+'\n'));const ast=parseCalculation(formula.value);walkCalculation(ast,n=>{

     if(n.kind==='field'&&!fields.some(f=>f.toLowerCase()===n.name.toLowerCase()))throw new CalculationError('Unavailable field ['+n.name+']. Select a configured field.',n.at);

     if(n.kind==='call'&&!calculationFunctions[n.name])throw new CalculationError('Unknown function '+n.name,n.at);

     if((n.kind==='metric'||n.kind==='reference')&&!measures.some(v=>v.toLowerCase()===n.name.toLowerCase())&&!groups.some(group=>group.measures.some(item=>item.name.toLowerCase()===n.name.toLowerCase()))&&!(n.kind==='metric'&&(m.defaultMeasure||g.defaultMeasure)))throw new CalculationError('Unavailable measure '+n.name,n.at);

    });errors.textContent='Syntax parsed. Validate to check dependencies and model names.';}catch(e){showSyntaxError(e);}};

   const suggest=async()=>{const currentRevision=++suggestRevision,owner=revision;suggestions.replaceChildren();const before=formula.value.slice(0,formula.selectionStart);let choices:Array<string|{label:string;insert?:string}>=[];const field=/\[([^\]]+)\]\s*(?:(?:NOT\s+)?IN\s*\(\s*([^)[\]]*)|(?:BETWEEN|!=|>=|<=|=|>|<)\s*([^,()[\]]*))$/i.exec(before);let start=formula.selectionStart,end=formula.selectionEnd;

    const renderChoices=()=>{
    if(currentRevision!==suggestRevision||owner!==revision)return;const selectedLabel=suggestions.querySelector('[aria-selected="true"]')?.getAttribute('aria-label');suggestions.replaceChildren();active=Math.max(0,choices.slice(0,15).findIndex(choice=>(typeof choice==='string'?choice:choice.label)===selectedLabel));

    if(!choices.length)return;

    const head=document.createElement('div');head.className='askbics-calculation-suggestions-head';const caption=document.createElement('span');caption.textContent='Suggestions · ↑ ↓ · Enter / Tab';head.append(caption);

    const close=action(head,'Close suggestions',()=>{dismissSuggestions();formula.focus();});settingsActionIcon(close,'close','Close suggestions');close.title='Close suggestions (Esc)';suggestions.append(head);

    const options=document.createElement('div');options.setAttribute('role','listbox');options.setAttribute('aria-label','Formula completions');suggestions.append(options);

    choices.slice(0,15).forEach(choice=>{const label=typeof choice==='string'?choice:choice.label,insert=typeof choice==='string'?choice:choice.insert;const b=action(options,label,()=>{if(insert===undefined){errors.textContent='Select a default measure in group Defaults or a measure override before inserting a field value.';return;}formula.setRangeText(insert,start,end,'end');m.formula=formula.value;dismissSuggestions();formula.focus();paint();});b.setAttribute('role','option');b.setAttribute('aria-label',label);b.setAttribute('aria-selected',String(options.children.length-1===active));const kind=typeof choice!=='string'?'Value':label.startsWith('[')?'Field':label.startsWith('@')?'Calculation':label.endsWith('(')?'Function':'Measure';const glyph=document.createElement('span');glyph.className='askbics-completion-kind';glyph.setAttribute('aria-hidden','true');glyph.textContent=kind==='Function'?'ƒ':kind==='Field'?'F':kind==='Value'?'V':'M';const text=document.createElement('span');text.textContent=label;b.replaceChildren(glyph,text);if(insert===undefined){b.setAttribute('aria-disabled','true');b.title='A default measure is required to use this field value.';}const fn=typeof choice==='string'&&choice.endsWith('(')?choice.slice(0,-1):'';if(calculationFunctions[fn])b.title=fn+' expects '+calculationFunctions[fn].join('–')+' arguments. Model measures use (quoted measure, filters).';});

    positionFormulaCompletion(formula,suggestions,completionAnchor);

    };
    // Track the quoted token at the caret, including escaped quotes and comments.

    let quoteStart=-1,quotedPrefix='',closedQuote=false;
    for(let i=0;i<before.length;){
     if(before.slice(i,i+2)==='//'){const newline=before.indexOf('\n',i);if(newline<0)return;i=newline+1;continue;}
     if(before[i]==="'"||before[i]==='"'){
      const quoted=readCalculationQuote(before,i);
      if(!quoted.closed||quoted.end===before.length){quoteStart=i;quotedPrefix=quoted.value.toLowerCase();closedQuote=quoted.closed;break;}
      i=quoted.end;
     }else i++;
    }
    if(quoteStart>=0&&!closedQuote){const full=readCalculationQuote(formula.value,quoteStart);if(full.closed)end=full.end;}

    if(field){const tail=(field[2]??field[3]??'').split(/,|\bAND\b/i).at(-1)||'';start=quoteStart>=0?quoteStart:formula.selectionStart-tail.length;const typed=(quoteStart>=0?quotedPrefix:tail.trim()).replace(/''/g,"'").toLowerCase();if(!typed.trim())return;try{const canonical=fields.find(f=>f.toLowerCase()===field[1].toLowerCase());const matches=(values:string[])=>values.filter(v=>v.toLowerCase().startsWith(typed)).flatMap(v=>/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v)?[{label:v+' — '+canonical,insert:quoteCalculation(v)},{label:v+' — '+canonical+' (number)',insert:v}]:[{label:v+' — '+canonical,insert:quoteCalculation(v)}]);choices=matches(canonical?(readValues?.(canonical)||[]):[]);renderChoices();const values=canonical?await valuesFor(canonical):[];if(currentRevision!==suggestRevision||owner!==revision)return;choices=matches(values);if(!values.length)errors.textContent='No accessible value suggestions are available. Enter an explicit value; suggestions may be limited by current data and filters.';}catch(e){if(currentRevision!==suggestRevision||owner!==revision)return;errors.textContent='Value suggestions unavailable: '+(e as Error).message;}}

    else if(quoteStart>=0){

     start=quoteStart;const typed=quotedPrefix;if(!typed.trim())return;

     const defaultField=m.defaultField||g.defaultField;

     const defaultMeasure=m.defaultMeasure||g.defaultMeasure;

     choices=measures.filter(name=>name.toLowerCase().startsWith(typed)).map(quoteCalculation);

     const orderedFields=defaultField?[defaultField,...fields.filter(f=>f!==defaultField)]:fields;
     const addValues=(field:string,values:string[])=>{
      for(const value of new Set(values)){if(!value.toLowerCase().startsWith(typed))continue;
       const label=value+' — '+field;
       if(choices.some(choice=>typeof choice!=='string'&&choice.label===label))continue;
       choices.push({label,insert:defaultMeasure?'('+quoteCalculation(defaultMeasure)+', ['+field+'] = '+quoteCalculation(value)+')':undefined});
      }
     };
     for(const field of orderedFields)addValues(field,readValues?.(field)||[]);
     renderChoices();
     try{for(const field of orderedFields){
      if(currentRevision!==suggestRevision||owner!==revision)return;

      const values=await valuesFor(field);if(currentRevision!==suggestRevision||owner!==revision)return;

      addValues(field,values);renderChoices();

     }}catch(e){if(currentRevision!==suggestRevision||owner!==revision)return;errors.textContent='Value suggestions unavailable: '+(e as Error).message;}



     if(!choices.length)errors.textContent='No matching accessible values. Set a default measure for shorthand, or use an explicit measure and [Field] filter. Suggestions reflect available data only.';

    }

    else if(/(?<!@)\[[^\]]*$/.test(before)||calculationFilterCompletion(before)){const bracket=/(?<!@)\[([^\]]*)$/.exec(before);const context=calculationFilterCompletion(bracket?before.slice(0,bracket.index):before);if(!context)return;start=bracket?bracket.index:context.start;if(bracket&&formula.value[end]===']')end++;const typed=(bracket?bracket[1]:before.slice(start)).trim().toLowerCase();if(!typed)return;choices=fields.filter(f=>!context.usedFields.some(used=>used.toLowerCase()===f.toLowerCase())&&f.toLowerCase().startsWith(typed)).map(f=>'['+f+'] = ');}

    else{const tail=/[A-Za-z_][A-Za-z_0-9]*$/.exec(before)?.[0]||'';if(!tail)return;start-=tail.length;const matches=(name:string)=>name.toLowerCase().startsWith(tail.toLowerCase());choices=[...measures.filter(matches).map(name=>'('+quoteCalculation(name)+')'),...groups.flatMap(g=>g.measures.filter(x=>x!==m&&x.enabled&&matches(x.name)).map(x=>'@['+x.name+']')),...Object.keys(calculationFunctions).filter(matches).map(f=>f+'(')];}

    renderChoices();
   };

   formula.addEventListener('scroll',()=>{if(suggestions.childElementCount)positionFormulaCompletion(formula,suggestions,completionAnchor);});

   let suggestionTimer:ReturnType<typeof setTimeout>;const dismissSuggestions=()=>{clearTimeout(suggestionTimer);suggestRevision++;suggestions.replaceChildren();};suggestions.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dismissSuggestions();formula.focus();}});formula.addEventListener('input',()=>{suggestRevision++;suggestions.replaceChildren();clearTimeout(suggestionTimer);suggestionTimer=setTimeout(()=>void suggest(),60);});formula.addEventListener('click',paint);formula.addEventListener('keyup',e=>{if(e.key.startsWith('Arrow'))paint();});formula.onkeydown=e=>{if(pairFormulaDelimiter(formula,e))return;if(e.ctrlKey&&e.code==='Space'){e.preventDefault();void suggest();return;}if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();if(e.key.toLowerCase()==='y'||e.shiftKey){const next=redo.pop();if(next!==undefined){undo.push(next);formula.value=next;}}else if(undo.length>1){redo.push(undo.pop()!);formula.value=undo.at(-1)!;}m.formula=formula.value;suggestions.replaceChildren();paint();return;}const buttons=Array.from(suggestions.querySelectorAll<HTMLButtonElement>('button[role=option]'));if(e.key==='Escape'){e.stopPropagation();clearTimeout(suggestionTimer);suggestRevision++;suggestions.replaceChildren();}else if(buttons.length&&['ArrowDown','ArrowUp','Enter','Tab'].includes(e.key)){e.preventDefault();if(e.key==='ArrowDown'||e.key==='ArrowUp'){active=(active+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons.forEach((b,i)=>b.setAttribute('aria-selected',String(i===active)));buttons[active].scrollIntoView({block:'nearest'});}else buttons[active].click();}else if(e.key==='Enter'){e.preventDefault();const prefix=formula.value.slice(0,formula.selectionStart);const indent=/^\s*/.exec(prefix.split('\n').pop()||'')![0];formula.setRangeText('\n'+indent,formula.selectionStart,formula.selectionEnd,'end');m.formula=formula.value;paint();}else if(e.key==='Tab'){e.preventDefault();formula.setRangeText('    ',formula.selectionStart,formula.selectionEnd,'end');m.formula=formula.value;paint();}};

   paint();action(body,'Format formula',()=>{m.formula=formatCalculation(formula.value);formula.value=m.formula;paint();});

   select(body,'Output format',m.format,['number','percentage'],v=>m.format=v as CalculationMeasure['format'],'Percentage displays 0.25 as 25%; do not also multiply by 100.');input(body,'Decimal places',String(m.decimals),v=>m.decimals=Number(v),'Integer from 0 through 6.');

   select(body,'Grand Total behavior',m.total,['recalculate','hide','custom'],v=>{m.total=v as CalculationMeasure['total'];custom.parentElement!.hidden=v!=='custom';},'Recalculate in total context by default; never add row ratios. Custom uses the total formula below.');const custom=input(body,'Custom total formula',m.totalFormula||'',v=>m.totalFormula=v,'Evaluated without row grouping, retaining independent operand filters.',true);custom.parentElement!.hidden=m.total!=='custom';

   action(body,'Validate',()=>{try{validateCalculationGroups(groups,measures,fields);errors.textContent='Syntax and measure references checked. Field-value shorthand still requires model resolution; ambiguity and availability are checked during preview. Open Preview to evaluate against model data.';}catch(e){errors.textContent=calculationDiagnostic(m.formula,e);}});

   const previewContext=input(body,'Preview context',previewDrafts.get(m.id)||'',v=>previewDrafts.set(m.id,v),'Optional question context, for example by Property for Year 2026. Only configured model fields can be used.');

   const previewOutput=document.createElement('pre');previewOutput.className='askbics-calculation-preview';body.append(previewOutput);

   const previewButton=action(body,'Validate and preview',()=>{void (async()=>{

    const owner=revision;previewButton.disabled=true;previewOutput.hidden=false;previewOutput.textContent='Evaluating model context…';

    try {validateCalculationGroups(groups,measures,fields);const previewGroups=structuredClone(groups);if(activateOnDone)previewGroups.find(group=>group.id===g.id)!.measures.find(item=>item.id===m.id)!.enabled=true;validateCalculationGroups(previewGroups,measures,fields);const response=await preview(previewGroups,'Show '+m.name+' '+previewContext.value);

     if(owner!==revision||!previewOutput.isConnected)return;

     if(!response.table)throw new Error(response.text||'Model did not return a preview table.');

     const t=response.table;previewOutput.textContent=[t.columns.join(' | '),...t.rows.slice(0,10).map(r=>r.join(' | ')),...(t.calculationNotes?.['0:'+(t.columns.length-1)]||t.calculationDetails?.(0,t.columns.length-1)||[])].join('\n');

    }catch(e){if(owner===revision)previewOutput.textContent=(e as Error).message;}finally{previewButton.disabled=false;}

   })();});

   const manageActions=document.createElement('span');manageActions.className='askbics-calculation-card-actions';summary.append(manageActions);

   manageActions.onclick=e=>e.stopPropagation();

   const handle=document.createElement('button');handle.type='button';settingsActionIcon(handle,'grip','Reorder '+m.name+'; drag or use Up and Down arrow keys');manageActions.append(handle);

   const move=(target:number)=>{if(target<0||target>=g.measures.length||target===index)return;g.measures.splice(target,0,g.measures.splice(index,1)[0]);render();editor.querySelector<HTMLButtonElement>('.askbics-calculation-compact-list [data-calculation-index="'+target+'"] .is-drag-handle')?.focus();status.textContent=m.name+' moved to position '+(target+1)+'.';};

   handle.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();e.stopPropagation();move(index+(e.key==='ArrowUp'?-1:1));}};

   let target=index,dragging=false,startY=0;
   const finish=()=>{dragging=false;row.classList.remove('is-dragging');row.style.removeProperty('transform');editor.querySelectorAll('.is-drop-target').forEach(n=>n.classList.remove('is-drop-target'));};
   handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();handle.focus();dragging=true;target=index;startY=e.clientY;row.classList.add('is-dragging');handle.setPointerCapture(e.pointerId);};
   handle.onpointermove=e=>{if(!dragging)return;e.preventDefault();row.style.transform='translateY('+(e.clientY-startY)+'px)';const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLTableRowElement>('tr[data-calculation-index]');if(hit&&tableBody.contains(hit)&&hit!==row){target=Number(hit.dataset.calculationIndex);editor.querySelectorAll('.is-drop-target').forEach(n=>n.classList.remove('is-drop-target'));hit.classList.add('is-drop-target');hit.classList.toggle('is-drop-before',target<index);}else if(Math.abs(e.clientY-startY)<4){target=index;editor.querySelectorAll('.is-drop-target').forEach(n=>n.classList.remove('is-drop-target'));}};
   handle.onpointerup=e=>{if(!dragging)return;const destination=target;finish();if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);move(destination);};handle.onpointercancel=finish;handle.onlostpointercapture=finish;

   const duplicate=action(manageActions,'Duplicate',()=>{const copy={...structuredClone(m),id:id(),name:m.name+' copy'};g.measures.splice(index+1,0,copy);selectedCalculation=copy.id;render();});settingsMenuAction(duplicate,'duplicate','Duplicate','Duplicate calculation');

   const remove=action(manageActions,'Delete calculation',()=>{if(groups.some(x=>x.measures.some(other=>other!==m&&[other.formula,other.totalFormula||''].filter(Boolean).some(s=>calculationReferences(s).some(n=>n.toLowerCase()===m.name.toLowerCase())))))throw new Error('Another formula depends on '+m.name+'. Remove that reference first.');if(pendingDelete!==m.id){pendingDelete=m.id;status.textContent='Click Delete calculation again to confirm deletion of '+m.name+'.';return;}g.measures.splice(index,1);selectedCalculation=undefined;render();});settingsMenuAction(remove,'delete','Delete','Delete calculation');

   const row=document.createElement('tr');row.dataset.calculationIndex=String(index);row.dataset.search=(m.name+' '+m.formula+' '+m.description).toLocaleLowerCase();

   const nameCell=row.insertCell(),nameLine=document.createElement('div');nameLine.className='askbics-calculation-kpi-name';nameCell.append(nameLine);const name=document.createElement('strong');name.textContent=m.name;name.title=m.formula;const nameText=document.createElement('div');nameText.className='askbics-calculation-kpi-text';nameText.append(name);const formulaSummary=document.createElement('div');formulaSummary.className='askbics-calculation-kpi-formula';formulaSummary.textContent=m.formula.trim()?m.formula.replace(/\s+/g,' ').trim():'No formula yet';formulaSummary.dataset.tooltip=m.formula;formulaSummary.tabIndex=0;nameText.append(formulaSummary);nameLine.append(handle,nameText);
   const optionsCell=row.insertCell();optionsCell.className='askbics-calculation-kpi-options';const optionsButton=action(optionsCell,'Options for '+m.name,()=>{selectedCalculation=m.id;openOptionsFor=m.id;render();});settingsActionIcon(optionsButton,'sliders','Options for '+m.name);optionsButton.title='Edit format, totals and default overrides for '+m.name;
   const statusCell=row.insertCell(),badge=document.createElement('span');badge.className='askbics-calculation-kpi-status';badge.textContent=!m.formula.trim()?'Draft':m.enabled?'Defined':'Disabled';badge.classList.toggle('is-defined',!!m.formula.trim()&&m.enabled);statusCell.append(badge);
   const rowActions=row.insertCell();rowActions.className='askbics-calculation-kpi-actions';row.classList.toggle('is-selected',selectedCalculation===m.id);const edit=action(rowActions,'Edit '+m.name,()=>{selectedCalculation=m.id;render();});settingsActionIcon(edit,'edit','Edit '+m.name);tableBody.append(row);
   const rename=action(manageActions,'Rename KPI',()=>{manageActions.hidden=true;calcMenu.setAttribute('aria-expanded','false');const field=document.createElement('input');field.setAttribute('aria-label','Rename '+m.name);field.value=m.name;name.replaceWith(field);field.focus();field.select();field.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();render();}if(e.key==='Enter'){e.preventDefault();try{const next=field.value.trim();checkName(next,m);const mapping=new Map([[m.name,next]]);const changes=groups.flatMap(group=>group.measures).map(item=>({item,formula:item.formula.trim()?remapCalculation(item.formula,mapping):'',totalFormula:item.totalFormula?.trim()?remapCalculation(item.totalFormula,mapping):item.totalFormula}));changes.forEach(change=>{change.item.formula=change.formula;change.item.totalFormula=change.totalFormula;});m.name=next;render();}catch(error){status.textContent=(error as Error).message;}}};});settingsMenuAction(rename,'rename','Rename','Rename KPI');rename.title='Rename this KPI and update its formula dependencies. Press Enter to apply or Escape to cancel.';manageActions.append(duplicate,rename,remove);

   summary.hidden=true;

   const calcHead=document.createElement('div');calcHead.className='askbics-calculation-heading';const back=action(calcHead,'Calculations',()=>{selectedCalculation=undefined;render();});settingsMenuAction(back,'back','Back','Back to '+g.name);back.classList.add('askbics-calculation-back');const breadcrumb=document.createElement('strong');breadcrumb.textContent=g.name+' › '+m.name;calcHead.append(breadcrumb);const calcMenu=action(calcHead,'Calculation actions',()=>{manageActions.hidden=!manageActions.hidden;calcMenu.setAttribute('aria-expanded',String(!manageActions.hidden));});settingsActionIcon(calcMenu,'more','Calculation actions');calcMenu.setAttribute('aria-expanded','false');manageActions.hidden=true;manageActions.className='askbics-qna__period-menu askbics-calculation-group-menu';calcHead.append(manageActions);manageActions.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();manageActions.hidden=true;calcMenu.setAttribute('aria-expanded','false');calcMenu.focus();}};calcHead.addEventListener('focusout',e=>{if(e.relatedTarget instanceof Node&&!calcHead.contains(e.relatedTarget)){manageActions.hidden=true;calcMenu.setAttribute('aria-expanded','false');}});details.prepend(calcHead);

   if(selectedCalculation!==m.id){row.classList.add('askbics-calculation-list-row');rowActions.append(calcMenu,manageActions);calcMenu.setAttribute('aria-label','Actions for '+m.name);row.addEventListener('focusout',e=>{if(e.relatedTarget instanceof Node&&!row.contains(e.relatedTarget)){manageActions.hidden=true;calcMenu.setAttribute('aria-expanded','false');}});}



   const primary=document.createElement('div');body.append(primary);const advanced=fold(body,'Options');advanced.classList.add('askbics-calculation-advanced');const formats=document.createElement('div');formats.className='askbics-calculation-fields';advanced.append(formats);if(openOptionsFor===m.id){advanced.open=true;openOptionsFor=undefined;queueMicrotask(()=>{if(advanced.isConnected){advanced.scrollIntoView({block:'nearest'});advanced.querySelector('summary')?.focus({preventScroll:true});}});}const pages=[primary,formats,formats];

   // Keep controls mounted when switching tabs, preserving editor undo and preview drafts.



   const labelFor=(name:string)=>Array.from(body.querySelectorAll<HTMLInputElement>('input,select,textarea')).find(e=>e.getAttribute('aria-label')===name)?.closest('label');

   for(const name of ['Output format','Decimal places','Grand Total behavior','Measure override','Field override','Calculation description','Custom total formula']){const label=labelFor(name);if(label){if(['Grand Total behavior','Calculation description','Custom total formula'].includes(name))label.classList.add('is-wide');formats.append(label);}}

   const controls=document.createElement('div');controls.className='askbics-calculation-actions askbics-calculation-formula-actions';code.before(controls);

   for(const button of Array.from(body.children).filter(e=>e.tagName==='BUTTON')){if(['Format formula','Validate'].includes(button.textContent||'')){controls.append(button);if(button.textContent==='Format formula'){button.textContent='Format';button.setAttribute('aria-label','Format formula');button.setAttribute('data-settings-help','Format indentation and spacing without changing the formula.');}}}

   const context=labelFor('Preview context');const previewOptions=fold(body,'Preview');previewOptions.classList.add('askbics-calculation-preview-options');if(context)previewOptions.append(context);previewOptions.append(previewButton,previewOutput);previewButton.textContent='Run preview';previewButton.setAttribute('aria-label','Run preview');previewButton.dataset.settingsHelp='Validate and evaluate the draft formula using the optional question context and accessible model data.';

   const inherited=document.createElement('p');inherited.className='askbics-calculation-defaults';inherited.textContent='Using: '+(m.defaultMeasure||g.defaultMeasure||'No default measure')+' · '+(m.defaultField||g.defaultField||'No default field');code.before(inherited);

   Array.from(body.children).filter(child=>child!==pages[0]&&child!==pages[1]&&child!==pages[2]&&child!==advanced&&child.getAttribute('role')!=='tablist').forEach(child=>pages[0].append(child));

   previewOutput.hidden=!previewOutput.textContent;

   const doneBar=document.createElement('div');doneBar.className='askbics-calculation-done';const done=action(doneBar,'Done',()=>{if(activateOnDone&&m.formula.trim()){const enabled=m.enabled;m.enabled=true;try{validateCalculationGroups(groups,measures,fields);}catch(error){m.enabled=enabled;throw error;}}selectedCalculation=undefined;render();});done.title='Return to the group with your draft. Save settings applies all changes.';details.append(doneBar);

  });updateEmpty();disposeHelp=installSettingsHelp(editor);

  if(newGroup){const name=editor.querySelector<HTMLInputElement>('input[aria-label="Group name"]');name?.focus();name?.select();}

 };

 search.oninput=()=>render();render();return {element,read:()=>structuredClone(groups),validate:()=>{try{validateCalculationGroups(groups,measures,fields);return true;}catch(e){status.textContent=(e as Error).message;return false;}}};

}

