import {cashFlowPanels} from './cashFlowPanels';
import {cashFlowScope} from './cashFlowScope';
import {settingsSelect} from './settingsSelect';
import { visualBuild } from '../buildInfo';
import {loadCashLinks} from '../cashFlowLoad';
import { installSettingsHelp } from './settingsHelp';
import { settingsMultiSelect } from './settingsMultiSelect';
import { cashFlowResults } from './cashFlowResults';
import { cashDescriptionField, identifiedBankPostings } from '../cashFlowStarts';
import { cashKey, CashPosting, CashResult, CashSetup, cashFields, traceCashResumable, CashCheckpoint, validateCashSetup } from '../cashFlow';
import { cashPostings, cashQuestion, cashValuesQuestion } from '../cashFlowQuery';
import { QnaResponse, QnaTable } from './types';

export function cashFlowWorkspace(root:HTMLElement,current:CashSetup|undefined,fields:string[],measures:string[],load:(q:string)=>Promise<QnaResponse|undefined>,save:(s:CashSetup)=>void,cancel:()=>void,render:(t:QnaTable,title:string)=>HTMLElement) {
 root.dispatchEvent(new CustomEvent('askbics-transaction-navigation',{detail:true}));
 const opener=document.activeElement as HTMLElement|null;
 const overlay=document.createElement('div');overlay.className='askbics-cash-overlay';
 const panel=document.createElement('section');panel.className='askbics-cash-workspace';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Cash flow');
 const head=document.createElement('header'),title=document.createElement('strong');title.textContent='Cash flow';
 const button=(label:string,fn:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=fn;return b;};
 let abandonContinuation=()=>{};let disposeHelp=()=>{};let revision=0,closed=false;const dismiss=()=>{disposeHelp();closed=true;++revision;abandonContinuation();cancel();root.removeEventListener('askbics-transaction-invalidate',invalidate);overlay.remove();root.dispatchEvent(new CustomEvent('askbics-transaction-navigation',{detail:false}));opener?.focus({preventScroll:true});};
 const close=button('Back',dismiss);head.append(close,title);panel.append(head);
 const body=document.createElement('div');body.className='askbics-cash-body';panel.append(body);overlay.append(panel);root.append(overlay);
 const note=document.createElement('p');note.textContent='Connect bank postings to their destinations through documents and clearing references. Debit amounts are positive; credits are negative. Existing model and security filters still apply.';body.append(note);
 const setup=document.createElement('details');setup.open=!current;const setupTitle=document.createElement('summary');setupTitle.textContent='Setup · document flow';setup.append(setupTitle);body.append(setup);
 const mapping=document.createElement('div');mapping.className='askbics-cash-grid';setup.append(mapping);
 const select=(label:string,options:string[],value:string,parent:HTMLElement)=>{const wrap=document.createElement('label');wrap.textContent=label;const s=document.createElement('select');s.setAttribute('aria-label',label);for(const name of ['',...options]){const o=document.createElement('option');o.value=name;o.textContent=name||'Choose…';s.append(o);}s.value=value;wrap.append(s);parent.append(wrap);return s;};
 const mapped:Record<string,HTMLSelectElement>={};for(const key of ['company','document','clearing']){const field=cashFields.find(f=>f[0]===key)!;mapped[key]=select(field[1]+' *',fields,current?.fields[key]||'',mapping);}
 const measure=select('Signed posting amount *',measures,current?.measure||'',mapping);
 const advanced=document.createElement('details'),advancedTitle=document.createElement('summary');advancedTitle.textContent='Advanced · years, currency, dates and references';advanced.append(advancedTitle);setup.append(advanced);
 const advancedHelp=document.createElement('p');advancedHelp.textContent='Map years when document numbers repeat across years, currency for mixed currencies, and line item when postings could otherwise merge. Posting date enables period reporting; clearing date establishes the historical cutoff. Without these mappings, use a single-currency source with unique document numbers and distinct posting groups.';advanced.append(advancedHelp);
 const advancedGrid=document.createElement('div');advancedGrid.className='askbics-cash-grid';advanced.append(advancedGrid);
 for(const [key,label] of cashFields)if(!mapped[key])mapped[key]=select(key==='currency'?'Currency field':label,fields,current?.fields[key]||'',advancedGrid);
 if(!mapped.accountDescription.value)mapped.accountDescription.value=cashDescriptionField(fields,Object.values(current?.fields||{}));
 const mappingRefresh=new Map<HTMLSelectElement,()=>void>();
 for(const control of [...Object.values(mapped),measure])mappingRefresh.set(control,settingsSelect(control));
 const bankHint=document.createElement('p');bankHint.textContent='Automatic start uses an Account description of Bank, Cash, Bank account or Cash account (case insensitive), or your configured bank account codes. Explicit starting filters automatically trace all matching nonzero postings; no separate bank selection is needed. Configured bank codes still apply as additional query restrictions. Without starting filters or configured bank codes, other labels require a manual starting posting. Add Account description to the visual’s grouping field parameter if it is not available here.';advanced.append(bankHint);
 mapped.accountDescription.dataset.settingsHelp=bankHint.textContent;
 const input=(label:string,type:string,value:string,parent:HTMLElement)=>{const wrap=document.createElement('label');wrap.textContent=label;const i=document.createElement('input');i.type=type;i.value=value;i.setAttribute('aria-label',label);wrap.append(i);parent.append(wrap);return i;};
 let displayColumns=current?.displayColumns||[mapped.document.value,mapped.accountDescription.value||mapped.account.value,measure.value].filter(Boolean);
 const read=():CashSetup=>({fields:Object.fromEntries(Object.entries(mapped).map(([key,s])=>[key,s.value])),measure:measure.value,rules:current?.rules||[],scope:{...scope.read(),from:mapped.date.value?from.value:undefined,to:mapped.date.value?to.value:undefined},displayColumns:displayColumns?.length?displayColumns:[mapped.document.value,mapped.accountDescription.value||mapped.account.value,measure.value].filter(Boolean)}); const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 setup.append(button('Validate and save setup',()=>{try{const s=read();validateCashSetup(s,fields,measures);save(s);status.textContent='Setup saved. Choose company, then Show cash flow.';setup.open=false;}catch(e){status.textContent=(e as Error).message;}}));
 const columnPicker=settingsMultiSelect('Starting-posting columns (maximum 10)',displayColumns||[],values=>{if(values.length>10){status.textContent='Choose at most 10 source columns.';columnPicker.reset(displayColumns||[]);return;}displayColumns=values;},async()=>[...fields,measure.value].filter(Boolean),'Choose columns…',{max:10,allowCustom:false});const columnLabel=document.createElement('div');columnLabel.textContent='Starting-posting columns (maximum 10)';setup.append(columnLabel,columnPicker.element);columnLabel.dataset.settingsHelp='Choose up to 10 fields from the starting posting, including at least one field. Destination account, Destination description, Destination amount and Details are added automatically. Hidden tracing fields are still loaded. Save and Show cash flow to apply.';

 const controls=document.createElement('div');controls.className='askbics-cash-grid';body.append(controls);
 let refreshScope=()=>{};
 const scope=cashFlowScope(fields,mapped.company.value,current?.scope,async(field,companyField,companies)=>{if(!field)return [];if(run.disabled)invalidate();const response=await load(cashValuesQuestion(field,companyField,companies));return response?.table?.rows.slice(0,200).map(row=>String(row[0]))||[];},()=>{mapped.company.value=scope.companyField();mappingRefresh.get(mapped.company)?.();invalidate();refreshScope();});controls.before(scope.element);
 const company={get value(){return scope.read().companies.join(', ');}};
 const currency=input('Currency','text','',controls);
 const today=new Date().toISOString().slice(0,10),from=input('From','date',current?.scope?.from||today.slice(0,8)+'01',controls),to=input('Through / as of','date',current?.scope?.to||today,controls);
 const banks=input('Starting bank accounts (optional, comma separated)','text',(current?.rules||[]).filter(r=>r.role==='bank').map(r=>r.account).join(','),controls);banks.placeholder='Or select a starting posting after loading';
 const start=select('Starting posting',[],'',controls);start.parentElement!.hidden=true;let startQuery='';
 const scopeNote=document.createElement('p');body.append(scopeNote);
 const updateScope=()=>{banks.parentElement!.hidden=!mapped.account.value;currency.parentElement!.hidden=!mapped.currency.value;from.parentElement!.hidden=to.parentElement!.hidden=!mapped.date.value;scopeNote.textContent=[!mapped.date.value?'All available postings; no reporting-period or historical cutoff.':'Period selects bank postings; linked documents may be older.',!mapped.currency.value?'Amounts use the source currency; do not combine currencies.':'',!mapped.year.value?'Document numbers must be unique across years in this source.':'',!mapped.item.value?'Rows are grouped by the mapped fields. Add Line item if distinct postings could merge.':''].filter(Boolean).join(' ');};
 for(const s of Object.values(mapped))s.addEventListener('change',updateScope);updateScope();
 const actions=document.createElement('div');actions.className='askbics-cash-actions';body.append(actions,status);
 const options=document.createElement('details');options.className='askbics-cash-options';options.open=true;const optionsTitle=document.createElement('summary');optionsTitle.textContent='Trace options';options.append(optionsTitle);while(body.firstChild)options.append(body.firstChild);body.append(options);disposeHelp=installSettingsHelp(options);
 const results=document.createElement('div');body.append(results);
 const secondary=cashFlowPanels(panel,head,body);
 const setupAction=button('Setup',()=>openSetup());setupAction.className='askbics-settings-action';head.append(setupAction);
 setupAction.dataset.settingsHelp='Configure field mappings once. Existing company values and filters remain unless their mapped field changes.';

 // Locate by caption: mapping pickers also contain buttons.
 const saveAction=Array.from(setup.querySelectorAll('button')).find(b=>b.textContent==='Validate and save setup')!;
 saveAction.textContent='Save setup';
 const setupMessage=document.createElement('p');setupMessage.setAttribute('role','status');setup.append(setupMessage);
 saveAction.onclick=()=>{try{const s=read();validateCashSetup(s,fields,measures);save(s);setupMessage.textContent='';setupAction.textContent='Setup · ✓ Configured';secondary.hide();status.textContent='Setup saved. Choose company and starting filters, then Show cash flow.';}catch(e){setupMessage.textContent=(e as Error).message;}};
 const tabBar=document.createElement('div');tabBar.className='askbics-settings-tabs';tabBar.setAttribute('role','tablist');tabBar.setAttribute('aria-label','Cash-flow setup sections');
 const sections=[mapping,document.createElement('div'),document.createElement('div')];sections.slice(1).forEach(e=>e.className='askbics-cash-grid');
 for(const [key,control] of Object.entries(mapped)){const i=['company','document','clearing','account','accountDescription'].includes(key)?0:['year','item','currency','date'].includes(key)?1:2;sections[i].append(control.parentElement!);}
 sections[0].append(measure.parentElement!);advanced.remove();setupTitle.hidden=true;setup.open=true;
 const tabButtons:HTMLButtonElement[]=[];
 ['Basic mappings','Identity & dates','Clearing & references'].forEach((label,i)=>{const b=button(label,()=>{sections.forEach((s,j)=>s.hidden=i!==j);tabButtons.forEach((t,j)=>{t.setAttribute('aria-selected',String(i===j));t.tabIndex=i===j?0:-1;});});b.setAttribute('role','tab');b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const j=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;tabButtons[j].click();tabButtons[j].focus();}};tabButtons.push(b);tabBar.append(b);sections[i].setAttribute('role','tabpanel');sections[i].setAttribute('aria-label',label);});
 setup.prepend(tabBar);setup.append(...sections,setupMessage,saveAction);tabButtons[0].click();const disposeOptionsHelp=disposeHelp;const disposeSetupHelp=installSettingsHelp(setup);disposeHelp=()=>{disposeOptionsHelp();disposeSetupHelp();};
 for(const key of ['year','item','currency','date'])mapped[key].parentElement!.dataset.settingsHelp=advancedHelp.textContent!;
 const openSetup=()=>{setup.hidden=false;setup.open=true;secondary.show('Cash-flow setup',setup,saveAction);};
 setup.hidden=true;
 const columnContent=document.createElement('div');columnContent.append(columnLabel,columnPicker.element);columnContent.hidden=true;body.append(columnContent);
 const saveColumns=button('Save columns',()=>{try{const s=read();validateCashSetup(s,fields,measures);save(s);secondary.hide();status.textContent='Columns saved. Show cash flow to apply.';}catch(e){status.textContent=(e as Error).message;}});columnContent.append(saveColumns);const openColumns=()=>{columnContent.hidden=false;secondary.show('Cash-flow columns',columnContent,saveColumns);};
 const columnsAction=button('Columns',openColumns);columnsAction.className='askbics-settings-action';head.append(columnsAction);
 // Keep only everyday controls on the main screen.
 optionsTitle.hidden=true;note.hidden=true;scope.element.querySelector('h4')!.hidden=true;scope.element.querySelector('label')!.hidden=true;
 const scopeHelp=scope.element.querySelector<HTMLElement>('.askbics-qna__settings-note');if(scopeHelp){scopeHelp.hidden=true;scope.element.dataset.settingsHelp=scopeHelp.textContent||'';}
 const filterHelp=scope.element.querySelector<HTMLElement>('.askbics-kpi-filters > p');if(filterHelp){filterHelp.hidden=true;scope.element.querySelector<HTMLElement>('.askbics-kpi-filters > h4')!.dataset.settingsHelp=filterHelp.textContent||'';}
 scopeNote.hidden=true;controls.dataset.settingsHelp=scopeNote.textContent||''; const filterEditor=scope.element.querySelector<HTMLElement>('.askbics-kpi-filters')!;
 const filterSummary=document.createElement('div');filterSummary.className='askbics-cash-chips';filterEditor.before(filterSummary);
 let editingFilters=false;
 const finishFilters=button('Done',()=>{try{scope.validate();editingFilters=false;refreshScope();}catch(e){status.textContent=(e as Error).message;}});filterEditor.append(finishFilters);
 refreshScope=()=>{const rules=scope.read().filters;filterSummary.replaceChildren();for(const [i,rule] of rules.entries()){const chip=button(rule.field+': '+rule.values.join(', ')+' ×',()=>scope.setFilters(rules.filter((_,j)=>j!==i)));chip.setAttribute('aria-label','Remove starting filter '+rule.field);filterSummary.append(chip);}filterSummary.append(button('Add filter',()=>{editingFilters=true;filterEditor.hidden=false;filterEditor.querySelector<HTMLButtonElement>(':scope > button')!.click();}),button('Edit filters',()=>{editingFilters=true;refreshScope();}));filterEditor.hidden=!editingFilters;};refreshScope();
 try{validateCashSetup(read(),fields,measures);setupAction.textContent='Setup · ✓ Configured';}catch(error){setupMessage.textContent=(error as Error).message;queueMicrotask(openSetup);}
 const checkpoints:CashCheckpoint[]=[];const loadingLimits=new Set<string>();const requests:object[]=[];let diagnosticError='',diagnosticSetup:CashSetup|undefined;
 const diagnostics=document.createElement('details');diagnostics.className='askbics-settings-disclosure';
 const diagnosticTitle=document.createElement('summary');diagnosticTitle.textContent='Cash-flow troubleshooting';
 const diagnosticHelp=document.createElement('p');diagnosticHelp.textContent='Copy mappings, scope, requests, returned DAX and error details for this run. No extra queries run. Includes filter values and conflicting amounts: review before sharing. If the host does not return DAX, attach Performance Analyzer queries separately.';
 const diagnosticText=document.createElement('textarea');diagnosticText.readOnly=true;diagnosticText.rows=12;diagnosticText.setAttribute('aria-label','Cash-flow diagnostic report');diagnosticText.style.cssText='width:100%;box-sizing:border-box;font:12px/1.5 monospace';
 const report=()=>JSON.stringify({kind:'askBICS cash-flow diagnostics',build:visualBuild,setup:diagnosticSetup,error:diagnosticError,status:status.textContent,requests,checkpoints,loadingLimits:[...loadingLimits],note:'Session only. Cached results may have no query record. Not a full ledger export.'},null,2);
 const copyStatus=document.createElement('p');copyStatus.setAttribute('role','status');
 const copyReport=button('Copy troubleshooting report',()=>{diagnosticText.value=report();void(async()=>{try{await navigator.clipboard.writeText(diagnosticText.value);copyStatus.textContent='Report copied.';}catch{diagnosticText.focus();diagnosticText.select();copyStatus.textContent='Press Ctrl+C to copy the selected report.';}})();});copyReport.className='askbics-settings-action';copyReport.dataset.settingsHelp=diagnosticHelp.textContent;
 diagnostics.append(diagnosticTitle,diagnosticHelp,copyReport,diagnosticText,copyStatus);body.append(diagnostics);diagnostics.hidden=true;const troubleshoot=button('Troubleshooting',()=>{diagnostics.hidden=false;diagnostics.open=true;diagnosticTitle.hidden=true;diagnosticText.value=report();secondary.show('Cash-flow troubleshooting',diagnostics);});troubleshoot.className='askbics-settings-action';head.append(troubleshoot);diagnostics.addEventListener('toggle',()=>{if(diagnostics.open)diagnosticText.value=report();});
  let cached:{key:string;rows:CashPosting[];complete:boolean}|undefined;
 const queryCache=new Map<string,{rows:CashPosting[];complete:boolean}>();let queriedRows=0,queryCount=0;
 const invalidate=()=>{try{validateCashSetup(read(),fields,measures);setupAction.textContent='Setup · ✓ Configured';}catch{setupAction.textContent='Setup · Needs attention';}panel.querySelector<HTMLButtonElement>('.askbics-cash-entries header button')?.click();cached=undefined;queryCache.clear();queriedRows=0;queryCount=0;++revision;abandonContinuation();loading.hidden=stop.hidden=true;cancel();results.replaceChildren();status.textContent='Model data changed. Show cash flow again to refresh.';run.disabled=false;options.open=true;};root.addEventListener('askbics-transaction-invalidate',invalidate);
 for(const control of [currency,from,to,banks,measure,...Object.values(mapped)])control.addEventListener('change',()=>{scope.setCompany(mapped.company.value);invalidate();});
 const format=(n:number)=>n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
 const run=button('Show cash flow',()=>void refresh(false)),reload=button('Refresh data',()=>void refresh(true));actions.append(run,reload);
 const loading=document.createElement('div');loading.className='askbics-cash-loading askbics-analysis-loading__card';loading.hidden=true;loading.setAttribute('role','status');loading.setAttribute('aria-live','polite');
 const spinner=document.createElement('span');spinner.className='askbics-analysis-loading__spinner';spinner.setAttribute('aria-hidden','true');
 const loadingCopy=document.createElement('span');loadingCopy.className='askbics-analysis-loading__copy';const loadingTitle=document.createElement('strong');loadingTitle.textContent='Tracing cash flow…';const loadingStage=document.createElement('span');loadingStage.className='askbics-analysis-loading__stage';loadingCopy.append(loadingTitle,loadingStage);loading.append(spinner,loadingCopy);panel.append(loading);
 const stop=button('Stop tracing',()=>{++revision;abandonContinuation();cancel();loading.hidden=stop.hidden=true;run.disabled=false;status.textContent='Tracing stopped. No complete result was calculated. Show cash flow starts a new run.';});stop.hidden=true;actions.append(stop);
 loading.dataset.settingsHelp='Loading and tracing continue automatically in bounded batches. Stop tracing or change scope to cancel. Missing data and safety limits remain unresolved.';
 const pause=async(checkpoint:CashCheckpoint,request:number)=>{
  if(closed||request!==revision)throw new Error('Cash-flow request cancelled.');
  if(checkpoints.length<1000)checkpoints.push(checkpoint);
  const progress=(checkpoint.phase==='loading'?'Loading linked documents':'Tracing allocations')+' · Batch '+(checkpoints.length+1)+' · Company '+checkpoint.company+(checkpoint.depth!==undefined?' · Depth/round '+checkpoint.depth:'');
  status.textContent=progress+'. Continuing automatically…';loadingStage.textContent=progress;
  // Yield to paint/input between batches; keep the frontier and allocation state intact.
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{abandonContinuation=()=>{};resolve();},32);abandonContinuation=()=>{clearTimeout(timer);loading.hidden=stop.hidden=true;abandonContinuation=()=>{};reject(new Error('Cash-flow request cancelled.'));};});
  if(closed||request!==revision)throw new Error('Cash-flow request cancelled.');
 };

 async function refresh(force:boolean){abandonContinuation();checkpoints.length=0;loadingLimits.clear();requests.length=0;diagnosticError='';diagnosticSetup=undefined;const request=++revision;cancel();results.replaceChildren();run.disabled=true;stop.hidden=false;loading.hidden=false;loadingStage.textContent='Loading starting postings · Batch 1';status.textContent='Loading posting data…';options.open=true;
  try{
   if(force){cached=undefined;queryCache.clear();queriedRows=0;queryCount=0;}scope.validate();
   const s=read();diagnosticSetup=s;validateCashSetup(s,fields,measures);if(!company.value.trim()||(s.fields.currency&&!currency.value.trim())||(s.fields.date&&(!from.value||!to.value||from.value>to.value)))throw new Error('Choose company and the currency/reporting period enabled by your mappings.');
   const currencyLabel=s.fields.currency?currency.value.trim():'',periodLabel=s.fields.date?`${from.value} to ${to.value}`:'All available postings';
   const selectedBanks=s.fields.account?banks.value.split(',').map(v=>v.trim()).filter(Boolean):[];
   const selectedCompanies=scope.read().companies;
   const rootQuestions=selectedCompanies.map(code=>cashQuestion(s,code,{phase:'starts',filters:s.scope!.filters,from:s.fields.date?from.value:undefined,to:s.fields.date?to.value:undefined,currency:currencyLabel,banks:selectedBanks}));
   const q=JSON.stringify(rootQuestions),selectionKey=q;
   let queryBudget=queryCount+100,rowBudget=queriedRows+20000;
   const continuation={active:()=>!closed&&request===revision,pause:(checkpoint:CashCheckpoint)=>pause(checkpoint,request)};
   const fetchRows=async(question:string)=>{if(closed||request!==revision)throw new Error('Cash-flow request cancelled.');const hit=queryCache.get(question);if(hit)return hit;if(queryCount>=1000||queriedRows>=100000){loadingLimits.add('Run safety limit reached: 1000 queries or 100000 returned rows. Narrow the starting scope.');return {rows:[],complete:false};}if(queryCount>=queryBudget||queriedRows+5000>rowBudget){const details=JSON.parse(decodeURIComponent(question.slice(';cashflow:'.length)));await pause({phase:'loading',reason:queryCount>=queryBudget?'Run query batch reached (100 queries)':'Run row batch reached (20000 returned rows)',company:details.company,queries:queryCount,rows:queriedRows},request);queryBudget=queryCount+100;rowBudget=Math.min(100000,queriedRows+20000);}queryCount++;const entry:any={request:JSON.parse(decodeURIComponent(question.slice(';cashflow:'.length))),started:new Date().toISOString()};if(requests.length<1000)requests.push(entry);const started=Date.now();let answer:QnaResponse|undefined;try{answer=await load(question);entry.daxQueries=answer?.daxQueries||[];entry.rows=answer?.table?.rows.length;entry.complete=answer?.table?.modelResultComplete;}catch(error){entry.error=(error as Error).message;throw error;}finally{entry.durationMs=Date.now()-started;}if(closed||request!==revision)throw new Error('Cash-flow request cancelled.');if(!answer?.table)throw new Error(answer?.text||'No posting table returned.');const all=cashPostings(answer.table,s);const rows=all.slice(0,Math.min(5000,100000-queriedRows));queriedRows+=rows.length;const response={rows,complete:answer.table.modelResultComplete===true&&rows.length===all.length};if(!response.complete)loadingLimits.add('A model response was incomplete or capped (5000 rows per response). Continuation cannot recover rows omitted by that response; narrow the scope.');queryCache.set(question,response);return response;};
   if(!cached||cached.key!==q){const rows:CashPosting[]=[];let complete=true;for(const question of rootQuestions){status.textContent='Loading scoped starting postings…';const response=await fetchRows(question);rows.push(...response.rows);complete=complete&&response.complete;}startQuery='';cached={key:q,rows,complete};}
   if(closed||request!==revision)return;
   const eligible=cached.rows.filter(p=>selectedCompanies.includes(p.company)&&p.currency===currencyLabel&&(!s.fields.date||(p.date>=from.value&&p.date<=to.value))&&p.amount!==0);   const explicitStarts=!!s.scope?.filters.length;const identified=explicitStarts?eligible:identifiedBankPostings(eligible,selectedBanks);
   if(!eligible.length)throw new Error(cached.complete?'No starting postings match the selected scope.':'Incomplete trace: narrow the company, starting filters or period.');
   if(selectedBanks.length&&!identified.length)throw new Error('No postings match the configured bank accounts in this scope.');
   const candidates=identified.length?identified:eligible;
   start.parentElement!.hidden=explicitStarts||identified.length===1;
   if(!explicitStarts&&startQuery!==selectionKey){start.replaceChildren();const blank=document.createElement('option');blank.value=identified.length?'all':'';blank.textContent=identified.length?'All bank postings':'Choose the bank posting to trace…';start.append(blank);
    for(const p of candidates){const option=document.createElement('option');option.value=cashKey(p);option.textContent=[p.company,p.year,p.document,p.item.startsWith('group:')?'':p.item,p.accountDescription||p.account,format(p.amount)].filter(Boolean).join(' · ');start.append(option);}startQuery=selectionKey;
   }
   if(!explicitStarts&&!start.value){status.textContent=s.fields.accountDescription||s.fields.account?'No bank label was identified. Configure bank account codes or choose the starting posting.':'Bank identification is unavailable: add Account description to the visual’s grouping field parameter, then reopen Cash flow, or choose the starting posting manually.';start.focus();return;}
   const startKeys=explicitStarts||start.value==='all'?identified.map(cashKey):[start.value];
   const result:CashResult={allocations:[],receipts:0,payments:0,unresolved:0,roots:0,complete:cached.complete};
   const loadedRows:CashPosting[]=[];const startSet=new Set(startKeys);
   for(const code of selectedCompanies){const roots=eligible.filter(p=>p.company===code&&startSet.has(cashKey(p)));if(!roots.length)continue;const linked=await loadCashLinks(s,code,currencyLabel,roots,fetchRows,()=>!closed&&request===revision,text=>status.textContent=text,continuation);if(linked.reason)loadingLimits.add(linked.reason);loadedRows.push(...linked.rows);const part=await traceCashResumable(linked.rows,s.rules,{company:code,currency:currencyLabel,from:from.value,to:to.value,allDates:!s.fields.date,startKeys:roots.map(cashKey),complete:cached.complete&&linked.complete},continuation);result.allocations.push(...part.allocations);result.receipts+=part.receipts;result.payments+=part.payments;result.unresolved+=part.unresolved;result.roots+=part.roots;result.complete=result.complete&&part.complete;}
   if(closed||request!==revision)return;save(s);setup.open=false;   status.textContent=(result.complete?'Loaded model result complete within the current source filters. ':'Incomplete trace: a row, batch, or source limit was reached. Narrow the starting scope; totals cover loaded rows only. ')+`${result.roots} bank postings. `+(result.unresolved?'Some amounts need investigation.':'All loaded bank amounts classified.');
   if(loadingLimits.size)status.textContent+=' '+[...loadingLimits].join(' ');
   if(explicitStarts)status.textContent+=' Starting postings selected automatically from your cash-flow filters.';
   else if(identified.length===1)status.textContent+=` Starting bank selected automatically: Document ${identified[0].document} · ${format(identified[0].amount)}.`;
   options.open=true;body.scrollTop=0;
   const filterPanel=document.createElement('details');filterPanel.className='askbics-cash-filters';const filterTitle=document.createElement('summary');filterTitle.textContent='Filter results';filterPanel.append(filterTitle);results.append(filterPanel);
   const filters=document.createElement('div');filters.className='askbics-cash-actions';filterPanel.append(filters);
   const categories=[...new Set(result.allocations.map(a=>a.category))].sort();const category=select('Category',categories,'',filters);category.options[0].textContent='All categories';
   const state=select('Trace status',[...new Set(result.allocations.map(a=>a.status))].sort(),'',filters);state.options[0].textContent='All statuses';
   const chips=document.createElement('div');chips.className='askbics-cash-chips';results.append(chips);
   const tableHost=document.createElement('div');results.append(tableHost);
   const paint=()=>{
    const visible=result.allocations.filter(a=>(!category.value||a.category===category.value)&&(!state.value||a.status===state.value));
    chips.replaceChildren();for(const [label,control] of [['Category',category],['Status',state]] as const)if(control.value){const chip=button(`${label}: ${control.value} ×`,()=>{control.value='';paint();});chip.setAttribute('aria-label','Remove '+label+' filter');chips.append(chip);}
    cashFlowResults(tableHost,result,visible,loadedRows,[ 'Cash flow',company.value,currencyLabel,periodLabel,...(s.scope?.filters||[]).map(f=>f.field+': '+f.values.join(', ')),category.value||'All categories',state.value||'All statuses',result.complete?'Loaded model scope':'Incomplete source data'].filter(Boolean).join(' · '),render,s,()=>{openColumns();columnPicker.element.querySelector('button')!.click();});
   };category.onchange=state.onchange=paint;paint();
  }catch(error){if(!closed&&request===revision){diagnosticError=(error as Error).message;status.textContent=diagnosticError;}}finally{if(!closed&&request===revision){run.disabled=false;loading.hidden=stop.hidden=true;abandonContinuation=()=>{};}}
 }
 overlay.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();dismiss();}if(e.key==='Tab'){const items=Array.from(panel.querySelectorAll<HTMLElement>('button,input,select,textarea,summary')).filter(el=>!(el as HTMLButtonElement).disabled&&el.getClientRects().length);if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus();}}};close.focus();
}
