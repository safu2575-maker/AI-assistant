import { AdvancedFilter, BasicFilter, IFilter } from 'powerbi-models';
import { CalcNode, CalcValue, CalculationError } from './calculationFormula';
import type { ParameterConfig, ParameterPlan } from './parameterQuery';
/** Formula overrides only AskBICS-owned question predicates. Host/report/RLS remain outside this plan. */
export function calculationScope(plan:ParameterPlan,config:ParameterConfig,filters:CalcNode[]):ParameterPlan {
 const targets=new Set<string>(),result:IFilter[]=[];
 const value=(n:CalcNode):CalcValue=>{if(n.kind==='literal')return n.value;if(n.kind==='unary'&&n.op==='-'&&n.child.kind==='literal'&&typeof n.child.value==='number')return -n.child.value;throw new CalculationError('Filter values must be literal text, numbers, dates or null.',n.at);};
 const build=(n:CalcNode):IFilter[]=>{
  if(n.kind==='unary'&&n.op==='NOT'){
   const invert=(node:CalcNode):CalcNode=>{if(node.kind==='unary'&&node.op==='NOT')return node.child;if(node.kind!=='binary')throw new CalculationError('NOT requires a field predicate.',node.at);const ops:Record<string,string>={'=':'!=','==':'!=','!=':'=','<>':'=','>':'<=','<':'>=','>=':'<','<=':'>','IN':'NOT IN','NOT IN':'IN','BETWEEN':'NOT BETWEEN','NOT BETWEEN':'BETWEEN'};if(node.op==='AND'||node.op==='OR')return {...node,op:node.op==='AND'?'OR':'AND',left:invert(node.left),right:invert(node.right)};if(!ops[node.op])throw new CalculationError('Unsupported NOT predicate.',node.at);return {...node,op:ops[node.op]};};return build(invert(n.child));
  }
  if(n.kind==='binary'&&n.op==='AND')return [...build(n.left),...build(n.right)];
  if(n.kind==='binary'&&n.op==='OR'){const a=build(n.left),b=build(n.right);if(a.length!==1||b.length!==1||JSON.stringify(a[0].target)!==JSON.stringify(b[0].target))throw new CalculationError('OR across different fields is not supported by this host filter plan. Use separate measures or same-field IN.',n.at);if([a[0],b[0]].some((f:any)=>f.operator==='NotIn'))throw new CalculationError('OR with NOT IN requires a model measure; this predicate cannot be safely translated.',n.at);const conditions=(f:any)=>f.conditions||((f.operator==='In'&&f.values)||[]).map((v:CalcValue)=>({operator:'Is',value:v}));if([a[0],b[0]].some((f:any)=>f.logicalOperator==='And'&&f.conditions?.length>1))throw new CalculationError('Nested OR of ranges requires a model measure.',n.at);return [new AdvancedFilter(a[0].target as any,'Or',...conditions(a[0]),...conditions(b[0])).toJSON()];}
  if(n.kind!=='binary'||n.left.kind!=='field')throw new CalculationError('Use [Field] = value or a field comparison.',n.at);
  const fieldName=n.left.name;const bound=n.left.target;const f=config.fields.find(f=>bound?f.table===bound.table&&f.column===bound.column:f.name.toLowerCase()===fieldName.toLowerCase());if(!f)throw new CalculationError('Unavailable field '+n.left.name,n.at);const target={table:f.table,column:f.column};targets.add(JSON.stringify(target));
  const typed=(v:CalcValue)=>{if(v===null)return null;if(f.type==='number'){if(typeof v!=='number'||!Number.isFinite(v))throw new CalculationError(f.name+' requires a number.',n.at);}else if(f.type==='date'){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))throw new CalculationError(f.name+' requires YYYY-MM-DD.',n.at);}else if(typeof v!=='string'&&typeof v!=='boolean')throw new CalculationError(f.name+' requires quoted text.',n.at);return v;};
  if(['IN','NOT IN'].includes(n.op)&&n.right.kind==='list')return [new BasicFilter(target,n.op==='IN'?'In':'NotIn',n.right.items.map(v=>typed(value(v))) as any).toJSON()];
  if(['BETWEEN','NOT BETWEEN'].includes(n.op)&&n.right.kind==='list'){const [a,b]=n.right.items.map(v=>typed(value(v)));return [new AdvancedFilter(target,n.op==='BETWEEN'?'And':'Or',{operator:n.op==='BETWEEN'?'GreaterThanOrEqual':'LessThan',value:a as any},{operator:n.op==='BETWEEN'?'LessThanOrEqual':'GreaterThan',value:b as any}).toJSON()];}
  const op:Record<string,string>={'=':'Is','==':'Is','!=':'IsNot','<>':'IsNot','>':'GreaterThan','<':'LessThan','>=':'GreaterThanOrEqual','<=':'LessThanOrEqual'};if(!op[n.op])throw new CalculationError('Invalid filter operator '+n.op,n.at);return [new AdvancedFilter(target,'And',{operator:op[n.op] as any,value:typed(value(n.right)) as any}).toJSON()];
 };for(const f of filters)result.push(...build(f));
 const inherited=plan.filters.filter(f=>{if(Array.isArray(f.target)){if(f.target.some(t=>targets.has(JSON.stringify(t))))throw new CalculationError('Formula overrides overlap a compound period/selection filter. Use a compatible field filter.');return true;}return !targets.has(JSON.stringify(f.target));});
 return {...plan,filters:[...inherited,...result]};
}
/** Explicit finite calendar domain; never guesses a year from the computer clock. */
export function calculationDays(plan:ParameterPlan,config:ParameterConfig,row:Record<string,CalcValue>={}):number {
 const time=config.time;const yearField=time?.yearField||config.fields.find(f=>/^year$/i.test(f.name))?.name;const monthField=time?.monthField||config.fields.find(f=>/^month$/i.test(f.name))?.name;const dateField=time?.dateField;const indexField=time?.monthIndexField;
 const fields=[yearField,monthField,dateField,indexField].filter(Boolean) as string[];
 const predicates=plan.filters.filter(f=>{const t=f.target as any;return fields.some(name=>{const field=config.fields.find(x=>x.name===name);return field?.table===t.table&&field?.column===t.column;});}) as any[];
 const named=(f:any)=>config.fields.find(x=>x.table===f.target.table&&x.column===f.target.column)?.name;
 // A finite date domain needs both bounds. An open-ended Year >= 2026
 // must not silently become just the year 2026.
 const yearOf=(name:string|undefined,value:any):number=>name===dateField?Number(String(value).slice(0,4)):name===indexField?Math.floor((Number(value)-(time?.monthIndexBase??1))/12):Number(value);
 let lower=-Infinity,upper=Infinity;
 for(const name of [yearField,dateField,indexField].filter(Boolean) as string[]){
  if(row[name]!==undefined&&row[name]!==null){const y=yearOf(name,row[name]);lower=Math.max(lower,y);upper=Math.min(upper,y);}
  for(const f of predicates.filter(f=>named(f)===name)){
   let lo=-Infinity,hi=Infinity;
   if(f.operator==='In'){const ys=f.values.map((v:any)=>yearOf(name,v));lo=Math.min(...ys);hi=Math.max(...ys);}
   else if(f.conditions?.length){
    const bounds=f.conditions.map((c:any)=>{const y=yearOf(name,c.value);return {lo:['Is','GreaterThan','GreaterThanOrEqual'].includes(c.operator)?y:-Infinity,hi:['Is','LessThan','LessThanOrEqual'].includes(c.operator)?y:Infinity};});
    lo=f.logicalOperator==='Or'?Math.min(...bounds.map((b:any)=>b.lo)):Math.max(...bounds.map((b:any)=>b.lo));
    hi=f.logicalOperator==='Or'?Math.max(...bounds.map((b:any)=>b.hi)):Math.min(...bounds.map((b:any)=>b.hi));
   }
   lower=Math.max(lower,lo);upper=Math.min(upper,hi);
  }
 }
 if(!Number.isInteger(lower)||!Number.isInteger(upper)||lower<100||upper>9999)throw new CalculationError('DAYS needs an explicit finite year, date range or MonthIndex context. Use DAYSINMONTH(year, month) or DAYS((measure, filters)).');
 const min=lower,max=upper;if(max<min)return 0;if(max-min>200)throw new CalculationError('Calendar context exceeds 200 years. Narrow the period.');
 const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
 const match=(actual:CalcValue,expected:any,name:string|undefined):boolean=>name===monthField?Number(actual)===(typeof expected==='number'||/^\d+$/.test(String(expected))?Number(expected):months.indexOf(String(expected).slice(0,3).toLowerCase())+1):name===yearField||name===indexField?Number(actual)===Number(expected):String(actual)===String(expected).slice(0,10);
 const accepts=(actual:CalcValue,f:any,name:string|undefined)=>{if(f.operator==='In')return f.values.some((v:any)=>match(actual,v,name));if(f.operator==='NotIn')return !f.values.some((v:any)=>match(actual,v,name));const checks=(f.conditions||[]).map((c:any)=>{const b=name===dateField?String(c.value).slice(0,10):c.value;switch(c.operator){case 'Is':return match(actual,b,name);case 'IsNot':return !match(actual,b,name);case 'GreaterThan':return actual!>b;case 'GreaterThanOrEqual':return actual!>=b;case 'LessThan':return actual!<b;case 'LessThanOrEqual':return actual!<=b;default:throw new CalculationError('Unsupported calendar predicate.');}});return f.logicalOperator==='Or'?checks.some(Boolean):checks.every(Boolean);};
 let count=0;for(let t=Date.UTC(min,0,1);t<Date.UTC(max+1,0,1);t+=86400000){const d=new Date(t),values:Record<string,CalcValue>={};if(yearField)values[yearField]=d.getUTCFullYear();if(monthField)values[monthField]=d.getUTCMonth()+1;if(dateField)values[dateField]=d.toISOString().slice(0,10);if(indexField)values[indexField]=d.getUTCFullYear()*12+d.getUTCMonth()+(time?.monthIndexBase??1);if(fields.every(n=>row[n]===undefined||row[n]===null||match(values[n],row[n],n))&&predicates.every(f=>accepts(values[named(f)!],f,named(f))))count++;}return count;
}
