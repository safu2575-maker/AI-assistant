import { QnaTable } from './qna/types';
/** Outline headings are structural: never sum model measures to invent parent totals. */
export function outlineModelRows(table:QnaTable,rowCount:number,parentTotals=new Map<string,string[]>()):QnaTable{
 if(table.matrix||table.duplicateRows?.length||rowCount<2)return table;
 const entries:Array<{path:string[];source?:number}>=[];
 const visit=(indices:number[],depth:number,path:string[])=>{
  const groups=new Map<string,number[]>();for(const i of indices){const label=table.rows[i][depth];groups.set(label,[...(groups.get(label)||[]),i]);}
  for(const [label,items] of groups){const next=[...path,label];if(depth<rowCount-1){entries.push({path:next});visit(items,depth+1,next);}else for(const source of items)entries.push({path:next,source});}
 };
 visit(table.rows.map((_,i)=>i),0,[]);
 const select=(i:number)=>entries[i].source;
 return {...table,columns:[table.columns.slice(0,rowCount).join(' → '),...table.columns.slice(rowCount)],rows:entries.map(e=>[e.path.at(-1)!,...(e.source===undefined?parentTotals.get(JSON.stringify(e.path))||table.columns.slice(rowCount).map(()=>'—'):table.rows[e.source].slice(rowCount))]),
 modelPivot:table.modelPivot?{...table.modelPivot,rowFields:[table.columns.slice(0,rowCount).join(' → ')]}:undefined,
 modelFormats:table.modelFormats?[undefined,...table.modelFormats.slice(rowCount)]:undefined,
 modelRawTotals:table.modelRawTotals?[null,...table.modelRawTotals.slice(rowCount)]:undefined,
 rowIndices:entries.map(e=>e.source===undefined?[]:table.rowIndices[e.source]),
 modelRawRows:undefined,modelGroupValues:undefined,modelSelections:entries.map(e=>e.source===undefined?[]:table.modelSelections?.[e.source]||[]),
 modelRowSelections:entries.map(e=>e.source===undefined?[]:table.modelRowSelections?.[e.source]||[]),
 modelCellSelections:entries.map((e,i)=>select(i)===undefined?[]:[table.modelRowSelections?.[e.source!]||[],...table.modelCellSelections?.[e.source!]?.slice(rowCount)||[]]),
 modelTotals:table.modelTotals?['Grand Total',...table.modelTotals.slice(rowCount)]:undefined,
 matrix:{levels:entries.map(e=>e.path.length-1),keys:entries.map(e=>JSON.stringify(e.path)),parentKeys:entries.map(e=>e.path.length>1?JSON.stringify(e.path.slice(0,-1)):undefined),hasChildren:entries.map(e=>e.source===undefined),rowHeader:table.columns.slice(0,rowCount).join(' → '),levelNames:table.columns.slice(0,rowCount)}};
}
