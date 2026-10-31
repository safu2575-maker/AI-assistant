import { filterTransactionRows } from "./transactionLocal";
import { reuseTransactionSummary } from './transactionSummaryReuse';
import { summaryCardRows } from "./summaryCardRows";
import { QnaTable,QnaResponse,ModelSelection } from './types';
import { transactionQuestion, TransactionScope } from '../answerTransactions';
const summaryCache=new WeakMap<QnaTable,Map<string,Promise<QnaResponse|undefined>>>();
export async function transactionCards(host:HTMLElement,holder:HTMLElement,table:QnaTable,load:(q:string)=>Promise<QnaResponse|undefined>, selection?:{values:Map<string,Set<string>>;scopes?:TransactionScope[];baseTable?:QnaTable;signal?:AbortSignal;change:(publish:(result?:QnaTable)=>void)=>void}){
 const config=table.summaryCards;if(!config?.enabled||!config.cards.length||!table.drillScopes?.length)return;
 const details=document.createElement('details');details.open=true;details.className='askbics-summary-cards';const heading=document.createElement('summary');heading.textContent='Transaction summaries';details.append(heading);host.append(details);
 const clear=document.createElement('button');clear.type='button';clear.className='askbics-summary-clear';clear.textContent='Clear selection';clear.hidden=!selection?.values.size;heading.append(clear);
 const strip=document.createElement('div');strip.className='askbics-summary-strip';details.append(strip);
 const progress=document.createElement('div');progress.className='askbics-summary-loading';progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');
 const spinner=document.createElement('span');spinner.className='askbics-analysis-loading__spinner';spinner.setAttribute('aria-hidden','true');
 const progressText=document.createElement('span');progress.append(spinner,progressText);host.prepend(progress);host.setAttribute('aria-busy','true');
 let completed=0;let failed=0;
 const updateProgress=()=>{progressText.textContent=`Loading transaction summaries… ${completed} of ${config.cards.length} checked`;};updateProgress();
 const selected=selection?.values||new Map<string,Set<string>>();const buttons:Array<{button:HTMLButtonElement;field:string;key:string}>=[];
 const key=(v:unknown)=>JSON.stringify(v??null);
 const paint=()=>{
  clear.hidden=selected.size===0;
  buttons.forEach(b=>{b.button.setAttribute('aria-pressed',String(selected.get(b.field)?.has(b.key)||false));});
 }; const selectionTarget=holder.closest('.askbics-qna')||holder; const publish=(result:QnaTable=table)=>{const identities:ModelSelection[]=result.rows.flatMap((_,i)=>[...selected].every(([f,values])=>values.has(key(result.modelGroupValues?.[i]?.[result.columns.indexOf(f)])))?(result.modelRowSelections?.[i]||(result.modelSelections?.[i]?[result.modelSelections[i]]:[])):[]);selectionTarget.dispatchEvent(new CustomEvent('askbics-summary-selection',{bubbles:true,detail:selected.size?identities:[]}));};
 clear.onclick=event=>{event.preventDefault();event.stopPropagation();selected.clear();paint();if(selection)selection.change(publish);else publish();};
 const observer=new MutationObserver(paint);observer.observe(holder,{childList:true,subtree:true});
 let summaries=summaryCache.get(table);if(!summaries){summaries=new Map();summaryCache.set(table,summaries);}
 const localSummaries=new Map(config.cards.map(c=>{
  const source=selection?.baseTable||table;
  const local=selection?filterTransactionRows(source,selected,c.field):source;
  return [c,local?reuseTransactionSummary(local,c.field,c.measure||table.drillScopes![0].measure||table.columns.at(-1)!):undefined] as const;
 }));
 // Paint every reusable card before waiting for any model-only summary.
 for(const c of [...config.cards].sort((a,b)=>Number(!!localSummaries.get(b))-Number(!!localSummaries.get(a)))){if(selection?.signal?.aborted||!host.isConnected||host.closest('[hidden]'))break;const card=document.createElement('section');card.className='askbics-summary-card';card.style.order=String(config.cards.indexOf(c));card.dataset.field=c.field;card.dataset.icon=c.icon||'chart';card.dataset.measure=c.measure||table.drillScopes[0].measure||'Amount';card.style.setProperty('--card-accent',['#2563eb','#08916b','#7c3aed','#c66a13','#c3377a','#008b9a'][config.cards.indexOf(c)%6]);const title=document.createElement('strong');title.textContent=c.title||c.field;card.append(title);const rows=document.createElement('div');rows.className='askbics-summary-card-rows';const loading=document.createElement('div');loading.className='askbics-summary-loading';const spin=spinner.cloneNode(true);const label=document.createElement('span');label.textContent='Loading…';loading.append(spin,label);rows.append(loading);card.append(rows);strip.append(card);
 try{const question=transactionQuestion((selection?.baseTable?.drillScopes||selection?.scopes||table.drillScopes).map(s=>({...s,summaryFilters:selection?[...selected].filter(([field])=>field!==c.field).map(([field,values])=>({field,values:[...values].map(v=>JSON.parse(v))})):undefined,summaryCard:true,summarizeBy:c.field,summaryMeasures:[...new Set(config.cards.filter(card=>card.field===c.field).map(card=>card.measure||s.measure||table.columns.at(-1)!))]})));let pending=summaries.get(question);const reused=localSummaries.get(c);if(!pending&&reused)pending=Promise.resolve({text:'',table:reused});if(!pending){pending=load(question).then(answer=>{if(!answer?.table||answer.table.modelResultComplete===false)summaries!.delete(question);return answer;},error=>{summaries!.delete(question);throw error;});summaries.set(question,pending);}const answer=await pending;if(selection?.signal?.aborted||!host.isConnected||host.closest('[hidden]'))break;const t=answer?.table;if(!t||t.modelResultComplete===false)throw new Error('Complete summary unavailable');const measureColumn=t.columns?.indexOf(c.measure||table.drillScopes[0].measure||table.columns.at(-1)!)??-1;const measureIndex=measureColumn<0?(t.rows[0]?.length||1)-1:measureColumn;const entries=t.rows.map((r,i)=>({label:r[0],value:r[measureIndex]||'',raw:t.modelRawRows?.[i]?.[measureIndex],key:key(t.modelGroupValues?.[i]?.[0])}));if(!entries.length||entries.every(entry=>entry.raw===null)||(c.hideBlanks&&!t.rows.some((r,i)=>{const member=t.modelGroupValues?.[i]?.[0];return member===undefined?Boolean(r[0]?.trim()):member!==null&&String(member).trim()!=='';}))){card.remove();continue;}summaryCardRows(card,rows,entries,c.sort,(entryKey,event)=>{const values=new Set(selected.get(c.field)||[]);if(selected.get(c.field)?.has(entryKey))values.delete(entryKey);else values.add(entryKey);if(values.size)selected.set(c.field,values);else selected.delete(c.field);paint();if(selection)selection.change(publish);else publish();},(button,entryKey)=>{for(let i=buttons.length-1;i>=0;i--)if(!buttons[i].button.isConnected)buttons.splice(i,1);buttons.push({button,field:c.field,key:entryKey});},paint,t.modelTotals?.[measureIndex]??'—');
 }catch(error){if(selection?.signal?.aborted)break;if((error as Error).message.startsWith('Query cancelled.')){rows.textContent='Summary loading interrupted. Reopen transactions to retry.';break;}failed++;rows.textContent=(error as Error).message;}
 finally{completed++;updateProgress();}
 }
 host.setAttribute('aria-busy','false');if(!strip.childElementCount)details.remove();
 if(failed){spinner.remove();progressText.textContent='Some summaries could not load. See the affected cards for details.';}else progress.remove();
 // Observer owns only this view and disconnects once it is removed.
 const cleanup=new MutationObserver(()=>{if(!host.isConnected){observer.disconnect();cleanup.disconnect();}});const dispose=()=>{observer.disconnect();cleanup.disconnect();};if(!host.isConnected||selection?.signal?.aborted)dispose();else{cleanup.observe(host.ownerDocument.body,{childList:true,subtree:true});selection?.signal?.addEventListener('abort',dispose,{once:true});}
}

