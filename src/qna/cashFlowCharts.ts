import {CashAllocation,CashPosting} from '../cashFlow';
const node=(tag:string,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
const amount=(v:number)=>Math.abs(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const sameDocument=(a:CashPosting,b:CashPosting)=>a.company===b.company&&a.year===b.year&&a.document===b.document;
const connection=(a:CashPosting,b:CashPosting)=>b.settlementSources?'Clearing group '+(b.clearing||'—')+' · '+b.settlementSources.length+' source lines':sameDocument(a,b)?'Same document':a.reference?'Reference '+a.reference:a.clearing?'Clearing '+a.clearing:'Linked document';
/** Group only adjacent, identified account postings across documents; never guess from descriptions. */
export function cashFlowSteps(path:CashPosting[]) {
 const groups:CashPosting[][]=[];
 for(const p of path){const prior=groups.at(-1),last=prior?.at(-1);if(last&&!p.settlementSources&&p.account&&p.account===last.account&&p.company===last.company&&p.currency===last.currency&&!sameDocument(last,p))prior!.push(p);else groups.push([p]);}
 return groups;
}
/** Presentation only: no transports, model queries or selection callbacks. */
export function cashFlowChart(host:HTMLElement,allocations:CashAllocation[],kind:'flow'|'allocation',inspect?:(posting:CashPosting,postings:CashPosting[])=>void) {
 host.append(node('p','Selected trace only. Amounts show allocated cash; original posting amounts remain in Accounting entries.'));
 if(kind==='flow'){
 let shown=0;const more=node('button','Show more paths') as HTMLButtonElement;more.type='button';
 const draw=()=>{more.remove();for(const a of allocations.slice(shown,shown+10)){const section=node('section');section.className='askbics-trace-flow';section.append(node('h3',(a.amount<0?'Payment':'Receipt')+' '+amount(a.amount)+' '+(a.path[0]?.currency||'')+' · '+a.status));
 if(a.basis)section.append(node('p',a.basis));
 section.append(node('small','Company '+(a.path[0]?.company||'—')));
 const steps=cashFlowSteps(a.path);
 steps.forEach((postings,i)=>{
 const p=postings[0];
 if(i){const edge=node('div');edge.className='askbics-trace-edge';const arrow=node('span');arrow.className='askbics-trace-connector';arrow.setAttribute('aria-hidden','true');edge.append(arrow,node('small',connection(steps[i-1].at(-1)!,p)));section.append(edge);}
 const box=node(inspect?'button':'div');
 if(inspect){(box as HTMLButtonElement).type='button';box.setAttribute('aria-label','Show entries for '+(p.accountDescription||p.account||p.document));box.title='Inspect the selected node documents and matching account rows. Back returns to the flow diagram. Does not change report filters.';box.setAttribute('data-settings-help',box.title);box.onclick=()=>inspect(p,postings);}
 box.className='askbics-trace-node';if(i===0)box.classList.add('is-start');if(i===steps.length-1)box.classList.add(a.status==='Resolved'?'is-end':'is-unresolved');
 const docs=postings.map(row=>row.document+(row.year?' ('+row.year+')':''));
 box.append(node('strong',(p.accountDescription||p.account||'Document '+p.document)+(p.accountDescription&&p.account?' · '+p.account:'')),node('small',(docs.length>1?'Documents ':'Document ')+docs.join(' → ')));
 if(p.settlementSources)box.append(node('small','Group settlement; no source-line-to-invoice pairing'));
 const links=postings.slice(1).map((row,j)=>connection(postings[j],row));if(links.length)box.append(node('small',[...new Set(links)].join(' · ')));
 section.append(box);
 });host.append(section);}shown+=10;if(shown<allocations.length)host.append(more);};more.onclick=draw;draw();return;
 }
 const groups=new Map<string,CashAllocation[]>();for(const a of allocations){const p=a.path[0];const key=JSON.stringify([p.company,p.currency,a.amount<0?'Payment':'Receipt']);const group=groups.get(key)||[];group.push(a);groups.set(key,group);}
 for(const group of groups.values()){
 const p=group[0].path[0],total=group.reduce((n,a)=>n+Math.abs(a.amount),0);const section=node('section');section.append(node('h3',(group[0].amount<0?'Payment':'Receipt')+' allocation · Company '+p.company+(p.currency?' · '+p.currency:'')));
 const destinations=new Map<string,{label:string,value:number}>();for(const a of group){const end=a.path.at(-1)!;const label=a.status==='Estimated'?'Estimated · '+(end.accountDescription||a.account||a.category):a.status==='Resolved'?(end.accountDescription||a.account||a.category):'Unresolved · '+a.status;const key=JSON.stringify([a.account,label]);const old=destinations.get(key)||{label,value:0};old.value+=Math.abs(a.amount);destinations.set(key,old);}
 const entries=[...destinations.values()].sort((a,b)=>b.value-a.value);const shown=entries.slice(0,12);if(entries.length>12)shown.push({label:'Other destinations ('+(entries.length-12)+')',value:entries.slice(12).reduce((n,e)=>n+e.value,0)});
 const height=Math.max(180,shown.length*90+100),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 640 '+height);svg.setAttribute('role','img');svg.setAttribute('aria-label','Allocated cash '+amount(total)+' across '+entries.length+' destinations');svg.classList.add('askbics-trace-sankey');
 const shape=(tag:string,attrs:Record<string,string>,text='')=>{const e=document.createElementNS(svg.namespaceURI,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);e.textContent=text;svg.append(e);return e;};
 let offset=40;shown.forEach((e,i)=>{const width=total?e.value/total*100:0,y=90+i*90;const color=e.label.startsWith('Unresolved')?'#b7791f':['#2563eb','#08916b','#7c3aed'][i%3];shape('path',{d:'M 100 '+(offset+width/2)+' C 270 '+(offset+width/2)+', 300 '+y+', 400 '+y,fill:'none',stroke:color,'stroke-width':String(width),opacity:'.35'});shape('rect',{x:'395',y:String(y-Math.max(width,2)/2),width:'12',height:String(Math.max(width,2)),rx:'3',fill:color});const text=shape('text',{x:'420',y:String(y-5),fill:'#16345b','font-size':'13'},e.label.length>25?e.label.slice(0,24)+'…':e.label);const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=e.label;text.append(title);shape('text',{x:'420',y:String(y+14),fill:'#526b8d','font-size':'12'},amount(e.value)+' · '+(total?e.value/total*100:0).toFixed(1)+'%');offset+=width;});
 shape('rect',{x:'88',y:'40',width:'12',height:'100',rx:'4',fill:'#2563eb'});shape('text',{x:'10',y:'22',fill:'#16345b','font-size':'13'},'Selected cash');shape('text',{x:'10',y:'165',fill:'#16345b','font-size':'13'},amount(total));section.append(svg);
 const list=node('ul');for(const e of entries)list.append(node('li',e.label+' · '+amount(e.value)+' · '+(total?e.value/total*100:0).toFixed(1)+'%'));const details=node('details');details.append(node('summary','Allocation values'),list);section.append(details);host.append(section);
 }
}
