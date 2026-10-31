import { formatPowerBiValue } from '../dataAdapter';
import { settingsSelect } from './settingsSelect';
import { QnaChart } from './types';
export interface WaterfallRow { include:boolean; total:boolean; mode:'loaded'|'running'; label:string; reverse?:boolean }
export function waterfallSteps(values:number[],totals:boolean[],modes:Array<'loaded'|'running'>=[]) {
 let balance=0;const warnings:number[]=[];
 const steps=values.map((value,index)=>{if(!Number.isFinite(value))throw new Error('Waterfall requires finite numeric values.');const before=balance;
  if(totals[index]){const end=modes[index]==='running'?balance:value;if(modes[index]!=='running'&&index>0&&Math.abs(end-balance)>Math.max(1,Math.abs(end),Math.abs(balance))*1e-8)warnings.push(index);balance=end;return {start:0,end,value:end,total:true,before};}
  balance+=value;return {start:before,end:balance,value,total:false,before};
 });return {steps,warnings,balance};
}
export function waterfallView(chart:QnaChart,rows:WaterfallRow[]):QnaChart {
 const indices:number[]=[];let segment:number[]=[];
 const flush=()=>{if(chart.waterfallSort==='positive')segment.sort((a,b)=>{const sign=(i:number)=>{const value=chart.values[i]*(rows[i].reverse?-1:1);return value>0?0:value===0?1:2;};return sign(a)-sign(b);});indices.push(...segment);segment=[];};
 rows.forEach((row,i)=>{if(row.total){flush();if(row.include)indices.push(i);}else if(row.include)segment.push(i);});flush();
 if(!indices.length)throw new Error('Include at least one category.');
 const result={...chart,labels:indices.map(i=>rows[i].label||chart.labels[i]),values:indices.map(i=>chart.values[i]*(rows[i].reverse && !(rows[i].total&&rows[i].mode==='running')?-1:1)),valueLabels:indices.map(i=>formatPowerBiValue(chart.values[i]*(rows[i].reverse&&!(rows[i].total&&rows[i].mode==='running')?-1:1),chart.valueFormat,chart.formatHint)),rowIndices:indices.map(i=>chart.rowIndices[i]),periodDetails:chart.periodDetails?indices.map(i=>chart.periodDetails![i]):undefined,modelRowSelections:chart.modelRowSelections?indices.map(i=>chart.modelRowSelections![i]):undefined,groupValues:chart.groupValues?indices.map(i=>chart.groupValues![i]):undefined,waterfall:{originalValues:indices.map(i=>chart.values[i]),totals:indices.map(i=>rows[i].total),modes:indices.map(i=>rows[i].mode)}};
 return result;
}
export function waterfallEditor(chart:QnaChart,apply:(view:QnaChart)=>void, initiallyOpen=false) {
 const element=document.createElement('details');element.className='askbics-waterfall-editor';element.open=initiallyOpen;
 const summary=document.createElement('summary');summary.textContent='Waterfall setup · '+chart.labels.length+' steps';element.append(summary);
 const note=document.createElement('p');note.textContent='Choose steps, rename labels and mark totals. Excluded steps do not affect the balance; totals are not added twice.';element.append(note);
 const rows:WaterfallRow[]=chart.waterfallRows?structuredClone(chart.waterfallRows):chart.labels.map((label,i)=>({include:true,total:chart.waterfall?.totals[i]||false,mode:chart.waterfall?.modes[i]||'loaded',label}));
 const scroll=document.createElement('div');scroll.className='askbics-waterfall-rows';const table=document.createElement('table');const head=document.createElement('thead'),hr=document.createElement('tr');for(const title of ['Include','Step / display name','Loaded value','Total','Reverse sign','Applied value','Total basis']){const th=document.createElement('th');th.textContent=title;hr.append(th);}head.append(hr);table.append(head);const body=document.createElement('tbody');table.append(body);scroll.append(table);element.append(scroll);
 rows.forEach((row,i)=>{const tr=document.createElement('tr');const cell=(node:Node)=>{const td=document.createElement('td');td.append(node);tr.append(td);};const check=(label:string,value:boolean,change:(checked:boolean)=>void)=>{const input=document.createElement('input');input.type='checkbox';input.checked=value;input.setAttribute('aria-label',label+' '+chart.labels[i]);input.onchange=()=>change(input.checked);return input;};
 cell(check('Include',row.include,value=>row.include=value));const name=document.createElement('input');name.value=row.label;name.setAttribute('aria-label','Display name '+chart.labels[i]);name.oninput=()=>row.label=name.value;cell(name);cell(document.createTextNode(chart.valueLabels[i]));
 const mode=document.createElement('select');mode.setAttribute('aria-label','Total value '+chart.labels[i]);for(const [value,label] of [['loaded','Use loaded value'],['running','Calculate running total']]){const option=document.createElement('option');option.value=value;option.textContent=label;mode.append(option);}mode.value=row.mode;mode.disabled=!row.total;mode.onchange=()=>{row.mode=mode.value as WaterfallRow['mode'];refreshSign();};cell(check('Intermediate total',row.total,value=>{row.total=value;mode.disabled=!value;refreshMode();refreshSign();}));const reverse=check('Reverse sign',!!row.reverse,value=>{row.reverse=value;refreshSign();});cell(reverse);const applied=document.createElement('span');cell(applied);const refreshSign=()=>{reverse.disabled=row.total&&row.mode==='running';applied.textContent=reverse.disabled?'Running balance':(chart.values[i]*(row.reverse?-1:1)).toLocaleString(undefined,{maximumFractionDigits:6});};refreshSign();cell(mode);body.append(tr);const refreshMode=settingsSelect(mode,false);
 });
 const status=document.createElement('p');status.setAttribute('role','status');const button=document.createElement('button');button.type='button';button.className='askbics-settings-action is-primary';button.textContent='Apply waterfall';button.dataset.waterfallApply='true';button.onclick=()=>{try{const view=waterfallView(chart,rows);chart.waterfallRows=structuredClone(rows);element.dispatchEvent(new Event("waterfall-apply",{bubbles:true}));apply(view);status.textContent='Waterfall updated.';element.open=false;}catch(error){status.textContent=(error as Error).message;}};const footer=document.createElement('div');footer.className='askbics-waterfall-editor-actions';footer.append(status,button);element.append(footer);return element;
}

/** Natural chronological order for dates/numbered financial steps, preserving source order otherwise. */
export function sortWaterfall(chart:QnaChart,order:'auto'|'label'|'source'='auto'):QnaChart {
 const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
 const key=(label:string)=>{const text=label.toLowerCase().trim();const month=months.findIndex(m=>m===text||m.slice(0,3)===text);if(month>=0)return month;const date=/^(\d{4})[-/](\d{1,2})$/.exec(text);if(date)return Number(date[1])*12+Number(date[2]);const named=/^([a-z]+) (\d{4})$/.exec(text);if(named){const m=months.findIndex(v=>v.startsWith(named[1]));if(m>=0)return Number(named[2])*12+m+1;}return /^\d+(?:\s|$)/.test(text)?Number(text.match(/^\d+/)![0]):null;};
 if(order==='source'||order==='auto'&&chart.labels.some(label=>key(label)===null))return chart;
 const indices=chart.labels.map((_,i)=>i).sort((a,b)=>order==='label'?chart.labels[a].localeCompare(chart.labels[b],undefined,{numeric:true}):key(chart.labels[a])!-key(chart.labels[b])!);
 return {...chart,labels:indices.map(i=>chart.labels[i]),values:indices.map(i=>chart.values[i]),valueLabels:indices.map(i=>chart.valueLabels[i]),rowIndices:indices.map(i=>chart.rowIndices[i]),modelRowSelections:chart.modelRowSelections?indices.map(i=>chart.modelRowSelections![i]):undefined,groupValues:chart.groupValues?indices.map(i=>chart.groupValues![i]):undefined,waterfallRows:chart.waterfallRows?indices.map(i=>chart.waterfallRows![i]):undefined};
}
