import { monthlyPeriod } from './monthlyPeriods';
import { BasicFilter } from 'powerbi-models';
import { ParameterConfig, ParameterPlan, planParameterQuestion } from './parameterQuery';
import { QnaResponse, QnaTable } from './qna/types';
import { calendarMonths, monthIndexLabel } from './timeSetup';

/** Resolve undated periods from complete model data; evaluate cumulative windows in the model. */
export async function answerTimeWindow(question:string,config:ParameterConfig,measures:string[],load:(plan:ParameterPlan)=>Promise<QnaResponse>):Promise<QnaResponse|undefined> {
 const boundary=/;\s*(?:answerFilters|modelScope):|\b(?:where|with)\b/i.exec(question)?.index??question.length;
 const head=question.slice(0,boundary),tail=question.slice(boundary);
 const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 let command=head.replace(/"[^"]*"|'[^']*'|\[[^\]]*\]|\([^)]*\)/g,value=>' '.repeat(value.length));
 for(const literal of [...measures,...config.fields.map(f=>f.name),...Object.values(config.groupAliases||{}).flat()].sort((a,b)=>b.length-a.length)){
  if(literal.trim())command=command.replace(new RegExp('(?<![\\w])'+escape(literal)+'(?![\\w])','gi'),value=>' '.repeat(value.length));
 }
 const running=/\b(?:running|cumulative) total\b/i.exec(command);
 const period=/\b(ytd|ttm|year to date|trailing 12 months)\b/i.exec(command);
 if(!running&&!period)return undefined;
 // Preserve the established explicit month/comparison and across-year month paths.
 if(!running&&new RegExp('\\b('+calendarMonths.flatMap(m=>[m,m.slice(0,3)]).join('|')+')\\b','i').test(command))return undefined;
 if(!running&&/\b\d{4}\b/.test(command))return undefined;
 if(running&&period)throw new Error('Choose running total, YTD or TTM, rather than combining them.');
 const name=config.time?.monthIndexField,field=config.fields.find(f=>f.name===name);
 if(!field||field.type!=='number'||!config.options.includes(field.name))throw new Error('Map a numeric MonthIndex available in the field parameter under Time setup.');
 const offset=config.time?.monthIndexBase??1;
 const marker=(running||period)!;
 let clean=head.slice(0,marker.index)+head.slice(marker.index+marker[0].length);
 if(running)clean=clean.replace(/\bby\s+month\s+(?:and|,)\s*/i,'by ').replace(/\b(?:by|per)\s+month\b/i,' ');
 if(running&&(new RegExp('\\b('+calendarMonths.flatMap(m=>[m,m.slice(0,3)]).join('|')+')\\b','i').test(command)||/\b(?:from|between|vs|versus)\b/i.test(command)))throw new Error('Use one year for a running total, for example Sales running total by month for 2026.');
 const base=planParameterQuestion(clean+' '+tail,config,measures);
 if(!base.measures.length||base.listOnly)throw new Error('Name a measure for the time calculation.');
 if(base.rank)throw new Error('Remove Top/Bottom when requesting a running total or an automatic time window.');
 const categoryGroups=base.totalOnly?[]:base.groups;
 const reuseMonthly=!!running&&!config.revenuePercentage&&base.measures.every(m=>config.additiveMeasures?.includes(m)&&!config.customKpis?.some(k=>k.name===m));
 const monthColumn=reuseMonthly?categoryGroups.length:0;
 const discovery=await load({...base,groups:[...(reuseMonthly?categoryGroups:[]),field.name],totalOnly:false,listOnly:false,presentation:'table',matrixRowCount:undefined});
 if(discovery.table?.modelResultComplete!==true)throw new Error('The available months are incomplete. Narrow the filters before calculating this time window.');
 const rawMonths=discovery.table.modelRawRows;
 if(!rawMonths)throw new Error('Raw measure values are unavailable for month discovery. Refresh the data and retry.');
 for(let i=0;i<discovery.table.rows.length;i++){
  if(!rawMonths[i]?.slice(monthColumn+1).some(v=>typeof v==='number'&&Number.isFinite(v)))continue;
  const value=Number((discovery.table.modelGroupValues||discovery.table.rows)[i]?.[monthColumn]);
  if(!Number.isInteger(value)||value<1900*12+offset||value>=9999*12+offset)throw new Error('MonthIndex contains invalid values. Use Year × 12 plus the month number (or the configured zero-based index).');
 }
 const available=[...new Set((discovery.table.modelGroupValues||discovery.table.rows).filter((_,i)=>discovery.table!.modelRawRows?.[i]?.slice(monthColumn+1).some(v=>typeof v==='number'&&Number.isFinite(v))).map(row=>Number(row[monthColumn])).filter(n=>Number.isInteger(n)&&n>=1900*12+offset&&n<9999*12+offset))].sort((a,b)=>a-b);
 if(!available.length)throw new Error('No available months match this measure and these filters.');
 if(reuseMonthly){
  if(discovery.table.rows.length>30000||discovery.table.rows.length*base.measures.length>200000)throw new Error('Monthly data exceeds the running-total limit. Narrow the filters.');
  const seen=new Set<string>();for(const row of discovery.table.rows){const key=JSON.stringify(row.slice(0,monthColumn+1));if(seen.has(key))throw new Error('Monthly data contains duplicate category/month rows.');seen.add(key);}
 }
 const latest=available[available.length-1],year=Math.floor((latest-offset)/12),first=year*12+offset;
 if(base.filters.some(f=>JSON.stringify(f.target)===JSON.stringify({table:field.table,column:field.column})))throw new Error('Remove the explicit MonthIndex filter and specify a calendar year or ending month in the question.');
 const timeNames=new Set([config.time?.monthIndexField,config.time?.yearField,config.time?.monthField,config.time?.dateField]);
 if(categoryGroups.some(g=>timeNames.has(g)))throw new Error('Use running total by month for a monthly cumulative result; remove other time grouping fields.');
 const indexTarget={table:field.table,column:field.column};
 const window=(start:number,end:number):ParameterPlan=>({...base,groups:base.totalOnly?[]:base.groups,totalOnly:false,listOnly:false,presentation:'table',matrixRowCount:undefined,filters:[...base.filters,new BasicFilter(indexTarget,'In',Array.from({length:end-start+1},(_,i)=>start+i)).toJSON()]});
 if(!running){
  const kind=/ttm|trailing/i.test(period![0])?'TTM':'YTD',start=kind==='TTM'?latest-11:first;
  const plan=window(start,latest);plan.presentation=base.totalOnly?'table':base.presentation;
  const answer=await load(plan);
  if(answer.table?.modelResultComplete!==true)throw new Error('The time window returned incomplete data. Narrow the filters and retry.');
  if(answer.table&&plan.groups.length){
   const scalar=await load({...plan,groups:[],totalOnly:false,presentation:'table'});
   if(scalar.table?.modelResultComplete!==true)throw new Error('The time-window total returned incomplete data.');
   answer.table.modelTotals=[...plan.groups.map((_,i)=>i===0?'Grand Total':''),...(scalar.table.rows[0]||plan.measures.map(()=>'—'))];
   answer.table.modelRawTotals=[...plan.groups.map(()=>null),...(scalar.table.modelRawRows?.[0]||plan.measures.map(()=>null))];
   answer.table.modelEvaluatedTotals=[...plan.groups.map(()=>false),...plan.measures.map(()=>true)];
  }
  const coverage=available.filter(n=>n>=start&&n<=latest).length,expected=latest-start+1;
  answer.text=`${kind} · ${monthIndexLabel(start,offset)} – ${monthIndexLabel(latest,offset)} · Latest available month within filters.${coverage<expected?' Partial period: '+coverage+'/'+expected+' months with measure data.':''}\n${answer.text||''}`;
  if(answer.table)answer.table.drillScopes=[{question:clean+' '+tail,inheritedFilters:plan.filters}];
  if(base.totalOnly&&plan.measures.length===1)return {modelQuery:true,text:answer.text,kpi:{title:plan.measures[0],value:answer.table.rows[0]?.[0]??'—'}};
  return answer;
 }
 const explicit=/\b(?:for|in|during|of|year)\s+(\d{4})\b/i.exec(clean);
 if(/\b(?:from|between|vs|versus)\b/i.test(clean))throw new Error('Use one year for a running total, for example Sales running total by month for 2026.');
 const chosenYear=explicit?Number(explicit[1]):year,start=chosenYear*12+offset;
 const covered=available.filter(n=>n>=start&&n<start+12);
 if(!covered.length)throw new Error('No months match the requested running-total year.');
 const end=covered[covered.length-1];
 const table:QnaTable={columns:['Period',...(base.totalOnly?[]:base.groups),...base.measures],rows:[],rowIndices:[],modelRawRows:[],modelRowSelections:[],modelSnapshot:true,modelResultComplete:true,drillScopes:[{question:clean+' '+tail}]};
 for(let month=start;month<=end;month++){
  const plan=window(start,month),answer=reuseMonthly?monthlyPeriod(discovery.table,categoryGroups.length,base.measures,start,month,false):await load(plan),part=answer.table;
  if(part&&reuseMonthly)part.modelResultComplete=true;
  if(!part||part.modelResultComplete!==true)throw new Error('A running-total window returned incomplete data. Narrow the filters and retry.');
  for(let i=0;i<part.rows.length;i++){
   table.rows.push([monthIndexLabel(month,offset),...part.rows[i]]);table.rowIndices.push([]);
   table.modelRawRows!.push([null,...(part.modelRawRows?.[i]||part.rows[i].map(()=>null))]);
   table.modelRowSelections!.push(part.modelRowSelections?.[i]||[]);
  }
  table.modelFormats=[undefined,...(part.modelFormats||[])];
  if(table.rows.length>30000)throw new Error('Running-total results exceed 30,000 rows. Narrow the filters.');
 }
 return {modelQuery:true,text:`Running total · ${monthIndexLabel(start,offset)} – ${monthIndexLabel(end,offset)} · Resets in January. ${reuseMonthly?'Uses complete monthly data for measures configured as additive.':'Each window is evaluated separately.'} Cumulative rows are not added into a grand total.${covered.length<end-start+1?' Some months have no measure data.':''}`,table};
}
