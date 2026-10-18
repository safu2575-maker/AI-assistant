import { settingsSelect } from "./settingsSelect";
/** Organize existing controls without replacing their draft state or event handlers. */
export function settingsLayout(form: HTMLElement, data: HTMLElement, time: HTMLElement, navigation: HTMLElement, body: HTMLElement, layoutNote: HTMLElement): (section: boolean | "time") => void {
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
    const reports = createSection("Saved reports", "Organize reports into sections.");
    for (const child of Array.from(form.children)) {
        const target = child.classList.contains("askbics-qna__conversation-settings") ? general
            : child.classList.contains("askbics-qna__autocomplete-settings") ? suggestions
            : child.classList.contains("askbics-qna__synonym-settings") ? synonyms
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
        {label:"Table & matrix",page:layout}, {label:"Time intelligence",page:time},
        {label:"Data connection",page:data}, {label:"Saved reports",page:reports}, {label:"Advanced",page:data}
    ];
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
        data.querySelectorAll<HTMLElement>(".askbics-parameter-trial > details").forEach(details=>{details.hidden=index!==7;});
    };
    entries.forEach((entry,index)=>{
        const button=document.createElement("button"); button.type="button"; button.textContent=entry.label; button.onclick=()=>select(index); buttons.push(button); navigation.append(button);
        const option=document.createElement("option"); option.value=String(index); option.textContent=entry.label; compact.append(option);
    });
    compact.onchange=()=>select(Number(compact.value)); navigation.prepend(compact);
    refreshCompact=settingsSelect(compact,false);
    compact.nextElementSibling?.classList.add("askbics-settings-section-control");
    body.append(general,suggestions,synonyms,layout,time,data,reports); select(0);
    return section=>select(section===true ? 7 : section==="time" ? 4 : 0);
}
