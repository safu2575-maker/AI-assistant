import { QnaResponse, QnaTable, ModelSelection } from "./qna/types";
import { formatPowerBiValue } from "./dataAdapter";

/** Sum only administrator-confirmed monthly additive values; never parse formatted text. */
export function monthlyPeriod(source: QnaTable, groupCount: number, measures: string[], start: number, end: number, totalOnly: boolean): QnaResponse {
    const groups = new Map<string,{labels:string[]; values:Array<number|null>; selections:ModelSelection[]}>();
    const formats = source.modelFormats?.slice(groupCount+1) || [];
    source.rows.forEach((row,index)=>{
        const month = Number(row[groupCount]); if (month < start || month > end) return;
        const labels = row.slice(0,groupCount), key = JSON.stringify(labels);
        const entry = groups.get(key) || {labels,values:measures.map(()=>null),selections:[]};
        measures.forEach((_,measure)=>{
            const value=source.modelRawRows?.[index]?.[groupCount+1+measure];
            if (value !== null && value !== undefined && Number.isFinite(value)) entry.values[measure]=(entry.values[measure] ?? 0)+value;
        });
        entry.selections.push(...(source.modelRowSelections?.[index] || [])); groups.set(key,entry);
    });
    const entries=[...groups.values()];
    const formatted=(values:Array<number|null>)=>values.map((value,index)=>value===null ? "—" : formatPowerBiValue(value,formats[index]));
    if (totalOnly) {
        const values=entries[0]?.values || measures.map(()=>null);
        return {text:"",table:{columns:[],rows:[],rowIndices:[],modelTotals:["Grand Total",...formatted(values)],modelRawTotals:[null,...values],modelFormats:[undefined,...formats]}};
    }
    return {text:"",table:{columns:[...source.columns.slice(0,groupCount),...measures],rows:entries.map(entry=>[...entry.labels,...formatted(entry.values)]),rowIndices:entries.map(()=>[]),modelRawRows:entries.map(entry=>[...entry.labels.map(()=>null),...entry.values]),modelFormats:[...Array(groupCount).fill(undefined),...formats],modelRowSelections:entries.map(entry=>entry.selections)}};
}
