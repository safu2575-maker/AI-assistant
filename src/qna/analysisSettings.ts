import { summaryCardSettings } from "./summaryCardSettings";
import { documentSettings } from './documentSettings';
import { clearingSettings } from "./clearingSettings";
import { transactionRuleSettings } from "./transactionRuleSettings";
import { AnalysisDefinition, AnalysisSettings, AnalysisState, analysisAutomaticReason } from "../analysisTemplates";
import { settingsSelect } from "./settingsSelect";
import { TimeSetup } from "../timeSetup";

/** Saving preferences activates them directly; no hierarchy or publishing workflow. */
export function analysisSettings(current: AnalysisSettings | undefined, fields: string[], measures: string[], interpret?: (question:string,definition:AnalysisDefinition)=>AnalysisState|undefined, binding?: (hierarchy:string[])=>string, timeSetup?:()=>TimeSetup, dateFields?:()=>string[]) {
    const element=document.createElement("fieldset");
    element.className="askbics-qna__config-section askbics-qna__analysis-settings";
    const initial=current?.published || current?.draft;
    const note=document.createElement("p");
    note.textContent="Ask one question to compare Group, Category, Tenant, Floor and other available dimensions. No hierarchy setup is needed. Your question's measure and periods take priority.";
    element.append(note);
    let target: HTMLElement=element;
    const pick=(title:string, choices:Array<[string,string]>, value:string, search=false)=>{
        const label=document.createElement("label"),select=document.createElement("select");
        label.append(title,select);select.setAttribute("aria-label",title);
        for(const [key,text] of choices){const option=document.createElement("option");option.value=key;option.textContent=text;select.append(option);}
        select.value=value;target.append(label);settingsSelect(select,search);return select;
    };
    const check=(title:string,value:boolean)=>{
        const label=document.createElement("label"),input=document.createElement("input");input.type="checkbox";input.checked=value;input.setAttribute("aria-label",title);
        label.append(input,title);target.append(label);return input;
    };
    const enabled=check("Enable Explain & investigate",Boolean(current?.published));
    const measure=pick("Analysis default measure",measures.map(name=>[name,name]),initial?.measure||measures[0]||"",true);
    const comparison=pick("Default comparison for variance questions",[["prior-year","Same period last year"],["previous-period","Previous month (monthly questions)"]],initial?.comparison||"prior-year");
    const top=pick("Analysis result count",[["5","Top 5"],["10","Top 10"],["20","Top 20"],["0","All members"]],String(initial?.top??10));
    const example=document.createElement("p");example.textContent="Try: “Explain Rent variance for June 2026” or “Explain Rent for June 2026”. Save settings to apply these preferences.";element.append(example);
    const advanced=document.createElement("details"),summary=document.createElement("summary");summary.textContent="Advanced options";advanced.append(summary);element.append(advanced);target=advanced;
    const missing=pick("When period is omitted",[["ask","Ask the user for a period"],["last-month","Last completed calendar month"]],initial?.missingPeriod||"ask");
    const others=check("Include Others",initial?.others??true);
    const percent=check("Show variance percentage",initial?.variancePercent??true);
    const revenue=check("Show percentage of revenue for each period",initial?.revenuePercent??false);
    const unchanged=check("Hide unchanged members",initial?.hideUnchanged??false);
    const favourable=pick("Favourable movement",[["neutral","Neutral"],["increase","An increase is favourable"],["decrease","A decrease is favourable"]],initial?.favourable||"neutral");
    const transactions=document.createElement("section");transactions.className="askbics-transaction-settings";advanced.append(transactions);
    const transactionHelp=document.createElement("p");transactionHelp.textContent="Transaction details (optional). Choose up to 10 fields, including a unique transaction ID for individual entries. These fields are queried only when you right-click a result and choose Show transactions; they are excluded from automatic dimension sections.";transactions.append(transactionHelp);
    const transactionList=document.createElement('div');transactionList.className='askbics-transaction-fields';transactions.append(transactionList);
    const addTransaction=document.createElement('button');addTransaction.type='button';addTransaction.className='askbics-settings-action';addTransaction.textContent='Add transaction field';transactions.append(addTransaction);
    let transactionFields:HTMLSelectElement[]=[];
    const renderTransactions=(values:string[])=>{
        transactionList.replaceChildren();transactionFields=[];
        values.forEach((value,index)=>{
            const row=document.createElement('div');row.className='askbics-transaction-field-row';transactionList.append(row);
            const previous=target;target=row;const field=pick(`Transaction field ${index+1}`,[["","None"],...fields.map(name=>[name,name] as [string,string])],value,true);target=previous;
            transactionFields.push(field);field.addEventListener('change',refresh);
            if(values.length>1){const remove=document.createElement('button');remove.type='button';remove.className='askbics-settings-action';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove transaction field ${index+1}`);remove.onclick=()=>{renderTransactions(transactionFields.filter((_,i)=>i!==index).map(item=>item.value));refresh();addTransaction.focus();};row.append(remove);}
        });
        addTransaction.disabled=values.length>=10;addTransaction.textContent=values.length>=10?'Maximum 10 transaction fields':'Add transaction field';
    };
    addTransaction.onclick=()=>{if(transactionFields.length>=10)return;renderTransactions([...transactionFields.map(field=>field.value),'']);transactionList.lastElementChild?.querySelector<HTMLButtonElement>('.askbics-settings-select__trigger')?.focus();};
    const cardsEditor=summaryCardSettings(initial?.summaryCards,fields,measures);transactions.append(cardsEditor.element);const ruleEditor=transactionRuleSettings(initial?.transactionRule,fields,measures,()=>transactionFields.map(f=>f.value).filter(Boolean));transactions.append(ruleEditor.element);const clearingEditor=clearingSettings(initial?.clearing,fields,measures,()=>transactionFields.map(f=>f.value).filter(Boolean));transactions.append(clearingEditor.element);const documentEditor=documentSettings(initial?.document,fields,measures,()=>transactionFields.map(f=>f.value).filter(Boolean));transactions.append(documentEditor.element);
    const exclusionLabel=document.createElement("p");exclusionLabel.textContent="Time fields are used to select periods and are excluded from breakdown sections automatically. Transaction fields remain available in transaction details.";advanced.append(exclusionLabel);
    const autoTitle=document.createElement("strong");autoTitle.textContent="Automatically excluded";
    const chips=document.createElement("div");chips.className="askbics-analysis-exclusions";advanced.append(autoTitle,chips);
    const includeTitle=document.createElement("strong");includeTitle.textContent="Dimensions to include";advanced.append(includeTitle);
    const included=fields.map(name=>({name,input:check(`Include ${name}`,!initial?.excludedDimensions?.includes(name))}));
    const refresh=()=>{
        const time=timeSetup?.();const dates=dateFields?.()||[];
        chips.replaceChildren();
        included.forEach(item=>{
            const reason=analysisAutomaticReason(item.name,time,dates.includes(item.name)?"date":undefined)||(transactionFields.some(field=>field.value===item.name)?"Transaction field":"");
            item.input.closest('label')!.hidden=!!reason;
            if(reason){const chip=document.createElement("span");chip.textContent=`${item.name} · ${reason}`;chips.append(chip);}
        });
        if(!chips.childElementCount)chips.textContent="None";
    };
    renderTransactions(initial?.transactionFields?.length?initial.transactionFields.slice(0,10):['']);refresh();
    return {element,refresh,validateSection:(section:string)=>{
        if(section==='Transactions')ruleEditor.read();
        if(section==='Summary cards')cardsEditor.read();
        if(section==='Clearing details')clearingEditor.read();
        if(section==='Document details')documentEditor.read();
        if(section==='Explain'&&enabled.checked&&!measures.includes(measure.value))throw new Error('Choose an available analysis measure.');
        return true;
    },read:():AnalysisSettings=>{
        const definition:AnalysisDefinition={summaryCards:cardsEditor.read(),document:documentEditor.read(),clearing:clearingEditor.read(),transactionRule:ruleEditor.read(),consolidated:true,measure:measure.value,hierarchy:[],
            transactionFields:[...new Set(transactionFields.map(field=>field.value).filter(Boolean))],
            excludedDimensions:included.filter(item=>!item.input.checked).map(item=>item.name),
            breakdownKeywords:initial?.breakdownKeywords||["explain","breakdown"],varianceKeywords:initial?.varianceKeywords||["variance","var","difference","change"],
            comparison:comparison.value as AnalysisDefinition["comparison"],missingPeriod:missing.value as AnalysisDefinition["missingPeriod"],
            top:Number(top.value),others:others.checked,variancePercent:percent.checked,revenuePercent:revenue.checked,hideUnchanged:unchanged.checked,totals:true,favourable:favourable.value as AnalysisDefinition["favourable"]};
        return {draft:definition,published:enabled.checked?definition:undefined,revision:(current?.revision||0)+1};
    }};
}
