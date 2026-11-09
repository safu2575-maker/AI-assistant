import { AgingSetup, defaultAgingBuckets, validateAging } from '../aging';
import { settingsSelect } from './settingsSelect';
import { decorateSettingsAction } from './settingsActionIcon';

export function agingSettings(current:AgingSetup[]|undefined,fields:string[],measures:string[]) {
    let items=structuredClone(current||[]), editing=-1;
    const element=document.createElement('section');element.className='askbics-aging-settings';
    const list=document.createElement('div'),editor=document.createElement('div'),status=document.createElement('p');
    editor.className='askbics-aging-editor';editor.hidden=true;status.setAttribute('role','alert');
    const action=(text:string,parent:HTMLElement,fn:()=>void)=>{const b=document.createElement('button');b.type='button';b.className='askbics-settings-action';b.textContent=text;decorateSettingsAction(b,text);b.onclick=fn;parent.append(b);return b;};
    element.append(list);
    const add=action('Add aging setup',element,()=>{if(!commit())return;open();});
    element.append(editor,status);
    const label=(text:string,help:string)=>{const l=document.createElement('div');l.className='askbics-aging-control';const caption=document.createElement('span');caption.textContent=text;caption.dataset.settingsHelp=help;l.append(caption);editor.append(l);return l;};
    const input=(text:string,help:string,type='text')=>{const i=document.createElement('input');i.type=type;i.setAttribute('aria-label',text);label(text,help).append(i);return i;};
    const select=(text:string,values:string[],help:string)=>{const s=document.createElement('select');s.setAttribute('aria-label',text);for(const v of values){const o=document.createElement('option');o.value=v;o.textContent=v==='detailed'?'Detailed':v==='summary'?'Summary':v||'Choose…';s.append(o);}label(text,help).append(s);const refresh=settingsSelect(s);return {s,refresh};};
    const name=input('Aging name','Use this name in questions, for example: Show Customer aging.');
    const date=select('Aging date field',['',...fields],'Select the date used to calculate age: due date for overdue days, or posting date for elapsed days. Missing dates appear in Date unavailable, never as zero days.');
    const measure=select('Outstanding amount measure',['',...measures],'Choose the model measure for outstanding balances. Historical dates require a measure that calculates balances at the selected as-of date; this feature does not reconstruct payments.');
    const additive=document.createElement('input');additive.type='checkbox';additive.setAttribute('aria-label','Balances can be added');
    const additiveLabel=document.createElement('label');additiveLabel.textContent='Balances can be added (faster aging)';additiveLabel.dataset.settingsHelp='Enable for a SUM of outstanding balances that can be added across dates and customers within one snapshot. Loads daily balances once. Leave off for ratios, averages, distinct counts or repeated totals.';additiveLabel.append(additive);editor.append(additiveLabel);
    const help=document.createElement('p');help.textContent='Results show overall balances. Add by Customer (using your field name) to request a breakdown. New setups use Detailed buckets; add summary to your question for a summary view. Bucket limits are inclusive. Leave the first minimum and last maximum empty. Use the same summary label to combine adjacent bands.';editor.append(help);
    const buckets=document.createElement('div');buckets.className='askbics-aging-buckets';editor.append(buckets);
    const bucketRows:Array<{label:HTMLInputElement;min:HTMLInputElement;max:HTMLInputElement;summary:HTMLInputElement}>=[];
    const drawBuckets=(values: AgingSetup['buckets'])=>{buckets.replaceChildren();bucketRows.length=0;
        const head=document.createElement('div');head.className='askbics-aging-bucket';for(const text of ['Label','From day','To day','Summary','']){const h=document.createElement('strong');h.textContent=text;head.append(h);}buckets.append(head);
        values.forEach((v,index)=>{const row=document.createElement('div');row.className='askbics-aging-bucket';const controls={} as typeof bucketRows[number];for(const key of ['label','min','max','summary'] as const){const i=document.createElement('input');i.setAttribute('aria-label',`Bucket ${index+1} ${key}`);i.type=key==='min'||key==='max'?'number':'text';i.value=v[key]===null?'':String(v[key]);row.append(i);controls[key]=i;}bucketRows.push(controls);action('Delete',row,()=>drawBuckets(readBuckets().filter((_,i)=>i!==index)));buckets.append(row);});};
    const readBuckets=()=>bucketRows.map(r=>({label:r.label.value.trim(),min:r.min.value===''?null:Number(r.min.value),max:r.max.value===''?null:Number(r.max.value),summary:r.summary.value.trim()}));
    action('Add bucket',editor,()=>{if(bucketRows.length<20)drawBuckets([...readBuckets(),{label:'',min:0,max:null,summary:''}]);});
    action('Cancel edit',editor,()=>{editor.hidden=true;editing=-1;status.textContent='';});
    const readDraft=():AgingSetup=>({additive:additive.checked,name:name.value.trim(),basis:items[editing]?.basis||'Due date',dateField:date.s.value,measure:measure.s.value,group:items[editing]?.group||'',asOfField:items[editing]?.asOfField||'',defaultDate:items[editing]?.defaultDate||'',display:items[editing]?.display||'detailed',buckets:readBuckets()});
    const commit=()=>{try{if(!editor.hidden){const next=[...items];if(editing<0)next.push(readDraft());else next[editing]=readDraft();validateAging(next,fields,measures);items=next;editor.hidden=true;editing=-1;render();}status.textContent='';return true;}catch(e){status.textContent=(e as Error).message;return false;}};
    const open=(index=-1)=>{editing=index;const v=items[index]||{name:'',basis:'Due date',dateField:'',measure:'',group:'',asOfField:'',defaultDate:'',display:'detailed',buckets:defaultAgingBuckets()};additive.checked=items[index]?.additive===true;name.value=v.name;date.s.value=v.dateField;measure.s.value=v.measure;for(const x of [date,measure])x.refresh();drawBuckets(v.buckets);editor.hidden=false;name.focus();};
    const render=()=>{list.replaceChildren();items.forEach((v,index)=>{const row=document.createElement('div');row.className='askbics-synonym-entry';const text=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('span');title.textContent=v.name;detail.textContent=`${v.measure} · ${v.dateField} · ${v.buckets.length} buckets`;text.append(title,detail);row.append(text);action('Edit',row,()=>{if(commit())open(index);});action('Delete',row,()=>{items.splice(index,1);editor.hidden=true;editing=-1;render();});list.append(row);});add.disabled=false;};
    render();return {element,read:()=>items,validate:()=>{if(!commit())return false;try{validateAging(items,fields,measures);return true;}catch(e){status.textContent=(e as Error).message;return false;}}};
}
