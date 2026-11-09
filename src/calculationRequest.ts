import type powerbi from 'powerbi-visuals-api';
import { CalcNode, CalcValue, CalculationRuntime, CalculationError, evaluateCalculation, parseCalculation, walkCalculation } from './calculationFormula';
import { calculationDays, calculationScope } from './calculationContext';
import type { ParameterConfig, ParameterPlan } from './parameterQuery';
import type { QnaResponse, QnaTable } from './qna/types';
import { kpiFormat } from './customKpis';
/** Display only: retain the original query predicates and numeric values. */
export function calculationFilterLabels(filters:ParameterPlan['filters'],config:ParameterConfig):string[] {
 const value=(v:unknown):string=>v===null?'(Blank)':typeof v==='string'?`'${v}'`:String(v);
 const operators:Record<string,string>={Is:'=',IsNot:'≠',GreaterThan:'>',GreaterThanOrEqual:'≥',LessThan:'<',LessThanOrEqual:'≤',Contains:'contains',DoesNotContain:'does not contain',StartsWith:'starts with',DoesNotStartWith:'does not start with',IsBlank:'is blank',IsNotBlank:'is not blank'};
 return filters.map(filter=>{
  const f=filter as typeof filter & {operator?:string;values?:unknown[];logicalOperator?:string;conditions?:Array<{operator:string;value?:unknown}>};
  const target=f.target as {table?:string;column?:string};
  const name=config.fields.find(field=>field.table===target?.table&&field.column===target?.column)?.name||target?.column||'Combined fields';
  if(f.values&&['In','NotIn','All'].includes(f.operator||''))return `${name} ${f.operator==='NotIn'?'NOT IN':f.operator==='All'?'ALL':'IN'} (${f.values.map(value).join(', ')})`;
  if(f.conditions?.length)return f.conditions.map(c=>`${name} ${operators[c.operator]||c.operator}${c.value===undefined?'':' '+value(c.value)}`).join(f.logicalOperator==='Or'?' OR ':' AND ');
  return `${name}: additional model filter`;
 });
}
/** One request-local memo shared by rows, totals and common subexpressions. No cross-user/model cache. */
export async function calculationView(plan:ParameterPlan,config:ParameterConfig,load:(plan:ParameterPlan)=>Promise<QnaResponse>,nativeMeasures:string[]):Promise<{view:powerbi.DataView;explanations:Map<string,string[]>}> {
 const definitions=config.customKpis||[],byName=new Map(definitions.map(k=>[k.name.toLowerCase(),k]));
 const cache=new Map<string,Promise<QnaTable>>(),asts=new Map<string,CalcNode>(),explanations=new Map<string,string[]>();let requests=0;
 const getAst=(s:string)=>{let n=asts.get(s);if(!n){n=parseCalculation(s);asts.set(s,n);}return n;};
 // A host request has one filter context. Combine only compatible operands.
 const batches=new Map<string,Set<string>>();
 const scopeKey=(p:ParameterPlan)=>JSON.stringify([p.groups,p.filters]);
 const register=(name:string,p:ParameterPlan)=>{const key=scopeKey(p);let names=batches.get(key);if(!names){names=new Set();batches.set(key,names);}names.add(name);};
 const defaultPredicate=(n:Extract<CalcNode,{kind:'metric'}>,defaultField:string):CalcNode=>{
  const field=config.fields.find(f=>f.name.toLowerCase()===defaultField.toLowerCase());
  if(!field)throw new CalculationError('Unavailable default field ['+defaultField+']. Select an accessible field.',n.at);
  const value:CalcValue=field.type==='number'?Number(n.name):n.name;
  if(field.type==='number'&&(!n.name.trim()||!Number.isFinite(value)))throw new CalculationError('Value '+n.name+' is not numeric for ['+field.name+'].',n.at);
  return {kind:'binary',op:'=',at:n.at,left:{kind:'field',name:field.name,target:{table:field.table,column:field.column},at:n.at},right:{kind:'literal',value,at:n.at}};
 };
 const planBatch=(name:string,p:ParameterPlan,total=false,stack:string[]=[])=>{
  if(stack.length>50||stack.includes(name.toLowerCase()))return;
  const k=byName.get(name.toLowerCase());
  if(!k?.calculation){const native=nativeMeasures.find(v=>v.toLowerCase()===name.toLowerCase());if(native)register(native,p);return;}
  if(!k.enabled||total&&k.calculation.total==='hide')return;
  const scoped=(parent:ParameterPlan,filters:CalcNode[])=>{const result=calculationScope(parent,config,filters),overridden=new Set<string>();filters.forEach(f=>walkCalculation(f,n=>{if(n.kind==='field')overridden.add(n.name.toLowerCase());}));return {...result,groups:parent.groups.filter(g=>!overridden.has(g.toLowerCase()))};};
  const visit=(n:CalcNode,context:ParameterPlan):void=>{
   if(n.kind==='metric'){
    const shorthand=!nativeMeasures.some(v=>v.toLowerCase()===n.name.toLowerCase())&&!byName.has(n.name.toLowerCase());
    const m=k.calculation!;
    if(shorthand&&m.defaultField&&m.defaultMeasure)planBatch(m.defaultMeasure,scoped(context,[defaultPredicate(n,m.defaultField),...n.filters]),false,[...stack,name.toLowerCase()]);
    else planBatch(n.name,scoped(context,n.filters),false,[...stack,name.toLowerCase()]);
   }
   else if(n.kind==='reference')planBatch(n.name,context,false,[...stack,name.toLowerCase()]);
   else if(n.kind==='filtered')visit(n.expression,scoped(context,n.filters));
   else if(n.kind==='unary')visit(n.child,context);
   else if(n.kind==='binary'&&!['AND','OR'].includes(n.op)){visit(n.left,context);visit(n.right,context);}
   // Function/conditional arguments stay lazy: do not fetch unused branches.
  };
  try{visit(getAst(total&&k.calculation.total==='custom'?k.calculation.totalFormula||'':k.calculation.formula),p);}catch{/* Normal evaluation reports invalid formulas. */}
 };
 plan.measures.forEach(name=>{planBatch(name,plan);planBatch(name,{...plan,groups:[]},true);});
 // Totals are reusable only when explicitly marked as model evaluated, never
 // when the renderer synthesized them by summing the visible rows.
 const modelTotals=new Map<string,number>();
 const totalKey=(p:ParameterPlan,name:string)=>JSON.stringify([p.filters,name]);
 const query=(p:ParameterPlan):Promise<QnaTable>=>{
  const names=[...new Set([...(batches.get(scopeKey(p))||[]),...p.measures])];
  const offset=Math.floor(names.indexOf(p.measures[0])/16)*16;
  const measures=p.measures.length===1?names.slice(offset,offset+16):p.measures;
  if(!p.groups.length&&measures.every(name=>modelTotals.has(totalKey(p,name)))){
   const raw=measures.map(name=>modelTotals.get(totalKey(p,name))!);
   return Promise.resolve({columns:measures,rows:[raw.map(String)],rowIndices:[[]],modelRawRows:[raw],modelResultComplete:true});
  }
  const key=JSON.stringify([p.groups,measures,p.filters]);let task=cache.get(key);
  if(!task){if(++requests>250)throw new Error('Calculation query budget exceeded (250 distinct contexts). Reduce measures or grouping.');task=load({...p,measures,presentation:'table',matrixRowCount:undefined,rank:undefined,totalOnly:false}).then(r=>{if(!r.table?.modelRawRows)throw new Error('Calculation requires unrounded model results.');if(r.table.modelResultComplete!==true)throw new Error('Calculation input is incomplete or completeness is unknown. Narrow the query; partial rows are not used to calculate results.');if(p.groups.length)for(const name of measures){const index=r.table.columns.indexOf(name),value=r.table.modelRawTotals?.[index];if(r.table.modelEvaluatedTotals?.[index]===true&&typeof value==='number'&&Number.isFinite(value))modelTotals.set(totalKey(p,name),value);}return r.table;});cache.set(key,task);}
  return task;
 };
 const rowIndexes=new WeakMap<QnaTable,Map<string,number>>();
 const native=async(name:string,scope:ParameterPlan,row:Record<string,CalcValue>|undefined,notes:string[]):Promise<CalcValue>=>{
  const t=await query({...scope,measures:[name]});let index=0;
  if(scope.groups.length){let lookup=rowIndexes.get(t);if(!lookup){lookup=new Map();t.rows.forEach((labels,i)=>{const values=scope.groups.map((g,j)=>{const f=config.fields.find(f=>f.name===g);const selection=t.modelSelections?.[i]?.find(s=>s.table===f?.table&&s.column===f?.column);return selection?selection.value:t.modelGroupValues?.[i]?.[j]??labels[j];});lookup!.set(JSON.stringify(values),i);});rowIndexes.set(t,lookup);}index=lookup.get(JSON.stringify(scope.groups.map(g=>row?.[g]??null)))??-1;}
  const column=t.columns.indexOf(name);if(column<0)throw new Error('Calculation response is missing measure '+name);
  const value=index<0?null:t.modelRawRows![index]?.[column]??null;
  notes.push(name+' = '+(value===null?'Blank':String(value)));
  const context=[...scope.groups.map(g=>g+': '+String(row?.[g]??'(Blank)')),...calculationFilterLabels(scope.filters,config)];
  if(context.length)notes.push('Context: '+context.join('; '));
  return value;
 };
 const metricScopes=new Map<string,Promise<{measure:string;scoped:ParameterPlan}>>();
 const resultMemo=new Map<string,{value:CalcValue;notes:string[]}>();
 const run=async(name:string,scope:ParameterPlan,row:Record<string,CalcValue>|undefined,notes:string[],stack:string[]=[],total=false):Promise<CalcValue>=>{
  if(stack.length>50||stack.includes(name.toLowerCase()))throw new Error('Circular or excessive calculation dependency: '+name);
  const k=byName.get(name.toLowerCase());if(!k?.calculation)return native(k?.name||nativeMeasures.find(n=>n.toLowerCase()===name.toLowerCase())||name,scope,row,notes);
  if(!k.enabled)throw new Error('Calculation is disabled: '+name);const m=k.calculation;if(total&&m.total==='hide')return null;const memoKey=JSON.stringify([name,scope.groups,scope.filters,row,total,m.formula,m.totalFormula]);const cached=resultMemo.get(memoKey);if(cached){notes.push(...cached.notes);return cached.value;}const noteStart=notes.length;const ast=getAst(total&&m.total==='custom'?m.totalFormula||'':m.formula);
  const applyScope=(parent:ParameterPlan,filters:CalcNode[])=>{const scoped=calculationScope(parent,config,filters),overridden=new Set<string>();filters.forEach(f=>walkCalculation(f,n=>{if(n.kind==='field')overridden.add(n.name.toLowerCase());}));return {...scoped,groups:parent.groups.filter(g=>!overridden.has(g.toLowerCase()))};};
  const resolveMetricScope=async(parent:ParameterPlan,n:Extract<CalcNode,{kind:'metric'}>)=>{
   const available=nativeMeasures.some(x=>x.toLowerCase()===n.name.toLowerCase())||byName.has(n.name.toLowerCase());
   if(available)return {measure:n.name,scoped:applyScope(parent,n.filters)};
   if(!m.defaultMeasure)throw new CalculationError('Unavailable measure '+n.name+'. Configure a default measure to use a field value.',n.at);
   // A configured field removes ambiguity. Let the secured model evaluate the
   // predicate directly, including blank results; do not first enumerate members.
   if(m.defaultField)return {measure:m.defaultMeasure,scoped:applyScope(parent,[defaultPredicate(n,m.defaultField),...n.filters])};
   const candidates=config.fields.filter(f=>m.defaultField?f.name.toLowerCase()===m.defaultField.toLowerCase():f.type!=='date');
   const matches:Array<{field:typeof candidates[number];value:CalcValue}>=[];
   for(const field of candidates){
    const value:CalcValue=field.type==='number'?Number(n.name):n.name;
    if(field.type==='number'&&(!n.name.trim()||!Number.isFinite(value)))continue;
    const predicate:CalcNode={kind:'binary',op:'=',at:n.at,left:{kind:'field',name:field.name,target:{table:field.table,column:field.column},at:n.at},right:{kind:'literal',value,at:n.at}};
    const scoped=applyScope(parent,[predicate,...n.filters]);
    const table=await query({...scoped,groups:[field.name],measures:[m.defaultMeasure]});
    const values=table.rows.map((r,i)=>table.modelSelections?.[i]?.find(v=>v.table===field.table&&v.column===field.column)?.value??table.modelGroupValues?.[i]?.[0]??r[0]);
    const exact=values.find(v=>v!==null&&String(v).toLowerCase()===String(value).toLowerCase());
    if(exact!==undefined){
     matches.push({field,value:field.type==='number'?Number(exact):String(exact)});
     // With precisely one equality-filtered member, its model measure is also
     // the scalar value in that exact context, even for non-additive measures.
     const fixed=scoped.filters.some(f=>{const v=f as typeof f & {conditions?:Array<{operator:string;value?:unknown}>};const target=v.target as {table?:string;column?:string};return target?.table===field.table&&target?.column===field.column&&v.conditions?.length===1&&v.conditions[0].operator==='Is'&&v.conditions[0].value===value;});
     const amount=table.modelRawRows?.[0]?.[table.columns.indexOf(m.defaultMeasure)];
     if(fixed&&table.rows.length===1&&typeof amount==='number'&&Number.isFinite(amount))modelTotals.set(totalKey(scoped,m.defaultMeasure),amount);
    }
   }
   if(matches.length>1)throw new CalculationError('Ambiguous value '+n.name+'. Select an explicit field: '+matches.map(x=>'['+x.field.name+']').join(', ')+'.',n.at);
   if(!matches.length)throw new CalculationError('Value '+n.name+' is unavailable in accessible data and current context. Use an explicit [Field] filter; blank-measure members may not be returned by this host.',n.at);
   const {field,value}=matches[0];
   return {measure:m.defaultMeasure,scoped:applyScope(parent,[{kind:'binary',op:'=',at:n.at,left:{kind:'field',name:field.name,target:{table:field.table,column:field.column},at:n.at},right:{kind:'literal',value,at:n.at}},...n.filters])};
  };
  const metricScope=(parent:ParameterPlan,n:Extract<CalcNode,{kind:'metric'}>)=>{
   const key=JSON.stringify([parent.groups,parent.filters,n.name,n.filters,m.defaultMeasure,m.defaultField]);
   let task=metricScopes.get(key);if(!task){task=resolveMetricScope(parent,n);metricScopes.set(key,task);}return task;
  };
  const nodeValues=new Map<CalcNode,CalcValue>();
  const runtime=(context:ParameterPlan):CalculationRuntime=>({
   filtered:n=>evaluateCalculation(n.expression,runtime(applyScope(context,n.filters))),
   trace:(node,value)=>nodeValues.set(node,value),
   metric:async n=>{const {measure,scoped}=await metricScope(context,n);return run(measure,scoped,row,notes,[...stack,name.toLowerCase()],false);},
   reference:ref=>run(ref,context,row,notes,[...stack,name.toLowerCase()],false),
   days:async binding=>{if(binding&&binding.kind!=='metric')throw new CalculationError('Bind DAYS to a scoped measure: DAYS((\'Revenue\', [Year] = 2026)).',binding.at);const s=binding?.kind==='metric'?(await metricScope(context,binding)).scoped:context;const r:Record<string,CalcValue>={};for(const g of s.groups)r[g]=row?.[g]??null;const count=calculationDays(s,config,r);notes.push('Calendar days = '+count);return count;}
  });const result=await evaluateCalculation(ast,runtime(scope));if(typeof result==='string')throw new Error('Calculation output must be numeric, boolean or blank. Convert the date/text to a numeric result.');if(typeof result==='number'&&!Number.isFinite(result))throw new Error('Calculation returned a non-finite number.');const describe=(node:CalcNode,depth=0):void=>{const label=node.kind==='binary'||node.kind==='unary'?node.op:node.kind==='call'||node.kind==='metric'||node.kind==='reference'?node.name:node.kind;notes.push('  '.repeat(depth)+label+' → '+String(nodeValues.get(node)??'Blank'));if(node.kind==='filtered'){describe(node.expression,depth+1);}else if(node.kind==='binary'){describe(node.left,depth+1);describe(node.right,depth+1);}else if(node.kind==='unary')describe(node.child,depth+1);else if(node.kind==='call')node.args.forEach(child=>{if(nodeValues.has(child))describe(child,depth+1);});};describe(ast);resultMemo.set(memoKey,{value:result,notes:notes.slice(noteStart)});return result;
 };
 // Anchor labels are obtained in the outer question context, never from a numerator's overridden year.
 const anchors=new Set<string>(),visited=new Set<string>();
 const findAnchors=(name:string)=>{if(visited.has(name.toLowerCase()))return;visited.add(name.toLowerCase());const k=byName.get(name.toLowerCase());if(!k?.calculation){anchors.add(k?.name||name);return;}walkCalculation(getAst(k.formula),n=>{if(n.kind==='reference')findAnchors(n.name);if(n.kind==='metric')findAnchors(nativeMeasures.some(x=>x.toLowerCase()===n.name.toLowerCase())||byName.has(n.name.toLowerCase())?n.name:k.calculation!.defaultMeasure||n.name);});};
 plan.measures.forEach(findAnchors);
 if(!anchors.size){const fallback=config.defaultMeasure||nativeMeasures[0];if(!fallback)throw new Error('Bind a native measure to obtain calculation row context.');anchors.add(fallback);}
 anchors.forEach(name=>register(name,plan));
 const uniqueLabels=new Map<string,Array<CalcValue>>(),seenAnchors=new WeakSet<QnaTable>();
 for(const anchor of anchors){
  const base=await query({...plan,measures:[anchor]});
  if(seenAnchors.has(base))continue;seenAnchors.add(base);
  base.rows.forEach((labels,i)=>{const values=plan.groups.map((g,j)=>{const f=config.fields.find(f=>f.name===g);const selection=base.modelSelections?.[i]?.find(s=>s.table===f?.table&&s.column===f?.column);return selection?selection.value:base.modelGroupValues?.[i]?.[j]??(labels[j]==='—'?null:labels[j]);});uniqueLabels.set(JSON.stringify(values),values);});
 }
 const labelRows=[...uniqueLabels.values()];
 const evaluate=async(labels:Array<CalcValue>|undefined):Promise<Array<number|null>>=>{const row=labels?Object.fromEntries(plan.groups.map((g,i)=>[g,labels[i]])):undefined;const scope={...plan,groups:labels?plan.groups:[]};const values:Array<number|null>=[];for(const name of plan.measures){const notes:string[]=[];try{const value=await run(name,scope,row,notes,[],!labels);values.push(typeof value==='number'?value:typeof value==='boolean'?Number(value):null);notes.push('Result: '+String(value??'Blank'));}catch(error){values.push(null);notes.push('Unavailable: '+(error as Error).message);}explanations.set(JSON.stringify([labels||[],name]),notes);}return values;};
 const rows:powerbi.DataViewTableRow[]=[];for(const labels of labelRows){if(rows.length&&rows.length%100===0)await new Promise<void>(resolve=>setTimeout(resolve,0));rows.push([...labels,...await evaluate(labels)] as powerbi.DataViewTableRow);}
 const columns=[...plan.groups.map(displayName=>({displayName,roles:{categories:true}})),...plan.measures.map(displayName=>({displayName,isMeasure:true,roles:{measures:true},format:byName.has(displayName.toLowerCase())?kpiFormat(byName.get(displayName.toLowerCase())!):undefined}))];
 const totals=[...plan.groups.map(()=>null),...await evaluate(undefined)];return {view:{metadata:{columns},table:{columns,rows,totals}} as powerbi.DataView,explanations};
}
