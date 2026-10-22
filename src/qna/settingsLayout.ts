import { settingsSelect } from "./settingsSelect";
/** Organize existing controls without replacing their draft state or event handlers. */
export function settingsLayout(form: HTMLElement, data: HTMLElement, time: HTMLElement, navigation: HTMLElement, body: HTMLElement, layoutNote: HTMLElement): (section: boolean | "time" | "revenue" | "startup") => void {
    const createSection = (title: string, description: string) => {
        const section = document.createElement("section"); section.className = "askbics-settings-page";
        const heading = document.createElement("h3"); heading.textContent = title;
        const help = document.createElement("p"); help.className = "askbics-settings-description"; help.textContent = description;
        section.append(heading,help); return section;
    };
    const general = createSection("General", "Choose how answers appear in your conversation.");
    const suggestions = createSection("Suggestions", "Choose the names offered while typing and your default measure.");
    const synonyms = createSection("Synonyms", "Use familiar words for your fields and measures.");
    const layout = createSection("Table & matrix", "Control automatic layouts. Explicit requests take priority.");
    const startup = createSection("Startup loading", "Keep the initial visual query small.");
    const hasStartup = !!form.querySelector(".askbics-qna__startup-settings");
    const revenue = createSection("Percentage of Revenue", "Divide each amount by revenue for the same period, including YTD and TTM.");
    const reports = createSection("Saved reports", "Organize reports into sections.");
    const analysis = createSection("Explain & investigate", "Explore changes across available business dimensions in one answer.");
    for (const child of Array.from(form.children)) {
        const target = child.classList.contains("askbics-qna__conversation-settings") ? general
            : child.classList.contains("askbics-qna__autocomplete-settings") ? suggestions
            : child.classList.contains("askbics-qna__synonym-settings") ? synonyms
            : child.classList.contains("askbics-qna__revenue-settings") ? revenue
            : child.classList.contains("askbics-qna__analysis-settings") ? analysis
            : child.classList.contains("askbics-qna__startup-settings") ? startup
            : child.tagName === "FIELDSET" ? reports : layout;
        target.append(child);
    }
    layout.append(layoutNote);
    for (const page of [suggestions,synonyms,reports]) {
        page.querySelector("fieldset > legend")?.remove();
        const help=page.querySelector<HTMLElement>("fieldset > .askbics-qna__settings-note");
        if (help) { const info=document.createElement("details"), summary=document.createElement("summary"); info.className="askbics-settings-help"; summary.textContent="About these settings"; help.before(info); info.append(summary,help); }
    }
    suggestions.querySelectorAll<HTMLElement>(".askbics-qna__autocomplete-group").forEach(group=>{
        const details=document.createElement("details"); details.className="askbics-settings-disclosure";
        const summary=document.createElement("summary"), heading=group.querySelector(".askbics-qna__autocomplete-heading");
        if(heading)summary.append(heading); group.before(details); details.append(summary,group);
    });
    const measureGroup=suggestions.querySelectorAll(".askbics-qna__autocomplete-group")[1];
    const defaultHelp=suggestions.querySelector(".askbics-qna__autocomplete-settings > .askbics-qna__settings-note");
    if(measureGroup && defaultHelp)measureGroup.append(defaultHelp);
    synonyms.querySelectorAll<HTMLElement>(".askbics-qna__synonym-row").forEach(row=>{
        const details=document.createElement("details"); details.className="askbics-settings-disclosure askbics-synonym-disclosure";
        const summary=document.createElement("summary"), identity=row.querySelector(".askbics-qna__synonym-identity"), count=document.createElement("small");
        if(identity)summary.append(identity); summary.append(count); row.before(details); details.append(summary,row);
        const update=()=>{const size=row.querySelectorAll(".askbics-qna__synonym-chips > span").length;count.textContent=`${size} ${size===1?"alias":"aliases"}`;};
        row.addEventListener("click",()=>queueMicrotask(update)); row.addEventListener("keydown",()=>queueMicrotask(update)); update();
    });
    const search = document.createElement("input"); search.type = "search"; search.placeholder = "Search fields, measures or synonyms…"; search.setAttribute("aria-label", "Search synonyms");
    synonyms.insertBefore(search,synonyms.children[2]);
    search.oninput = () => synonyms.querySelectorAll<HTMLElement>(".askbics-synonym-disclosure").forEach(row=>{row.hidden = !(row.textContent || "").toLowerCase().includes(search.value.toLowerCase());});
    const entries = [
        {label:"General",page:general}, {label:"Suggestions",page:suggestions}, {label:"Synonyms",page:synonyms},
        {label:"Table & matrix",page:layout}, {label:"Explain & investigate",page:analysis}, {label:"Percentage of Revenue",page:revenue},
        {label:"Saved reports",page:reports}, {label:"Time intelligence",page:time}, {label:"Data setup",page:data}, ...(hasStartup ? [{label:"Startup loading",page:startup}] : [])
    ];
    const iconPaths: Record<string,string> = {
        "General":"M4 7h5m4 0h7M4 17h9m4 0h3M9 4v6m4-6v6M13 14v6m4-6v6",
        "Suggestions":"M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 4H9c0-2 0-3-1-4Z",
        "Synonyms":"M3 5h11M8 3v2m-3 3c1 4 4 7 8 9M12 5c0 5-4 10-9 12m11 3 4-11 4 11m-6-4h4",
        "Table & matrix":"M4 4h16v16H4ZM4 10h16M10 4v16",
        "Explain & investigate":"M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-2 6 5 5M7 13v-3m4 3V7m4 6V9",
        "Percentage of Revenue":"M5 19 19 5M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
        "Saved reports":"M6 3h12v18l-6-4-6 4Z",
        "Time intelligence":"M4 5h16v16H4ZM8 3v4m8-4v4M4 11h16m-12 4h2m4 0h2",
        "Data setup":"M20 6c0 2-4 3-8 3S4 8 4 6s4-3 8-3 8 1 8 3ZM4 6v12c0 2 4 3 8 3s8-1 8-3V6M4 12c0 2 4 3 8 3s8-1 8-3",
        "Startup loading":"M12 3v9m-6-7a9 9 0 1 0 12 0"
    };
    time.classList.add("askbics-settings-page"); data.classList.add("askbics-settings-page");
    const timePanel = time.querySelector<HTMLElement>(".askbics-time-setup");
    if (timePanel && !timePanel.querySelector(".askbics-settings-date-options")) {
        const advanced = document.createElement("details"); advanced.className="askbics-settings-date-options";
        const summary = document.createElement("summary"); summary.textContent="Advanced date options"; advanced.append(summary);
        Array.from(timePanel.children).filter(child=>child.tagName==="LABEL" && /Ambiguous numeric|Two-digit year/.test(child.textContent || "")).forEach(child=>advanced.append(child));
        timePanel.append(advanced);
    }
    if (timePanel) {
        timePanel.querySelector(".askbics-settings-time-status")?.remove();
        const status = document.createElement("p"); status.className="askbics-settings-time-status"; status.setAttribute("role","status");
        const updateStatus = () => {
            const selected = timePanel.querySelector<HTMLSelectElement>('select[aria-label^="MonthIndex"]');
            status.textContent = selected?.value ? `Ready for YTD and TTM · ${selected.value}` : "Choose MonthIndex to enable YTD and TTM.";
            status.classList.toggle("is-ready",!!selected?.value);
        };
        timePanel.append(status); timePanel.oninput=updateStatus; updateStatus();
    }
    const compact = document.createElement("select"); compact.className = "askbics-settings-section-picker"; compact.setAttribute("aria-label","Settings section");
    const buttons: HTMLButtonElement[] = [];
    let refreshCompact: (() => void) | undefined;
    const select = (index: number) => {
        entries.forEach(entry=>{entry.page.hidden=true;}); entries[index].page.hidden=false;
        buttons.forEach((button,i)=>button.setAttribute("aria-current",i===index ? "page" : "false"));
        compact.value=String(index); refreshCompact?.(); body.scrollTop=0;
        // Keep persistent data controls inside their owner for subsequent dialog opens.
        data.querySelectorAll<HTMLElement>(".askbics-parameter-trial > details").forEach(details=>{details.hidden=false;});
    };
    entries.forEach((entry,index)=>{
        const button=document.createElement("button"); button.type="button";
        const icon=document.createElementNS("http://www.w3.org/2000/svg","svg");icon.setAttribute("viewBox","0 0 24 24");icon.setAttribute("aria-hidden","true");icon.setAttribute("focusable","false");icon.classList.add("askbics-settings-nav-icon");
        const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d",iconPaths[entry.label]);icon.append(path);
        const label=document.createElement("span");label.textContent=entry.label;button.append(icon,label);
        button.onclick=()=>select(index); buttons.push(button); navigation.append(button);
        const option=document.createElement("option"); option.value=String(index); option.textContent=entry.label; compact.append(option);
    });
    compact.onchange=()=>select(Number(compact.value)); navigation.prepend(compact);
    refreshCompact=settingsSelect(compact,false);
    compact.nextElementSibling?.classList.add("askbics-settings-section-control");
    body.append(general,suggestions,synonyms,layout,analysis,time,data,reports,revenue,...(hasStartup ? [startup] : [])); select(0);
    return section=>{ const page = section === "startup" && hasStartup ? startup : section === "revenue" ? revenue : section === true ? data : section === "time" ? time : general; select(entries.findIndex(entry => entry.page === page)); };
}
