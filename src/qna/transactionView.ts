import { setBackButton } from "./backButton";
import { AnalysisState, analysisQuestion } from "../analysisTemplates";
import { QnaResponse, QnaTable } from "./types";
import { loadingOverlay } from "./loadingOverlay";

export function bindTransactions(root:HTMLElement, holder:HTMLElement, table:QnaTable, state:AnalysisState,
    rowQuestions:Array<string|null>, configured:boolean,
    load:(question:string)=>Promise<QnaResponse|undefined>, renderTable:(table:QnaTable,question:string)=>HTMLElement) {
    const open=async(next:AnalysisState,anchor:HTMLElement)=>{
        root.querySelector('.askbics-transactions-overlay')?.remove();
        const overlay=document.createElement('div');overlay.className='askbics-qna__config-overlay askbics-transactions-overlay';
        const panel=document.createElement('section');panel.className='askbics-transactions-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Transaction details');
        const back=document.createElement('button');back.type='button';setBackButton(back, "Back");back.setAttribute('aria-label','Back to analysis');
        let closed=false;
        const close=()=>{closed=true;overlay.remove();anchor.focus();};back.onclick=close;
        const head=document.createElement('div');head.className='askbics-transactions-head';const title=document.createElement('strong');title.textContent='Transaction details';head.append(back,title);
        const body=document.createElement('div');body.className='askbics-transactions-body';panel.append(head,body);overlay.append(panel);root.append(overlay);
        const waiting=document.createElement('div');body.append(waiting);const loader=loadingOverlay(waiting,'Loading transactions…');
        const cancel=document.createElement('button');cancel.type='button';setBackButton(cancel,'Back');cancel.onclick=close;loader.card.append(cancel);cancel.focus();
        overlay.addEventListener('keydown',event=>{
            if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
            if(event.key==='Tab'){
                const items=Array.from(panel.querySelectorAll<HTMLElement>('button,input,select,[tabindex="0"]')).filter(item=>!item.hasAttribute('disabled')&&item.getClientRects().length);
                const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
            }
        });
        try{
            const answer=await load(analysisQuestion(next));if(closed||!root.isConnected)return;
            waiting.remove();if(!answer?.table)throw new Error('No transaction details were returned.');
            const description=document.createElement('p');description.textContent=answer.text;body.append(description);
            body.append(renderTable({...answer.table,analysisResult:true,analysisGroupCount:answer.table.columns.length-1},`Transactions · ${next.measure} · ${next.transactions==='comparison'?next.comparison:next.period}${next.transactions==='both'&&next.comparison?' versus '+next.comparison:''}`));back.focus();
        }catch(error){if(!closed){waiting.remove();const message=document.createElement('p');message.setAttribute('role','alert');message.textContent=(error as Error).message;body.append(message);back.focus();}}
    };
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
        button.onclick=()=>{menu.remove();void open({...selected,transactions:period},cell);};menu.append(button);root.append(menu);
        menu.style.left=`${Math.max(8,Math.min(event.clientX,window.innerWidth-menu.offsetWidth-8))}px`;
        menu.style.top=`${Math.max(8,Math.min(event.clientY,window.innerHeight-menu.offsetHeight-8))}px`;
        menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();menu.remove();cell.focus();}});
        menu.addEventListener('focusout',()=>{queueMicrotask(()=>{if(!menu.contains(document.activeElement))menu.remove();});});
        button.disabled?menu.setAttribute('tabindex','0'):undefined;(button.disabled?menu:button).focus();
    },true);
}
