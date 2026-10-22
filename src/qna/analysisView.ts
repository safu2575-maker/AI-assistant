import { analysisQuestion } from "../analysisTemplates";
import { loadingOverlay } from "./loadingOverlay";
import { bindTransactions } from "./transactionView";
import { QnaResponse, QnaTable } from "./types";

/** Hierarchy navigation uses the same table renderer as every other answer. */
export function analysisView(initial: QnaResponse, load: (question: string) => Promise<QnaResponse | undefined>, renderTable: (table: QnaTable, question: string) => HTMLElement): HTMLElement {
    if (initial.analysis?.sections) return consolidatedView(initial, load, renderTable);
    const root = document.createElement("div"); root.className = "askbics-analysis";
    let generation = 0;
    const draw = (response: QnaResponse, parent?: { panel: HTMLElement; clear: () => void }) => {
        const data = response.analysis!, table = response.table!;
        const panel = document.createElement("div"); panel.className = "askbics-analysis-panel";
        const summary = document.createElement("p"); summary.className = "askbics-qna__result-summary";
        summary.textContent = response.text + (data.filters.length ? ` Filtered by: ${data.filters.join("; ")}.` : "");
        panel.append(summary);
        if (parent) {
            const filters = document.createElement("div"); filters.className = "askbics-qna__answer-filters";
            const selection = data.state.selections.at(-1)!;
            const chip = document.createElement("button"); chip.type = "button";
            chip.textContent = `${selection.field}: ${selection.values.length === 1 ? selection.values[0] : `${selection.values.length} members`} ×`;
            chip.setAttribute("aria-label", `Remove hierarchy selection ${selection.field}`);
            chip.onclick = parent.clear; filters.append(chip); panel.append(filters);
        }
        const holder = document.createElement("div");
        holder.append(renderTable({ ...table, analysisResult: true, modelSnapshot: true,
            rows: [...table.rows, ...(table.modelTotals ? [table.modelTotals] : [])],
            rowIndices: [...table.rowIndices, ...(table.modelTotals ? [[]] : [])]
        }, analysisQuestion(data.state)));
        const status = document.createElement("p"); status.setAttribute("role", "status"); status.hidden = true;
        panel.append(holder, status); root.append(panel);
        let selected = -1;
        const decorate = () => holder.querySelectorAll<HTMLElement>("tbody tr[data-source-row]").forEach(row => {
            const index = Number(row.dataset.sourceRow), question = data.rowQuestions[index];
            row.classList.toggle("is-selected", index === selected);
            const varianceColumn = table.columns.indexOf("Variance"), value = table.rows[index]?.[varianceColumn];
            const varianceCell = row.querySelector<HTMLElement>(`td[data-column-index="${varianceColumn}"]`);
            if (varianceCell && value && data.favourable !== "neutral") {
                const positive = value.startsWith("+"), negative = /[-−]/.test(value);
                varianceCell.classList.toggle("is-favourable", (positive || negative) && positive === (data.favourable === "increase"));
                varianceCell.classList.toggle("is-unfavourable", (positive || negative) && positive !== (data.favourable === "increase"));
            }
            if (!question) return;
            row.setAttribute("aria-selected", String(index === selected));
            const cell = row.querySelector<HTMLElement>("td");
            if (cell) { cell.tabIndex = 0; cell.setAttribute("role", "button"); cell.setAttribute("aria-label", `Explore ${table.rows[index][0]}`); cell.setAttribute("aria-expanded", String(index === selected)); }
        });
        const clear = () => {
            ++generation; selected = -1;
            while (panel.nextElementSibling) panel.nextElementSibling.remove();
            status.hidden = true; decorate();
        };
        const choose = async (index: number) => {
            const question = data.rowQuestions[index]; if (!question) return;
            if (selected === index) { clear(); return; }
            clear(); selected = index; decorate();
            const revision = ++generation; status.hidden = false; status.textContent = "Loading details…";
            try {
                const answer = await load(question);
                if (revision !== generation || !root.isConnected) return;
                if (!answer?.analysis) throw new Error("Analysis settings changed. Ask the question again.");
                draw(answer, { panel, clear }); status.hidden = true;
            } catch (error) { if (revision === generation && root.isConnected) status.textContent = (error as Error).message; }
        };
        const activate = (event: Event) => {
            const target = event.target as HTMLElement;
            if (target.closest("button, input, select, a")) return;
            const row = target.closest<HTMLElement>("tbody tr[data-source-row]");
            if (!row || !holder.contains(row) || !data.rowQuestions[Number(row.dataset.sourceRow)]) return;
            event.preventDefault(); event.stopPropagation(); void choose(Number(row.dataset.sourceRow));
        };
        holder.addEventListener("click", activate, true);
        holder.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") activate(event); }, true);
        // Sorting, display filtering and custom columns recreate rows in the shared renderer.
        new MutationObserver(decorate).observe(holder, { childList: true, subtree: true });
        decorate();
    };
    draw(initial); return root;
}

function consolidatedView(initial: QnaResponse, load: (question:string)=>Promise<QnaResponse|undefined>, renderTable:(table:QnaTable,question:string)=>HTMLElement): HTMLElement {
    const root=document.createElement("div");root.className="askbics-analysis";
    let generation=0;
    const draw=(response:QnaResponse)=>{
        root.replaceChildren();
        const data=response.analysis!;
        const summary=document.createElement("p");summary.className="askbics-qna__result-summary";summary.textContent=response.text + (data.filters.length ? ` Filtered by: ${data.filters.join("; ")}.` : "");root.append(summary);
        const status=document.createElement("div");status.setAttribute("role","status");status.setAttribute("aria-live","polite");status.setAttribute("aria-atomic","true");status.hidden=true;
        let updating=false;
        const navigate=async(question:string,removing=false)=>{
            if(updating)return;
            updating=true;
            const revision=++generation;
            loadingOverlay(status,removing?"Removing filter…":"Applying filter…");
            chips.querySelectorAll("button").forEach(button=>button.disabled=true);
            root.querySelectorAll(".askbics-analysis-panel").forEach(panel=>panel.setAttribute("aria-busy","true"));
            try{const result=await load(question);if(revision!==generation||!root.isConnected)return;
                if(!result?.analysis?.sections)throw new Error("Analysis preferences changed. Ask the question again.");draw(result);
            }catch(error){if(revision===generation){status.className="askbics-analysis-error";status.textContent=(error as Error).message;}}
            finally{updating=false;chips.querySelectorAll("button").forEach(button=>button.disabled=false);root.querySelectorAll(".askbics-analysis-panel").forEach(panel=>panel.removeAttribute("aria-busy"));}
        };
        const chips=document.createElement("div");chips.className="askbics-qna__answer-filters";
        data.state.selections.forEach((selection,index)=>{
            const button=document.createElement("button");button.type="button";button.textContent=`${selection.field}: ${selection.values.length===1?selection.values[0]||"Unassigned":`${selection.values.length} members`} ×`;
            button.setAttribute("aria-label",`Remove dimension selection ${selection.field}`);
            button.onclick=()=>void navigate(analysisQuestion({...data.state,selections:data.state.selections.filter((_,i)=>i!==index)}),true);chips.append(button);
        });
        if(chips.childElementCount)root.append(chips);
        root.append(status);
        const tableElement=(table:QnaTable)=>renderTable({...table,analysisResult:true,modelSnapshot:true,
            rows:[...table.rows,...(table.modelTotals?[table.modelTotals]:[])],rowIndices:[...table.rowIndices,...(table.modelTotals?[[]]:[])]},
            `${data.state.measure} for ${data.state.period}${data.state.comparison ? ` versus ${data.state.comparison}` : ""}`);
        if(response.table?.modelTotals){const overall=tableElement(response.table);root.append(overall);bindTransactions(root,overall,response.table,data.state,[],!!data.transactionFields?.length,load,renderTable);}
        for(const section of data.sections!){
            const details=document.createElement("details");details.className="askbics-analysis-panel";details.open=data.sections!.indexOf(section)<2;
            const title=document.createElement("summary");title.textContent=section.dimension;details.append(title);
            const table=section.answer.table!,questions=section.answer.analysis!.rowQuestions;
            const holder=tableElement(table);details.append(holder);root.append(details);
            bindTransactions(root,holder,table,data.state,questions,!!data.transactionFields?.length,load,renderTable);
            const blanks=new Set(section.answer.analysis!.blankRows||[]);
            let showBlanks=false;
            let blankToggle:HTMLButtonElement|undefined;
            if(blanks.size){
                blankToggle=document.createElement('button');blankToggle.type='button';blankToggle.className='askbics-analysis-blank-toggle';
                const eye=document.createElementNS('http://www.w3.org/2000/svg','svg');
                eye.setAttribute('viewBox','0 0 24 24');eye.setAttribute('width','17');eye.setAttribute('height','17');eye.setAttribute('aria-hidden','true');
                const outline=document.createElementNS('http://www.w3.org/2000/svg','path');outline.setAttribute('d','M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z');
                const pupil=document.createElementNS('http://www.w3.org/2000/svg','circle');pupil.setAttribute('cx','12');pupil.setAttribute('cy','12');pupil.setAttribute('r','3');
                for(const part of [outline,pupil]){part.setAttribute('fill','none');part.setAttribute('stroke','currentColor');part.setAttribute('stroke-width','1.6');eye.append(part);}
                blankToggle.append(eye);
                title.append(blankToggle);
                blankToggle.onclick=event=>{event.preventDefault();event.stopPropagation();showBlanks=!showBlanks;decorate();};
            }
            const decorate=()=>holder.querySelectorAll<HTMLElement>("tbody tr[data-source-row]").forEach(row=>{
                const index=Number(row.dataset.sourceRow);
                row.hidden=blanks.has(index)&&!showBlanks;
                if(blankToggle){blankToggle.setAttribute('aria-label',`${showBlanks?'Hide':'Show'} blank rows in ${section.dimension}`);blankToggle.setAttribute('aria-pressed',String(showBlanks));blankToggle.dataset.tooltip='Show or hide blank members. Grand totals still include their amounts.';}
                const variance=table.rows[index]?.[table.columns.indexOf("Variance")];
                const header=Array.from(holder.querySelectorAll<HTMLElement>("th[data-column-index]")).find(item=>/^Variance\b/.test(item.textContent||"")&&!item.textContent?.includes("%"));
                const varianceCell=header ? row.querySelector<HTMLElement>(`td[data-column-index="${header.dataset.columnIndex}"]`) : null;
                if(varianceCell && variance && data.favourable!=="neutral"){
                    const positive=variance.startsWith("+"),negative=/^[-−]/.test(variance);
                    varianceCell.classList.toggle("is-favourable",(positive||negative)&&positive===(data.favourable==="increase"));
                    varianceCell.classList.toggle("is-unfavourable",(positive||negative)&&positive!==(data.favourable==="increase"));
                }
                if(!questions[index])return;
                const cell=row.querySelector<HTMLElement>("td");if(cell){cell.tabIndex=0;cell.setAttribute("role","button");cell.setAttribute("aria-label",`Filter all dimensions by ${section.dimension}: ${table.rows[index][0]}`);}
            });
            const activate=(event:Event)=>{
                const target=event.target as HTMLElement;if(target.closest("button,input,select,a"))return;
                const row=target.closest<HTMLElement>("tbody tr[data-source-row]");if(!row||!holder.contains(row))return;
                const question=questions[Number(row.dataset.sourceRow)];if(!question)return;
                event.preventDefault();event.stopPropagation();void navigate(question);
            };
            holder.addEventListener("click",activate,true);
            holder.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" ")activate(event);},true);
            new MutationObserver(decorate).observe(holder,{childList:true,subtree:true});decorate();
        }
        if(!data.sections!.length){const empty=document.createElement("p");empty.textContent="No varying dimensions with amounts remain in this selection.";root.append(empty);}
        for(const text of data.notes||[]){const note=document.createElement("p");note.className="askbics-qna__result-summary";note.textContent=text;root.append(note);}
    };
    draw(initial);return root;
}
