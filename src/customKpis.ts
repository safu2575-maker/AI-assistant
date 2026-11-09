import { applyAlwaysFilter } from "./alwaysFilter";
import { calculationReferences } from './calculationGroups';
import { calculationView } from './calculationRequest';
import { calculationItemsAsRows, calculationFieldsAsColumns } from './calculationRows';
import { evaluateFormula } from './qna/formula';
import { ParameterConfig, ParameterPlan } from './parameterQuery';
import { QnaResponse } from './qna/types';
import type powerbi from 'powerbi-visuals-api';
export interface CustomKpi { id:string; name:string; formula:string; format:'number'|'percentage'; decimals:number; enabled:boolean; filters?:Array<{field:string;values:string[]}>; calculation?:import('./calculationGroups').CalculationMeasure }
export const kpiFormat=(k:CustomKpi)=>'#,0'+(k.decimals?'.'+'0'.repeat(k.decimals):'')+(k.format==='percentage'?'%':'');
export function compileKpis(definitions:CustomKpi[]|undefined,native:string[]) {
 if(definitions!==undefined&&!Array.isArray(definitions))throw new Error('Custom KPIs must be a list.');
 const defs=definitions||[];if(defs.filter(k=>!k.calculation).length>50)throw new Error('Use at most 50 custom KPIs.');
 const names=new Map(native.map(name=>[name.toLowerCase(),name])),byName=new Map<string,CustomKpi>(),ids=new Set<string>();
 for(const k of defs){if(!k||typeof k.id!=='string'||!k.id||ids.has(k.id)||typeof k.name!=='string'||!k.name.trim()||k.name!==k.name.trim()||k.name.length>100||/[\[\];]/.test(k.name)||typeof k.formula!=='string'||typeof k.enabled!=='boolean'||!['number','percentage'].includes(k.format)||!Number.isInteger(k.decimals)||k.decimals<0||k.decimals>6)throw new Error('Invalid custom KPI definition.');if(k.filters!==undefined&&(!Array.isArray(k.filters)||k.filters.some(f=>!f||typeof f.field!=='string'||!f.field.trim()||!Array.isArray(f.values)||!f.values.length||f.values.some(v=>typeof v!=='string'||!v.trim()))))throw new Error('Invalid KPI filters for '+k.name);ids.add(k.id);if(names.has(k.name.toLowerCase()))throw new Error('Duplicate measure or KPI name: '+k.name);names.set(k.name.toLowerCase(),k.name);byName.set(k.name,k);}
 const dependencies=new Map<string,string[]>(),active=new Set<string>(),done=new Set<string>();
 const visit=(k:CustomKpi)=>{if(done.has(k.name))return;if(active.has(k.name))throw new Error('Circular KPI dependency: '+k.name);active.add(k.name);
  if(k.calculation&&k.enabled&&!k.formula.trim())throw new Error('Add a formula before enabling '+k.name+'.');
 const sourceRefs=k.calculation?calculationReferences(k.formula):[...k.formula.matchAll(/\[([^\]]+)\]/g)].map(m=>m[1].trim());
  const refs=[...new Set(sourceRefs.map(ref=>{const name=names.get(ref.toLowerCase())||(k.calculation?.defaultMeasure&&names.get(k.calculation.defaultMeasure.toLowerCase()));if(!name)throw new Error('Unknown measure in '+k.name+': '+ref);return name;}))];
  if(!refs.length&&!k.calculation)throw new Error(k.name+' must reference at least one measure.');
  if(!k.calculation)evaluateFormula(k.formula,new Map(refs.map(name=>[name,1])),true);
  for(const name of refs){const child=byName.get(name);if(child){if(!k.calculation&&child.calculation)throw new Error('Reference '+child.name+' from a Calculation Group formula, not a legacy KPI.');if(k.enabled&&!child.enabled)throw new Error(k.name+' depends on disabled KPI '+name);visit(child);}}
  dependencies.set(k.name,refs);active.delete(k.name);done.add(k.name);
 };defs.forEach(visit);
 const baseCache=new Map<string,string[]>();
 const baseFor=(name:string):string[]=>{if(baseCache.has(name))return baseCache.get(name)!;const k=byName.get(name);if(k){if(!k.enabled)throw new Error('KPI is disabled: '+name);const result=[...new Set(dependencies.get(name)!.flatMap(baseFor))];baseCache.set(name,result);return result;}if(!native.includes(name))throw new Error('Unknown measure: '+name);return [name];};
 const bases=(requested:string[]):string[]=>[...new Set(requested.flatMap(baseFor))];
 const evaluate=(name:string,values:Map<string,number|null>,cache=new Map<string,number|null>()):number|null=>{if(cache.has(name))return cache.get(name)!;const k=byName.get(name);if(!k)return values.get(name)??null;const inputs=new Map((dependencies.get(name)||[]).map(dep=>[dep,evaluate(dep,values,cache)]));let value:number|null;try{value=evaluateFormula(k.formula,inputs,false,null);}catch{value=null;}cache.set(name,value);return value;};
 return {byName,dependencies,bases,evaluate,names:defs.filter(k=>k.enabled).map(k=>k.name)};
}
/** Evaluate from unrounded model measures for the exact row/total filter context. */
export async function customKpiRequest(plan:ParameterPlan,config:ParameterConfig,native:string[],load:(plan:ParameterPlan)=>Promise<QnaResponse>,render:(view:powerbi.DataView,plan:ParameterPlan)=>QnaResponse):Promise<QnaResponse>{
 const sourceLoad=load,sourceRender=render;let inputsComplete=true;
 load=async p=>{const response=await sourceLoad(p);if(response.table?.modelResultComplete!==true)inputsComplete=false;return response;};
 render=(view,p)=>{const response=sourceRender(view,p);if(response.table)response.table.modelResultComplete=inputsComplete;return response;};
 const compiled=compileKpis(config.customKpis,native);
 if(plan.measures.some(name=>compiled.byName.get(name)?.calculation)){
  // Keep calculation items on rows for every question shape, including scalar and matrix requests.
  // Query/evaluate the original grouping and independent contexts; only the final presentation changes.
  const columnFields=plan.presentation==='matrix'&&plan.matrixRowCount!==undefined?plan.groups.slice(plan.matrixRowCount):plan.groups.filter(g=>g===config.time?.yearField||/^(fiscal\s*)?year$/i.test(g));
  plan={...plan,presentation:'table',matrixRowCount:undefined,totalOnly:false};
  const data=await calculationView(plan,config,load,native);const response=await renderKpiView(data.view,plan,config,native,load,render,data.explanations);
  if(response.table){const table=response.table;table.calculationDetails=(row,column)=>{
   const pivot=table.modelPivot;let name=table.columns[column],labels:any[]=table.modelGroupValues?.[row]||table.rows[row]?.slice(0,plan.groups.length)||[];
   if(pivot){if(column<pivot.rowFields.length)return [];name=pivot.measures[(column-pivot.rowFields.length)%pivot.measures.length];const totalColumn=column>=pivot.rowFields.length+pivot.columnValues.length*pivot.measures.length;const selections=totalColumn?[table.modelSelections?.[row]||[]]:(table.modelCellSelections?.[row]?.[column]||[]);const fields=totalColumn?plan.groups.slice(0,plan.matrixRowCount??plan.groups.length-1):plan.groups;labels=fields.map(g=>{const f=config.fields.find(f=>f.name===g);return selections.flat().find(s=>s.table===f?.table&&s.column===f?.column)?.value??null;});}
   else if(table.matrix?.keys[row]){try{labels=JSON.parse(table.matrix.keys[row]);}catch{/* Keep original row identity. */}}
   else if(table.modelSelections?.[row]?.length)labels=plan.groups.map(g=>{const f=config.fields.find(f=>f.name===g);return table.modelSelections![row].find(s=>s.table===f?.table&&s.column===f?.column)?.value??null;});
   return data.explanations.get(JSON.stringify([labels,name]))||(table.totalRowIndices?.includes(row)?data.explanations.get(JSON.stringify([[],name])):undefined)||[];
  };table.calculationNotes={};table.rows.forEach((_r,i)=>table.columns.forEach((_c,j)=>{const notes=table.calculationDetails!(i,j);if(notes.length)table.calculationNotes![i+':'+j]=notes;if(notes.some(n=>n.startsWith('Unavailable:')))table.rows[i][j]='Unavailable';}));
   // Cache/export plain notes, not a closure over the rendered table.
   delete table.calculationDetails;
  }
  if(response.kpi){const notes=data.explanations.get(JSON.stringify([[],plan.measures[0]]))||[];const error=notes.find(n=>n.startsWith('Unavailable:'));if(error)response.kpi.value='Unavailable';response.kpi.subtitle=notes.join('\n');}
  if(response.table){
   response.table=calculationItemsAsRows(response.table,plan.measures);
   // Grand totals use the evaluator's total-context explanation, not a row's context.
   for(const row of response.table.totalRowIndices||[]){const name=response.table.rows[row][response.table.columns.length-2];const notes=data.explanations.get(JSON.stringify([[],name]));if(notes)response.table.calculationNotes![row+':'+(response.table.columns.length-1)]=notes;}
   if(columnFields.length){
    const rowGroups=plan.groups.filter(g=>!columnFields.includes(g));let subtotals:import('./qna/types').QnaTable|undefined;
    if(rowGroups.length){
     const subtotalPlan={...plan,groups:rowGroups};const subtotalData=await calculationView(subtotalPlan,config,load,native);
     const subtotalResponse=render(subtotalData.view,subtotalPlan);
     if(subtotalResponse.table){subtotals=calculationItemsAsRows(subtotalResponse.table,plan.measures);subtotals.rows.forEach((r,i)=>{if(subtotals!.totalRowIndices?.includes(i))return;const labels=subtotals!.modelGroupValues?.[i]||r.slice(0,rowGroups.length);const name=subtotals!.calculationRowMeasures![i];const notes=subtotalData.explanations.get(JSON.stringify([labels,name]));if(notes)subtotals!.calculationNotes![i+':'+(subtotals!.columns.length-1)]=notes;});}
    }
    response.table=calculationFieldsAsColumns(response.table,columnFields,subtotals);
   }
  }
  return response;
 }
 const hasFilters=(name:string):boolean=>!!compiled.byName.get(name)?.filters?.length||(compiled.dependencies.get(name)||[]).some(hasFilters);
 if(plan.measures.some(hasFilters)) {
  const view=await filteredKpiView(plan,config,compiled,load);
  return renderKpiView(view,plan,config,native,load,render);
 }
 const required=compiled.bases(plan.measures);
 const raw={...plan,measures:required,presentation:'table' as const,totalOnly:false,rank:undefined,matrixRowCount:undefined};
 const table=(await load(raw)).table;if(!table?.modelRawRows)throw new Error('Custom KPIs require unrounded model measure results.');
 const count=plan.groups.length;
 let totals=table.modelRawTotals;
 if(count&&required.some((name,i)=>!table.modelEvaluatedTotals?.[count+i])){const scalar=(await load({...raw,groups:[]})).table;if(!scalar?.modelRawRows?.[0])throw new Error('Model totals are unavailable for custom KPIs.');totals=[...plan.groups.map(()=>null),...scalar.modelRawRows[0]];}
 if(!count)totals=table.modelRawRows[0];
 const evaluate=(row:Array<number|null>)=>{const values=new Map(required.map((name,i)=>[name,row[count+i]??null]));return plan.measures.map(name=>compiled.evaluate(name,values));};
 const columns=[...plan.groups.map(name=>({displayName:name,roles:{categories:true}})),...plan.measures.map(name=>({displayName:name,roles:{measures:true},isMeasure:true,format:compiled.byName.has(name)?kpiFormat(compiled.byName.get(name)!):table.modelFormats?.[table.columns.indexOf(name)]}))];
 const rows=table.rows.map((row,i)=>[...plan.groups.map((name,j)=>{const field=config.fields.find(f=>f.name===name);return table.modelSelections?.[i]?.find(s=>s.table===field?.table&&s.column===field?.column)?.value??(row[j]==='—'?null:row[j]);}),...evaluate(table.modelRawRows![i])]);
 const view={metadata:{columns},table:{columns,rows,totals:[...plan.groups.map(()=>null),...evaluate(totals||required.map(()=>null))]}} as powerbi.DataView;
 return renderKpiView(view,plan,config,native,load,render);
}
async function renderKpiView(view:powerbi.DataView,plan:ParameterPlan,config:ParameterConfig,native:string[],load:(plan:ParameterPlan)=>Promise<QnaResponse>,render:(view:powerbi.DataView,plan:ParameterPlan)=>QnaResponse,explanations?:Map<string,string[]>):Promise<QnaResponse>{
 const count=plan.groups.length, columns=view.table!.columns, rows=view.table!.rows;
 if(plan.presentation==='matrix'&&count>1){
  const levels:Array<Array<Array<string|number|boolean|null>>>=[];
  for(let depth=1;depth<count;depth++){
   let levelView:powerbi.DataView|undefined;
   const levelResult=await customKpiRequest({...plan,groups:plan.groups.slice(0,depth),presentation:'table',matrixRowCount:undefined,rank:undefined,totalOnly:false},config,native,load,(data)=>{levelView=data;return {text:'',table:{columns:data.table!.columns.map(c=>c.displayName),rows:(data.table!.rows||[]).map(r=>r.map(v=>String(v??''))),rowIndices:(data.table!.rows||[]).map(()=>[]),modelGroupValues:(data.table!.rows||[]).map(r=>r.slice(0,depth) as any)}};});
   if(explanations)(levelView!.table!.rows||[]).forEach((r,i)=>plan.measures.forEach((name,j)=>{const notes=levelResult.table?.calculationNotes?.[i+':'+(depth+j)];if(notes)explanations.set(JSON.stringify([r.slice(0,depth),name]),notes);}));
   levels.push(levelView!.table!.rows as Array<Array<string|number|boolean|null>>);
  }levels.push(rows as Array<Array<string|number|boolean|null>>);
  const values=(row:unknown[])=>Object.fromEntries(row.map((value,i)=>[i,{value,valueSourceIndex:i}]));
  const root:any={children:[],values:values(view.table!.totals!.slice(count))},nodes=new Map<string,any>();
  levels.forEach((level,depth)=>level.forEach(row=>{const path=row.slice(0,depth+1),key=JSON.stringify(path);const node:any={level:depth,value:path[depth],values:values(row.slice(depth+1)),children:[]};nodes.set(key,node);(depth?nodes.get(JSON.stringify(path.slice(0,-1))):root)?.children.push(node);}));
  view.matrix={rows:{levels:columns.slice(0,count).map(source=>({sources:[source]})),root},columns:{levels:[],root:{}},valueSources:columns.slice(count)} as powerbi.DataViewMatrix;
 }
 const response=render(view,plan);response.text+=(response.text?' ':'')+'Custom KPIs are recalculated for each row and total; missing inputs or undefined divisions show —.';return response;
}
interface ScopedMetric { rows:Map<string,{labels:Array<powerbi.PrimitiveValue|null>;value:number|null}>; total:number|null; format?:string }
async function filteredKpiView(plan:ParameterPlan,config:ParameterConfig,compiled:ReturnType<typeof compileKpis>,load:(plan:ParameterPlan)=>Promise<QnaResponse>):Promise<powerbi.DataView>{
 const count=plan.groups.length,cache=new Map<string,ScopedMetric>();
 const metric=async(name:string,scope:ParameterPlan):Promise<ScopedMetric>=>{
  const kpi=compiled.byName.get(name);let scoped=scope;
  for(const rule of kpi?.filters||[])try{scoped=applyAlwaysFilter(scoped,{...config,alwaysFilter:rule});}catch(error){throw new Error(name+': '+String((error as Error).message).replace(/Always filter/g,'KPI filter'));}
  const key=JSON.stringify([name,scoped.groups,scoped.filters]);const existing=cache.get(key);if(existing)return existing;
  let result:ScopedMetric;
  if(!kpi){
   const raw={...scoped,measures:[name],presentation:'table' as const,totalOnly:false,rank:undefined,matrixRowCount:undefined};
   const table=(await load(raw)).table;if(!table?.modelRawRows)throw new Error('Custom KPIs require unrounded model measure results.');
   let total=table.modelRawTotals?.[count]??null;
   if(!count)total=table.modelRawRows[0]?.[0]??null;
   else if(!table.modelEvaluatedTotals?.[count]){const scalar=(await load({...raw,groups:[]})).table;if(!scalar?.modelRawRows?.[0])throw new Error('Model totals are unavailable for custom KPIs.');total=scalar.modelRawRows[0][0]??null;}
   const rows=new Map<string,{labels:Array<powerbi.PrimitiveValue|null>;value:number|null}>();
   table.rows.forEach((row,i)=>{const labels=plan.groups.map((name,j)=>{const field=config.fields.find(f=>f.name===name);const selection=table.modelSelections?.[i]?.find(s=>s.table===field?.table&&s.column===field?.column);return selection?selection.value:row[j]==='—'?null:row[j];});rows.set(JSON.stringify(labels),{labels,value:table.modelRawRows![i][count]??null});});
   result={rows,total,format:table.modelFormats?.[count]};
  }else{
   const dependencies=new Map<string,ScopedMetric>();for(const dep of compiled.dependencies.get(name)!)dependencies.set(dep,await metric(dep,scoped));
   const labels=new Map<string,Array<powerbi.PrimitiveValue|null>>();for(const value of dependencies.values())for(const [key,row] of value.rows)labels.set(key,row.labels);
   const evaluate=(key?:string):number|null=>{const inputs=new Map([...dependencies].map(([name,data])=>[name,key===undefined?data.total:data.rows.get(key)?.value??null]));try{return evaluateFormula(kpi.formula,inputs,false,null);}catch{return null;}};
   result={rows:new Map([...labels].map(([key,labels])=>[key,{labels,value:evaluate(key)}])),total:evaluate(),format:kpiFormat(kpi)};
  }
  cache.set(key,result);return result;
 };
 const metrics:ScopedMetric[]=[];for(const name of plan.measures)metrics.push(await metric(name,plan));
 const labels=new Map<string,Array<powerbi.PrimitiveValue|null>>();for(const value of metrics)for(const [key,row] of value.rows)labels.set(key,row.labels);
 const columns=[...plan.groups.map(displayName=>({displayName,roles:{categories:true}})),...plan.measures.map((displayName,i)=>({displayName,roles:{measures:true},isMeasure:true,format:metrics[i].format}))];
 const rows=[...labels].map(([key,labels])=>[...labels,...metrics.map(m=>m.rows.get(key)?.value??null)]);
 return {metadata:{columns},table:{columns,rows,totals:[...plan.groups.map(()=>null),...metrics.map(m=>m.total)]}} as powerbi.DataView;
}
