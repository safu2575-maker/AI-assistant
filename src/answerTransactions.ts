import { validateClearing, validateDocument } from "./clearingDetails";
import { loadTransactionResult, resolveTransactionRule, TransactionRuleView } from "./transactionRules";
import { applyGroupFilters } from "./answerGroups";
import { BasicFilter, TupleFilter } from "powerbi-models";
import { ParameterConfig, ParameterPlan, planParameterQuestion } from "./parameterQuery";
import { ModelSelection, QnaResponse } from "./qna/types";
import { dateSelectionFilters } from "./selectionFilter";
import { resolveValueSynonyms } from "./valueSynonyms";
import { revenueQuestion } from "./revenue";

export interface TransactionScope {
    /** Internal card request: grouped values only; cards do not display a total. */
    summaryCard?: boolean;
    summaryMeasures?: string[];
    summaryFilters?: Array<{field:string;values:Array<string|number|boolean|null>}>;
    clearingDetails?: boolean;
    documentDetails?: boolean;
    clearingValues?: Array<string|number|boolean>;
    transactionRuleView?: TransactionRuleView;
    question: string;
    inheritedFilters?: ParameterPlan["filters"];
    lookupFilters?: ParameterPlan["filters"];
    summarizeBy?: string;
    measure?: string;
    selections?: ModelSelection[];
    requireSelection?: boolean;
}
const prefix = ";transactions:";
export const transactionQuestion = (scopes: TransactionScope[]) => prefix + encodeURIComponent(JSON.stringify(scopes));

/** Explicit drill-through only. Reparse the source and intersect the clicked member scope. */
export async function answerTransactions(question: string, config: ParameterConfig, measures: string[], load: (plan: ParameterPlan) => Promise<QnaResponse>): Promise<QnaResponse | undefined> {
    if (!question.startsWith(prefix)) return undefined;
    const decoded: TransactionScope[] = JSON.parse(decodeURIComponent(question.slice(prefix.length)));
    if (!Array.isArray(decoded) || !decoded.length || decoded.length > 100 || decoded.some(s=>!s)) throw new Error("Invalid transaction context.");
    const summaryField = Array.isArray(decoded) ? decoded[0]?.summarizeBy : undefined;
    const summaryGroup = config.answerGroups?.find(g=>g.enabled && g.kind==='field' && g.name===summaryField);
    if (summaryField !== undefined && (typeof summaryField !== "string" || !summaryGroup && (!config.options.includes(summaryField) || !config.fields.some(f => f.name === summaryField)) || decoded.some(s => s.summarizeBy !== summaryField))) throw new Error("Choose an available field to summarize by.");
    const isDocument=decoded.some(s=>s.documentDetails);
    if(isDocument&&decoded.some(s=>!s.documentDetails||s.clearingDetails))throw new Error("Invalid document details scope.");
    const definition=config.analysis?.published||config.analysis?.draft;
    const clearing=isDocument?definition?.document:definition?.clearing;
    const isClearing=isDocument||decoded.some(s=>s.clearingDetails);
    if(isClearing&&(!clearing?.enabled||decoded.some(s=>!s.clearingDetails&&!s.documentDetails)))throw new Error('Clearing details are not configured.');
    if(isClearing)(isDocument?validateDocument:validateClearing)(clearing,config.options,measures,(config.analysis?.published||config.analysis?.draft)?.transactionFields);
    const fields = isClearing&&clearing?.columns.length?clearing.columns:summaryField ? summaryGroup?.members.filter(m=>!summaryGroup.hiddenMembers?.includes(m)) || [summaryField] : config.analysis?.published?.transactionFields || config.analysis?.draft?.transactionFields || [];
    if (!fields.length || fields.length > 10 || new Set(fields).size !== fields.length || fields.some(name => !config.options.includes(name)))
        throw new Error("Choose one to ten transaction fields in Explain & investigate settings.");
    let scopes: TransactionScope[] = isClearing ? [{...decoded[0], question: "Show " + clearing!.measure, measure:clearing!.measure, selections:undefined, requireSelection:false}] : decoded;
    if (!Array.isArray(scopes) || !scopes.length || scopes.length > 100) throw new Error("Invalid transaction context. Ask the question again.");
    scopes = scopes.flatMap(scope => {
        const comparison = typeof scope.question === 'string' && /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\s+(?:vs\.?|versus)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b/i.exec(scope.question);
        return comparison ? [comparison[1], comparison[2]].map(period => ({...scope, question: scope.question.replace(comparison[0], period)})) : [scope];
    });
    let appliedRule: QnaResponse["transactionRule"];
    const tables: NonNullable<QnaResponse['transactionTables']> = [];
    for (const scope of scopes) {
        if (typeof scope.question !== "string" || scope.question.startsWith(prefix) || scope.measure && !measures.includes(scope.measure)) throw new Error("The selected measure is no longer available.");
        const plan = planParameterQuestion(resolveValueSynonyms(revenueQuestion(scope.question).question, config.valueSynonyms, config.fields, measures), config, measures);
        const selected = scope.selections || [];
        if (!Array.isArray(selected) || selected.length > 30000) throw new Error("Invalid transaction selection.");
        if (scope.requireSelection && !selected.some(row => row.length)) throw new Error("The selected value has no model context. Run the answer again before viewing transactions.");
        // Linked documents have their own reference/company/year scope. Do not
        // carry transaction-rule restrictions (including older saved scopes).
        const filters = [...plan.filters, ...(isClearing ? [] : scope.inheritedFilters || [])];
        for(const selection of isClearing?[]:scope.summaryFilters||[]){
            const field=config.fields.find(f=>f.name===selection.field);
            if(!field||!selection.values.length)throw new Error('Summary filter field is unavailable: '+selection.field);
            filters.push(new BasicFilter({table:field.table,column:field.column},'In',selection.values as Array<string|number|boolean>).toJSON());
        }
        if(isClearing){
            const values=scope.clearingValues;
            if(!values||values.length!==3||values.some(v=>v==null||String(v).trim()===""||!["string","number","boolean"].includes(typeof v)))throw new Error("Clearing reference, company and year are required.");
            [clearing!.referenceField,clearing!.companyField,clearing!.yearField].forEach((name,i)=>{const f=config.fields.find(f=>f.name===name);if(!f)throw new Error("Missing clearing field mapping: "+name);filters.push(new BasicFilter({table:f.table,column:f.column},"In",[values[i]]).toJSON());});
        }
        if (selected.length) {
            const targets = selected[0].map(part => ({table: part.table, column: part.column}));
            if (!targets.length || selected.some(row => row.length !== targets.length || row.some((part, i) => !config.fields.some(field => field.table === part.table && field.column === part.column) || part.table !== targets[i].table || part.column !== targets[i].column)))
                throw new Error("This selection cannot be resolved to model fields. Select an individual value.");
            if (selected.some(row => row.some(part => part.dateDay))) {
                if (selected.some(row => row.some((part, i) => !part.dateDay && part.value !== selected[0][i].value))) throw new Error("Select an individual category to view its transactions.");
                selected[0].forEach((part, i) => filters.push(...(part.dateDay ? dateSelectionFilters(targets[i], selected.map(row => String(row[i].value))) : [new BasicFilter(targets[i], "In", [part.value]).toJSON()])));
            } else if (targets.length === 1) filters.push(new BasicFilter(targets[0], "In", selected.map(row => row[0].value)).toJSON());
            else filters.push(new TupleFilter(targets, "In", selected.map(row => row.map(part => ({value: part.value})))).toJSON());
        }
        if(scope.summaryMeasures&&(!scope.summaryCard||!summaryField||!Array.isArray(scope.summaryMeasures)||!scope.summaryMeasures.length||scope.summaryMeasures.length>16||scope.summaryMeasures.some(name=>!measures.includes(name))))throw new Error('Invalid summary measures.');
        const requested = scope.summaryMeasures ? [...new Set(scope.summaryMeasures)] : isClearing?[clearing!.measure]:scope.measure ? [scope.measure] : plan.measures;
        if (!requested.length) throw new Error("Choose a measure for this answer before viewing transactions.");
        let detailPlan: ParameterPlan = applyGroupFilters({...plan, summaryCard:scope.summaryCard===true, groups: fields, measures: requested, filters, presentation: "table", matrixRowCount: undefined, rank: undefined, listOnly: false, totalOnly: false}, config, summaryGroup?.filters);
        const resolved = summaryField || isClearing ? {plan:detailPlan,decorate:(table:NonNullable<QnaResponse['table']>)=>table,rule:undefined} : await resolveTransactionRule(detailPlan,config,measures,load,scope.transactionRuleView);
        detailPlan=resolved.plan;appliedRule=resolved.rule?{...resolved.rule,reviewCount:(appliedRule?.reviewCount||0)+(resolved.rule.reviewCount||0)}:undefined;
        const answer = await loadTransactionResult(detailPlan,load,!!resolved.rule);
        answer.table=resolved.decorate(answer.table!);
        if (!answer.table) throw new Error("No transaction details were returned.");
        let totals = answer.table.modelTotals;
        if (!totals) {
            const scalar = await load({...detailPlan, groups: [], totalOnly: true});
            const values = scalar.table?.modelTotals || scalar.table?.rows[0];
            if (!values) throw new Error("The transaction total could not be retrieved. Try again.");
            totals = [...fields.map((_, i) => i ? "" : "Grand Total"), ...values.slice(-requested.length)];
        }
        tables.push({period: scope.question, table: {...answer.table, summaryAdditiveMeasures:config.additiveMeasures?.filter(name=>!config.customKpis?.some(k=>k.name===name)), summaryCards:isClearing||summaryField?undefined:definition?.summaryCards, document:isClearing?undefined:definition?.document,clearing:isClearing?undefined:clearing, drillScopes: [{question: scope.question, measure: scope.measure, inheritedFilters: detailPlan.filters}], modelTotals: totals, analysisResult: true, analysisGroupCount: fields.length}});
    }
    return {modelQuery: true, transactionRule:appliedRule, text: `${summaryField ? "Summary" : "Transaction details"} grouped by ${fields.join(", ")}. Totals use the answer filters and selected values.${summaryField ? "" : " Include a unique transaction ID to see individual entries."}`, transactionTables: tables, table: tables[0].table};
}
