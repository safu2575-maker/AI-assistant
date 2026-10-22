import { BasicFilter } from "powerbi-models";
import { ParameterConfig, ParameterPlan, planParameterQuestion } from "./parameterQuery";
import { QnaResponse, QnaTable } from "./qna/types";
import { calendarMonths, normalizeMonthPeriods } from "./timeSetup";
import { formatPowerBiValue } from "./dataAdapter";
import { revenueRequest } from "./revenue";

export interface AnalysisDefinition {
    transactionFields?: string[];
    consolidated?: boolean;
    excludedDimensions?: string[];
    revenuePercent?: boolean;
    hideUnchanged?: boolean;
    binding?: string;
    measure: string;
    hierarchy: string[];
    breakdownKeywords: string[];
    varianceKeywords: string[];
    comparison: "prior-year" | "previous-period";
    missingPeriod: "ask" | "last-month";
    top: number;
    others: boolean;
    variancePercent: boolean;
    totals: boolean;
    favourable: "neutral" | "increase" | "decrease";
}
export interface AnalysisSettings {
    draft?: AnalysisDefinition;
    published?: AnalysisDefinition;
    revision?: number;
}
export interface AnalysisState {
    transactions?: "current" | "comparison" | "both";
    mode: "breakdown" | "variance";
    measure: string;
    period: string;
    comparison?: string;
    level: number;
    top: number;
    base: string;
    selections: Array<{ field: string; values: string[]; blank?: boolean }>;
}
export interface AnalysisAnswer {
    transactionFields?: string[];
    blankRows?: number[];
    movementScore?: number;
    sections?: Array<{ dimension: string; answer: QnaResponse; score: number }>;
    notes?: string[];
    state: AnalysisState;
    hierarchy: string[];
    revision: number;
    rowQuestions: Array<string | null>;
    clearQuestion: string;
    filters: string[];
    favourable: AnalysisDefinition["favourable"];
}
const marker = ";analysisState:";
const isBlankMember=(name:string)=>!name.trim() || name==='—' || name.toLowerCase()==='(blank)';
export function analysisBinding(fields: ParameterConfig["fields"], hierarchy: string[]): string {
    return JSON.stringify(hierarchy.map(name => {
        const field=fields.find(item=>item.name===name);
        return [name,field?.table,field?.column];
    }));
}
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (value: string) => new RegExp(`(?<![\\w])${escaped(value)}(?![\\w])`, "ig");
export function analysisQuestion(state: AnalysisState): string {
    return `${state.mode === "variance" ? "Variance" : "Explain"} ${state.measure} for ${state.period}${marker}${encodeURIComponent(JSON.stringify(state))}`;
}
export function validateAnalysis(definition: AnalysisDefinition, fields: string[], measures: string[]): void {
    if (!definition || !measures.includes(definition.measure)) throw new Error("Choose an available default measure for Analysis templates.");
    if (!definition.consolidated && (!Array.isArray(definition.hierarchy) || !definition.hierarchy.length || definition.hierarchy.length > 5 ||
        new Set(definition.hierarchy).size !== definition.hierarchy.length || definition.hierarchy.some(name => !fields.includes(name)))
        ) throw new Error("Choose one to five different hierarchy fields available in this model.");
    const keywords = [...definition.breakdownKeywords, ...definition.varianceKeywords].map(value => value.trim().toLowerCase());
    if (!definition.breakdownKeywords.length || !definition.varianceKeywords.length || keywords.some(value => !/^[a-z][a-z ]{1,39}$/.test(value)) || new Set(keywords).size !== keywords.length)
        throw new Error("Use unique words or short phrases for each analysis, separated by commas.");
    if (keywords.some(value => [...fields, ...measures].some(name => word(value).test(name))))
        throw new Error("Analysis keywords must not overlap field or measure names.");
    if (keywords.some(value => /^(not|excluding|before|after|where|with|for|in|by|and|or|top|bottom|ytd|ttm|versus|vs)$/.test(value)))
        throw new Error("Use analysis-specific keywords, not filter, ranking or period instructions.");
    if (keywords.some((value,index)=>keywords.some((other,otherIndex)=>index!==otherIndex && word(value).test(other))))
        throw new Error("Analysis keywords must not contain one another.");
    if (![0, 5, 10, 20].includes(definition.top)) throw new Error("Choose Top 5, 10, 20, or all members.");
    if (!["prior-year", "previous-period"].includes(definition.comparison) || !["ask", "last-month"].includes(definition.missingPeriod) ||
        !["neutral", "increase", "decrease"].includes(definition.favourable)) throw new Error("Invalid analysis defaults.");
}
function previousPeriod(period: string, comparison: AnalysisDefinition["comparison"]): string {
    const year = Number(period.match(/\d{4}/)?.[0]);
    if (/^\d{4}$/.test(period)) return String(year - 1);
    const month = calendarMonths.findIndex(name => period.includes(name));
    if (comparison === "previous-period" && /^(YTD|TTM)/.test(period))
        throw new Error("For YTD or TTM, name the comparison period explicitly or choose Same period last year.");
    const date = new Date(Date.UTC(year, month - (comparison === "previous-period" ? 1 : 0), 1));
    if (comparison === "prior-year") date.setUTCFullYear(date.getUTCFullYear() - 1);
    return `${/^(YTD|TTM)/.exec(period)?.[0] ? period.split(" ")[0] + " ending " : ""}${calendarMonths[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
function periodQuestion(base: string, period: string): string {
    const boundary = /;\s*(?:answerFilters|modelScope):|\b(?:where|with)\b/i.exec(base)?.index ?? base.length;
    return `${base.slice(0, boundary)} for ${period} ${base.slice(boundary)}`;
}
export function planAnalysis(question: string, config: ParameterConfig, measures: string[], now = new Date()): AnalysisState | undefined {
    const configured = config.analysis?.published;
    if (!configured) return undefined;
    let definition: AnalysisDefinition = configured;
    const saved = question.indexOf(marker);
    const validate=()=>{
        config = consolidatedConfig(config);
        definition = config.analysis!.published!;
        validateAnalysis(definition,config.options,measures);
        if(definition.binding && definition.binding!==analysisBinding(config.fields,definition.hierarchy))
            throw new Error("The analysis hierarchy maps to different model columns. Review and republish the template.");
    };
    if (saved >= 0) {
        validate();
        let state: AnalysisState;
        try { state = JSON.parse(decodeURIComponent(question.slice(saved + marker.length))); } catch { throw new Error("Invalid analysis question. Ask the question again."); }
        if (!state || !["breakdown", "variance"].includes(state.mode) || !measures.includes(state.measure) ||
            (state.transactions !== undefined && !["current", "comparison", "both"].includes(state.transactions)) ||
            !Number.isInteger(state.level) || state.level < 0 || state.level >= definition.hierarchy.length ||
            ![0, 5, 10, 20].includes(state.top) || typeof state.base !== "string" || typeof state.period !== "string" ||
            (state.mode === "variance" && typeof state.comparison !== "string") ||
            !Array.isArray(state.selections) || state.selections.some(item => !definition.hierarchy.includes(item.field) || !Array.isArray(item.values) || !item.values.length || item.values.some(value => typeof value !== "string")))
            throw new Error("The saved analysis no longer matches this model. Ask the question again.");
        return state;
    }
    // Protect model names, known members, quoted values and explicit filter clauses.
    let mask = question;
    const protectedNames = [...measures, ...Object.values(config.groupAliases||{}).flat(), ...config.fields.flatMap(field => [field.name, ...(field.aliases || []), ...(field.values || [])])].sort((a,b) => b.length-a.length);
    for (const name of protectedNames) mask = mask.replace(word(name), match => " ".repeat(match.length));
    mask = mask.replace(/"[^"]*"|\b(?:where|with)\s+[\s\S]*$/gi, match => " ".repeat(match.length));
    const matched = [...definition.breakdownKeywords, ...definition.varianceKeywords].flatMap(keyword => [...mask.matchAll(word(keyword))].map(match => ({keyword, index:match.index!, length:match[0].length})));
    if (!matched.length) return undefined;
    validate();
    let mode: AnalysisState["mode"] = matched.some(match => definition.varianceKeywords.includes(match.keyword)) ? "variance" : "breakdown";
    let base = question;
    for (const match of matched.sort((a,b)=>b.index-a.index)) base = base.slice(0,match.index) + " ".repeat(match.length) + base.slice(match.index+match.length);
    base = normalizeMonthPeriods(base, config.time, protectedNames);
    const boundary = /;\s*(?:answerFilters|modelScope):|\b(?:where|with)\b/i.exec(base)?.index ?? base.length;
    let front = base.slice(0,boundary), tail = base.slice(boundary);
    const periodPattern = new RegExp(`\\b(?:(YTD|TTM)\\s+(?:ending\\s+)?)?(${calendarMonths.join("|")})\\s+(\\d{4})\\b`, "ig");
    let periodText=front;
    const timeNames=new Set(["Year","Month","Date","MonthIndex",config.time?.dateField,config.time?.yearField,config.time?.monthField,config.time?.monthIndexField]);
    const periodProtected=[...measures,...Object.values(config.groupAliases||{}).flat(),...config.fields.flatMap(field=>[field.name,...(field.aliases||[]),...(!timeNames.has(field.name)?field.values||[]:[])])];
    for(const name of periodProtected.sort((a,b)=>b.length-a.length)) periodText=periodText.replace(word(name),match=>" ".repeat(match.length));
    const periods = [...periodText.matchAll(periodPattern)].map(match => ({text:match[0], label:`${match[1] ? match[1].toUpperCase()+" ending " : ""}${calendarMonths.find(name=>name.toLowerCase()===match[2].toLowerCase())} ${match[3]}`}));
    if (periods.length > 2) throw new Error("Choose one period or two comparison periods.");
    if (periods.length === 2 && !/\b(?:vs|versus)\b/i.test(front)) throw new Error("Separate comparison periods with “versus”.");
    for (const period of periods) front = front.replace(new RegExp(`(?:\\bof\\s+)?${escaped(period.text)}`, "i")," ");
    let period = periods[0]?.label, comparison = periods[1]?.label;
    if(comparison && /^(YTD|TTM)/.test(period) && !/^(YTD|TTM)/.test(comparison))
        comparison=`${period.split(" ")[0]} ending ${comparison}`;
    if (!period) {
        const yearComparison=/\b(\d{4})\s+(?:vs\.?|versus)\s+(\d{4})\b/i.exec(periodText);
        const years = [...periodText.matchAll(/\b(\d{4})\b/gi)];
        if(yearComparison){period=yearComparison[1];comparison=yearComparison[2];front=front.replace(yearComparison[0]," ");}
        else if (years.length === 1) { period=years[0][1]; front=front.replace(new RegExp(`(?:\\bof\\s+)?${years[0][0]}`)," "); }
        else if (definition.missingPeriod === "last-month") {
            const last = new Date(now.getFullYear(),now.getMonth()-1,1);
            period=`${calendarMonths[last.getMonth()]} ${last.getFullYear()}`;
        } else throw new Error("Which period should I analyse? For example: June 2026, for 2026, or YTD ending June 2026.");
    }
    front = front.replace(/\b(?:vs\.?|versus)\b/gi," ");
    if(comparison) mode="variance";
    base = front + tail;
    // Accept "variance of Category Electronics" without erasing "of" inside
    // a model name such as Cost of Sales or a quoted/explicit filter value.
    let connectors=front;
    for(const name of protectedNames) connectors=connectors.replace(word(name),match=>" ".repeat(match.length));
    const connectorPositions=[...connectors.matchAll(/\bof\b/gi)].filter(match=>{
        const following=front.slice(match.index!+match[0].length).trimStart();
        return protectedNames.some(name=>new RegExp(`^${escaped(name)}(?![\\w])`,"i").test(following));
    });
    for(const match of connectorPositions.sort((a,b)=>b.index!-a.index!)) front=front.slice(0,match.index)+"  "+front.slice(match.index!+match[0].length);
    base=front+tail;
    const parsed = planParameterQuestion(periodQuestion(base, period), {...config,defaultMeasure:definition.measure}, measures);
    if (parsed.measures.length !== 1) throw new Error("Choose one measure for this analysis.");
    if (parsed.rank) throw new Error("Choose the result count using the analysis Top control.");
    const groups = parsed.totalOnly ? [] : parsed.groups;
    if (groups.some(name=>!definition.hierarchy.includes(name))) throw new Error("Choose a grouping from the configured analysis hierarchy.");
    const filteredLevels = definition.hierarchy.map((name,index)=> {
        const field=config.fields.find(item=>item.name===name)!;
        return parsed.filters.some(filter=>JSON.stringify(filter.target)===JSON.stringify({table:field.table,column:field.column})) ? index : -1;
    });
    const level = groups.length ? definition.hierarchy.indexOf(groups[0]) : Math.max(0,...filteredLevels);
    return {mode,measure:parsed.measures[0],period,comparison: mode==="variance" ? comparison || previousPeriod(period,definition.comparison) : undefined,level,top:definition.top,base,selections:[]};
}

export async function runAnalysis(state: AnalysisState, config: ParameterConfig, measures: string[], load: (plan: ParameterPlan) => Promise<QnaResponse>): Promise<QnaResponse> {
    if (state.transactions) return runTransactions(state, config, measures, load);
    if (config.analysis?.published && config.analysis.published.consolidated !== false) return runConsolidated(state, consolidatedConfig(config), measures, load);
    return runDimension(state, config, measures, load);
}
async function runDimension(state: AnalysisState, config: ParameterConfig, measures: string[], load: (plan: ParameterPlan) => Promise<QnaResponse>): Promise<QnaResponse> {
    const definition = config.analysis!.published!;
    const fieldName = definition.hierarchy[state.level], field = config.fields.find(item=>item.name===fieldName)!;
    const periods = [state.period, ...(state.mode==="variance" ? [state.comparison!] : [])];
    const plans = periods.map(period=>{
        const parsed=planParameterQuestion(periodQuestion(state.base,period),{...config,defaultMeasure:state.measure},measures);
        const filters=parsed.filters.slice();
        for(const selection of state.selections) {
            const mapped=config.fields.find(item=>item.name===selection.field)!;
            const target={table:mapped.table,column:mapped.column};
            // Descendant selections always refine the original question context.
            filters.push(new BasicFilter(target,"In",selection.blank ? [null as any] : selection.values.map(value=>mapped.type==="number" ? Number(value) : value)).toJSON());
        }
        return {...parsed,groups:[fieldName],measures:[state.measure],filters,totalOnly:false,listOnly:false,rank:undefined,presentation:"table" as const};
    });
    const tables: QnaTable[]=[];
    for(const plan of plans) {
        const answer=await load(plan);
        if(!answer.table?.modelRawRows) throw new Error("Analysis needs complete model results with numeric values.");
        tables.push(answer.table);
    }
    const names = [...new Set(tables.flatMap(table=>table.rows.map(row=>row[0])))];
    const values = tables.map(table=>new Map(table.rows.map((row,index)=>[row[0],table.modelRawRows![index][1]])));
    // Compute before ranking, Others aggregation, or display hiding. Unknown amounts
    // cannot safely participate in a complete movement denominator.
    const movements = new Map(names.map(name=>{
        const amounts=values.map(map=>map.has(name)?map.get(name):0);
        return [name, amounts.length===2 && amounts.every(value=>typeof value==='number' && Number.isFinite(value))
            ? Math.abs(amounts[0]!-amounts[1]!) : null] as const;
    }));
    const absoluteMovement=Array.from(movements.values()).every(value=>value!==null)
        ? Array.from(movements.values()).reduce<number>((sum,value)=>sum+value!,0) : null;
    const impact=(members?:string[])=>absoluteMovement!==null && absoluteMovement>0 && Number.isFinite(absoluteMovement)
        ? `${((members ? members.reduce((sum,name)=>sum+(movements.get(name) || 0),0) : absoluteMovement)/absoluteMovement*100).toFixed(2)}%` : "—";
    const rows=names.map(name=>({name,values:values.map(map=>map.has(name) ? map.get(name)??null : 0),members:[name]}))
        .filter(row=>!definition.consolidated || (row.values.some(value=>value!==null && value!==0) &&
            (!definition.hideUnchanged || state.mode!=="variance" || row.values[0]!==row.values[1])));
    const magnitude=(row:typeof rows[number])=> Math.abs(state.mode==="variance" ? (row.values[0]??0)-(row.values[1]??0) : row.values[0]??0);
    rows.sort((a,b)=>magnitude(b)-magnitude(a)||a.name.localeCompare(b.name));
    const blankMembers=definition.consolidated ? rows.filter(row=>isBlankMember(row.name)) : [];
    const ranked=rows.filter(row=>!blankMembers.includes(row));
    const shown = state.top ? ranked.slice(0,state.top) : ranked.slice();
    const remaining = state.top ? ranked.slice(state.top) : [];
    const aggregate = async (members?: string[]): Promise<Array<number|null>> => {
        const result: Array<number|null>=[];
        for(let index=0;index<plans.length;index++) {
            if(!members && tables[index].modelEvaluatedTotals?.[1]) { result.push(tables[index].modelRawTotals?.[1]??null); continue; }
            if(config.additiveMeasures?.includes(state.measure)) {
                const numbers=(members || names).map(name=>values[index].get(name)).filter((value):value is number=>typeof value==="number");
                result.push(numbers.length ? numbers.reduce((a,b)=>a+b,0) : null); continue;
            }
            const plan=plans[index];
            const filters=members ? [...plan.filters.filter(filter=>JSON.stringify(filter.target)!==JSON.stringify({table:field.table,column:field.column})),
                new BasicFilter({table:field.table,column:field.column},"In",members.map(value=>field.type==="number"?Number(value):value)).toJSON()] : plan.filters;
            const total=await load({...plan,groups:[],filters});
            result.push(total.table?.modelEvaluatedTotals?.[0] ? total.table.modelRawTotals?.[0]??null : null);
        }
        return result;
    };
    if(remaining.length && definition.others) shown.push({name:"Others",members:remaining.map(row=>row.name),values:await aggregate(remaining.map(row=>row.name))});
    shown.push(...blankMembers);
    const totals=definition.totals ? await aggregate() : undefined;
    const format=tables[0].modelFormats?.[1];
    const number=(value:number|null)=>value===null ? "—" : formatPowerBiValue(value,format);
    const cells=(label:string, amounts:Array<number|null>, members?:string[]):string[]=>{
        const current=amounts[0], prior=amounts[1], difference=current!==null && prior!==null ? current-prior : null;
        if(state.mode==="breakdown") return [label,number(current)];
        return [label,...amounts.map(number),difference===null?"—":`${difference>0?"+":""}${number(difference)}`,
            ...(definition.variancePercent ? [difference===null || prior===0 || prior===null ? "—" : `${(difference/Math.abs(prior)*100).toFixed(2)}%`] : []),impact(members)];
    };
    const columns=state.mode==="breakdown" ? [fieldName,state.period] : [fieldName,...periods,"Variance",...(definition.variancePercent?["Variance %"]:[]),"Impact %"];
    const rowQuestions=shown.map(row=>definition.consolidated ? analysisQuestion({...state,level:0,selections:[...state.selections.filter(item=>item.field!==fieldName),{field:fieldName,values:row.members,...(blankMembers.includes(row)?{blank:true}:{})}]}) : state.level+1<definition.hierarchy.length ? analysisQuestion({...state,level:state.level+1,selections:[...state.selections,{field:fieldName,values:row.members}]}) : null);
    const leader=shown[0], delta=leader && state.mode==="variance" && leader.values.every(value=>value!==null) ? leader.values[0]!-leader.values[1]! : null;
    const explanation=leader ? state.mode==="variance" ? `${leader.name} has the largest absolute change${delta===null?"":`: ${delta>0?"+":""}${number(delta)}`}.` : `${leader.name} is the largest contributor by absolute amount.` : "No matching members.";
    return {modelQuery:true,text:`${state.measure} · ${periods.join(" versus ")} · ${fieldName}. ${explanation}`,
        table:{columns,rows:shown.map(row=>cells(row.name,row.values,row.members)),rowIndices:shown.map(()=>[]),modelTotals:totals?cells("Grand Total",totals):undefined},
        analysis:{state,hierarchy:definition.hierarchy,revision:config.analysis?.revision||1,rowQuestions,movementScore:rows.length ? magnitude(rows[0]) : 0,
            clearQuestion:analysisQuestion({...state,level:0,selections:[]}),filters:plans[0].summary,
            favourable:definition.favourable}};
}

export function analysisAutomaticReason(name:string, time:ParameterConfig["time"], type?:string):string {
    if ([time?.dateField,time?.yearField,time?.monthField,time?.monthIndexField].includes(name) || type === "date" || /^(year|month|monthindex|date|day|quarter|week)$/i.test(name)) return "Time field";
    return /(?:^|[ _])(id|key|guid)$/i.test(name) ? "Technical ID" : "";
}
/** Only dimensions exposed to this visual participate; physical aliases are queried once. */
export function analysisDimensions(config: ParameterConfig): string[] {
    const excluded = new Set([...(config.analysis?.published?.excludedDimensions || []), ...(config.analysis?.published?.transactionFields || [])]);
    const seen = new Set<string>();
    return config.fields.filter(field => {
        const key = JSON.stringify([field.table, field.column]);
        if (!config.options.includes(field.name) || excluded.has(field.name) || analysisAutomaticReason(field.name,config.time,field.type) || seen.has(key)) return false;
        seen.add(key); return true;
    }).map(field => field.name);
}
function consolidatedConfig(config: ParameterConfig): ParameterConfig {
    const definition = config.analysis?.published;
    if (!definition || definition.consolidated === false) return config;
    const hierarchy = analysisDimensions(config);
    if (!hierarchy.length) throw new Error("No business dimensions are available. Check Explain & investigate exclusions and the fields exposed to askBICS.");
    return {...config, analysis: {...config.analysis, published: {...definition, consolidated:true, totals:true, hierarchy, binding: undefined}}};
}
async function runConsolidated(state: AnalysisState, config: ParameterConfig, measures: string[], load: (plan: ParameterPlan) => Promise<QnaResponse>): Promise<QnaResponse> {
    const definition = config.analysis!.published!;
    // The Power BI host has one mutable query context. Serial execution avoids racing it;
    // request-scoped caching shares scalar totals and revenue queries between sections.
    const cache = new Map<string, Promise<QnaResponse>>();
    const cached = (plan: ParameterPlan) => {
        const key = JSON.stringify({...plan, summary: []});
        if (!cache.has(key)) cache.set(key, load(plan));
        return cache.get(key)!.then(answer=>structuredClone(answer));
    };
    const sections: NonNullable<AnalysisAnswer["sections"]> = [];
    let overall: QnaTable | undefined;
    let filters: string[] = [];
    const notes = ["Sections are different views of the same amounts. Do not add their totals together. Selection filters every section."];
    const revenueEnabled = definition.revenuePercent && config.revenue?.field && config.revenue.value?.trim();
    if (definition.revenuePercent && !revenueEnabled) notes.push("Revenue percentages need Settings > Percentage of Revenue. Amounts and variance remain available.");
    for (let level = 0; level < definition.hierarchy.length; level++) {
        const dimension = definition.hierarchy[level];
        const plans: ParameterPlan[] = [];
        const result = await runDimension({...state, level}, config, measures, async plan => {
            if (plan.groups.length && !plans.some(item => JSON.stringify(item) === JSON.stringify(plan))) plans.push(plan);
            return cached(plan);
        });
        const table = result.table!;
        if (!overall) filters = result.analysis!.filters;
        if (revenueEnabled) {
            const ratios: QnaTable[] = [];
            for (const plan of plans) {
                const response = await revenueRequest(plan, config, cached, (view) => {
                    const data = view.table!;
                    return {text: "", table: {columns: data.columns.map(column => column.displayName),
                        rows: (data.rows || []).map(row => row.map(value => value == null ? "" : String(value))),
                        rowIndices: (data.rows || []).map(() => []), modelRawRows: (data.rows || []).map(row => row.map(value => typeof value === "number" ? value : null)),
                        modelRawTotals: data.totals?.map(value => typeof value === "number" ? value : null)}};
                });
                ratios.push(response.table!);
            }
            const percentage = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(2)}%`;
            for (let period = 0; period < ratios.length; period++) {
                const ratio = ratios[period];
                table.columns.push(`${period === 0 ? state.period : state.comparison} · % of revenue`);
                for (let index = 0; index < table.rows.length; index++) {
                    const question = result.analysis!.rowQuestions[index];
                    const selected: AnalysisState | undefined = question ? JSON.parse(decodeURIComponent(question.slice(question.indexOf(marker) + marker.length))) : undefined;
                    const members = selected?.selections.find(item => item.field === dimension)?.values || [table.rows[index][0]];
                    const blank=selected?.selections.find(item=>item.field===dimension)?.blank;
                    let value = ratio.modelRawRows?.[ratio.rows.findIndex(row => blank ? isBlankMember(row[0]) : row[0] === members[0])]?.[1];
                    if (members.length > 1) {
                        const field = config.fields.find(item => item.name === dimension)!;
                        const response = await revenueRequest({...plans[period], groups: [], filters: [...plans[period].filters,
                            new BasicFilter({table:field.table,column:field.column}, "In", members.map(member=>field.type==="number"?Number(member):member)).toJSON()]}, config, cached, view => ({text:"", table:{columns:[],rows:[],rowIndices:[],modelRawTotals:view.table?.totals?.map(value=>typeof value==="number"?value:null)}}));
                        value = response.table?.modelRawTotals?.[0];
                    }
                    table.rows[index].push(percentage(value));
                }
                table.modelTotals?.push(percentage(ratio.modelRawTotals?.[1]));
            }
        }
        if (!overall) {
            overall = {...table, columns: ["Overall", ...table.columns.slice(1)], rows: [], rowIndices: [],modelTotals:table.modelTotals?.slice()};
            const impactColumn=table.columns.indexOf('Impact %');
            if(overall.modelTotals && impactColumn>=0)overall.modelTotals[impactColumn]='—';
        }
        const raw = await cached(plans[0]);
        // A constant field provides no breakdown. Its amount is still represented by Overall.
        if (raw.table!.rows.length <= 1 || !table.rows.length) continue;
        const score = result.analysis!.movementScore || 0;
        result.analysis!.blankRows=[];
        table.rows.forEach((row,index)=>{if (isBlankMember(row[0])) {result.analysis!.blankRows!.push(index);row[0] = "Unassigned";}});
        sections.push({dimension, answer: result, score});
    }
    sections.sort((a,b)=>b.score-a.score || a.dimension.localeCompare(b.dimension));
    return {modelQuery:true, text:`${state.measure} · ${state.period}${state.comparison ? ` versus ${state.comparison}` : ""}. ${sections.length} dimension sections.`,
        table: overall!, analysis:{state, transactionFields:definition.transactionFields, hierarchy:definition.hierarchy, revision:config.analysis?.revision||1, sections, notes,
            rowQuestions:[],clearQuestion:analysisQuestion({...state,selections:[],level:0}),filters,favourable:definition.favourable}};
}

/** Only entered by an explicit Show transactions action, never by dimension discovery. */
async function runTransactions(state: AnalysisState, config: ParameterConfig, measures: string[], load: (plan: ParameterPlan)=>Promise<QnaResponse>): Promise<QnaResponse> {
    const fields=config.analysis?.published?.transactionFields || [];
    if(!fields.length || fields.length>4 || new Set(fields).size!==fields.length || fields.some(name=>!config.fields.some(field=>field.name===name) || !config.options.includes(name)))
        throw new Error("Choose one to four different available transaction fields in Explain & investigate settings.");
    if(state.transactions==='comparison' && !state.comparison)throw new Error("This answer has no comparison period.");
    const periods=state.transactions==='comparison' ? [state.comparison!] : state.transactions==='both' && state.comparison ? [state.period,state.comparison] : [state.period];
    const rows:string[][]=[];
    for(const period of periods){
        const parsed=planParameterQuestion(periodQuestion(state.base,period),{...config,defaultMeasure:state.measure},measures);
        const filters=parsed.filters.slice();
        for(const selection of state.selections){
            const field=config.fields.find(item=>item.name===selection.field);
            if(!field)throw new Error("The selected dimension is no longer available.");
            filters.push(new BasicFilter({table:field.table,column:field.column},"In",selection.blank?[null as any]:selection.values.map(value=>field.type==='number'?Number(value):value)).toJSON());
        }
        const answer=await load({...parsed,groups:fields,measures:[state.measure],filters,presentation:'table',rank:undefined,totalOnly:false,listOnly:false});
        if(!answer.table)throw new Error("Power BI did not return transaction details.");
        rows.push(...answer.table.rows.map(row=>[period,...row]));
    }
    const selectionText=state.selections.map(item=>`${item.field}: ${item.values.length>5?`${item.values.length} selected members`:item.values.map(value=>value||'Unassigned').join(', ')}`).join('; ');
    return {modelQuery:true,text:`${state.measure} · ${periods.join(' versus ')}.${selectionText?` Selected: ${selectionText}.`:''} Details grouped by ${fields.join(', ')}. Include a unique transaction ID in settings to see individual entries.`,
        table:{columns:['Period',...fields,state.measure],rows,rowIndices:rows.map(()=>[]),modelSnapshot:true,
            modelEditor:{rows:['Period',...fields],columns:[],measures:[state.measure],filters:[]}}};
}
