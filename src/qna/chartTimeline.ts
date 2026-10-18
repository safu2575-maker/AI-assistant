import { QnaChart } from "./types";

export interface TimelinePoint { value: number; label: string; source: number; indices?: number[]; }
export interface TimelineSeries { name: string; points: Map<number, TimelinePoint>; }
export interface ChartTimeline { periods: Array<{ key: number; label: string }>; series: TimelineSeries[]; monthly: boolean; }
const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
function month(value: string): number { const n = Number(value); return /^\d{1,2}$/.test(value) && n >= 1 && n <= 12 ? n - 1 : months.findIndex(m => m === value.toLowerCase() || m.slice(0,3) === value.toLowerCase()); }
/** Pivot existing results only. Never sum duplicate cells or invent zeroes for missing periods. */
export function chartTimeline(chart: QnaChart): ChartTimeline | undefined {
    const names = chart.groupNames || [];
    const yearIndex = names.findIndex(n => /\byear\b/i.test(n));
    const monthIndex = names.findIndex(n => /\bmonth\b/i.test(n));
    const dateIndex = names.findIndex(n => /\bdate\b/i.test(n));
    const grouped = !!chart.groupValues && (yearIndex >= 0 || dateIndex >= 0 || monthIndex >= 0);
    if (!grouped && !/\b(year|month|date|period)\b/i.test(chart.axisTitle || "")) return;
    const periods = new Map<number,string>(), series = new Map<string,TimelineSeries>();
    let monthly = false;
    for (let i=0;i<chart.labels.length;i++) {
        const values = grouped ? chart.groupValues![i] : [chart.labels[i]];
        let year: number, m = -1;
        if (grouped && yearIndex >= 0) { year=Number(values[yearIndex]); if(monthIndex>=0)m=month(values[monthIndex]); if(monthIndex>=0 && m<0)return; }
        else {
            const raw = grouped ? values[dateIndex>=0?dateIndex:monthIndex] : values[0];
            const match = raw.match(/^(\d{4})(?:-(\d{1,2})(?:-\d{1,2})?)?$/) || raw.match(/^([A-Za-z]+)\s+(\d{4})$/);
            if (!match) return;
            if (/^\d{4}/.test(raw)) { year=Number(match[1]); if(match[2])m=Number(match[2])-1; }
            else { year=Number(match[2]);m=month(match[1]); }
        }
        if(!Number.isInteger(year) || year<1000 || year>9999 || m>11)return;
        monthly ||= m>=0;
        const key=year*12+Math.max(0,m);
        const label=m>=0 ? `${months[m][0].toUpperCase()+months[m].slice(1,3)} ${year}` : String(year);
        periods.set(key,label);
        const category=grouped ? values.filter((_,j)=>j!==yearIndex && j!==monthIndex && j!==dateIndex).join(" · ") : "";
        const metrics=chart.series?.length ? chart.series : [{name:chart.title.split(/\s+by\s+/i)[0],values:chart.values,valueLabels:chart.valueLabels}];
        for(const metric of metrics) {
            const name=category ? (metrics.length>1 ? `${category} · ${metric.name}` : category) : metric.name;
            const item=series.get(name) || {name,points:new Map<number,TimelinePoint>()};
            if(item.points.has(key))return; // Ambiguous duplicate grain: preserve the original chart.
            if(Number.isFinite(metric.values[i]) && metric.valueLabels[i]!=="—")item.points.set(key,{value:metric.values[i],label:metric.valueLabels[i],source:i,indices:metric.rowIndices?.[i]});
            series.set(name,item);
        }
    }
    if(!periods.size)return;
    return {periods:Array.from(periods,([key,label])=>({key,label})).sort((a,b)=>a.key-b.key),series:[...series.values()],monthly};
}
