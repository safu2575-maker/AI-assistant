import {CashAllocation,CashPosting,CashSetup,cashEvidence,cashKey} from '../cashFlow';
import {CashPath} from '../cashFlowDiscovery';
import {QnaTable} from './types';

export interface CashInspection {
 paths?:CashPath[];
 diagnostics?:()=>string;
 load?:(root:CashPosting,active:()=>boolean,progress:(text:string)=>void)=>Promise<{rows:CashPosting[];complete:boolean;reason?:string}>;
}
const doc=(p:CashPosting)=>JSON.stringify([p.company,p.year,p.document,p.currency]);
const money=(n:number)=>n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
/** Read-only inspection; discovered relationships never become confirmed allocations. */
export function fullTransaction(host:HTMLElement,opener:HTMLElement,root:CashPosting,allocations:CashAllocation[],postings:CashPosting[],setup:CashSetup,render:(t:QnaTable,title:string)=>HTMLElement,inspection:CashInspection={},unverified=false,reason='') {
 const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
 const button=(text:string,run:()=>void)=>{const b=make('button',text);b.type='button';b.onclick=run;return b;};
 const scroller=(host.closest('.askbics-cash-body')||host) as HTMLElement;
 const top=scroller.scrollTop,left=scroller.scrollLeft,wasInert=scroller.inert;
 const overlay=make('div');overlay.className='askbics-clearing-overlay askbics-cash-entries-overlay';
 const panel=make('section');panel.className='askbics-clearing-panel askbics-cash-entries';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Full transaction');
 let closed=false;let loadRevision=0;const active=()=>!closed&&overlay.isConnected;
 const close=button('×',()=>{closed=true;++loadRevision;overlay.remove();scroller.inert=wasInert;scroller.scrollTop=top;scroller.scrollLeft=left;if(opener.isConnected)opener.focus({preventScroll:true});});close.setAttribute('aria-label','Close full transaction');
 const header=make('header');header.append(make('strong','Full transaction · Available entries'),close);
 const body=make('div');body.className='askbics-clearing-body';panel.append(header,body);overlay.append(panel);(scroller.parentElement||host).append(overlay);scroller.inert=true;
 const related=allocations.filter(a=>a.root===cashKey(root));
 const paths=(inspection.paths||[]).filter(p=>p.root===cashKey(root));
 const evidence=cashEvidence([root,...related.flatMap(a=>a.path),...paths.flatMap(p=>p.path)]);
 const documents=new Map(evidence.map(p=>[doc(p),p]));
 let rows=postings.filter(p=>p.company===root.company&&p.currency===root.currency);
 const issues=related.filter(a=>a.status!=='Resolved').map(a=>({posting:a.path.at(-1)||root,reason:a.status}));
 for(const p of paths)if(p.status!=='Destination found'&&!issues.some(i=>cashKey(i.posting)===cashKey(p.path.at(-1)!)&&i.reason===p.status))issues.push({posting:p.path.at(-1)!,reason:p.status});
 if(reason&&!issues.length)issues.push({posting:root,reason});
 const usage=new Map<string,number>();for(const path of [...related.map(a=>a.path),...paths.map(p=>p.path)])for(const key of new Set(path.map(doc)))usage.set(key,(usage.get(key)||0)+1);
 const confirmedDocs=new Set(related.filter(a=>a.status==='Resolved'&&!unverified).flatMap(a=>a.path.map(doc)));
 const issueKeys=new Set(issues.map(i=>cashKey(i.posting)));
 body.append(make('p',`Company ${root.company} · Starting document ${root.document} · Account ${root.accountDescription||root.account||'—'} · Original amount ${money(root.amount)} ${root.currency}`));
 const confirmed=related.filter(a=>a.status==='Resolved').reduce((n,a)=>n+a.amount,0),unresolved=related.filter(a=>a.status!=='Resolved').reduce((n,a)=>n+a.amount,0);
 body.append(make('p',unverified?'Amounts unverified. Available entries are evidence only; no confirmed cash flow is claimed.':`Confirmed destination amount ${money(confirmed)} · Unresolved amount ${money(unresolved)}. Original journal amounts are shown separately below.`));
 const status=make('p','Available entries—trace may be incomplete. Source filters can omit lines. Additional loading does not verify or change allocations.');status.setAttribute('role','status');body.append(status);
 const actions=make('div');actions.className='askbics-cash-actions';body.append(actions);
 const diagnosticArea=make('textarea');diagnosticArea.readOnly=true;diagnosticArea.hidden=true;diagnosticArea.setAttribute('aria-label','Full transaction troubleshooting');body.append(diagnosticArea);
 const copy=button('Copy troubleshooting',()=>{const text=JSON.stringify({kind:'askBICS full transaction',startingPosting:root,issues,paths,allocations:related,run:inspection.diagnostics?.()},null,2);void Promise.resolve().then(()=>navigator.clipboard.writeText(text)).then(()=>{if(active())status.textContent='Troubleshooting copied.';}).catch(()=>{if(!active())return;diagnosticArea.hidden=false;diagnosticArea.value=text;diagnosticArea.focus();diagnosticArea.select();status.textContent='Press Ctrl+C to copy troubleshooting.';});});actions.append(copy);
 const journey=make('details');journey.append(make('summary','Document journey · Confirmed and possible connections'));
 const journeyRows=[...related.map(a=>[a.status==='Resolved'&&!unverified?'Confirmed allocation':'Unresolved allocation',a.path.map(p=>`${p.document}${p.clearing?' [Clearing '+p.clearing+']':''}`).join(' → '),a.status,unverified?'Unverified':money(a.amount)]),...paths.map(p=>['Possible connection—not a confirmed allocation',p.path.map(v=>`${v.document}${v.clearing?' [Clearing '+v.clearing+']':''}`).join(' → '),p.status,'—'])];
 // Render on demand to avoid building thousands of path rows when inspecting one issue.
 let journeyBuilt=false;journey.ontoggle=()=>{if(!journey.open||journeyBuilt)return;journeyBuilt=true;journey.append(render({columns:['Evidence','Document journey','Status','Allocated cash'],rows:journeyRows,rowIndices:journeyRows.map(()=>[])},'Full transaction · Relationship evidence; possible connections are not allocations'));};body.append(journey);
 const content=make('div');body.append(content);let page=0,issueIndex=-1;const pageSize=20;
 const draw=()=>{
  const byDocument=new Map<string,CashPosting[]>();for(const row of rows){const key=doc(row);const list=byDocument.get(key)||[];list.push(row);byDocument.set(key,list);}
  content.replaceChildren();const entries=[...documents.values()];page=Math.min(page,Math.max(0,Math.ceil(entries.length/pageSize)-1));
  for(const p of entries.slice(page*pageSize,(page+1)*pageSize)){
   const section=make('section');section.dataset.fullDocument=doc(p);section.append(make('h3',`Document ${p.document} · Company ${p.company}${p.year?' · '+p.year:''}`));
   for(const issue of issues.filter(i=>doc(i.posting)===doc(p)))section.append(make('p',`Stopped at Document ${issue.posting.document} · Account ${issue.posting.account||'—'} · Item ${issue.posting.item.startsWith('group:')?'Grouped posting':issue.posting.item} · Clearing ${issue.posting.clearing||'—'}: ${issue.reason}`));
   if(!confirmedDocs.has(doc(p))&&doc(p)!==doc(root))section.append(make('p','Possible connection—not a confirmed allocation.'));
   if((usage.get(doc(p))||0)>1)section.append(make('small','Shared document: appears in multiple recorded paths; entries shown once.'));
   const lines=byDocument.get(doc(p))||[];
   if(!lines.length){section.append(make('p','Document entries unavailable in loaded data.'));content.append(section);continue;}
   const selected=setup.displayColumns||[],columns=['Item','Account','Clearing reference','Debit','Credit',...selected.filter(n=>!['Item','Account','Clearing reference','Debit','Credit'].includes(n))];
   const values=lines.map(r=>[r.item.startsWith('group:')?'Grouped posting':r.item,[r.account,r.accountDescription].filter(Boolean).join(' · ')||'—',r.clearing||'—',r.amount>0?money(r.amount):'—',r.amount<0?money(-r.amount):'—',...columns.slice(5).map(n=>n===setup.measure?money(r.amount):r.sourceValues?.[n]||'—')]);
   values.push(['Available lines total','','',money(lines.reduce((n,r)=>n+Math.max(0,r.amount),0)),money(lines.reduce((n,r)=>n+Math.max(0,-r.amount),0)),...columns.slice(5).map(()=>'')]);
   const table=render({columns,rows:values,rowIndices:values.map(()=>[]),totalRowIndices:[values.length-1],traceHighlightRows:lines.flatMap((r,i)=>issueKeys.has(cashKey(r))?[i]:[])},`Full transaction · Document ${p.document} · Available entries${unverified?' · Unverified':''}`);table.querySelector('[aria-label="Configure table or matrix rows, columns, and measures"]')?.remove();section.append(table);content.append(section);
  }
  if(entries.length>pageSize){const nav=make('div');nav.className='askbics-cash-actions';const prev=button('Previous documents',()=>{page--;draw();}),next=button('Next documents',()=>{page++;draw();});prev.disabled=page===0;next.disabled=(page+1)*pageSize>=entries.length;nav.append(prev,make('span',`${page*pageSize+1}–${Math.min((page+1)*pageSize,entries.length)} of ${entries.length} documents`),next);content.append(nav);}
 };
 const moveIssue=(delta:number)=>{issueIndex=issueIndex<0?(delta>0?0:issues.length-1):(issueIndex+delta+issues.length)%issues.length;const key=doc(issues[issueIndex].posting);page=Math.floor([...documents.keys()].indexOf(key)/pageSize);draw();const target=Array.from(content.children).find(e=>(e as HTMLElement).dataset.fullDocument===key) as HTMLElement;if(target){const rowIndex=rows.filter(r=>doc(r)===key).findIndex(r=>cashKey(r)===cashKey(issues[issueIndex].posting));const wrap=target.querySelector<HTMLElement>('.askbics-qna__table-wrap');if(wrap&&rowIndex>=0){const height=target.querySelector('tbody tr[data-source-row]')?.getBoundingClientRect().height||32;wrap.scrollTop=rowIndex*height;wrap.dispatchEvent(new Event('scroll'));}target.scrollIntoView({block:'nearest'});}status.textContent=`Issue ${issueIndex+1} of ${issues.length}: ${issues[issueIndex].reason}`;};
 if(issues.length)actions.append(button('Previous issue',()=>moveIssue(-1)),button('Next issue',()=>moveIssue(1)));
 if(inspection.load){const load=button('Load missing entries',()=>{const request=++loadRevision;load.disabled=true;status.textContent='Loading available linked entries…';void inspection.load!(root,()=>active()&&request===loadRevision,text=>{if(active()&&request===loadRevision)status.textContent=text;}).then(result=>{if(!active()||request!==loadRevision)return;rows=result.rows.filter(p=>p.company===root.company&&p.currency===root.currency);for(const p of rows)documents.set(doc(p),p);status.textContent=result.complete?'Linked entries loaded within source scope. Allocations are unchanged; rerun cash flow to verify results.':'Available entries—trace incomplete. '+(result.reason||'Some entries could not be loaded.');draw();}).catch(error=>{if(active()&&request===loadRevision)status.textContent='Loading stopped: '+(error as Error).message;}).finally(()=>{if(active()&&request===loadRevision)load.disabled=false;});});load.title='Explicitly load linked documents within company and security scope. Does not change confirmed results.';load.dataset.settingsHelp=load.title;actions.append(load);}
 draw();close.focus();overlay.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close.click();}if(e.key==='Tab'){const controls=Array.from(panel.querySelectorAll<HTMLElement>('button,input,textarea,[tabindex]')).filter(n=>n.tabIndex>=0&&n.getClientRects().length&&!(n as HTMLButtonElement).disabled);if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();controls[0]?.focus();}}};
}
