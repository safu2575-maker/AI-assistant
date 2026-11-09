import { settingsActionIcon } from './settingsActionIcon';

const number=(value:string)=>{const n=Number(value);return value.trim()!==''&&Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:6}):value;};
/** Condense existing evidence for hover; retain the original notes for full inspection. */
export function calculationTooltipSummary(name:string,column:string,value:string,notes:string[]):string[] {
 const title=name+(column&&!['Value',name].includes(column)?' · '+column:'');
 const sources=notes.flatMap(line=>{const m=/^(?!Context:)(.+?) = (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|Blank)$/i.exec(line);return m?[m[1]]:[];});
 const unique=(lines:string[])=>[...new Set(lines.filter(Boolean))];
 const sourceNames=unique(sources);
 const contexts:string[]=[];let contextSource='';for(const line of notes){const native=/^(?!Context:)(.+?) = (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|Blank)$/i.exec(line);if(native)contextSource=native[1];if(line.startsWith('Context: ')){const text=line.slice(9).split('; ').filter(part=>!(/^(?:fiscal\s*)?year:\s*/i.test(part)&&part.replace(/^(?:fiscal\s*)?year:\s*/i,'')===column)).join('; ');if(text)contexts.push((sourceNames.length>1&&contextSource?contextSource+': ':'')+text);}}
 const failure=unique(notes.filter(line=>line.startsWith('Unavailable:')));
 const root=notes.map((line,i)=>({line,i})).filter(x=>/^[^\s].* → /.test(x.line)).at(-1);
 const children=root?notes.slice(root.i+1).filter(line=>/^  [^\s].* → /.test(line)).map(line=>{const at=line.lastIndexOf(' → ');return {label:line.slice(2,at),value:line.slice(at+3)};}):[];
 const ratio=root&&/^(?:\/|DIVIDE) → /.test(root.line)&&children.length>=2;
 return unique([title,ratio?'Result: '+value:value,...(ratio?[`Numerator: ${children[0].label} = ${number(children[0].value)}`,`Denominator: ${children[1].label} = ${number(children[1].value)}`]:[sourceNames.join(' · ')]),...unique(contexts),...failure]);
}

/** Uses cached evidence only; opening the dialog never evaluates another model query. */
export function openCalculationDetails(root:HTMLElement,opener:HTMLElement,title:string,value:string,notes:string[]):void {
 root.querySelector('.askbics-calculation-detail-overlay')?.remove();
 const overlay=document.createElement('div');overlay.className='askbics-qna__config-overlay askbics-calculation-detail-overlay';
 const panel=document.createElement('section');panel.className='askbics-qna__config-panel askbics-calculation-detail-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Calculation details');
 const head=document.createElement('div');head.className='askbics-qna__config-head';const heading=document.createElement('h3');heading.textContent='Calculation details';
 const close=document.createElement('button');close.type='button';settingsActionIcon(close,'close','Close calculation details');head.append(heading,close);
 const summary=document.createElement('p');summary.textContent=title+' · '+value;
 const body=document.createElement('pre');body.className='askbics-calculation-detail-evidence';body.textContent=notes.join('\n');
 panel.append(head,summary,body);overlay.append(panel);root.append(overlay);
 const dismiss=()=>{overlay.remove();opener.focus({preventScroll:true});};close.onclick=dismiss;overlay.onpointerdown=e=>{if(e.target===overlay)dismiss();};
 overlay.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dismiss();}else if(e.key==='Tab'){e.preventDefault();close.focus();}};close.focus();
}
