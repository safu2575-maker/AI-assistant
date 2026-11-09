import {QnaTable} from './qna/types';
import {formatPowerBiValue} from './dataAdapter';
import {AgingBucket} from './aging';
import {ModelField} from './parameterQuery';
export function additiveAgingBands(source:QnaTable,group:ModelField|undefined,dateField:string,measure:string,asOf:string,buckets:Array<AgingBucket|null|undefined>):QnaTable[] {
 if(source.modelResultComplete!==true)throw new Error('Aging daily data is incomplete. Narrow the filters.');
 const gi=group?source.columns.indexOf(group.name):-1,di=source.columns.indexOf(dateField),mi=source.columns.indexOf(measure);
 if((group&&gi<0)||di<0||mi<0||!source.modelRawRows||!source.modelGroupValues)throw new Error('Raw aging dates and numeric balances are required.');
 if(source.rows.length>30000)throw new Error('Aging daily data exceeds 30,000 rows.');
 const entries=new Map<string,{label:string;value:string|number|boolean|null;values:Array<number|null>}>(),seen=new Set<string>();
 const format=source.modelFormats?.[mi];
 source.rows.forEach((row,i)=>{
  const raw=source.modelRawRows![i]?.[mi],values=source.modelGroupValues![i];
  if(raw!==null&&(typeof raw!=='number'||!Number.isFinite(raw)))throw new Error('Aging requires raw numeric balances.');
  const value=group?values?.[gi]:'All balances',due=values?.[di];
  if(value===undefined||due===undefined)throw new Error('Raw aging grouping values are missing.');
  const key=JSON.stringify(value),identity=JSON.stringify([value,due]);
  if(seen.has(identity))throw new Error('Aging returned duplicate customer/date rows.');seen.add(identity);
  const ms=due===null?null:typeof due==='string'&&/^\d{4}-\d{2}-\d{2}/.test(due)?Date.parse(due):NaN;
  if(ms!==null&&!Number.isFinite(ms))throw new Error('Aging requires raw calendar dates.');
  const age=ms===null?null:Math.floor((Date.parse(asOf)+86400000-1-ms)/86400000);
  let entry=entries.get(key);if(!entry){entry={label:group?row[gi]:'All balances',value,values:buckets.map(()=>null)};entries.set(key,entry);}
  buckets.forEach((b,j)=>{const include=b===undefined||b===null&&age===null||b!=null&&age!==null&&(b.min===null||age>=b.min)&&(b.max===null||age<=b.max);if(include&&raw!==null)entry!.values[j]=(entry!.values[j]??0)+raw;});
 });
 return buckets.map((_,j)=>{const rows=[...entries.values()];const total=rows.reduce<number|null>((sum,r)=>r.values[j]===null?sum:(sum??0)+r.values[j]!,null);const text=(v:number|null)=>v===null?'—':formatPowerBiValue(v,format);return {columns:[group?.name||'Scope',measure],rows:rows.map(r=>[r.label,text(r.values[j])]),rowIndices:rows.map(()=>[]),modelSelections:rows.map(r=>group?[{table:group.table,column:group.column,value:r.value as string|number|boolean}]:[]),modelRawRows:rows.map(r=>[null,r.values[j]]),modelTotals:['Grand Total',text(total)],modelRawTotals:[null,total],modelResultComplete:true};});
}

