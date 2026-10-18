import { QnaChart } from "./types";
type Kind = QnaChart["type"];
const common: Array<[Kind,string,string]> = [
    ["column","Column","M4 20V10h4v10m3 0V4h4v16m3 0V7h4v13"],
    ["bar","Bar","M3 4h16v4H3m0 3h11v4H3m0 3h18v4H3"],
    ["line","Line","M3 18l6-9 5 4 7-10"],
    ["area","Area","M3 20V14l6-6 5 5 7-9v16Z"],
    ["donut","Donut","M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"],
    ["pie","Pie","M12 3v9h9A9 9 0 0 0 12 3Zm-3 1a9 9 0 1 0 11 11H9Z"]
];
const more: Array<[Kind,string,string]> = [
    ["stackedBar","Stacked bar","M3 4h18v6H3Zm0 10h14v6H3ZM10 4v6m0 4v6"],
    ["stackedColumn","Stacked column","M3 8h6v13H3Zm12-5h6v18h-6ZM3 14h6m6-5h6"],
    ["combo","Combo","M4 21V11h4v10m5 0V6h4v15M2 13l8-7 5 3 7-6"],
    ["waterfall","Waterfall","M3 3h5v5H3Zm7 5h5v6h-5Zm7 6h5v7h-5"],
    ["scatter","Scatter","M3 3v18h18M7 15h1m2-7h1m3 4h1m3-7h1"],
    ["treemap","Treemap","M3 3h18v18H3ZM11 3v18m0-11h10"],
    ["funnel","Funnel","M3 4h18l-7 9v7h-4v-7Z"],
    ["gauge","Gauge","M3 19a9 9 0 0 1 18 0M12 19l5-9"],
    ["bullet","Bullet","M3 6h18v12H3Zm0 4h12v4H3m14-9v14"],
    ["heatmap","Heatmap","M3 3h18v18H3Zm6 0v18m6-18v18M3 9h18M3 15h18"],
    ["smallMultiples","Small multiples","M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7"],
    ["kpiTrend","KPI trend","M3 18l6-6 4 3 8-11m-6 0h6v6"],
    ["sparkline","Sparkline","M2 14h4l4-8 4 12 4-8h4"]
];
export function chartTypePicker(root: HTMLElement, current:()=>Kind, choose:(type:Kind)=>void) {
    const host=document.createElement("div");host.className="askbics-type-picker";
    const trigger=document.createElement("button");trigger.type="button";trigger.setAttribute("aria-haspopup","menu");
    const caption=document.createElement("span");
    const icon=(path:string)=>{const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");const p=document.createElementNS(svg.namespaceURI,"path");p.setAttribute("d",path);svg.append(p);return svg;};
    const chevron=document.createElement("span");chevron.className="askbics-chevron";chevron.setAttribute("aria-hidden","true");trigger.append(caption,chevron);
    const menu=document.createElement("div");menu.className="askbics-type-picker__menu";menu.hidden=true;menu.setAttribute("role","menu");menu.setAttribute("aria-label","Chart type");
    let expanded=false;
    const close=()=>{menu.hidden=true;trigger.setAttribute("aria-expanded","false");};
    const position = () => {
        const bounds = root.getBoundingClientRect(), anchor = trigger.getBoundingClientRect();
        const width = Math.max(0, Math.min(expanded ? 276 : 228, bounds.width - 16));
        menu.style.width = `${width}px`;
        const grid = menu.querySelector<HTMLElement>(".askbics-type-picker__grid");
        if (grid) grid.style.gridTemplateColumns = width < 220 ? "minmax(0,1fr)" : "repeat(2,minmax(0,1fr))";
        const below = Math.max(0, bounds.bottom - anchor.bottom - 12);
        const above = Math.max(0, anchor.top - bounds.top - 12);
        const up = below < Math.min(menu.scrollHeight, 300) && above > below;
        menu.style.maxHeight = `${up ? above : below}px`;
        menu.style.top = up ? "auto" : "calc(100% + 4px)";
        menu.style.bottom = up ? "calc(100% + 4px)" : "auto";
        menu.style.right = "0"; menu.style.left = "auto";
        const rect = menu.getBoundingClientRect();
        const left = Math.max(bounds.left + 8, Math.min(rect.left, bounds.right - 8 - rect.width));
        menu.style.right = `${rect.left - left}px`;
    };
    const draw=()=>{
        menu.replaceChildren();const heading=document.createElement("div");heading.className="askbics-type-picker__heading";heading.textContent=expanded?"More charts":"Common charts";menu.append(heading);
        const grid=document.createElement("div");grid.className="askbics-type-picker__grid";grid.setAttribute("role","group");grid.setAttribute("aria-label",heading.textContent);
        (expanded?more:common).forEach(([type,name,path])=>{const b=document.createElement("button");b.type="button";b.setAttribute("role","menuitemradio");b.setAttribute("aria-checked",String(type===current()));b.append(icon(path));const text=document.createElement("span");text.textContent=name;b.append(text);if(type===current())b.append(icon("m5 12 4 4L19 6"));b.onclick=()=>{choose(type);refresh();close();trigger.focus();};grid.append(b);});
        menu.append(grid);const toggle=document.createElement("button");toggle.type="button";toggle.className="askbics-type-picker__more";toggle.setAttribute("role","menuitem");toggle.textContent=expanded?"‹ Common charts":"More charts ›";toggle.onclick=event=>{event.preventDefault();event.stopPropagation();trigger.focus();expanded=!expanded;draw();menu.hidden=false;menu.scrollTop=0;position();menu.querySelector<HTMLButtonElement>("button")?.focus();};menu.append(toggle);
    };
    const refresh=()=>{caption.textContent=[...common,...more].find(([type])=>type===current())?.[1] || "Chart";trigger.setAttribute("aria-label",`Chart type: ${caption.textContent}`);};
    trigger.onclick=()=>{if(!menu.hidden){close();return;}expanded=more.some(([type])=>type===current());draw();menu.hidden=false;trigger.setAttribute("aria-expanded","true");position();menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();};
    host.onkeydown=e=>{if(e.key==="Escape"){e.stopPropagation();close();trigger.focus();}if(["ArrowDown","ArrowUp","ArrowLeft","ArrowRight","Home","End"].includes(e.key)){e.preventDefault();if(menu.hidden){trigger.click();return;}const buttons=Array.from(menu.querySelectorAll<HTMLButtonElement>("button"));const i=buttons.indexOf(document.activeElement as HTMLButtonElement);const columns=menu.clientWidth<220?1:2;const step=e.key==="ArrowUp"?-columns:e.key==="ArrowDown"?columns:e.key==="ArrowLeft"?-1:1;buttons[e.key==="Home"?0:e.key==="End"?buttons.length-1:Math.max(0,Math.min(buttons.length-1,i+step))]?.focus();}};
    menu.addEventListener("pointerdown", event => { if ((event.target as Element).closest("button")) event.preventDefault(); });
    menu.addEventListener("click", event => event.stopPropagation());
    host.addEventListener("focusout",()=>queueMicrotask(()=>{if(!host.contains(document.activeElement))close();}));
    host.append(trigger,menu);refresh();close();return {element:host,refresh};
}
