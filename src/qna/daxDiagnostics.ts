export function daxDiagnostics(read:()=>{question:string;queries:string[]}):HTMLElement {
    const section=document.createElement('details');section.className='askbics-settings-disclosure askbics-settings-diagnostics';
    const heading=document.createElement('summary');heading.textContent='DAX query diagnostics';section.append(heading);
    const help=document.createElement('p');section.append(help);
    help.textContent='Exact DAX from the latest completed question in this session, including supporting queries. No queries run when you open this panel. Filter values may appear in the query text.';
    const text=document.createElement('textarea');text.readOnly=true;text.rows=14;text.setAttribute('aria-label','DAX queries');text.style.cssText='width:100%;box-sizing:border-box;font:12px/1.5 monospace';
    const copy=document.createElement('button');copy.type='button';copy.textContent='Copy DAX';copy.className='askbics-settings-action';
    const status=document.createElement('p');status.setAttribute('role','status');
    section.addEventListener('toggle',()=>{if(!section.open)return;const data=read();text.value=data.queries.map((query,index)=>`-- Query ${index+1}\n${query}`).join('\n\n');status.textContent=data.queries.length?`${data.queries.length} queries · ${data.question}`:'No completed query captured. Ask a question first; failed requests are not included.';copy.disabled=!text.value;});
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(text.value);status.textContent='DAX copied.';}catch{text.focus();text.select();status.textContent='Press Ctrl+C to copy the selected DAX.';}};
    section.append(text,copy,status);return section;
}
