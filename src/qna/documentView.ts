import { loadingOverlay } from './loadingOverlay';
import { QnaResponse,QnaTable } from './types';
import { transactionQuestion } from '../answerTransactions';

export async function openDocumentDetails(root:HTMLElement,table:QnaTable,row:number,anchor:HTMLElement,load:(q:string)=>Promise<QnaResponse|undefined>,render:(t:QnaTable,q:string)=>HTMLElement){
 const overlay=document.createElement('div');overlay.className='askbics-clearing-overlay';
 const panel=document.createElement('section');panel.className='askbics-clearing-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Document details');
 const head=document.createElement('header'),title=document.createElement('strong'),close=document.createElement('button');title.textContent='Document details';close.type='button';close.textContent='×';close.setAttribute('aria-label','Close document details');head.append(title,close);
 const body=document.createElement('div');body.className='askbics-clearing-body';body.setAttribute('aria-live','polite');body.textContent='Loading document details…';panel.append(head,body);overlay.append(panel);root.append(overlay);const waiting=document.createElement('div');loadingOverlay(waiting,body.textContent||'Loading details…');waiting.classList.add('askbics-detail-loading');body.replaceChildren(waiting);
 let closed=false;const dismiss=()=>{closed=true;overlay.remove();anchor.focus();};close.onclick=dismiss;overlay.onclick=e=>{if(e.target===overlay)dismiss();};
 overlay.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();dismiss();}if(e.key==='Tab'){const items=Array.from(panel.querySelectorAll<HTMLElement>('button,input,select,[tabindex="0"]')).filter(n=>!n.hasAttribute('disabled')&&n.getClientRects().length);if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus();}}};close.focus();
 try{
  const c=table.document;if(!c?.enabled||!table.drillScopes?.length)throw new Error('Document context is unavailable. Reopen transactions.');
  const values=[c.referenceField,c.companyField,c.yearField].map(name=>table.modelGroupValues?.[row]?.[table.columns.indexOf(name)]);
  if(values.some(v=>v==null||String(v).trim()===''))throw new Error('This row is missing its document number, company or fiscal year. Check the transaction columns.');
  const q=transactionQuestion(table.drillScopes.map(s=>({...s,selections:undefined,requireSelection:false,summarizeBy:undefined,documentDetails:true,clearingValues:values as Array<string|number|boolean>})));
  const answer=await load(q);if(closed||!overlay.isConnected)return;if(!answer?.table)throw new Error('No document details were returned.');
  body.replaceChildren();const scope=document.createElement('p');scope.textContent=`Document ${values[0]} · Company ${values[1]} · Fiscal year ${values[2]}`;const note=document.createElement('p');note.textContent='Document lines across question periods and categories. Transaction rules do not restrict this lookup. Always filters remain applied.';body.append(scope,note);
  for(const section of answer.transactionTables||[{table:answer.table}]){const t=section.table;if(!t.rows.length){const empty=document.createElement('p');empty.textContent='No related items within the current filters.';body.append(empty);continue;}const totals=t.modelTotals?[t.modelTotals]:[];body.append(render({...t,clearing:undefined,clearingLink:undefined,drillScopes:undefined,groupSubtotal:undefined,transactionDetail:false,rows:[...t.rows,...totals],rowIndices:[...t.rowIndices,...totals.map(()=>[])]},'Clearing details'));}
 }catch(error){if(!closed){body.setAttribute('role','alert');body.textContent=(error as Error).message;}}
}
