import { QnaChart } from "./types";
import { ChartTimeline } from "./chartTimeline";
import { settingsSelect } from "./settingsSelect";

/** Filter existing categories without pivoting, aggregating, or changing their order. */
export function filterChartPeriods(chart: QnaChart, timeline: ChartTimeline, first: number, last: number): QnaChart {
    const allowed = new Set<number>();
    timeline.series.forEach(series => series.points.forEach((point,key) => { if(key>=first && key<=last)allowed.add(point.source); }));
    const indices=chart.labels.map((_,i)=>i).filter(i=>allowed.has(i));
    const pick=<T>(values:T[])=>indices.map(i=>values[i]);
    return {...chart,labels:pick(chart.labels),values:pick(chart.values),valueLabels:pick(chart.valueLabels),rowIndices:pick(chart.rowIndices),
        groupValues:chart.groupValues ? pick(chart.groupValues):undefined,
        series:chart.series?.map(s=>({...s,values:pick(s.values),valueLabels:pick(s.valueLabels),rowIndices:s.rowIndices?pick(s.rowIndices):undefined}))};
}

export function chartWindow(chart: QnaChart, timeline: ChartTimeline | undefined, changed:()=>void) {
    const controls=document.createElement("div");controls.className="askbics-chart-window";
    let zoom=1,first=timeline?.periods[0].key || 0,last=timeline?.periods[timeline.periods.length-1].key || 0;
    if(timeline){
        const details=document.createElement("details"),summary=document.createElement("summary");summary.textContent="Period";details.append(summary);
        const popup=document.createElement("div");popup.className="askbics-chart-window__period";
        const select=(name:string)=>{const label=document.createElement("label");label.textContent=name;const input=document.createElement("select");input.setAttribute("aria-label",name);timeline.periods.forEach(p=>{const option=document.createElement("option");option.value=String(p.key);option.textContent=p.label;input.append(option);});label.append(input);popup.append(label);return {input,refresh:settingsSelect(input,false)};};
        const from=select("From"),to=select("To");
        const sync=()=>{from.input.value=String(first);to.input.value=String(last);from.refresh();to.refresh();summary.textContent=first===timeline.periods[0].key&&last===timeline.periods[timeline.periods.length-1].key?"Period: All":"Period: Custom";changed();};
        from.input.onchange=()=>{first=Number(from.input.value);last=Math.max(first,last);sync();};
        to.input.onchange=()=>{last=Number(to.input.value);first=Math.min(first,last);sync();};
        const preset=(name:string,action:()=>void)=>{const b=document.createElement("button");b.type="button";b.textContent=name;b.onclick=()=>{action();sync();details.open=false;};popup.append(b);};
        preset("All periods",()=>{first=timeline.periods[0].key;last=timeline.periods[timeline.periods.length-1].key;});
        if(timeline.monthly)preset("Last 12 months",()=>{last=timeline.periods[timeline.periods.length-1].key;first=timeline.periods.find(p=>p.key>=last-11)!.key;});
        from.input.value=String(first);to.input.value=String(last);from.refresh();to.refresh();summary.textContent="Period: All";
        details.append(popup);controls.append(details);details.onkeydown=e=>{if(e.key==="Escape"){details.open=false;summary.focus();}};
    }
    const caption=document.createElement("span");caption.textContent="100%";
    const button=(name:string,path:string,action:()=>void)=>{const b=document.createElement("button");b.type="button";b.title=name;b.setAttribute("aria-label",name);const icon=document.createElementNS("http://www.w3.org/2000/svg","svg");icon.setAttribute("viewBox","0 0 24 24");icon.setAttribute("aria-hidden","true");const shape=document.createElementNS(icon.namespaceURI,"path");shape.setAttribute("d",path);icon.append(shape);b.append(icon);b.onclick=()=>{action();caption.textContent=`${Math.round(zoom*100)}%`;changed();};return b;};
    controls.append(button("Zoom out","M5 12h14",()=>{zoom=Math.max(1,zoom-.25);}),caption,button("Zoom in","M5 12h14M12 5v14",()=>{zoom=Math.min(4,zoom+.25);}),button("Reset zoom","M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",()=>{zoom=1;}));
    return {controls,zoom:()=>zoom,view:()=>timeline?filterChartPeriods(chart,timeline,first,last):chart};
}
