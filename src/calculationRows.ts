import type { QnaTable } from './qna/types';
import { compareTimeLabels, timeFieldOrder } from './qna/timeLayout';

/** Pivot evaluated cells only. Subtotals must come from a separate total-context evaluation. */
export function calculationFieldsAsColumns(source: QnaTable, columnFields: string[], subtotals?: QnaTable): QnaTable {
 if (!source.calculationRowMeasures || source.columns.length < 3) return source;
 const valueIndex=source.columns.length-1, dimensions=source.columns.slice(0,-2);
 const columnIndices=columnFields.map(f=>dimensions.indexOf(f));
 if (!columnIndices.length || columnIndices.some(i=>i<0)) return source;
 const rowIndices=dimensions.map((_,i)=>i).filter(i=>!columnIndices.includes(i));
 const totals=new Set(source.totalRowIndices||[]), columnsByKey=new Map<string,string[]>(), groups=new Map<string,{name:string;labels:string[];cells:Map<string,number>}>();
 let duplicate=false;
 source.rows.forEach((r,i)=>{
  if(totals.has(i))return;
  const values=columnIndices.map(c=>r[c]), colKey=JSON.stringify(values);columnsByKey.set(colKey,values);
  const name=source.calculationRowMeasures![i],labels=rowIndices.map(c=>r[c]),key=JSON.stringify([name,...labels]);
  let group=groups.get(key);if(!group){group={name,labels,cells:new Map()};groups.set(key,group);}
  if(group.cells.has(colKey))duplicate=true;group.cells.set(colKey,i);
 });
 if(duplicate)return source;
 // Compare each dimension before formatting the combined heading. Month labels
 // must use calendar order, while ordinary categories retain natural ordering.
 const columnKeys=[...columnsByKey.keys()].sort((a,b)=>{
  const left=columnsByKey.get(a)!,right=columnsByKey.get(b)!;
  for(let i=0;i<columnFields.length;i++){
   const comparison=timeFieldOrder(columnFields[i])>=0
    ?compareTimeLabels(left[i],right[i])
    :left[i].localeCompare(right[i],undefined,{numeric:true});
   if(comparison)return comparison;
  }
  return 0;
 });
 const totalSource=rowIndices.length?subtotals:source, totalLookup=new Map<string,number>();
 totalSource?.rows.forEach((r,i)=>{
  if(rowIndices.length && totalSource.totalRowIndices?.includes(i))return;
  if(!rowIndices.length && !totals.has(i))return;
  const name=totalSource.calculationRowMeasures?.[i];
  const labels=rowIndices.map(c=>r[totalSource.columns.indexOf(dimensions[c])]);
  const key=JSON.stringify([name,...labels]);if(totalLookup.has(key))duplicate=true;totalLookup.set(key,i);
 });
 if(duplicate)return source;
 const hasTotal=totalLookup.size>0,columns=['Calculation',...rowIndices.map(c=>dimensions[c]),...columnKeys.map(k=>columnsByKey.get(k)!.join(' / ')),...(hasTotal?['Grand Total']:[])];
 const result:QnaTable={...source,columns,rows:[],rowIndices:[],cellIndices:[],modelRawRows:[],modelSelections:[],modelRowSelections:[],modelCellSelections:[],modelGroupValues:[],calculationNotes:{},calculationRowMeasures:[],totalRowIndices:[],modelFormats:columns.map(()=>undefined),modelEvaluatedTotals:columns.map(()=>false)};
 if(source.modelEditor)result.modelEditor={...source.modelEditor,rows:rowIndices.map(c=>dimensions[c]),columns:columnFields};
 delete result.modelTotals;delete result.modelRawTotals;delete result.modelPivot;delete result.matrix;
 for(const [key,group] of groups){
  const refs=columnKeys.map(k=>({table:source,index:group.cells.get(k)}));if(hasTotal)refs.push({table:totalSource!,index:totalLookup.get(key)});
  const offset=1+rowIndices.length,row=result.rows.length;
  const scopes=refs.map(({table,index})=>index===undefined?[]:table.modelCellSelections?.[index]?.[table.columns.length-1]||table.modelRowSelections?.[index]||[]);
  const cells=refs.map(({table,index})=>index===undefined?[]:table.rowIndices[index]||[]);
  result.rows.push([group.name,...group.labels,...refs.map(({table,index})=>index===undefined?'—':table.rows[index][table.columns.length-1])]);
  result.modelRawRows!.push([null,...group.labels.map(()=>null),...refs.map(({table,index})=>index===undefined?null:table.modelRawRows?.[index]?.[table.columns.length-1]??null)]);
  result.rowIndices.push([...new Set(cells.flat())]);result.cellIndices!.push([...Array.from({length:offset},()=>result.rowIndices[row]),...cells]);
  result.modelSelections!.push([]);result.modelRowSelections!.push(scopes.flat());result.modelCellSelections!.push([...Array.from({length:offset},()=>scopes.flat()),...scopes]);
  const first=[...group.cells.values()][0];result.modelGroupValues!.push(rowIndices.map(c=>source.modelGroupValues?.[first]?.[c]??null));result.calculationRowMeasures!.push(group.name);
  refs.forEach(({table,index},c)=>{const notes=index===undefined?undefined:table.calculationNotes?.[index+':'+(table.columns.length-1)];if(notes)result.calculationNotes![row+':'+(offset+c)]=notes;});
 }
 return result;
}

export function calculationYearsAsColumns(source: QnaTable, yearField: string): QnaTable {
 return calculationFieldsAsColumns(source,[yearField]);
}

/** Presentation only: keep each measure's formatted value, raw value and model scope. */
export function calculationItemsAsRows(source: QnaTable, measures: string[]): QnaTable {
 const valueColumns = measures.map(name => source.columns.indexOf(name)).filter(i => i >= 0);
 const dimensions = source.columns.map((_, i) => i).filter(i => !valueColumns.includes(i));
 const columns = [...dimensions.map(i => source.columns[i]), 'Calculation', 'Value'];
 const valueIndex = columns.length - 1;
 const result: QnaTable = {
  columns, rows: [], rowIndices: [], modelRawRows: [], modelSelections: [], modelRowSelections: [], modelCellSelections: [],
  modelGroupValues: [], calculationNotes: {}, totalRowIndices: [], calculationRowMeasures: [],
  modelResultComplete: source.modelResultComplete, modelSnapshot: source.modelSnapshot,
  backgroundFields: source.backgroundFields, modelEditor: source.modelEditor,
  modelFormats: columns.map(() => undefined),
  // Different calculations can have different units. Never synthesize a summed Value total.
  modelEvaluatedTotals: columns.map(() => false),
 };
 const append = (row: number, col: number, total: boolean) => {
  const index = result.rows.length;
  result.calculationRowMeasures!.push(source.columns[col]);
  result.rows.push([...dimensions.map((d, i) => total ? (i === 0 ? 'Grand Total' : '') : source.rows[row][d]), source.columns[col], total ? source.modelTotals?.[col] ?? '—' : source.rows[row][col]]);
  result.modelRawRows!.push([...dimensions.map(() => null), null, total ? source.modelRawTotals?.[col] ?? null : source.modelRawRows?.[row]?.[col] ?? null]);
  result.rowIndices.push(total ? [] : source.rowIndices[row] || []);
  const selection = total ? [] : source.modelSelections?.[row] || [];
  const scopes = total ? [] : source.modelCellSelections?.[row]?.[col] || source.modelRowSelections?.[row] || [];
  result.modelSelections!.push(selection);
  result.modelRowSelections!.push(scopes);
  result.modelCellSelections!.push(columns.map(() => scopes));
  result.modelGroupValues!.push(total ? [] : source.modelGroupValues?.[row] || []);
  const notes = source.calculationNotes?.[row + ':' + col];
  if (notes) result.calculationNotes![index + ':' + valueIndex] = notes;
  if (total || source.totalRowIndices?.includes(row)) result.totalRowIndices!.push(index);
 };
 source.rows.forEach((_, row) => valueColumns.forEach(col => append(row, col, false)));
 if (dimensions.length && !source.totalRowIndices?.length && source.modelTotals) valueColumns.forEach(col => append(-1, col, true));
 return result;
}
