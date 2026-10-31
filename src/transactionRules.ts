import { matchReversalPairs, matchReversalReferences, DocumentMatchRow } from './reversalMatching';
import { BasicFilter, TupleFilter } from 'powerbi-models';
import type { ParameterConfig, ParameterPlan } from './parameterQuery';
import type { QnaResponse, QnaTable } from './qna/types';

export type TransactionRuleView = 'included' | 'excluded' | 'all';
export interface TransactionRule { reversal?: {method?:"lookup"|"pairs";documentField:string;reversalField:string;amountMeasure:string;partitionFields:string[]}; name: string; enabled: boolean; keyField: string; formula: string; builder?: {match:"all"|"any";conditions:Array<{field:string;operator:string;value:string}>} }
type Value = string | number | boolean | null;
type Predicate = (values: Map<string, Value>) => boolean;

/** Small, bounded predicate language. No eval, DAX execution or implicit blank-to-zero coercion. */
export function compileTransactionRule(source: string) {
    if (typeof source !== 'string' || !source.trim() || source.length > 4000) throw new Error('Enter a transaction condition (maximum 4,000 characters).');
    const tokens = source.match(/\[[^\]]+\]|"(?:[^"\\]|\\.)*"|-?(?:\d+(?:\.\d*)?|\.\d+)|>=|<=|<>|!=|[=><(),]|[A-Za-z_]+/g) || [];
    if (tokens.join('').replace(/\s/g,'') !== source.replace(/\s/g,'')) throw new Error('Unsupported transaction condition. Use [Field], comparisons, IN, AND, OR and ISBLANK.');
    let at = 0, depth = 0;
    const references = new Set<string>();
    const take = (expected: string) => { if (tokens[at++]?.toUpperCase() !== expected) throw new Error(`Expected ${expected} in transaction condition.`); };
    const reference = () => { const t = tokens[at++]; if (!t?.startsWith('[')) throw new Error('Choose a [Field] or [Measure] in the transaction condition.'); const name=t.slice(1,-1).trim(); references.add(name); return name; };
    const literal = (): Value => { const t=tokens[at++]; if(t?.startsWith('"'))return JSON.parse(t); if(t && /^-?[\d.]+$/.test(t)) { const n=Number(t); if(Number.isFinite(n))return n; } if(t?.toUpperCase()==='TRUE')return true; if(t?.toUpperCase()==='FALSE')return false; throw new Error('Use a number, TRUE/FALSE or a double-quoted text value. Use ISBLANK for blanks.'); };
    const atom = (): Predicate => {
        if(++depth>30)throw new Error('Transaction condition is nested too deeply.');
        try {
            if(tokens[at]==='('){at++;const p=or();take(')');return p;}
            if(tokens[at]?.toUpperCase()==='ISBLANK'){at++;take('(');const name=reference();take(')');return v=>v.get(name)===null;}
            const name=reference(),op=tokens[at++]?.toUpperCase();
            if(op==='IN'){take('(');const values=[literal()];while(tokens[at]===','){at++;values.push(literal());}take(')');return v=>values.includes(v.get(name)!);}
            if(!['=','<>','!=','>','<','>=','<='].includes(op))throw new Error('Choose =, <>, >, <, >=, <= or IN.');
            const value=literal();
            return v=>{const actual=v.get(name);if(actual===undefined)throw new Error(`Missing rule input: ${name}.`);if(op==='=')return actual===value;if(op==='<>'||op==='!=')return actual!==value;if(actual===null)return false;if(typeof actual!==typeof value)throw new Error(`The condition value has the wrong type for ${name}.`);return op==='>'?actual>value!:op==='<'?actual<value!:op==='>='?actual>=value!:actual<=value!;};
        } finally {depth--;}
    };
    const and = (): Predicate => {let p=atom();while(tokens[at]?.toUpperCase()==='AND'){at++;const a=p,b=atom();p=v=>a(v)&&b(v);}return p;};
    const or = (): Predicate => {let p=and();while(tokens[at]?.toUpperCase()==='OR'){at++;const a=p,b=and();p=v=>a(v)||b(v);}return p;};
    const matches=or();if(at!==tokens.length)throw new Error(`Unexpected token: ${tokens[at]}.`);
    return {references:[...references],matches};
}
export function validateTransactionRule(rule: TransactionRule | undefined, fields: string[], measures: string[], transactionFields?: string[]) {
    if(!rule)return;
    if(typeof rule.name!=='string'||!rule.name.trim()||rule.name.length>100||typeof rule.enabled!=='boolean')throw new Error('Enter a transaction rule name (maximum 100 characters).');
    if(!(rule.reversal?.method==='lookup'&&!rule.keyField)&&!fields.includes(rule.keyField))throw new Error('Choose an available transaction ID field for the rule.');
    if(transactionFields && !(rule.reversal?.method==='lookup'&&!rule.keyField) && !transactionFields.includes(rule.keyField))throw new Error('Include the rule’s transaction ID in Transaction fields.');
    if(rule.reversal){
        const r=rule.reversal;
        if(r.method!==undefined&&! ["lookup","pairs"].includes(r.method))throw new Error("Invalid document matching method.");
        if(!fields.includes(r.documentField)||!fields.includes(r.reversalField)||r.documentField===r.reversalField||(r.method!=="lookup"&&!measures.includes(r.amountMeasure))||!Array.isArray(r.partitionFields)||r.partitionFields.length>5||new Set(r.partitionFields).size!==r.partitionFields.length||r.partitionFields.some(n=>!fields.includes(n)||n===r.documentField||n===r.reversalField))throw new Error('Choose document number, reversed document number, an additive signed amount measure and valid matching scope fields.');
        return;
    }
    if(rule.builder && transactionBuilderFormula(rule.builder)!==rule.formula)throw new Error("Transaction builder and formula do not match.");
    for(const name of compileTransactionRule(rule.formula).references){
        if(!fields.includes(name)&&!measures.includes(name))throw new Error(`Transaction rule: ${name} is unavailable.`);
        if(fields.includes(name)&&measures.includes(name))throw new Error(`Transaction rule: ${name} is ambiguous between a field and measure.`);
    }
}

export function transactionBuilderFormula(builder:NonNullable<TransactionRule['builder']>):string {
    if(!['all','any'].includes(builder.match)||!Array.isArray(builder.conditions)||!builder.conditions.length||builder.conditions.length>20)throw new Error('Use one to twenty transaction conditions.');
    return builder.conditions.map(c=>{if(!c.field||/[\[\]]/.test(c.field)||!['=','<>','>','<','>=','<=','IN','ISBLANK'].includes(c.operator)||typeof c.value!=='string')throw new Error('Invalid transaction condition.');return c.operator==='ISBLANK'?`ISBLANK([${c.field}])`:`[${c.field}] ${c.operator} ${c.operator==='IN'?`(${c.value})`:c.value}`;}).join(builder.match==='all'?' AND ':' OR ');
}

/** Probe at explicit transaction grain, then filter the final model query. Never sum display rows. */
export async function resolveTransactionRule(plan: ParameterPlan, config: ParameterConfig, measures: string[], load:(plan:ParameterPlan)=>Promise<QnaResponse>, view:TransactionRuleView='included'):Promise<{plan:ParameterPlan;rule?:QnaResponse['transactionRule'];decorate:(table:QnaTable)=>QnaTable}> {
    const rule=(config.analysis?.published || config.analysis?.draft)?.transactionRule;
    if(!rule?.enabled)return {plan, decorate:(table:QnaTable)=>table};
    if(!['included','excluded','all'].includes(view))throw new Error('Invalid transaction rule view.');
    validateTransactionRule(rule,config.options,measures,plan.groups);
    if(rule.reversal?.method==='lookup'&&!rule.keyField)return resolveReferenceLookup(plan,config,rule,load,view);
    const compiled=rule.reversal?{references:[rule.reversal.documentField,rule.reversal.reversalField,...rule.reversal.partitionFields,...(rule.reversal.method==="lookup"?[]:[rule.reversal.amountMeasure])],matches:()=>false}:compileTransactionRule(rule.formula), key=config.fields.find(f=>f.name===rule.keyField)!;
    const groups=[...new Set([rule.keyField,...compiled.references.filter(n=>config.options.includes(n))])];
    const inputs=compiled.references.filter(n=>!config.options.includes(n));
    if(groups.length>10)throw new Error('Use at most nine dependency fields and a transaction ID in a rule.');
    const probe=await load({...plan,groups,measures:[...new Set([...inputs,...plan.measures])],rank:undefined,transactionRuleProbe:true,matrixRowCount:undefined,totalOnly:false,listOnly:false,presentation:'table'});
    const table=probe.table;
    if(!table || table.rows.length>=5001 || table.modelResultComplete!==true)throw new Error('Transaction rules need a complete result of at most 5,000 transactions. Narrow the period or filters and try again.');
    const byId=new Map<string,{value:Value;excluded:boolean}>();
    const matchingRows:DocumentMatchRow[]=[];
    table.rows.forEach((_,i)=>{
        const raw=table.modelGroupValues?.[i];
        if(!raw)throw new Error('Transaction rule inputs are unavailable. Refresh data and try again.');
        const id=raw[0];if(id===null||id==='')throw new Error('The transaction ID contains blanks. Choose a nonblank unique ID.');
        const token=JSON.stringify(id);if(byId.has(token))throw new Error('The transaction ID is not unique at the rule’s grain. Choose a more specific ID.');
        const values=new Map<string,Value>();groups.forEach((n,j)=>values.set(n,raw[j]));
        inputs.forEach((n,j)=>{const value=table.modelRawRows?.[i]?.[groups.length+j];if(value===undefined)throw new Error(`Missing raw rule input: ${n}.`);values.set(n,value);});
        byId.set(token,{value:id,excluded:compiled.matches(values)});
        if(rule.reversal){const r=rule.reversal;matchingRows.push({id:token,document:values.get(r.documentField)??null,reversal:values.get(r.reversalField)??null,partitions:r.partitionFields.map(n=>values.get(n)??null),amount:values.get(r.amountMeasure) as number|null});}
    });
    const matching=rule.reversal?(rule.reversal.method==="lookup"?matchReversalReferences:matchReversalPairs)(matchingRows):undefined;
    if(matching)for(const [id,row] of byId)row.excluded=matching.excluded.has(id);
    const values=[...byId.values()].filter(row=>view==='all'||row.excluded===(view==='excluded')).map(row=>row.value);
    const filtered=!values.length?{...plan,transactionRuleData:true,transactionRuleEmpty:true}:view==='all'?{...plan,transactionRuleData:true}:{...plan,transactionRuleData:true,filters:[...plan.filters,new BasicFilter({table:key.table,column:key.column},'In',values as Array<string|number|boolean>).toJSON()]};
    return {plan:filtered,rule:{name:rule.name,view,reversal:!!rule.reversal,referenceLookup:rule.reversal?.method==="lookup",reviewCount:matching?.review.size},decorate:(result:QnaTable):QnaTable=>{
        if(view==='all' && result.rows.length && !result.modelGroupValues)throw new Error('Transaction row identities are unavailable. Refresh data and try again.');
        const index=plan.groups.indexOf(rule.keyField);
        const excludedRows=view==='all'?result.rows.flatMap((_,i)=>byId.get(JSON.stringify(result.modelGroupValues?.[i]?.[index]))?.excluded?[i]:[]):[];
        const transactionReviewRows:Record<number,string>={};
        if(matching)result.rows.forEach((_,i)=>{const issue=matching.review.get(JSON.stringify(result.modelGroupValues?.[i]?.[index]));if(issue)transactionReviewRows[i]=issue;});
        return {...result,transactionExcludedRows:excludedRows,transactionReviewRows};
    }};
}

export async function loadTransactionResult(plan:ParameterPlan, load:(plan:ParameterPlan)=>Promise<QnaResponse>, forceModelTotal:boolean) {
    // A complete probe proved this view empty. Do not send an empty IN filter
    // or a scalar follow-up that can leave Power BI without a valid data shape.
    if(plan.transactionRuleEmpty)return {text:'No transactions match this view.',table:{columns:[...plan.groups,...plan.measures],rows:[],rowIndices:[],modelResultComplete:true,modelGroupValues:[],modelTotals:[...plan.groups.map((_,i)=>i?'':'Grand Total'),...plan.measures.map(()=>'—')],modelRawTotals:[...plan.groups,...plan.measures].map(()=>null)}} as QnaResponse;
    // Detail and subtotal queries need raw grouping identities even when no rule
    // is evaluated (summaries inherit the already-resolved reversal filters).
    const response=await load({...plan,transactionRuleData:true});const answer={...response,table:response.table?{...response.table}:undefined};if(!answer.table)throw new Error('No transaction details were returned.');
    if(forceModelTotal){
        const total=await load({...plan,groups:[],rank:undefined,matrixRowCount:undefined,presentation:'table',totalOnly:false,listOnly:false});
        if(!total.table?.rows[0])throw new Error('The filtered model total could not be retrieved. Try again.');
        answer.table={...answer.table,modelTotals:[...plan.groups.map((_,i)=>i?'':'Grand Total'),...total.table.rows[0]],modelRawTotals:[...plan.groups.map(()=>null),...(total.table.modelRawRows?.[0]||plan.measures.map(()=>null))]};
    }
    return answer;
}

/** ID-free lookup filters complete document/reference/scope tuples in the model. */
async function resolveReferenceLookup(plan:ParameterPlan,config:ParameterConfig,rule:TransactionRule,load:(p:ParameterPlan)=>Promise<QnaResponse>,view:TransactionRuleView){
    const r=rule.reversal!;
    const groups=[r.documentField,r.reversalField,...r.partitionFields];
    const mappings=groups.map(n=>config.fields.find(f=>f.name===n));
    if(mappings.some(f=>!f))throw new Error('A document matching field has no model mapping.');
    const probe=await load({...plan,groups,rank:undefined,matrixRowCount:undefined,totalOnly:false,listOnly:false,presentation:'table',transactionRuleProbe:true});
    const table=probe.table;
    if(!table||table.modelResultComplete!==true||table.rows.length>5000)throw new Error('Reference lookup needs a complete result of at most 5,000 document combinations. Narrow the filters.');
    const tuples=table.modelGroupValues;
    if(!tuples||tuples.length!==table.rows.length||tuples.some(v=>v.length!==groups.length||v.some(x=>x===undefined)))throw new Error('Document matching values are unavailable.');
    const matching=matchReversalReferences(tuples.map(v=>({id:JSON.stringify(v),document:v[0],reversal:v[1],partitions:v.slice(2),amount:null})));
    const selected=tuples.filter(v=>view==='all'||matching.excluded.has(JSON.stringify(v))===(view==='excluded'));
    const filtered:ParameterPlan=!selected.length?{...plan,transactionRuleData:true,transactionRuleEmpty:true}:view==='all'?{...plan,transactionRuleData:true}:{...plan,transactionRuleData:true,filters:[...plan.filters,new TupleFilter(mappings.map(f=>({table:f!.table,column:f!.column})),'In',selected.map(v=>v.map(value=>({value: value as string|number|boolean})))).toJSON()]};
    return {plan:filtered,rule:{name:rule.name,view,reversal:true,referenceLookup:true,reviewCount:matching.review.size},decorate:(result:QnaTable):QnaTable=>{
        const indices=groups.map(n=>plan.groups.indexOf(n));
        // Hidden matching fields can combine classifications. Do not guess a row highlight.
        if(indices.some(i=>i<0))return result;
        const excludedRows:number[]=[],reviewRows:Record<number,string>={};
        result.modelGroupValues?.forEach((v,i)=>{const token=JSON.stringify(indices.map(j=>v[j]));if(view==='all'&&matching.excluded.has(token))excludedRows.push(i);const issue=matching.review.get(token);if(issue)reviewRows[i]=issue;});
        return {...result,transactionExcludedRows:excludedRows,transactionReviewRows:reviewRows};
    }};
}


