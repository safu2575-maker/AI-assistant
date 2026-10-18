import { QnaChart } from "./types";
import { ChartTimeline } from "./chartTimeline";
import { settingsSelect } from "./settingsSelect";

export function chartExplorer(timeline: ChartTimeline, changed: () => void, color: (index:number,name:string)=>string) {
    const controls=document.createElement("div");controls.className="askbics-chart-explorer";
    let start=0,end=timeline.periods.length-1;
    const selected=new Set(timeline.series.map(s=>s.name));
    const select=(label:string,options:Array<[string,string]>)=>{
        const holder=document.createElement("label");holder.textContent=label;
        const input=document.createElement("select");input.setAttribute("aria-label",label);
        options.forEach(([value,text])=>{const option=document.createElement("option");option.value=value;option.textContent=text;input.append(option);});
        holder.append(input);controls.append(holder);const refresh=settingsSelect(input,false);return {input,refresh};
    };
    const presets=select("Period",[["all","All periods"],...(timeline.monthly?[["12","Last 12 months"] as [string,string]]:[]),["custom","Custom range"]]);
    const options=timeline.periods.map((p,i)=>[String(i),p.label] as [string,string]);
    const from=select("From",options),to=select("To",options);
    const categories=document.createElement("details");categories.className="askbics-chart-categories";
    const summary=document.createElement("summary");categories.append(summary);
    const list=document.createElement("div");const search=document.createElement("input");search.type="search";search.placeholder="Search series…";search.setAttribute("aria-label","Search chart series");list.append(search);
    const checks:Array<{name:string;label:HTMLLabelElement;input:HTMLInputElement}>=[];
    const legend=document.createElement("div");legend.className="askbics-chart-legend";
    const updateLegend=()=>{legend.replaceChildren();timeline.series.forEach((s,i)=>{if(!selected.has(s.name))return;const item=document.createElement("span"),swatch=document.createElement("i");swatch.style.background=color(i,s.name);item.append(swatch,document.createTextNode(s.name));legend.append(item);});};
    const updateCategories=()=>{summary.textContent=`Series (${selected.size}/${timeline.series.length})`;updateLegend();changed();};
    for(const [caption,enabled] of [["Select all",true],["Clear",false]] as const){const button=document.createElement("button");button.type="button";button.textContent=caption;button.onclick=()=>{checks.filter(c=>!c.label.hidden).forEach(c=>{c.input.checked=enabled;if(enabled)selected.add(c.name);else selected.delete(c.name);});updateCategories();};list.append(button);}
    timeline.series.forEach(s=>{const label=document.createElement("label"),input=document.createElement("input");input.type="checkbox";input.checked=true;label.append(input,document.createTextNode(s.name));list.append(label);checks.push({name:s.name,label,input});input.onchange=()=>{if(input.checked)selected.add(s.name);else selected.delete(s.name);updateCategories();};});
    search.oninput=()=>checks.forEach(c=>{c.label.hidden=!c.name.toLowerCase().includes(search.value.trim().toLowerCase());});
    categories.append(list);controls.append(categories);summary.textContent=`Series (${selected.size}/${timeline.series.length})`;
    categories.onkeydown=e=>{if(e.key==="Escape"){categories.open=false;summary.focus();}};
    const navigator=document.createElement("div");navigator.className="askbics-chart-navigator";
    const caption=document.createElement("span");caption.setAttribute("aria-live","polite");
    const range=(name:string)=>{const holder=document.createElement("label");holder.textContent=name;const input=document.createElement("input");input.type="range";input.min="0";input.max=String(end);input.step="1";input.setAttribute("aria-label",name);holder.append(input);navigator.append(holder);return input;};
    const first=range("First visible period"),last=range("Last visible period"),pan=range("Move selected time window");
    navigator.prepend(caption);
    const sync=()=>{from.input.value=String(start);to.input.value=String(end);from.refresh();to.refresh();presets.refresh();first.value=String(start);last.value=String(end);pan.max=String(timeline.periods.length-1-(end-start));pan.value=String(start);pan.disabled=start===0&&end===timeline.periods.length-1;caption.textContent=`${timeline.periods[start].label} – ${timeline.periods[end].label} · ${end-start+1} periods (loaded data)`;};
    const custom=()=>{presets.input.value="custom";sync();changed();};
    from.input.onchange=()=>{start=Number(from.input.value);end=Math.max(start,end);custom();};
    to.input.onchange=()=>{end=Number(to.input.value);start=Math.min(start,end);custom();};
    first.oninput=()=>{start=Math.min(Number(first.value),end);custom();};last.oninput=()=>{end=Math.max(Number(last.value),start);custom();};
    pan.oninput=()=>{const length=end-start;start=Number(pan.value);end=start+length;custom();};
    presets.input.onchange=()=>{if(presets.input.value==="all"){start=0;end=timeline.periods.length-1;}else if(presets.input.value==="12"){end=timeline.periods.length-1;start=timeline.periods.findIndex(p=>p.key>=timeline.periods[end].key-11);}sync();changed();};
    navigator.append(legend);updateLegend();sync();
    return {controls,navigator,view:()=>({periods:timeline.periods.slice(start,end+1),series:timeline.series.filter(s=>selected.has(s.name))})};
}

/** Separate paths per category; missing observations break paths instead of becoming zero. */
export function drawTimeline(chart:QnaChart, view:ReturnType<ReturnType<typeof chartExplorer>["view"]>, labels:boolean,
    color:(i:number,name:string)=>string, tooltip:(mark:SVGElement,lines:string[],source:number,indices?:number[])=>void):SVGSVGElement {
    const ns="http://www.w3.org/2000/svg";
    const svg=document.createElementNS(ns,"svg");svg.setAttribute("viewBox","0 0 900 400");svg.setAttribute("role","img");svg.setAttribute("aria-label",chart.title);
    const add=(tag:string,attrs:Record<string,string|number>,text?:string)=>{const el=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,String(v)));if(text!==undefined)el.textContent=text;svg.append(el);return el;};
    const values=view.series.flatMap(s=>view.periods.flatMap(p=>{const point=s.points.get(p.key);return point?[point.value]:[];}));
    if(!values.length){add("text",{x:450,y:190,"text-anchor":"middle",fill:"#64748b"},"No data for the selected periods and series");return svg;}
    const low=Math.min(0,...values),high=Math.max(0,...values),span=high-low||1;
    const x=(key:number)=>70+(view.periods.length===1?390:(key-view.periods[0].key)/(view.periods[view.periods.length-1].key-view.periods[0].key)*790);
    const y=(v:number)=>25+(high-v)/span*300;
    for(let tick=0;tick<=5;tick++){const value=low+span*tick/5;add("line",{x1:70,x2:860,y1:y(value),y2:y(value),stroke:"#e8edf5"});add("text",{x:60,y:y(value)+4,"text-anchor":"end",fill:"#64748b","font-size":11},Intl.NumberFormat(undefined,{notation:"compact",maximumFractionDigits:1}).format(value));}
    const stride=Math.max(1,Math.ceil(view.periods.length/8));view.periods.forEach((p,i)=>{if(i%stride===0||i===view.periods.length-1)add("text",{x:x(p.key),y:350,"text-anchor":"middle",fill:"#64748b","font-size":11},p.label);});
    view.series.forEach(s=>{const ink=color(0,s.name);let path="",previous:number|undefined;let segment:Array<[number,number]>=[];
        const fill=()=>{if(chart.type==="area" && segment.length){add("path",{d:`M${segment[0][0]},${y(0)} `+segment.map(([px,py])=>`L${px},${py}`).join(" ")+` L${segment[segment.length-1][0]},${y(0)} Z`,fill:ink,opacity:.1});}segment=[];};
        view.periods.forEach(p=>{const point=s.points.get(p.key);if(!point){previous=undefined;fill();return;}path+=`${previous===undefined?"M":"L"}${x(p.key)},${y(point.value)} `;previous=p.key;segment.push([x(p.key),y(point.value)]);});fill();
        add("path",{d:path,fill:"none",stroke:ink,"stroke-width":2.5});
        view.periods.forEach(p=>{const point=s.points.get(p.key);if(!point)return;const mark=add("circle",{cx:x(p.key),cy:y(point.value),r:4,fill:"white",stroke:ink,"stroke-width":2,tabindex:0,"aria-label":`${p.label}, ${s.name}, ${point.label}`});mark.classList.add("askbics-qna__point");tooltip(mark,[p.label,s.name,point.label],point.source,point.indices);if(labels)add("text",{x:x(p.key),y:y(point.value)-10,"text-anchor":"middle",fill:ink,"font-size":10},point.label);});
    });
    return svg;
}
