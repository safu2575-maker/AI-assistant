import { QnaTable, QnaResponse } from './types';
import { transactionQuestion } from '../answerTransactions';

/** Model subtotals; detail rows are never summed, merged or discarded. */
export async function transactionSubtotals(host:HTMLElement, table:QnaTable, column:number, load:(q:string)=>Promise<QnaResponse|undefined>, render:(t:QnaTable,q:string)=>HTMLElement, restore:()=>void) {
    if(!table.drillScopes?.length)throw new Error('Subtotal query context is unavailable. Reopen transactions.');
    if(table.modelResultComplete===false)throw new Error('Load a complete transaction result before grouping.');
    const field=table.columns[column], count=table.analysisGroupCount??table.columns.length-1;
    const response=await load(transactionQuestion(table.drillScopes.map(s=>({...s,summarizeBy:field}))));
    const summary=response?.table;
    if(!summary?.modelGroupValues)throw new Error('Model subtotal values are unavailable.');
    const key=(v:unknown)=>JSON.stringify(v??null);
    const totals=new Map(summary.modelGroupValues.map((v,i)=>[key(v[0]),summary.rows[i].slice(1)]));
    const groups=new Map<string,number[]>();
    table.rows.forEach((_,i)=>{const value=table.modelGroupValues?.[i]?.[column];if(value===undefined)throw new Error('Transaction grouping identities are unavailable.');const k=key(value);groups.set(k,[...(groups.get(k)||[]),i]);});
    const content=document.createElement('div');content.className='askbics-transaction-subtotals';
    const toolbar=document.createElement('div');toolbar.className='askbics-subtotal-toolbar';toolbar.append('Grouped by '+field);content.append(toolbar);
    const button=(label:string,run:()=>void)=>{const b=document.createElement('button');b.type='button';b.className='askbics-settings-action';b.textContent=label;b.onclick=run;toolbar.append(b);};
    button('Expand all',()=>content.querySelectorAll('details').forEach(d=>d.open=true));button('Collapse all',()=>content.querySelectorAll('details').forEach(d=>d.open=false));button('Remove grouping',restore);
    for(const [k,indices] of groups){
        const subtotal=totals.get(k);if(!subtotal)throw new Error('A model subtotal is missing. Try refreshing transactions.');
        const details=document.createElement('details');details.open=true;const heading=document.createElement('summary');
        const label=document.createElement('strong');label.textContent=String(table.rows[indices[0]][column]||'Unassigned');heading.append(label);
        subtotal.forEach((value,i)=>{const amount=document.createElement('span');amount.textContent=table.columns[count+i]+': '+value;heading.append(amount);});details.append(heading);
        const subset:QnaTable={...table,documentLink:table.documentLink?(row,column,anchor)=>table.documentLink!(indices[row],column,anchor):undefined,clearingLink:table.clearingLink?(row,column,anchor)=>table.clearingLink!(indices[row],column,anchor):undefined,transactionDetail:true,analysisResult:true,analysisGroupCount:count,groupSubtotal:undefined,modelTotals:undefined,rows:indices.map(i=>table.rows[i]),rowIndices:indices.map(i=>table.rowIndices[i]),modelGroupValues:indices.map(i=>table.modelGroupValues![i]),modelRawRows:table.modelRawRows?indices.map(i=>table.modelRawRows![i]):undefined,transactionExcludedRows:indices.flatMap((i,j)=>table.transactionExcludedRows?.includes(i)?[j]:[]),transactionReviewRows:Object.fromEntries(indices.flatMap((i,j)=>table.transactionReviewRows?.[i]?[[j,table.transactionReviewRows[i]]]:[]))};
        details.append(render(subset,'Transactions · '+label.textContent));content.append(details);
    }
    if(table.modelTotals){const total=render({...table,groupSubtotal:undefined,rows:[table.modelTotals],rowIndices:[[]],modelGroupValues:[],modelRawRows:[],transactionExcludedRows:[],transactionReviewRows:{}},'Transaction grand total');content.append(total);}
    host.replaceChildren(content);
}
