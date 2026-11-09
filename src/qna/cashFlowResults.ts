import {cashAllocationLabel,cashStatusAppearance,cashStatusBadges} from '../cashFlowStatus';
import { tableExports, installTableCopyMenu } from './tableExport';
import {fullTransaction,CashInspection} from './cashFullTransaction';
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
function traceData(columns: string[], rows: string[][], highlights:number[], setup:CashSetup, postings:CashPosting[]): QnaTable {
    const extra=(setup.displayColumns||[]).filter(name=>!columns.includes(name));
    const sourceValue=(p:CashPosting,name:string):string=>{
        if(name===setup.measure)return money(p.amount);
        if(p.sourceValues && Object.prototype.hasOwnProperty.call(p.sourceValues,name))return p.sourceValues[name];
        const field=Object.keys(setup.fields).find(key=>setup.fields[key]===name);
        const value=field?(p as unknown as Record<string,unknown>)[field]:undefined;
        return value===undefined||value===null||value===''?'—':String(value);
    };
    const dataRows=rows.map((row,i)=>[...row.map((value,column)=>postings[i]&&setup.displayColumns?.includes(columns[column])?sourceValue(postings[i],columns[column]):value),...extra.map(name=>postings[i]?sourceValue(postings[i],name):'')]);
    const total=rows.length>postings.length?[rows.length-1]:[];
    return {columns:[...columns,...extra],rows:dataRows,totalRowIndices:total,traceHighlightRows:highlights,rowIndices:rows.map(()=>[])};
}
export function traceGrid(columns:string[],rows:string[][],render:(table:QnaTable,title:string)=>HTMLElement,highlights:number[],setup:CashSetup,postings:CashPosting[],editColumns?:()=>void):HTMLElement {
    const card=render(traceData(columns,rows,highlights,setup,postings),'Cash-flow document entries');
    card.classList.add('askbics-cash-entry-table');
    card.querySelector('[aria-label="Configure table or matrix rows, columns, and measures"]')?.remove();
    if(editColumns){const button=action('Columns',editColumns);button.title='Add or remove shared transaction source columns. Rerun cash flow after adding fields to load their values.';card.querySelector('.askbics-qna__table-toolbar > div')?.prepend(button);}
    return card;
}
/** Shared transaction-style output; all source columns refer to the starting posting. */
export function cashFlowResults(host:HTMLElement,result:CashResult,visible:CashAllocation[],postings:CashPosting[],title:string,render:(t:QnaTable,title:string)=>HTMLElement,setup:CashSetup,editColumns?:()=>void,inspection:CashInspection={}) {
 host.replaceChildren();host.classList.add('askbics-cash-trace');
 const model=cashFlowTable(visible,setup);
 const heading=el('div');heading.className='askbics-cash-trace-heading';
 heading.append(el('strong','Cash Flow Trace'));host.append(heading);
 const note=el('p','Selected columns describe the starting posting. Destination amounts show the allocated cash. Actual appears once per starting posting, on its first visible destination row. Variance = displayed Actual (blank = zero) − Destination amount. Row variances reconcile to Grand Total; individual rows are not unresolved amounts.');note.title='Unresolved allocations remain visible. Available model rows may be restricted by source filters.';const help=el('details');help.className='askbics-cash-calculation-help';help.append(el('summary','How amounts are calculated'),note);host.append(help);
 const rows=[...model.rows,model.total(model.rows.map((_,i)=>i))];
 const table=render({columns:model.columns,statusBadges:cashStatusBadges('Allocation status',model.rows.map(r=>r[model.columns.indexOf('Allocation status')])),presentRows:model.presentRows,defaultDataBarColumns:['Variance'],rows,rowIndices:rows.map(()=>[]),totalRowIndices:[rows.length-1],filteredTotals:model.total,detailAction:{column:model.columns.length-1,open:(row,anchor)=>{const group=model.entries[row];if(group)showEntries(group,postings,host,anchor,render,result.allocations.filter(a=>a.root===group[0].root),setup,editColumns,inspection);}}},title);
 table.querySelector('[aria-label="Configure table or matrix rows, columns, and measures"]')?.remove();
 if(editColumns){const columns=action('Columns',editColumns);columns.setAttribute('aria-label','Choose cash-flow columns');table.querySelector('.askbics-qna__table-toolbar > div')?.prepend(columns);}
 table.classList.add('askbics-cash-result-table');host.append(table);
}
function showEntries(allocations: CashAllocation[], postings: CashPosting[], host: HTMLElement, opener: HTMLElement, render: (table: QnaTable, title: string) => HTMLElement, paymentAllocations:CashAllocation[], setup:CashSetup, editColumns?:()=>void,inspection:CashInspection={}) {
    const allocation=allocations[0];
    const scroller = host.closest('.askbics-cash-body') as HTMLElement;
    const scrollTop = scroller.scrollTop, scrollLeft = scroller.scrollLeft;
    const background = scroller.parentElement!;
    const overlay = el('div'); overlay.className = 'askbics-clearing-overlay askbics-cash-entries-overlay';
    const panel = el('section'); panel.className = 'askbics-clearing-panel askbics-cash-entries';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Available document entries');
    const close = action('Close entries', () => { overlay.remove(); scroller.inert = false; scroller.scrollTop = scrollTop; scroller.scrollLeft = scrollLeft; opener.focus({preventScroll: true}); });
    const chooseColumns=editColumns?()=>{close.click();editColumns();}:undefined;
    const exportKey=(columns:string[],items:CashPosting[],count:number)=>JSON.stringify([columns,items.map(cashKey),count]);
    const exports=new Map<string,NonNullable<ReturnType<typeof tableExports.get>>>();
    const full=action('View full transaction',()=>{close.click();fullTransaction(host,opener,allocation.path[0],paymentAllocations,postings,setup,render,inspection);});
    const heading = el('header'); heading.append(el('strong', 'Available document entries'), close); close.textContent='×';close.setAttribute('aria-label','Close entries'); panel.append(heading);const entryBody=el('div');entryBody.className='askbics-clearing-body askbics-cash-accounting-body';panel.append(entryBody);
    const statusLabel=cashAllocationLabel(allocations),statusInfo=cashStatusAppearance(statusLabel);
    const summary=el('div');summary.className='askbics-cash-compact-summary';
    const statusBadge=el('span',statusLabel);statusBadge.className='askbics-status-badge is-'+statusInfo.tone;statusBadge.title=[statusInfo.description,allocation.basis].filter(Boolean).join(' ');
    const destinations=[...new Set(allocations.map(a=>a.status==='Resolved'||a.status==='Estimated'?account(a.path[a.path.length-1]):'Unresolved'))];
    summary.append(el('strong',`${account(allocation.path[0])} → ${destinations.length===1?destinations[0]:'Multiple destinations'} · ${money(allocations.reduce((n,a)=>n+a.amount,0))}`),statusBadge,full);
    const context=el('small',`Company ${allocation.path[0].company} · Starting document ${allocation.path[0].document} · Available entries`);context.title='Available model rows only; source filters may omit document lines. Original debit/credit amounts are unchanged.';summary.append(context);
    if(allocation.basis){const basis=el('small',allocation.basis);summary.append(basis);}
    entryBody.append(summary);
    const controls = el('div'); controls.className = 'askbics-cash-actions';
    const content = el('div');content.className='askbics-cash-document-content';
    const all = action('All entries', () => paint(false)), selected = action('Trace only', () => paint(true));
    controls.append(all, selected); entryBody.append(controls, content); overlay.append(panel); background.append(overlay); scroller.inert = true;
    const evidence=cashEvidence(allocations.flatMap(a=>a.path));const keys=new Set(evidence.map(cashKey));
    const documents = new Map<string, CashPosting>(); evidence.forEach(p=>documents.set(documentKey(p),p));
    const documentLines=new Map<string,CashPosting[]>();for(const row of postings){const key=documentKey(row);if(!documents.has(key))continue;const lines=documentLines.get(key)||[];lines.push(row);documentLines.set(key,lines);}
    let entireTrace=false;let inspected:CashPosting|undefined;let inspectedDocuments=new Set<string>();let traceMode=false;const documentEntries=[...documents];
    function paint(traceOnly: boolean) {
        if(!inspected)traceMode=traceOnly;else traceOnly=false;
        controls.hidden=!!inspected;tabs.hidden=!!inspected;
        const visibleDocuments=inspected&&!entireTrace?documentEntries.filter(([key])=>inspectedDocuments.has(key)):documentEntries;
        all.setAttribute('aria-pressed', String(!traceOnly)); selected.setAttribute('aria-pressed', String(traceOnly)); content.replaceChildren();
        if(inspected)content.append(el('h3',account(inspected)+(entireTrace?' · Entire trace':' · Selected step')));
        if (traceOnly) content.append(el('p', 'Selected trace lines may not balance. Document totals are hidden in this view.'));
        const lines=visibleDocuments.flatMap(([key])=>(documentLines.get(key)||[]).filter(row=>!traceOnly||keys.has(cashKey(row))));
        const hasItems=lines.some(row=>!row.item.startsWith('group:'));
        const columns=[...(hasItems?['Item']:[]),'Account','Clearing reference','Debit','Credit'];
        const rows=lines.map(row=>[...(hasItems?[row.item.startsWith('group:')?'—':row.item]:[]),[row.account,row.accountDescription].filter(Boolean).join(' · ')||'—',row.clearing||'—',row.amount>0?money(row.amount):'—',row.amount<0?money(-row.amount):'—']);
        const highlights=lines.flatMap((row,i)=>inspected&&inspectedDocuments.has(documentKey(row))&&(inspected.account?row.account===inspected.account:cashKey(row)===cashKey(inspected))?[i]:[]);
        const entrySetup={...setup,displayColumns:setup.displayColumns?.filter(name=>name!==setup.fields.accountDescription)};
        const data=traceData(columns,rows,highlights,entrySetup,lines);
        data.documentGroups={keys:lines.map(documentKey),labels:Object.fromEntries(visibleDocuments.map(([key,p])=>[key,`Document ${p.document}${p.year?' · '+p.year:''} · Company ${p.company}${p.currency?' · '+p.currency:''}`])),totals:traceOnly?undefined:(indices,filtered)=>data.columns.map((name,i)=>i===0?(filtered?'Visible lines total':'Available lines total'):name==='Debit'?money(indices.reduce((n,i)=>n+Math.max(0,lines[i].amount),0)):name==='Credit'?money(indices.reduce((n,i)=>n+Math.max(0,-lines[i].amount),0)):'')};
        data.documentGroups.descriptions={};
        for(const [key,p] of visibleDocuments){const entries=(documentLines.get(key)||[]).filter(row=>!traceOnly||keys.has(cashKey(row)));const traced=evidence.filter(row=>documentKey(row)===key);const names=[...new Set((traced.length?traced:entries).map(account))];const refs=[...new Set(entries.map(row=>row.clearing).filter(Boolean))];data.documentGroups.labels[key]=`Document ${p.document} · ${names.slice(0,3).join(' → ')}${names.length>3?' …':''} · ${entries.length} entries`;data.documentGroups.descriptions[key]=`Company ${p.company}${p.year?' · '+p.year:''}${p.currency?' · '+p.currency:''} · Clearing ${refs.length?refs.join(' / '):'—'}`;}
        const card=render(data,'Accounting entries grouped by document');card.classList.add('askbics-cash-entry-table','askbics-cash-grouped-entries');card.querySelector('[aria-label="Configure table or matrix rows, columns, and measures"]')?.remove();
        if(chooseColumns)card.querySelector('.askbics-qna__table-toolbar > div')?.prepend(action('Columns',chooseColumns));
        const exporter=tableExports.get(card);if(exporter)exports.set('groupedDocuments',exporter);
        installTableCopyMenu(card,()=>copyTables(),()=>!inspected);
        card.dataset.traceDocument=inspected?documentKey(inspected):'';const focusIndex=inspected?lines.findIndex(row=>cashKey(row)===cashKey(inspected!)):-1;const beforeGroups=focusIndex<0?0:new Set(lines.slice(0,focusIndex).map(documentKey)).size-(focusIndex>0&&documentKey(lines[focusIndex-1])===documentKey(lines[focusIndex])?1:0);card.dataset.traceFocusRow=String(focusIndex<0?-1:focusIndex+1+beforeGroups*(traceOnly?1:2));content.append(card);

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
        paint(traceMode);
        const target=Array.from(content.querySelectorAll<HTMLElement>('[data-trace-document]')).find(c=>inspected&&c.dataset.traceDocument===documentKey(inspected));
        if(target)entryBody.scrollTop+=target.getBoundingClientRect().top-entryBody.getBoundingClientRect().top-45;
    });
    toggleScope.title='Show all available documents in this trace, or only the selected step. Matching rows stay highlighted. Uses loaded data; filters and original amounts do not change.';
    toggleScope.dataset.settingsHelp=toggleScope.title;toggleScope.setAttribute('aria-pressed','false');backBar.append(toggleScope);
    ['Accounting entries','Flow diagram','Cash allocation'].forEach((label,i)=>{const b=action(label,()=>{if(inspected){const top=entryBody.scrollTop,left=entryBody.scrollLeft;inspected=undefined;paint(traceMode);entryBody.scrollTop=top;entryBody.scrollLeft=left;}flowReturn=undefined;if(!built.has(i)){if(i===1)cashFlowChart(views[i],allocations,'flow',(p,nodePostings)=>{const returnTo={node:views[1].contains(document.activeElement)?document.activeElement as HTMLElement:null,top:views[1].scrollTop,left:views[1].scrollLeft};buttons[0].click();flowReturn=returnTo;entireTrace=false;toggleScope.textContent='Show entire trace';toggleScope.setAttribute('aria-pressed','false');inspected=p;inspectedDocuments=new Set(nodePostings.map(documentKey));paint(traceMode);backBar.hidden=false;const cards=Array.from(content.querySelectorAll<HTMLElement>('[data-trace-document]'));const target=cards.find(c=>c.dataset.traceDocument===documentKey(p));if(target){const wrap=target.querySelector<HTMLElement>('.askbics-qna__table-wrap');const index=Number(target.dataset.traceFocusRow);if(wrap&&index>=0){const height=target.querySelector('tbody tr[data-source-row]')?.getBoundingClientRect().height||32;wrap.scrollTop=index*height;wrap.dispatchEvent(new Event('scroll'));}target.tabIndex=-1;target.focus({preventScroll:true});entryBody.scrollTop+=target.getBoundingClientRect().top-entryBody.getBoundingClientRect().top-45;}});else{const controls=el('div');controls.className='askbics-cash-actions';const chart=el('div');const draw=(all:boolean)=>{chart.replaceChildren();cashFlowChart(chart,all?paymentAllocations:allocations,'allocation');if(all)chart.querySelector('p')!.textContent='All loaded destinations for this payment, including destinations hidden by result filters. Display only; existing filters are unchanged.';one.setAttribute('aria-pressed',String(!all));every.setAttribute('aria-pressed',String(all));};const one=action('Selected trace',()=>draw(false)),every=action('All loaded payment destinations',()=>draw(true));controls.append(one,every);views[i].append(controls,chart);draw(false);}built.add(i);}views.forEach((v,j)=>{v.hidden=i!==j;buttons[j].setAttribute('aria-selected',String(i===j));buttons[j].tabIndex=i===j?0:-1;});backBar.hidden=i!==0||!flowReturn;});b.setAttribute('role','tab');b.setAttribute('aria-selected',String(i===0));b.tabIndex=i===0?0:-1;views[i].setAttribute('role','tabpanel');views[i].setAttribute('aria-label',label);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;buttons[next].click();buttons[next].focus();}};buttons.push(b);tabs.append(b);});
    async function copyTables(){
        const output:string[][]=[['Available document entries'],[allocation.basis||allocation.status],['Available model rows only; current source filters may omit document lines.'],[]];
        const add=(title:string,columns:string[],rows:string[][],items:CashPosting[])=>{
            const current=exports.get(exportKey(columns,items,rows.length));
            const data=traceData(columns,rows,[],setup,items);
            output.push([title],...(current?current.rows():[data.columns,...data.rows]),[]);
        };
        if(!inspected)for(const a of allocations){
            for(const p of a.path)if(p.settlementSources){
                add('Clearing group '+(p.clearing||'—')+' · Shared evidence; individual allocation not inferred',['Source document','Item','Account','Posting amount','Clearing'],p.settlementSources.map(r=>[r.document,r.item.startsWith('group:')?'Grouped posting':r.item,account(r),money(r.amount),r.clearing||'—']),p.settlementSources);
                for(const branch of p.settlementPaths||[]){const items=cashEvidence(branch);add('Incoming path · '+journeyLabel(branch),['Document','Account','Posting amount','Clearing'],items.map(r=>[r.document,account(r),money(r.amount),r.clearing||'—']),items);}
            }
            add((a.groupId?'Shared group destination · '+a.account+' (invoice pairing not established)':journeyLabel(a.path))+' · '+money(a.amount)+' · '+a.status,['Step','Document','Account','Posting amount','Clearing'],a.path.map((p,i)=>[String(i+1),p.document,account(p),money(p.amount),p.clearing||'—']),a.path);
        }
        const traceOnly=!inspected&&traceMode;
        if(traceOnly)output.push(['Selected trace lines may not balance. Document totals are hidden.'],[]);
        const grouped=exports.get('groupedDocuments');
        if(grouped)output.push(['Accounting entries'],...grouped.rows(true),[]);
        for(const [key,p] of grouped?[]:documentEntries){
            if(inspected&&!entireTrace&&!inspectedDocuments.has(key))continue;
            const lines=(documentLines.get(key)||[]).filter(r=>!traceOnly||keys.has(cashKey(r)));
            const rows=lines.map(r=>[r.item.startsWith('group:')?'Grouped posting':r.item,[r.account,r.accountDescription].filter(Boolean).join(' · ')||'—',r.clearing||'—',r.amount>0?money(r.amount):'—',r.amount<0?money(-r.amount):'—']);
            if(!traceOnly)rows.push(['Available lines total','','',money(lines.reduce((n,r)=>n+Math.max(0,r.amount),0)),money(lines.reduce((n,r)=>n+Math.max(0,-r.amount),0))]);
            add(`Document ${p.document} · Company ${p.company}${p.year?' · '+p.year:''}${p.currency?' · '+p.currency:''}`,['Item','Account','Clearing reference','Debit','Credit'],rows,lines);
        }
        const service=exports.values().next().value;
        const ok=service?await service.copy(output):false;
        return ok;
    }
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
