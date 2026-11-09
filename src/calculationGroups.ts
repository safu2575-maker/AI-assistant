import { CalcNode, quoteCalculation, tokenizeCalculation, calculationFunctions, CalculationError, parseCalculation, walkCalculation } from './calculationFormula';
import type { CustomKpi } from './customKpis';
export interface CalculationMeasure { id:string;name:string;description:string;formula:string;enabled:boolean;format:'number'|'percentage';decimals:number;total:'recalculate'|'hide'|'custom';totalFormula?:string;defaultMeasure?:string;defaultField?:string }
export interface CalculationGroup { version:1;id:string;name:string;description:string;enabled:boolean;defaultMeasure?:string;defaultField?:string;measures:CalculationMeasure[] }
export function calculationKpis(groups:CalculationGroup[]|undefined):CustomKpi[] {return (groups||[]).flatMap(g=>g.measures.map(m=>({id:'calculation:'+m.id,name:m.name,formula:m.formula,enabled:g.enabled&&m.enabled,format:m.format,decimals:m.decimals,calculation:{...m,defaultMeasure:m.defaultMeasure||g.defaultMeasure,defaultField:m.defaultField||g.defaultField}})));}
export function allCustomKpis(layout:{customKpis?:CustomKpi[];calculationGroups?:CalculationGroup[]}):CustomKpi[] {return [...(layout.customKpis||[]),...calculationKpis(layout.calculationGroups)];}
export function calculationReferences(source:string):string[]{if(!source.trim())return [];const refs=new Set<string>();walkCalculation(parseCalculation(source),n=>{if(n.kind==='metric'||n.kind==='reference')refs.add(n.name);});return [...refs];}
export function validateCalculationGroups(groups:CalculationGroup[]|undefined,native:string[],fields?:string[]):void {
 if(groups===undefined)return;if(!Array.isArray(groups)||JSON.stringify(groups).length>500000)throw new Error('Calculation groups exceed the 500 KB settings budget.');
 const ids=new Set<string>(),names=new Set(native.map(n=>n.toLowerCase())),groupNames=new Set<string>(),defs=new Map<string,CalculationMeasure>();
 for(const g of groups){if(!g||g.version!==1||typeof g.id!=='string'||!g.id||ids.has(g.id)||typeof g.name!=='string'||!g.name.trim()||typeof g.description!=='string'||typeof g.enabled!=='boolean'||!Array.isArray(g.measures))throw new Error('Invalid calculation group.');ids.add(g.id);if(groupNames.has(g.name.toLowerCase())||names.has(g.name.toLowerCase()))throw new Error('Duplicate calculation group name: '+g.name);groupNames.add(g.name.toLowerCase());
  for(const m of g.measures){if(!m||typeof m.id!=='string'||!m.id||ids.has(m.id)||typeof m.name!=='string'||!m.name.trim()||typeof m.formula!=='string'||typeof m.enabled!=='boolean'||!['number','percentage'].includes(m.format)||!Number.isInteger(m.decimals)||m.decimals<0||m.decimals>6||!['recalculate','hide','custom'].includes(m.total))throw new Error('Invalid calculation measure.');if(names.has(m.name.toLowerCase())||groupNames.has(m.name.toLowerCase()))throw new Error('Duplicate calculation name: '+m.name);ids.add(m.id);names.add(m.name.toLowerCase());defs.set(m.name.toLowerCase(),{...m,enabled:g.enabled&&m.enabled});}
 }
 for(const g of groups){for(const d of [g.defaultMeasure,...g.measures.map(m=>m.defaultMeasure)])if(d&&!native.some(n=>n.toLowerCase()===d.toLowerCase()))throw new Error('Default measure must be an available model measure or legacy KPI: '+d);for(const f of [g.defaultField,...g.measures.map(m=>m.defaultField)])if(f&&fields&&!fields.includes(f))throw new Error('Unavailable default field: '+f);for(const m of g.measures){if(!m.formula.trim()){if(m.enabled)throw new Error('Add a formula before enabling '+m.name+'.');continue;}for(const source of [m.formula,...(m.total==='custom'?[m.totalFormula||'']:[])]){const ast=parseCalculation(source);walkCalculation(ast,n=>{if(n.kind==='call'){const arity=calculationFunctions[n.name];if(!arity)throw new CalculationError('Unknown function '+n.name,n.at);if(n.args.length<arity[0]||n.args.length>arity[1])throw new CalculationError(n.name+' expects '+arity.join('–')+' arguments.',n.at);}if(n.kind==='field'&&fields&&!fields.some(f=>f.toLowerCase()===n.name.toLowerCase()))throw new CalculationError('Unavailable field ['+n.name+']. Select a configured field.',n.at);if(n.kind==='metric'||n.kind==='reference'){if(!names.has(n.name.toLowerCase())&&!((m.defaultMeasure||g.defaultMeasure)&&n.kind==='metric'))throw new CalculationError('Unavailable measure '+n.name,n.at);const child=defs.get(n.name.toLowerCase());if(g.enabled&&m.enabled&&child&&!child.enabled)throw new CalculationError('Dependency is disabled: '+n.name,n.at);}});}}}
 const active=new Set<string>(),done=new Set<string>();const visit=(name:string)=>{if(done.has(name))return;if(active.has(name))throw new Error('Circular calculation dependency: '+name);const m=defs.get(name);if(!m)return;active.add(name);for(const source of [m.formula,...(m.total==='custom'?[m.totalFormula||'']:[])])for(const ref of calculationReferences(source))visit(ref.toLowerCase());active.delete(name);done.add(name);};defs.forEach((_m,n)=>visit(n));
}
/** Structured chat token stores ID; saved questions survive a group rename. */
export function expandCalculationGroups(question:string,groups:CalculationGroup[]|undefined):string {
 let result=calculationQuestionTokens(question,groups);for(const g of groups||[])for(const m of g.measures){const token='#metric['+m.id+']';if(result.includes(token)){if(!g.enabled||!m.enabled)throw new Error('Calculation is disabled: '+m.name);result=result.split(token).join(m.name);}}for(const g of groups||[]){const escaped=g.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const token='#calc['+g.id+']';if(result.includes(token)||new RegExp('#'+escaped+'(?![\\w])','i').test(result)){if(!g.enabled)throw new Error('Calculation group is disabled: '+g.name);const names=g.measures.filter(m=>m.enabled).map(m=>m.name);if(!names.length)throw new Error('Calculation group has no enabled measures: '+g.name);result=result.split(token).join(names.join(' and ')).replace(new RegExp('#'+escaped+'(?![\\w])','gi'),names.join(' and '));}}
 if(/#(?:calc|metric)\[/.test(result))throw new Error('A selected calculation group no longer exists. Select it again.');return result;
}
export function calculationMetricNodes(ast:CalcNode):Array<Extract<CalcNode,{kind:'metric'}>> {const result:Array<Extract<CalcNode,{kind:'metric'}>>=[];walkCalculation(ast,n=>{if(n.kind==='metric')result.push(n);});return result;}

/** Remap only semantic references; literal filter values and comments remain untouched. */
export function remapCalculation(source:string,replacements:ReadonlyMap<string,string>):string {
 const ast=parseCalculation(source),tokens=tokenizeCalculation(source),edits:Array<{start:number;end:number;text:string}>=[];
 walkCalculation(ast,n=>{
  if(n.kind==='metric'){const token=tokens.find(t=>t.start===n.at&&t.kind==='word')||tokens.find(t=>t.start>n.at&&t.kind!=='comment');const replacement=replacements.get(n.name);if(token&&replacement&&(token.kind==='string'||token.kind==='word'))edits.push({start:token.start,end:token.end,text:token.kind==='word'?'('+quoteCalculation(replacement)+')':quoteCalculation(replacement)});}
  if(n.kind==='field'||n.kind==='reference'){const token=tokens.find(t=>t.start===n.at),replacement=replacements.get(n.name);if(token&&replacement)edits.push({start:token.start,end:token.end,text:(n.kind==='reference'?'@':'')+'['+replacement+']'});}
 });
 for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
 parseCalculation(source);return source;
}

export function calculationQuestionTokens(question:string,groups:CalculationGroup[]|undefined):string {
 const choices=(groups||[]).flatMap(g=>[{name:g.name,token:'#calc['+g.id+']'},...g.measures.map(m=>({name:m.name,token:'#metric['+m.id+']'}))]).sort((a,b)=>b.name.length-a.name.length);
 for(const choice of choices){const escaped=choice.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');question=question.replace(new RegExp('#'+escaped+'(?![\\w])','gi'),()=>choice.token);}
 return question;
}
export function displayCalculationQuestion(question:string,groups:CalculationGroup[]|undefined):string {
 question=question.replace(/#metric\[([^\]]+)\]/g,(_token,id)=>'#'+(groups?.flatMap(g=>g.measures).find(m=>m.id===id)?.name||'Unavailable calculation'));
 return question.replace(/#calc\[([^\]]+)\]/g,(_token,id)=>'#'+(groups?.find(g=>g.id===id)?.name||'Unavailable group'));
}
