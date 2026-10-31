import { AdvancedFilter } from 'powerbi-models';
import { ParameterConfig, ParameterPlan, planParameterQuestion } from './parameterQuery';
import { QnaResponse, QnaTable } from './qna/types';

export interface AgingBucket { label:string; min:number|null; max:number|null; summary:string }
export interface AgingSetup { name:string; dateField:string; basis:'Due date'|'Posting date'; measure:string; group:string; asOfField:string; defaultDate:string; display:'detailed'|'summary'; buckets:AgingBucket[] }
export const defaultAgingBuckets=():AgingBucket[]=>[
    {label:'Not Due',min:null,max:-1,summary:'Not Due'},
    {label:'0–30',min:0,max:30,summary:'0–30'},
    {label:'31–60',min:31,max:60,summary:'31–90'},
    {label:'61–90',min:61,max:90,summary:'31–90'},
    {label:'91–120',min:91,max:120,summary:'91–180'},
    {label:'121–180',min:121,max:180,summary:'91–180'},
    {label:'181–365',min:181,max:365,summary:'181–365'},
    {label:'Over 365',min:366,max:null,summary:'Over 365'}
];
export function validateAging(items:AgingSetup[],fields:string[],measures:string[]):void {
    const names=new Set<string>();
    for(const item of items){
        if(!item.name?.trim()||names.has(item.name.toLowerCase()))throw new Error('Aging setup names must be nonempty and unique.');names.add(item.name.toLowerCase());
        if(!fields.includes(item.dateField)||!fields.includes(item.group)||!measures.includes(item.measure))throw new Error(item.name+': select an available date field, grouping field and amount measure.');
        if(item.asOfField&&(!fields.includes(item.asOfField)||item.asOfField===item.dateField))throw new Error('Choose a separate model as-of date field.');
        if(!['detailed','summary'].includes(item.display)||!['Due date','Posting date'].includes(item.basis))throw new Error('Invalid aging display or date basis.');
        if(item.defaultDate){isoDate(item.defaultDate);if(!item.asOfField)throw new Error('A fixed as-of date requires a model as-of date field and a compatible outstanding balance measure.');}
        if(!Array.isArray(item.buckets)||!item.buckets.length||item.buckets.length>20)throw new Error('Configure between 1 and 20 aging buckets.');
        const labels=new Set<string>(),summaryClosed=new Set<string>();let previousSummary='';
        item.buckets.forEach((b,i)=>{
            if(!b.label?.trim()||labels.has(b.label)||b.label==='Total'||b.label==='Date unavailable'||!b.summary?.trim()||['Total','Date unavailable'].includes(b.summary))throw new Error('Use unique bucket labels and nonempty summary labels.');labels.add(b.label);
            if((b.min!==null&&!Number.isInteger(b.min))||(b.max!==null&&!Number.isInteger(b.max))||(b.min!==null&&b.max!==null&&b.min>b.max))throw new Error('Bucket limits must be whole days in ascending order.');
            if((i===0)!==(b.min===null)||(i===item.buckets.length-1)!==(b.max===null))throw new Error('Leave the first minimum and last maximum empty; all other limits are required.');
            if(i&&b.min!==item.buckets[i-1].max!+1)throw new Error('Aging buckets must have no gaps or overlaps. Limits are inclusive.');
            if(b.summary!==previousSummary){if(summaryClosed.has(b.summary))throw new Error('Summary buckets must join adjacent detailed buckets.');if(previousSummary)summaryClosed.add(previousSummary);previousSummary=b.summary;}
        });
    }
}
function isoDate(value:string):string {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new Error('Use an as-of date in YYYY-MM-DD format.');return value;
}
export function todayDate():string {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function agingDateFilters(target:{table:string;column:string},asOf:string,bucket:AgingBucket|null):ParameterPlan['filters'] {
    if(!bucket)return [new AdvancedFilter(target,'And',{operator:'IsBlank'}).toJSON()];
    const day=(offset:number)=>new Date(Date.parse(isoDate(asOf))+offset*86400000).toISOString();
    const conditions:ConstructorParameters<typeof AdvancedFilter>[2][]=[{operator:'IsNotBlank'}];
    if(bucket.max!==null)conditions.push({operator:'GreaterThanOrEqual',value:day(-bucket.max)});
    if(bucket.min!==null)conditions.push({operator:'LessThan',value:day(1-bucket.min)});
    return conditions.length>2?[new AdvancedFilter(target,'And',conditions[0]).toJSON(),new AdvancedFilter(target,'And',...conditions.slice(1)).toJSON()]:[new AdvancedFilter(target,'And',...conditions).toJSON()];
}
/** Each band is evaluated by the model. No addition of displayed ratios or partial rows. */
export async function answerAging(question:string,config:ParameterConfig,measures:string[],load:(plan:ParameterPlan)=>Promise<QnaResponse>):Promise<QnaResponse|undefined>{
    const match=/^(?:show\s+)?(.+?)\s+aging(?:\s+by\s+(.+?))?(?:\s+as\s+of\s+(\d{4}-\d{2}-\d{2}|today))?(?:\s+(detailed|summary))?\s*$/i.exec(question.trim());
    if(!match)return undefined;
    const setup=config.aging?.find(s=>s.name.toLowerCase().replace(/\s+aging$/,'')===match[1].toLowerCase());
    if(!setup)throw new Error('Create a named setup in Settings → Calculations & time → Aging. Ask “Show Customer aging as of YYYY-MM-DD”.');
    validateAging([setup],config.fields.map(f=>f.name),measures);
    const date=isoDate(match[3]?(match[3].toLowerCase()==='today'?todayDate():match[3]):setup.defaultDate||todayDate());
    if(date!==todayDate()&&!setup.asOfField)throw new Error('Historical aging requires a model as-of date field and an outstanding measure that evaluates the balance at that date.');
    const grouping=match[2]?config.fields.find(f=>f.name.toLowerCase()===match[2].toLowerCase())?.name:setup.group;
    if(!grouping)throw new Error('Choose an available aging grouping field.');
    const field=config.fields.find(f=>f.name===setup.dateField)!;
    if(field.type!=='date')throw new Error('The aging date field must be a calendar date column.');
    const base=planParameterQuestion(`Show ${setup.measure} by ${grouping} as a table`,{...config,time:{...config.time,dateField:setup.dateField}},measures);
    if(setup.asOfField){const asOf=config.fields.find(f=>f.name===setup.asOfField)!;if(asOf.type!=='date')throw new Error('The model as-of field must be a date column.');base.filters.push(new AdvancedFilter({table:asOf.table,column:asOf.column},'And',{operator:'GreaterThanOrEqual',value:date+'T00:00:00.000Z'},{operator:'LessThan',value:new Date(Date.parse(date)+86400000).toISOString()}).toJSON());}
    let buckets=setup.buckets;
    const display=(match[4]?.toLowerCase()||setup.display);
    if(display==='summary'){buckets=[];for(const b of setup.buckets){const last=buckets.at(-1);if(last?.label===b.summary)last.max=b.max;else buckets.push({...b,label:b.summary});}}
    const bands:Array<{label:string;bucket:AgingBucket|null|undefined}>=[...buckets.map(bucket=>({label:bucket.label,bucket})),{label:'Date unavailable',bucket:null},{label:'Total',bucket:undefined}];
    const rows=new Map<string,{label:string;values:string[];selection:NonNullable<QnaTable['modelSelections']>[number]}>();const totals=['Grand Total'];const scopes:NonNullable<QnaTable['agingScopes']>={};
    for(const [index,band] of bands.entries()){
        const filters=[...base.filters,...(band.bucket===undefined?[]:agingDateFilters({table:field.table,column:field.column},date,band.bucket))];
        const plan={...base,filters,groups:[grouping],presentation:'table' as const};
        const response=await load(plan);const table=response.table;if(!table)throw new Error('The model did not return an aging table.');
        if(table.modelResultComplete===false)throw new Error('Aging results are incomplete. Narrow the model filters before retrying.');
        table.rows.forEach((row,i)=>{const key=JSON.stringify(table.modelSelections?.[i]||[row[0]]);let entry=rows.get(key);if(!entry){entry={label:row[0],values:bands.map(()=>'—'),selection:table.modelSelections?.[i]||[]};rows.set(key,entry);}entry.values[index]=row[1];});
        let total=table.modelTotals?.[1];if(total===undefined){const scalar=await load({...plan,groups:[],totalOnly:true});total=scalar.kpi?.value||scalar.table?.modelTotals?.at(-1)||scalar.table?.rows[0]?.at(-1);}
        totals.push(total??'—');
        scopes[band.label]={question:`Show ${setup.measure}`,measure:setup.measure,inheritedFilters:filters};
    }
    return {modelQuery:true,text:`${setup.name} · As of ${date} · ${setup.basis} · ${display}. Amount: ${setup.measure}. Existing model and Always filters apply.`,table:{columns:[grouping,...bands.map(b=>b.label)],rows:[...rows.values()].map(r=>[r.label,...r.values]),rowIndices:[...rows.values()].map(()=>[]),modelSelections:[...rows.values()].map(r=>r.selection),modelTotals:totals,modelSnapshot:true,modelResultComplete:true,agingView:{name:setup.name.replace(/\s+aging$/i,''),group:grouping,date,display:display as 'detailed'|'summary'},agingScopes:scopes}};
}
