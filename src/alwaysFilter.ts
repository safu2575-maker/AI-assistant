import { BasicFilter } from "powerbi-models";
import { ParameterConfig, ParameterPlan } from "./parameterQuery";
export interface AlwaysFilterRule { field: string; values: string[] }
export type AlwaysFilter = AlwaysFilterRule | AlwaysFilterRule[];
export function alwaysFilterRules(value:AlwaysFilter|undefined):AlwaysFilterRule[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
/** Apply at the execution boundary, after revenue and period plans are derived. */
export function applyAlwaysFilter(plan:ParameterPlan,config:ParameterConfig):ParameterPlan {
    return alwaysFilterRules(config.alwaysFilter).reduce((result,rule)=>applyRule(result,config,rule),plan);
}
function applyRule(plan:ParameterPlan,config:ParameterConfig,rule:AlwaysFilterRule):ParameterPlan {
    if(!rule)throw new Error("Always filter is invalid. Review Data setup.");
    const field=config.fields.find(f=>f.name===rule.field);
    if(!field||!Array.isArray(rule.values)||!rule.values.length||rule.values.some(v=>typeof v!=='string'||!v.trim()))throw new Error('Always filter is incomplete or its field is unavailable. Review Data setup.');
    let values:Array<string|number>=rule.values.map(v=>field.type==='number'?Number(v):v);
    if(values.some(v=>typeof v==='number'&&!Number.isFinite(v)))throw new Error('Always filter requires valid numeric values.');
    const filters=plan.filters.filter(raw=>{
        const f=raw as any;
        if(Array.isArray(f.target)) {
            if(f.target.some((t:any)=>t.table===field.table&&t.column===field.column))throw new Error('This period or selection overlaps Always filter. Use a compatible single-field filter.');
            return true;
        }
        if(f.target?.table!==field.table||f.target?.column!==field.column)return true;
        if(f.operator==='In'&&Array.isArray(f.values))values=values.filter(v=>f.values.includes(v));
        else if(f.operator==='NotIn'&&Array.isArray(f.values))values=values.filter(v=>!f.values.includes(v));
        else if(Array.isArray(f.conditions)) values=values.filter(v=>{
            const checks=f.conditions.map((c:any)=>{switch(c.operator){case 'Is':return v===c.value;case 'IsNot':return v!==c.value;case 'GreaterThanOrEqual':return v>=c.value;case 'LessThan':return v<c.value;case 'GreaterThan':return v>c.value;case 'LessThanOrEqual':return v<=c.value;default:throw new Error('Unsupported filter on the Always filter field.');}});
            return f.logicalOperator==='Or'?checks.some(Boolean):checks.every(Boolean);
        });
        else throw new Error('Unsupported filter on the Always filter field.');
        return false;
    });
    if(!values.length)throw new Error('This question conflicts with Always filter. Choose values within the configured scope.');
    return {...plan,filters:[...filters,new BasicFilter({table:field.table,column:field.column},'In',values).toJSON()]};
}
