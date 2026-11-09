import { settingsSectionApply } from './settingsSectionApply';
import { installSettingsHelp } from "./settingsHelp";
/** Organize existing controls without replacing their draft state or event handlers. */
export function settingsLayout(form: HTMLElement, data: HTMLElement, time: HTMLElement, navigation: HTMLElement, body: HTMLElement, layoutNote: HTMLElement, validateSection:(label:string)=>boolean=()=>true): ((section: boolean | "time" | "revenue" | "startup" | "synonyms" | "kpis" | "groups" | "filters" | "aging" | "cashflow" | "calculations") => void) & {validateAll:()=>boolean} {
    const createSection = (title: string, description: string) => {
        const section = document.createElement("section"); section.className = "askbics-settings-page";
        const heading = document.createElement("h3"); heading.textContent = title; heading.dataset.settingsHelp = description;
        const help = document.createElement("p"); help.className = "askbics-settings-description"; help.textContent = description;
        section.append(heading,help); return section;
    };
    const calculations=createSection("Calculation Groups", "Create a group, then add its calculations and KPIs. Each formula uses its own filters; totals recalculate in model context by default. Connected model measures and configured fields are required.");
    const cashflow=createSection("Cash flow", "Map document relationships and choose up to 10 starting-posting columns. Destination account, Destination description, Destination amount, Variance and Details are added automatically.");
    const waterfall=createSection("Waterfall", "Choose the default category and measure for the home-screen waterfall workspace.");
    const groups=createSection("Field & measure groups", "Use one name for multiple fields or measures.");
    const aging=createSection("Aging", "Analyze outstanding balances as of today. Ask: Show Customer aging summary. Specify as of YYYY-MM-DD only for a historical date.");
    const kpis=createSection("Custom KPIs", "Create ratios, percentages, and other reusable calculations.");
    const backup = createSection("Settings backup", "Export, validate, and restore your configuration.");
    const general = createSection("General", "Choose how answers appear in your conversation.");
    const suggestions = createSection("Suggestions", "Choose typing suggestions, Summarize by fields and your default measure.");
    const synonyms = createSection("Synonyms", "Add familiar names for fields, measures, and field values.");
    const layout = createSection("Table & matrix", "Control automatic layouts. Explicit requests take priority.");
    const startup = createSection("Startup loading", "Keep the initial visual query small.");
    const hasStartup = !!form.querySelector(".askbics-qna__startup-settings");
    const revenue = createSection("Percentage of Revenue", "Divide each amount by revenue for the same period, including YTD and TTM.");
    const reports = createSection("Saved reports", "Organize reports into sections.");
    const analysis = createSection("Explain & investigate", "Explore changes across available business dimensions in one answer.");
    for (const child of Array.from(form.children)) {
        const target = child.classList.contains("askbics-calculation-groups") ? calculations : child.classList.contains("askbics-cash-settings") ? cashflow : child.classList.contains("askbics-aging-settings") ? aging : child.classList.contains("askbics-waterfall-settings") ? waterfall : child.classList.contains("askbics-answer-groups") ? groups : child.classList.contains("askbics-custom-kpis") ? kpis : child.classList.contains("askbics-settings-backup") ? backup : child.classList.contains("askbics-qna__conversation-settings") ? general
            : child.classList.contains("askbics-qna__autocomplete-settings") ? suggestions
            : (child.classList.contains("askbics-qna__synonym-settings") || child.classList.contains("askbics-qna__value-synonym-settings")) ? synonyms
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
    const transactions=createSection("Transactions", "Choose detail columns and rules. Existing question and Always filters remain applied.");
    const documents=createSection("Document details", "Open lines for a document within its company and fiscal year.");
    const cards=createSection("Summary cards", "Compact model summaries with data bars above transactions.");const clearing=createSection("Clearing details", "Open linked clearing items from transaction tables.");
    const always=createSection("Always filters", "Restrict the scope of every answer.");
    const advancedPage=createSection("Technical setup", "Manual overrides and diagnostics for administrators.");
    advancedPage.classList.add('askbics-technical-settings');
    const moved:Array<{node:HTMLElement;marker:Comment}>=[];
    const move=(node:HTMLElement|null,target:HTMLElement)=>{if(!node)return;const marker=document.createComment('settings-owner');node.before(marker);moved.push({node,marker});target.append(node);};
    move(analysis.querySelector('.askbics-transaction-settings'),transactions);
    move(transactions.querySelector('.askbics-summary-settings'),cards);move(transactions.querySelector('.askbics-clearing-settings'),clearing);
    move(transactions.querySelector('.askbics-document-settings'),documents);
    move(data.querySelector('.askbics-always-settings'),always);
    data.querySelectorAll<HTMLElement>('.askbics-parameter-trial > details').forEach(node=>move(node,advancedPage));
    const categories=[
      {label:'General',icon:'General',pages:[{label:'Conversation',page:general},...(hasStartup?[{label:'Startup loading',page:startup}]:[])]},
      {label:'Fields & measures',icon:'Data setup',pages:[{label:'Catalogue & detection',page:data},{label:'Visibility',page:suggestions},{label:'Synonyms',page:synonyms},{label:'Groups',page:groups}]},
      {label:'Calculation Groups',icon:'Custom KPIs',pages:[{label:'Calculation Groups',page:calculations}]},
      {label:'Calculations & time',icon:'Custom KPIs',pages:[{label:'Custom KPIs',page:kpis},{label:'Revenue',page:revenue},{label:'Time setup',page:time},{label:'Aging',page:aging}]},
      {label:'Answers & charts',icon:'Table & matrix',pages:[{label:'Table & matrix',page:layout},{label:'Explain',page:analysis},{label:'Waterfall',page:waterfall}]},
      {label:'Filters & transactions',icon:'General',pages:[{label:'Always filters',page:always},{label:'Transactions',page:transactions},{label:'Summary cards',page:cards},{label:'Clearing details',page:clearing},{label:'Document details',page:documents},{label:'Cash flow',page:cashflow}]},
      {label:'Saved reports & backup',icon:'Saved reports',pages:[{label:'Saved reports',page:reports},{label:'Settings backup',page:backup}]},
      {label:'Advanced',icon:'General',pages:[{label:'Technical setup',page:advancedPage}]}
    ];
    const entries=categories.flatMap((category,categoryIndex)=>category.pages.map(entry=>({...entry,categoryIndex})));
    const iconPaths: Record<string,string> = {
        "Waterfall":"M3 3h5v5H3Zm7 5h5v6h-5Zm7 6h5v7h-5",
        "Field & measure groups":"M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6Z",
        "Custom KPIs":"M5 3h14v18H5ZM8 7h8M8 12h2m4 0h2M8 16h2m4 0h2",
        "Settings backup":"M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6",
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
            status.textContent = selected?.value ? `Ready for YTD, TTM and running totals · ${selected.value}` : "Choose MonthIndex to enable YTD, TTM and running totals.";
            status.classList.toggle("is-ready",!!selected?.value);
        };
        timePanel.querySelector('.askbics-time-query-examples')?.remove();
        const examples=document.createElement('p');examples.className='askbics-qna__settings-note askbics-time-query-examples';examples.textContent='Ask Sales YTD or Sales TTM to use the latest month with measure data within your filters. Specify an ending month to override it. Ask Sales running total by month for 2026 for calendar-year cumulative values. Calculations respect the measure type; report filters still apply.';
        timePanel.append(examples);
        timePanel.append(status); timePanel.oninput=updateStatus; updateStatus();
    }
    const tabs=document.createElement('div');tabs.className='askbics-settings-tabs';tabs.setAttribute('role','tablist');
    const search=document.createElement('input');search.type='search';search.placeholder='Search settings…';search.setAttribute('aria-label','Search settings');
    const results=document.createElement('div');results.className='askbics-settings-search-results';results.hidden=true;
    const searchBox=document.createElement('div');searchBox.className='askbics-settings-search';searchBox.append(search,results);
    const buttons:HTMLButtonElement[]=[];
    const select=(index:number)=>{
      entries.forEach((entry,i)=>entry.page.hidden=i!==index);
      const categoryIndex=entries[index].categoryIndex;
      buttons.forEach((button,i)=>button.setAttribute('aria-current',i===categoryIndex?'page':'false'));
      tabs.replaceChildren();entries.forEach((entry,i)=>{if(entry.categoryIndex!==categoryIndex)return;const tab=document.createElement('button');tab.type='button';tab.textContent=entry.label;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(i===index));tab.onclick=()=>select(i);tabs.append(tab);});
      body.scrollTop=0;
    };
    categories.forEach((category,index)=>{
      const button=document.createElement('button');button.type='button';
      const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.classList.add('askbics-settings-nav-icon');
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',iconPaths[category.icon]);icon.append(path);
      const label=document.createElement('span');label.textContent=category.label;button.append(icon,label);button.onclick=()=>select(entries.findIndex(entry=>entry.categoryIndex===index));buttons.push(button);navigation.append(button);
    });
    const itemDetails=document.createElement('section');itemDetails.className='askbics-settings-item-details';itemDetails.hidden=true;data.append(itemDetails);
    data.addEventListener('change',event=>{
      const picker=event.target;if(!(picker instanceof HTMLSelectElement)||!['Loaded field','Loaded measure'].includes(picker.getAttribute('aria-label')||''))return;
      itemDetails.replaceChildren();itemDetails.hidden=!picker.value;if(!picker.value)return;
      const name=picker.value,isMeasure=picker.getAttribute('aria-label')==='Loaded measure';const title=document.createElement('h4');title.textContent=name+' · Visibility & related settings';itemDetails.append(title);
      const allGroups=Array.from(suggestions.querySelectorAll<HTMLElement>('.askbics-qna__autocomplete-group'));
      const toggle=(text:string,original:HTMLInputElement|undefined,reason?:string)=>{if(!original)return;const label=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.checked=original.checked;input.disabled=!!reason;input.onchange=()=>{original.checked=input.checked;original.dispatchEvent(new Event('change',{bubbles:true}));};label.append(input,document.createTextNode(text+(reason?' — '+reason:'')));itemDetails.append(label);};
      const find=(group:HTMLElement|undefined)=>Array.from(group?.querySelectorAll<HTMLLabelElement>('.askbics-qna__config-options label')||[]).find(label=>label.textContent?.trim()===name)?.querySelector<HTMLInputElement>('input')||undefined;
      toggle('Show in typing suggestions',find(allGroups[isMeasure?1:0]));
      if(!isMeasure){toggle('Show in Summarize by',find(allGroups[2]));const input=Array.from(analysis.querySelectorAll<HTMLInputElement>('input')).find(input=>input.getAttribute('aria-label')==='Include '+name);toggle('Include in automatic Explain',input,input?.closest('label')?.hidden?'Excluded because this is a time or transaction field':undefined);}
      for(const [text,page] of [['Names & value synonyms',synonyms],['Groups using this item',groups],['Mapping & diagnostics',advancedPage]] as const){const button=document.createElement('button');button.type='button';button.className='askbics-settings-action';button.textContent=text;button.onclick=()=>select(entries.findIndex(entry=>entry.page===page));itemDetails.append(button);}
    });
    const health=document.createElement('details');health.className='askbics-settings-health';const healthTitle=document.createElement('summary');healthTitle.textContent='Setup health';health.append(healthTitle);general.append(health);
    const updateHealth=()=>{health.querySelectorAll('button').forEach(node=>node.remove());for(const [name,page,selector] of [['Data detection',data,'.askbics-detection-toolbar'],['Time configuration',time,'.askbics-settings-time-status'],['Mapping issues',data,'[role="alert"],.is-error']] as const){const button=document.createElement('button');button.type='button';const message=page.querySelector(selector)?.textContent?.trim();button.textContent=name+(message?' · '+message.slice(0,180):' · Review');button.onclick=()=>select(entries.findIndex(entry=>entry.page===page));health.append(button);}};health.addEventListener('toggle',()=>{if(health.open)updateHealth();});
    const aliases:Record<string,string>={'cash flow':'cash bank starting posting destination amount document trace columns', 'clearing details':'invoice payment clearing company fiscal year links',synonyms:'alias familiar names field values',visibility:'hide field suggestions summarize',transactions:'reverse document matching transaction id formula rules',waterfall:'subtotal colour color financial bridge', 'time setup':'YTD TTM calendar date month year', 'catalogue & detection':'automatic loading Show selected field metadata mappings', 'technical setup':'JSON troubleshooting diagnostics parameter interpretation'};
    const reveal=(index:number,target:HTMLElement)=>{body.querySelectorAll('.askbics-setting-found').forEach(node=>node.classList.remove('askbics-setting-found'));select(index);for(let parent=target.parentElement;parent&&parent!==body;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;results.hidden=true;search.value='';target.scrollIntoView({block:'center'});target.classList.add('askbics-setting-found');setTimeout(()=>target.classList.remove('askbics-setting-found'),2000);const control=target.matches('input,select,textarea,button')?target:target.querySelector<HTMLElement>('input:not([type=hidden]),button,textarea');control?.focus({preventScroll:true});};
    search.oninput=()=>{
      results.replaceChildren();const words=search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);results.hidden=!words.length;if(!words.length)return;
      let count=0;entries.forEach((entry,index)=>{
        const targets=[entry.page,...Array.from(entry.page.querySelectorAll<HTMLElement>('label,summary,legend,h3,h4,[aria-label]')).filter(node=>!node.closest('.askbics-settings-select__popup'))];
        const candidates=targets.filter(target=>{const title=target===entry.page?entry.label:(target.getAttribute('aria-label')||target.textContent||'');const text=(title+' '+(target===entry.page?aliases[entry.label.toLowerCase()]||'':'')).toLowerCase();return words.every(word=>text.includes(word));});
        const seen=new Set<string>();for(const target of candidates){if(count>=30)break;const name=(target===entry.page?entry.label:target.getAttribute('aria-label')||target.textContent||'').trim().slice(0,110);if(seen.has(name))continue;seen.add(name);const button=document.createElement('button');button.type='button';const title=document.createElement('strong');title.textContent=name;const path=document.createElement('small');path.textContent=categories[entry.categoryIndex].label+' → '+entry.label;button.append(title,path);button.onclick=()=>reveal(index,target);results.append(button);count++;}
      });if(!count)results.textContent='No matching settings.';
    };
    search.onkeydown=event=>{if(event.key==='Escape'){event.stopPropagation();search.value='';results.hidden=true;}if(event.key==='ArrowDown'){event.preventDefault();results.querySelector<HTMLButtonElement>('button')?.focus();}};
    const toolbar=document.createElement('div');toolbar.className='askbics-settings-sticky-toolbar';toolbar.append(searchBox,tabs);body.append(toolbar,...entries.map(entry=>entry.page));select(0);
    const sectionActions=entries.map(entry=>settingsSectionApply(entry.page,entry.label,()=>validateSection(entry.label)));
    // Host-owned data controls are reused when the dialog opens again.
    const disposeHelp=installSettingsHelp(body);
    body.addEventListener('askbics-settings-dispose',()=>{disposeHelp();sectionActions.forEach(action=>action.dispose());for(const {node,marker} of moved)marker.replaceWith(node);},{once:true});
    const choose: (section:boolean|"time"|"revenue"|"startup"|"synonyms"|"kpis"|"groups"|"filters"|"aging"|"cashflow"|"calculations")=>void = section=>{const page=section==='calculations'?calculations:section==='cashflow'?cashflow:section==='aging'?aging:section==='filters'?always:section==='groups'?groups:section==='kpis'?kpis:section==='synonyms'?synonyms:section==='startup'&&hasStartup?startup:section==='revenue'?revenue:section===true?data:section==='time'?time:general;select(entries.findIndex(entry=>entry.page===page));};
    return Object.assign(choose,{validateAll:()=>{for(let i=0;i<sectionActions.length;i++){if(!sectionActions[i].apply()){select(i);return false;}}return true;}});
}
