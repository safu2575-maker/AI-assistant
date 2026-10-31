import { cashFlowChart } from './cashFlowCharts';
import { cashFlowTable } from '../cashFlowTable';
import { CashSetup } from '../cashFlow';
import { CashAllocation, CashPosting, CashResult, cashKey, cashEvidence } from '../cashFlow';
import { QnaTable } from './types';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
    const node = document.createElement(tag); node.textContent = text; return node;
};
const moneyFormat=new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const money=(n:number)=>moneyFormat.format(n);
const action = (label: string, run: () => void) => {
    const b = el('button', label); b.type = 'button'; b.onclick = run; return b;
};
const documentKey = (p: CashPosting) => JSON.stringify([p.company, p.year, p.document, p.currency]);
const account = (p: CashPosting) => p.accountDescription || (p.account ? `Account ${p.account}` : `Document ${p.document}`);
const journeyLabel = (path: CashPosting[]) => path.map((p,i) => {
    if(!i)return `Doc ${p.document}`;
    if(p.settlementSources)return `Clearing group ${p.clearing||'—'} (${p.settlementSources.length} source lines) → Doc ${p.document}`;
    const previous=path[i-1];
    return documentKey(previous)===documentKey(p)?'':`${previous.reference?'Reference '+previous.reference:'Clearing '+(previous.clearing||'—')} → Doc ${p.document}`;
}).filter(Boolean).join(' → ');
function grid(columns: string[], rows: string[][], render: (table: QnaTable, title: string) => HTMLElement, highlights:number[]=[]): HTMLElement {
    const card=render({columns,rows,traceHighlightRows:highlights,rowIndices:rows.map(()=>[])},'Cash-flow document entries');
    card.classList.add('askbics-cash-entry-table');
    card.querySelector('.askbics-qna__table-toolbar')?.remove();
    card.querySelectorAll('th button').forEach(button=>button.remove());
    return card;
}
/** Shared transaction-style output; all source columns refer to the starting posting. */
export function cashFlowResults(host:HTMLElement,result:CashResult,visible:CashAllocation[],postings:CashPosting[],title:string,render:(t:QnaTable,title:string)=>HTMLElement,setup:CashSetup,editColumns?:()=>void) {
 host.replaceChildren();host.classList.add('askbics-cash-trace');
 const model=cashFlowTable(visible,setup);
 const heading=el('div');heading.className='askbics-cash-trace-heading';
 const badge=el('span',!result.complete?'Incomplete trace':result.unresolved?'Partially traced':'Traced');badge.className='askbics-cash-trace-badge';heading.append(el('strong','Cash Flow Trace'),badge);host.append(heading);const start=visible[0]?.path[0];if(start)host.append(el('small', ['Companies '+[...new Set(result.allocations.map(a=>a.path[0].company))].join(', '),start.currency,result.roots+' starting posting'+(result.roots===1?'':'s')].filter(Boolean).join(' · ')));
 const scopeText=(setup.scope?.filters||[]).map(f=>f.field+': '+f.values.join(', '));if(setup.scope?.from)scopeText.push(setup.scope.from+' to '+setup.scope.to);if(scopeText.length)host.append(el('p','Starting scope · '+scopeText.join(' · ')));
 const note=el('p','Selected columns describe the starting posting. Starting amounts are counted once in totals; destination amounts show the allocated cash.');note.title='Unresolved allocations remain visible. Available model rows may be restricted by source filters.';host.append(note);
 const rows=[...model.rows,model.total(model.rows.map((_,i)=>i))];
 const table=render({columns:model.columns,rows,rowIndices:rows.map(()=>[]),totalRowIndices:[rows.length-1],filteredTotals:model.total,detailAction:{column:model.columns.length-1,open:(row,anchor)=>{const group=model.entries[row];if(group)showEntries(group,postings,host,anchor,render,result.allocations.filter(a=>a.root===group[0].root));}}},title);
 table.querySelector('[aria-label="Configure table or matrix rows, columns, and measures"]')?.remove();
 if(editColumns){const columns=action('Columns',editColumns);columns.setAttribute('aria-label','Choose cash-flow columns');table.querySelector('.askbics-qna__table-toolbar > div')?.prepend(columns);}
 host.append(table);
}
function showEntries(allocations: CashAllocation[], postings: CashPosting[], host: HTMLElement, opener: HTMLElement, render: (table: QnaTable, title: string) => HTMLElement, paymentAllocations:CashAllocation[]) {
    const allocation=allocations[0];
    const scroller = host.closest('.askbics-cash-body') as HTMLElement;
    const scrollTop = scroller.scrollTop, scrollLeft = scroller.scrollLeft;
    const background = scroller.parentElement!;
    const overlay = el('div'); overlay.className = 'askbics-clearing-overlay askbics-cash-entries-overlay';
    const panel = el('section'); panel.className = 'askbics-clearing-panel askbics-cash-entries';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Available document entries');
    const close = action('Close entries', () => { overlay.remove(); scroller.inert = false; scroller.scrollTop = scrollTop; scroller.scrollLeft = scrollLeft; opener.focus({preventScroll: true}); });
    const heading = el('header'); heading.append(el('strong', 'Available document entries'), close); close.textContent='×';close.setAttribute('aria-label','Close entries'); panel.append(heading);const entryBody=el('div');entryBody.className='askbics-clearing-body';panel.append(entryBody);
    entryBody.append(el('p', `${allocation.category} · Allocated cash ${money(allocations.reduce((n,a)=>n+a.amount,0))}. Original debit/credit amounts are unchanged.`));
    entryBody.append(el('p', 'Available model rows only; current source filters may omit document lines.'));
    const paths=el('div');entryBody.append(paths);let shownPaths=0;
    const morePaths=action('Show more paths',appendPaths);
    function appendPaths(){morePaths.remove();for(const a of allocations.slice(shownPaths,shownPaths+25)){const path=el('details');path.open=allocations.length===1;path.append(el('summary',journeyLabel(a.path)+' · '+money(a.amount)));let loaded=false;const load=()=>{if(!path.open||loaded)return;loaded=true;for(const p of a.path)if(p.settlementSources){path.append(el('p','Clearing group '+(p.clearing||'—')+': these source lines jointly fund the cleared items. No individual source-line-to-invoice allocation is inferred.'));path.append(grid(['Source document','Item','Account','Posting amount','Clearing'],p.settlementSources.map(row=>[row.document,row.item.startsWith('group:')?'Grouped posting':row.item,account(row),money(row.amount),row.clearing||'—']),render));const branches=p.settlementPaths||[];let shown=0;const more=action('Show more incoming paths',drawIncoming);function drawIncoming(){more.remove();for(const branch of branches.slice(shown,shown+25)){const evidence=el('details');evidence.append(el('summary','Incoming path · '+journeyLabel(branch)));let built=false;evidence.ontoggle=()=>{if(evidence.open&&!built){built=true;evidence.append(grid(['Document','Account','Posting amount','Clearing'],cashEvidence(branch).map(row=>[row.document,account(row),money(row.amount),row.clearing||'—']),render));}};path.append(evidence);}shown+=25;if(shown<branches.length)path.append(more);}drawIncoming();}path.append(grid(['Step','Document','Account','Posting amount','Clearing'],a.path.map((p,i)=>[String(i+1),p.document,account(p),money(p.amount),p.clearing||'—']),render));};path.ontoggle=load;load();paths.append(path);}shownPaths+=25;if(shownPaths<allocations.length)paths.append(morePaths);}
    appendPaths();
    const controls = el('div'); controls.className = 'askbics-cash-actions';
    const content = el('div');
    const all = action('All document lines', () => paint(false)), selected = action('Selected trace lines', () => paint(true));
    controls.append(all, selected); entryBody.append(controls, content); overlay.append(panel); background.append(overlay); scroller.inert = true;
    const evidence=cashEvidence(allocations.flatMap(a=>a.path));const keys=new Set(evidence.map(cashKey));
    const documents = new Map<string, CashPosting>(); evidence.forEach(p=>documents.set(documentKey(p),p));
    const documentLines=new Map<string,CashPosting[]>();for(const row of postings){const key=documentKey(row);if(!documents.has(key))continue;const lines=documentLines.get(key)||[];lines.push(row);documentLines.set(key,lines);}
    let entireTrace=false;let inspected:CashPosting|undefined;let inspectedDocuments=new Set<string>();let traceMode=false;let documentPage=0;const pageSize=20;const documentEntries=[...documents];
    function paint(traceOnly: boolean) {
        if(!inspected)traceMode=traceOnly;else traceOnly=false;
        paths.hidden=controls.hidden=!!inspected;tabs.hidden=!!inspected;
        const visibleDocuments=inspected&&!entireTrace?documentEntries.filter(([key])=>inspectedDocuments.has(key)):documentEntries;
        documentPage=Math.min(documentPage,Math.max(0,Math.ceil(visibleDocuments.length/pageSize)-1));
        all.setAttribute('aria-pressed', String(!traceOnly)); selected.setAttribute('aria-pressed', String(traceOnly)); content.replaceChildren();
        if(inspected)content.append(el('h3',account(inspected)+(entireTrace?' · Entire trace':' · Selected step')));
        if (traceOnly) content.append(el('p', 'Selected trace lines may not balance. Document totals are hidden in this view.'));
        for (const [key, p] of visibleDocuments.slice(documentPage*pageSize,(documentPage+1)*pageSize)) {
            const lines = (documentLines.get(key)||[]).filter(row => !traceOnly || keys.has(cashKey(row)));
            content.append(el('h3', `Document ${p.document}${p.year ? ' · ' + p.year : ''} · Company ${p.company}${p.currency ? ' · ' + p.currency : ''}`));
            const rows = lines.map(row => [row.item.startsWith('group:') ? 'Grouped posting' : row.item, [row.account,row.accountDescription].filter(Boolean).join(' · ') || '—', row.clearing || '—', row.amount > 0 ? money(row.amount) : '—', row.amount < 0 ? money(-row.amount) : '—']);
            if (!traceOnly) rows.push(['Available lines total', '', '', money(lines.reduce((n, row) => n + Math.max(0, row.amount), 0)), money(lines.reduce((n, row) => n + Math.max(0, -row.amount), 0))]);
            const highlights=lines.flatMap((row,i)=>inspected&&inspectedDocuments.has(key)&&row.company===inspected.company&&row.currency===inspected.currency&&(inspected.account?row.account===inspected.account:cashKey(row)===cashKey(inspected))?[i]:[]);const card=grid(['Item', 'Account', 'Clearing reference', 'Debit', 'Credit'], rows,render,highlights);card.dataset.traceDocument=key;const inspectedKey=inspected?cashKey(inspected):undefined;card.dataset.traceFocusRow=String(inspectedKey?lines.findIndex(row=>cashKey(row)===inspectedKey):-1);content.append(card);
        }
        if(visibleDocuments.length>pageSize){const pages=el('div');pages.className='askbics-cash-actions';const previous=action('Previous documents',()=>{documentPage--;paint(traceMode);});previous.disabled=documentPage===0;const next=action('Next documents',()=>{documentPage++;paint(traceMode);});next.disabled=(documentPage+1)*pageSize>=visibleDocuments.length;pages.append(previous,el('span',`Documents ${documentPage*pageSize+1}–${Math.min((documentPage+1)*pageSize,visibleDocuments.length)} of ${visibleDocuments.length}`),next);content.append(pages);}
    }
    const tabs=el('div');tabs.className='askbics-settings-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Trace views');entryBody.before(tabs);
    const views=[entryBody,el('div'),el('div')];views.slice(1).forEach(v=>{v.className='askbics-clearing-body';v.hidden=true;panel.append(v);});
    const built=new Set([0]);const buttons:HTMLButtonElement[]=[];
    let flowReturn:{node:HTMLElement|null;top:number;left:number}|undefined;
    const backBar=el('div');backBar.className='askbics-cash-actions askbics-trace-back';backBar.hidden=true;
    const backToFlow=action('Back to flow diagram',()=>{const saved=flowReturn;if(!saved)return;buttons[1].click();views[1].scrollTop=saved.top;views[1].scrollLeft=saved.left;if(saved.node?.isConnected)saved.node.focus({preventScroll:true});else buttons[1].focus({preventScroll:true});});
    backToFlow.title='Return to the diagram node and clear temporary row highlighting without changing filters or reloading data.';backToFlow.dataset.settingsHelp=backToFlow.title;backBar.append(backToFlow);tabs.after(backBar);
    const toggleScope=action('Show entire trace',()=>{
        entireTrace=!entireTrace;
        toggleScope.textContent=entireTrace?'Show selected step':'Show entire trace';
        toggleScope.setAttribute('aria-pressed',String(entireTrace));
        documentPage=entireTrace&&inspected?Math.floor(Math.max(0,documentEntries.findIndex(([key])=>key===documentKey(inspected!)))/pageSize):0;
        paint(traceMode);
        const target=Array.from(content.querySelectorAll<HTMLElement>('[data-trace-document]')).find(c=>inspected&&c.dataset.traceDocument===documentKey(inspected));
        if(target)entryBody.scrollTop+=target.getBoundingClientRect().top-entryBody.getBoundingClientRect().top-45;
    });
    toggleScope.title='Show all available documents in this trace, or only the selected step. Matching rows stay highlighted. Uses loaded data; filters and original amounts do not change.';
    toggleScope.dataset.settingsHelp=toggleScope.title;toggleScope.setAttribute('aria-pressed','false');backBar.append(toggleScope);
    ['Accounting entries','Flow diagram','Cash allocation'].forEach((label,i)=>{const b=action(label,()=>{if(inspected){const top=entryBody.scrollTop,left=entryBody.scrollLeft;inspected=undefined;paint(traceMode);entryBody.scrollTop=top;entryBody.scrollLeft=left;}flowReturn=undefined;if(!built.has(i)){if(i===1)cashFlowChart(views[i],allocations,'flow',(p,nodePostings)=>{const returnTo={node:views[1].contains(document.activeElement)?document.activeElement as HTMLElement:null,top:views[1].scrollTop,left:views[1].scrollLeft};buttons[0].click();flowReturn=returnTo;entireTrace=false;toggleScope.textContent='Show entire trace';toggleScope.setAttribute('aria-pressed','false');inspected=p;inspectedDocuments=new Set(nodePostings.map(documentKey));documentPage=0;paint(traceMode);backBar.hidden=false;const cards=Array.from(content.querySelectorAll<HTMLElement>('[data-trace-document]'));const target=cards.find(c=>c.dataset.traceDocument===documentKey(p));if(target){const wrap=target.querySelector<HTMLElement>('.askbics-qna__table-wrap');const index=Number(target.dataset.traceFocusRow);if(wrap&&index>=0){const height=target.querySelector('tbody tr[data-source-row]')?.getBoundingClientRect().height||32;wrap.scrollTop=index*height;wrap.dispatchEvent(new Event('scroll'));}target.tabIndex=-1;target.focus({preventScroll:true});entryBody.scrollTop+=target.getBoundingClientRect().top-entryBody.getBoundingClientRect().top-45;}});else{const controls=el('div');controls.className='askbics-cash-actions';const chart=el('div');const draw=(all:boolean)=>{chart.replaceChildren();cashFlowChart(chart,all?paymentAllocations:allocations,'allocation');if(all)chart.querySelector('p')!.textContent='All loaded destinations for this payment, including destinations hidden by result filters. Display only; existing filters are unchanged.';one.setAttribute('aria-pressed',String(!all));every.setAttribute('aria-pressed',String(all));};const one=action('Selected trace',()=>draw(false)),every=action('All loaded payment destinations',()=>draw(true));controls.append(one,every);views[i].append(controls,chart);draw(false);}built.add(i);}views.forEach((v,j)=>{v.hidden=i!==j;buttons[j].setAttribute('aria-selected',String(i===j));buttons[j].tabIndex=i===j?0:-1;});backBar.hidden=i!==0||!flowReturn;});b.setAttribute('role','tab');b.setAttribute('aria-selected',String(i===0));b.tabIndex=i===0?0:-1;views[i].setAttribute('role','tabpanel');views[i].setAttribute('aria-label',label);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;buttons[next].click();buttons[next].focus();}};buttons.push(b);tabs.append(b);});
    paint(false); close.focus({preventScroll: true});
    overlay.onkeydown = event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); close.click(); }
        if (event.key === 'Tab') {
            const controls = Array.from(panel.querySelectorAll<HTMLButtonElement>('button')).filter(b=>b.getClientRects().length&&!b.disabled&&b.tabIndex>=0);
            if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
            else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
        }
    };
}
