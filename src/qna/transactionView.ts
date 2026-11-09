import { filterTransactionRows } from "./transactionLocal";
import { transactionCards } from "./transactionCards";
import { openDocumentDetails } from './documentView';
import { openClearingDetails } from "./clearingView";
import { transactionSubtotals } from "./transactionSubtotals";
import { transactionQuestion, TransactionScope } from "../answerTransactions";
import { TransactionRuleView } from "../transactionRules";
import { settingsSelect } from "./settingsSelect";
import { setBackButton } from "./backButton";
import { AnalysisState, analysisQuestion } from "../analysisTemplates";
import { QnaResponse, QnaTable } from "./types";
import { loadingOverlay } from "./loadingOverlay";

// Keep the existing view DOM alive: navigating back must not rerun queries or
// discard its sorting, scroll position, filters or transaction-rule selection.
const investigationViews = new WeakMap<HTMLElement, {parent?:HTMLElement; label:string; close:()=>void; cancel:()=>void}>();

/** Cash flow has its own signed measure and starting scope; never reuse a rent/KPI cell as cash. */
export function appendCashFlowMenu(menu:HTMLElement,root:HTMLElement,scopes?:TransactionScope[]):void {
    const action=document.createElement('button');action.type='button';action.setAttribute('role','menuitem');action.textContent=scopes?'Cash flow for this selection':'Cash flow';
    action.title=scopes?'Trace starting bank postings within this cell context using the saved signed amount.':'Open cash flow with saved company and starting filters. Review the scope before running.';
    action.dataset.settingsHelp=action.title;
    action.onclick=()=>{menu.remove();root.dispatchEvent(new CustomEvent('askbics-open-cash-flow',{detail:{scopes}}));};menu.append(action);
}

/** Shared flyout for every answer menu; opening it never sends a query. */
export function appendSummarizeMenu(menu: HTMLElement, fields: string[], choose: (field: string) => void): void {
    const trigger = document.createElement('button'); trigger.type = 'button';
    trigger.textContent = 'Summarize by'; trigger.setAttribute('role','menuitem');
    trigger.setAttribute('aria-haspopup','menu'); trigger.setAttribute('aria-expanded','false');
    const arrow = document.createElement('span'); arrow.textContent = '›'; arrow.setAttribute('aria-hidden','true'); arrow.style.float = 'right'; trigger.append(arrow);
    const flyout = document.createElement('div'); flyout.className = 'askbics-qna__column-submenu askbics-summary-submenu';
    flyout.setAttribute('role','menu'); flyout.setAttribute('aria-label','Summarize by field'); flyout.hidden = true;
    for (const field of [...new Set(fields)]) {
        const option = document.createElement('button'); option.type='button'; option.textContent=field; option.setAttribute('role','menuitem');
        option.onclick = () => choose(field); flyout.append(option);
    }
    trigger.disabled = !fields.length;
    const open = () => {
        if (trigger.disabled) return;
        flyout.hidden=false; trigger.setAttribute('aria-expanded','true');
        const bounds=trigger.getBoundingClientRect();
        flyout.style.left=Math.max(8, bounds.right + flyout.offsetWidth + 8 > window.innerWidth ? bounds.left - flyout.offsetWidth : bounds.right) + 'px';
        flyout.style.top=Math.max(8, Math.min(bounds.top,window.innerHeight-flyout.offsetHeight-8)) + 'px';
    };
    const close=()=>{flyout.hidden=true;trigger.setAttribute('aria-expanded','false');};
    const inside=(target:EventTarget|null)=>target instanceof Node&&(trigger.contains(target)||flyout.contains(target));
    // The trigger and fixed-position flyout form one hover/focus region.
    trigger.onmouseleave=event=>{if(!inside(event.relatedTarget))close();};
    flyout.onmouseleave=event=>{if(!inside(event.relatedTarget))close();};
    menu.addEventListener('mouseover',event=>{if(!inside(event.target))close();});
    menu.addEventListener('focusin',event=>{if(!inside(event.target))close();});
    trigger.addEventListener('focusout',event=>{if(!inside(event.relatedTarget))close();});
    flyout.addEventListener('focusout',event=>{if(!inside(event.relatedTarget))close();});
    trigger.onmouseenter=open; trigger.onclick=()=>{open();flyout.querySelector('button')?.focus();};
    trigger.onkeydown=event=>{if(event.key==='ArrowRight'){event.preventDefault();open();flyout.querySelector('button')?.focus();}};
    flyout.onkeydown=event=>{
        const items=Array.from(flyout.querySelectorAll('button')), index=items.indexOf(document.activeElement as HTMLButtonElement);
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();items[(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
        if(event.key==='ArrowLeft'||event.key==='Escape'){event.preventDefault();event.stopPropagation();flyout.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus();}
    };
    menu.append(trigger,flyout);
}

export function bindTransactions(root:HTMLElement, holder:HTMLElement, table:QnaTable, state:AnalysisState,
    rowQuestions:Array<string|null>, configured:boolean,
    load:(question:string)=>Promise<QnaResponse|undefined>, renderTable:(table:QnaTable,question:string)=>HTMLElement, fields:string[] | (()=>string[]) = []) {
    holder.addEventListener('contextmenu',event=>{
        const cell=(event.target as HTMLElement).closest<HTMLElement>('td[data-column-index]');
        const row=cell?.closest<HTMLElement>('tr[data-source-row]');if(!cell||!row||!holder.contains(row))return;
        event.preventDefault();event.stopPropagation();root.querySelector('.askbics-transactions-menu')?.remove();
        const index=Number(row.dataset.sourceRow),column=Number(cell.dataset.sourceColumn??cell.dataset.columnIndex);
        let selected=state;
        if(index<table.rows.length && rowQuestions[index]){
            const question=rowQuestions[index]!;selected=JSON.parse(decodeURIComponent(question.slice(question.indexOf(';analysisState:')+15)));
        }
        const label=table.columns[column]||'';
        const period:AnalysisState['transactions']=state.mode==='breakdown'?'current':column===1||label.startsWith(state.period+' ·')?'current':column===2||!!state.comparison&&label.startsWith(state.comparison+' ·')?'comparison':'both';
        const menu=document.createElement('div');menu.className='askbics-transactions-menu';menu.setAttribute('role','menu');
        const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.textContent=configured?'Show transactions':'Configure transaction fields in settings';button.disabled=!configured;
        button.onclick=()=>{menu.remove();void openTransactions(root,analysisQuestion({...selected,transactions:period}),cell,load,renderTable);};menu.append(button);
        appendSummarizeMenu(menu,typeof fields==='function'?fields():fields,field=>{menu.remove();void openTransactions(root,analysisQuestion({...selected,transactions:period,summarizeBy:field}),cell,load,renderTable,`Summarize by ${field}`);});root.append(menu);
        appendCashFlowMenu(menu,root,[{question:analysisQuestion({...selected,transactions:period})}]);
        menu.style.left=`${Math.max(8,Math.min(event.clientX,window.innerWidth-menu.offsetWidth-8))}px`;
        menu.style.top=`${Math.max(8,Math.min(event.clientY,window.innerHeight-menu.offsetHeight-8))}px`;
        menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();menu.remove();cell.focus();}});
        menu.addEventListener('focusout',event=>{if(!menu.contains(event.relatedTarget as Node | null))queueMicrotask(()=>menu.remove());});
        button.disabled?menu.setAttribute('tabindex','0'):undefined;(button.disabled?menu:button).focus();
    },true);
}

export async function openTransactions(root:HTMLElement, question:string, anchor:HTMLElement, load:(question:string)=>Promise<QnaResponse|undefined>, renderTable:(table:QnaTable,question:string)=>HTMLElement, heading = "Transaction details") {
        const previous=Array.from(root.querySelectorAll<HTMLElement>('.askbics-transactions-overlay')).filter(item=>!item.hidden).at(-1);
        if(previous){previous.hidden=true;investigationViews.get(previous)?.cancel();}
        const overlay=document.createElement('div');overlay.className='askbics-qna__config-overlay askbics-transactions-overlay';
        const panel=document.createElement('section');panel.className='askbics-transactions-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',heading);
        const back=document.createElement('button');back.type='button';setBackButton(back, "Back");back.setAttribute('aria-label','Back to answer');
        let closed=false;
        const close=()=>{
            if(closed)return;
            closed=true;
            removalObserver.disconnect();root.removeEventListener('askbics-transaction-invalidate',invalidateCache);
            cancelPending();
            cache.clear();
            ++revision; // Late query responses must not republish an exited selection.
            if(selectionTimer)clearTimeout(selectionTimer);
            summarySelection.clear();
            if(heading==='Transaction details'){
                // Clear only the outgoing report selection, not the original answer's
                // question, period, Always filters or saved transaction rules.
                (root.closest('.askbics-qna')||root).dispatchEvent(new CustomEvent('askbics-summary-selection',{bubbles:true,detail:[]}));
            }
            root.dispatchEvent(new CustomEvent('askbics-transaction-navigation',{bubbles:true,detail:false}));
            overlay.remove();if(previous)previous.hidden=false;anchor.focus();
        };back.onclick=close;
        if(previous)back.setAttribute('aria-label','Back to '+(investigationViews.get(previous)?.label||'previous view'));
        const selectedRow=anchor.closest('tr');
        const selectedLabel=selectedRow?.querySelector('td')?.textContent?.trim();
        const label=heading==='Transaction details'?'Transactions':heading.replace(/^Summarize by /,'');
        investigationViews.set(overlay,{parent:previous,label,close,cancel:()=>cancelPending()});
        const trail:HTMLElement[]=[];
        for(let item=previous;item;item=investigationViews.get(item)?.parent)trail.unshift(item);
        const crumbs=document.createElement('nav');crumbs.className='askbics-investigation-breadcrumbs';crumbs.setAttribute('aria-label','Investigation path');
        const go=(target?:HTMLElement)=>{let item:HTMLElement|undefined=overlay;while(item&&item!==target){const state=investigationViews.get(item);if(!state)break;state.close();item=state.parent;}target?.querySelector<HTMLButtonElement>('.askbics-transactions-head button')?.focus();};
        const crumb=(text:string,target?:HTMLElement,current=false)=>{if(crumbs.childElementCount){const separator=document.createElement('span');separator.textContent='›';separator.setAttribute('aria-hidden','true');crumbs.append(separator);}const item=document.createElement(current?'span':'button');item.textContent=text;item.title=text;if(current)item.setAttribute('aria-current','page');else{(item as HTMLButtonElement).type='button';item.onclick=()=>go(target);}crumbs.append(item);};
        crumb('Answer');for(const ancestor of trail)crumb(investigationViews.get(ancestor)!.label,ancestor);
        crumb(selectedLabel&&selectedLabel!=='Grand Total'?`${selectedLabel} · ${label}`:label,undefined,true);
        const head=document.createElement('div');head.className='askbics-transactions-head';const title=document.createElement('strong');title.textContent=heading;head.append(back,title,crumbs);
        const body=document.createElement('div');body.className='askbics-transactions-body';panel.append(head,body);overlay.append(panel);root.append(overlay);
        let revision=0;
        let active:AbortController|undefined;
        let baseAnswer:QnaResponse|undefined;
        const cache=new Map<string,QnaResponse>();
        const invalidateCache=()=>{cache.clear();baseAnswer=undefined;};
        root.addEventListener('askbics-transaction-invalidate',invalidateCache);
        const cancelPending=()=>{
            if(active&&!active.signal.aborted){active.abort();root.dispatchEvent(new CustomEvent('askbics-cancel-transactions',{bubbles:true}));}
        };
        let selectionTimer:ReturnType<typeof setTimeout>|undefined;
        const summarySelection=new Map<string,Set<string>>();
        let summaryBase:TransactionScope[]|undefined;
        let ruleView:TransactionRuleView|undefined;
        const refresh=async(currentQuestion:string,publish?:(result?:QnaTable)=>void)=>{
        cancelPending();
        const controller=new AbortController();active=controller;
        const current=++revision;
        const guardedLoad=async(q:string)=>{
            if(closed||controller.signal.aborted)throw new Error('Query cancelled.');
            const cached=cache.get(q);if(cached)return cached;
            const result=await load(q);
            if(closed||controller.signal.aborted)throw new Error('Query cancelled.');
            if(result?.table&&(result.transactionTables||[{table:result.table}]).every(s=>s.table.modelResultComplete===true)){
                cache.set(q,result);
                if(result.transactionRule&&q.startsWith(';transactions:')){
                    const scopes=JSON.parse(decodeURIComponent(q.slice(14))) as TransactionScope[];
                    cache.set(transactionQuestion(scopes.map(scope=>({...scope,transactionRuleView:result.transactionRule!.view}))),result);
                }
                while(cache.size>20)cache.delete(cache.keys().next().value!);
            }
            return result;
        };
        const updating=body.childElementCount>0;
        if(!updating)body.replaceChildren();
        body.querySelector('[data-filter-progress]')?.remove();
        const waiting=document.createElement('div');waiting.dataset.filterProgress='true';body.prepend(waiting);
        const loader=updating?undefined:loadingOverlay(waiting,heading === 'Transaction details' ? 'Loading transactions…' : 'Loading summary…');
        if(updating){waiting.className='askbics-summary-loading';waiting.setAttribute('role','status');const spin=document.createElement('span');spin.className='askbics-analysis-loading__spinner';spin.setAttribute('aria-hidden','true');waiting.append(spin,'Updating filters…');}
        const cancel=document.createElement('button');cancel.type='button';setBackButton(cancel,'Back');cancel.onclick=close;if(loader){loader.card.append(cancel);cancel.focus();}
        if(revision===1)overlay.addEventListener('keydown',event=>{
            if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
            if(event.key==='Tab'){
                const items=Array.from(panel.querySelectorAll<HTMLElement>('button,input,select,[tabindex="0"]')).filter(item=>!item.hasAttribute('disabled')&&item.getClientRects().length);
                const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
            }
        });
        try{
            const answer=await guardedLoad(currentQuestion);if(closed||current!==revision||!root.isConnected)return;
            waiting.remove();if(!answer?.table)throw new Error('No transaction details were returned.');body.replaceChildren();
            if(!summarySelection.size)baseAnswer=answer;
            const chips=document.createElement('div');chips.className='askbics-qna__filter-chips askbics-transaction-filter-chips';chips.setAttribute('aria-label','Active transaction filters');body.append(chips);
            const changeSelection=()=>{
                if(!summaryBase?.length)return;
                renderChips();
                if(selectionTimer)clearTimeout(selectionTimer);
                cancelPending();++revision;
                const summaryFilters=[...summarySelection].map(([field,values])=>({field,values:[...values].map(value=>JSON.parse(value))}));
                const next=transactionQuestion(summaryBase.map(scope=>({...scope,transactionRuleView:ruleView,summaryFilters})));
                const sections=baseAnswer?.transactionTables|| (baseAnswer?.table?[{period:question,table:baseAnswer.table}]:[]);
                const local=sections.map(section=>({...section,table:filterTransactionRows(section.table,summarySelection)}));
                if(local.length&&local.every(section=>section.table)){
                    cache.set(next,{...baseAnswer!,table:local[0].table!,transactionTables:local as NonNullable<QnaResponse['transactionTables']>});
                    if(cache.size>20)cache.delete(cache.keys().next().value!);
                    void refresh(next);
                }else selectionTimer=setTimeout(()=>{if(!closed)void refresh(next);},150);
            };
            const renderChips=()=>{
                chips.replaceChildren();chips.hidden=!summarySelection.size;if(chips.hidden)return;
                const caption=document.createElement('span');caption.className='askbics-qna__filter-caption';caption.textContent='Filtered by';chips.append(caption);
                let count=0;
                for(const [field,values] of summarySelection)for(const value of values){
                    count++;
                    const text=String(JSON.parse(value)??'(Blank)');
                    const chip=document.createElement('span');chip.className='askbics-qna__filter-chip';chip.title=field+': '+text;
                    const label=document.createElement('span');label.textContent=text;
                    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove '+field+': '+text);remove.dataset.tooltip='Remove '+text;
                    remove.onclick=()=>{values.delete(value);if(!values.size)summarySelection.delete(field);changeSelection();};chip.append(label,remove);chips.append(chip);
                }
                if(count>1){const clear=document.createElement('button');clear.type='button';clear.className='askbics-qna__filter-clear';clear.textContent='Clear all';clear.onclick=()=>{summarySelection.clear();changeSelection();};chips.append(clear);}
            };renderChips();
            const cardLoads:Array<()=>Promise<void>>=[];
            if(!summaryBase)summaryBase=(answer.transactionTables||[{table:answer.table}]).flatMap(s=>s.table.drillScopes||[]);
            ruleView=answer.transactionRule?.view||ruleView;
            let viewControl:HTMLElement|undefined;
            const details=document.createElement('details');details.className='askbics-transaction-rule-help';const helpTitle=document.createElement('summary');helpTitle.textContent='About this transaction view';details.append(helpTitle);
            if(answer.transactionRule){
                const label=document.createElement('label');label.className='askbics-transaction-view-control';label.title='Rule: '+answer.transactionRule.name;label.textContent='View';
                const select=document.createElement('select');select.setAttribute('aria-label','Transaction rule view');
                for(const [value,text] of [['included',answer.transactionRule.reversal?'Excluding reversals':'Included rows'],['excluded',answer.transactionRule.reversal?(answer.transactionRule.referenceLookup?'Reversals':'Reversal pairs only'):'Excluded rows'],['all','All rows']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
                select.value=answer.transactionRule.view;label.append(select);viewControl=label;settingsSelect(select);
                select.onchange=()=>{
                    const view=select.value as TransactionRuleView;
                    const marker=';analysisState:',index=question.indexOf(marker);
                    const next=question.startsWith(';transactions:')?transactionQuestion((JSON.parse(decodeURIComponent(question.slice(14))) as TransactionScope[]).map(scope=>({...scope,transactionRuleView:view}))):
                        index>=0?analysisQuestion({...JSON.parse(decodeURIComponent(question.slice(index+marker.length))),transactionRuleView:view}):question;
                    ruleView=view;summaryBase=undefined;baseAnswer=undefined;summarySelection.clear();void refresh(next);
                };
                if(answer.transactionRule.view==='all'){const note=document.createElement('p');note.textContent=answer.transactionRule.referenceLookup?'Highlighted rows have matching reversal references or need review. All rows keeps existing filters.':answer.transactionRule.reversal?'Highlighted rows are confirmed reversal pairs or need review; hover for details. All rows keeps existing filters.':'Highlighted rows match the exclusion rule. All rows keeps question, period and Always filters.';details.append(note);}
            }
            if(answer.transactionRule?.reversal){const note=document.createElement('p');note.textContent=answer.transactionRule.referenceLookup?'Rev With is matched against document numbers within the current period and filters. Matching rows are excluded; amounts are not checked. Unmatched references remain visible.': 'Only complete, opposite-value pairs within the current period and filters are hidden. Partial, unmatched or ambiguous reversals remain visible. Review rows: '+(answer.transactionRule.reviewCount||0)+'. Hover highlighted rows for details.';details.append(note);}
            const description=document.createElement('p');description.textContent=answer.text;details.append(description);
            for(const [sectionIndex,section] of (answer.transactionTables || [{period:question,table:answer.table}]).entries()){
                if((answer.transactionTables?.length||0)>1){const heading=document.createElement('h3');heading.textContent=section.period;body.append(heading);}
                const totals=section.table.modelTotals?[section.table.modelTotals]:[];
                const holder=document.createElement('div');let groupingRevision=0;
                const documentLink=heading==='Transaction details'&&section.table.document?.enabled?(row:number,_column:number,anchor:HTMLElement)=>{void openDocumentDetails(root,section.table,row,anchor,load,renderTable);}:undefined;
                const clearingLink=heading==='Transaction details'&&section.table.clearing?.enabled?(row:number,_column:number,anchor:HTMLElement)=>{void openClearingDetails(root,section.table,row,anchor,load,renderTable);}:undefined;
                const groupSubtotal=heading==='Transaction details'?async(column:number)=>{
                    const grouping=++groupingRevision;const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Loading model subtotals…';holder.prepend(status);
                    try{const staged=document.createElement('div');await transactionSubtotals(staged,{...section.table,documentLink,clearingLink},column,guardedLoad,renderTable,()=>holder.replaceChildren(rendered));if(!closed&&current===revision&&grouping===groupingRevision)holder.replaceChildren(...Array.from(staged.childNodes));}catch(error){status.setAttribute('role','alert');status.textContent=(error as Error).message;}
                }:undefined;
                const rendered=renderTable({...section.table,documentLink,clearingLink,groupSubtotal,transactionDetail:heading === "Transaction details",rows:[...section.table.rows,...totals],rowIndices:[...section.table.rowIndices,...totals.map(()=>[])],analysisResult:true,analysisGroupCount:section.table.analysisGroupCount ?? section.table.columns.length-1},`${heading} · ${section.period}`);
                if(viewControl){const toolbar=rendered.querySelector('.askbics-qna__table-toolbar');if(toolbar)toolbar.insertBefore(viewControl,toolbar.children[1]||null);else body.append(viewControl);viewControl=undefined;}
                const cardHost=document.createElement("div");body.append(cardHost);holder.append(rendered);body.append(holder);if(heading === "Transaction details")cardLoads.push(()=>transactionCards(cardHost,holder,section.table,guardedLoad,{values:summarySelection,scopes:section.table.drillScopes,baseTable:baseAnswer?.transactionTables?.find(s=>s.period===section.period)?.table||baseAnswer?.transactionTables?.[sectionIndex]?.table||baseAnswer?.table,signal:controller.signal,change:()=>changeSelection()}));
            }body.append(details);if(!updating)back.focus();
            // Publish report interaction only after our single host query slot is idle.
            for(const cards of cardLoads){if(closed||controller.signal.aborted)break;await cards();}
            if(!closed&&current===revision)publish?.(answer.table);
        }catch(error){if(!closed&&current===revision){waiting.remove();const message=document.createElement('p');message.setAttribute('role','alert');message.textContent=(error as Error).message;body.append(message);back.focus();}}
        };
        const removalObserver=new MutationObserver(()=>{if(!overlay.isConnected)close();});
        removalObserver.observe(root.ownerDocument.body,{childList:true,subtree:true});
        root.dispatchEvent(new CustomEvent('askbics-transaction-navigation',{bubbles:true,detail:true}));
        await refresh(question);
}
