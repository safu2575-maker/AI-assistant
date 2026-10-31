import { settingsMultiSelect } from "./settingsMultiSelect";
import { settingsActionIcon } from "./settingsActionIcon";
import { TransactionRule, validateTransactionRule, transactionBuilderFormula } from '../transactionRules';
import { settingsSelect } from './settingsSelect';

export function transactionRuleSettings(initial:TransactionRule|undefined, fields:string[], measures:string[], transactionFields:()=>string[]) {
    const element=document.createElement('details');element.className='askbics-transaction-rule';
    const summary=document.createElement('summary');summary.textContent='Transaction rule';element.append(summary);
    const help=document.createElement('p');help.textContent='Exclude matching transactions. Included, Excluded and All rows are available above the transaction table. Existing filters always apply. Reference lookup works without a Row ID. Other rule types require a unique transaction ID in Transaction fields. Rules evaluate up to 5,000 transactions; narrow the period for larger data.';element.append(help);
    const input=(title:string,value:string)=>{const label=document.createElement('label'),control=document.createElement('input');label.append(title,control);control.value=value;control.setAttribute('aria-label',title);element.append(label);return control;};
    const enabled=input('Enable transaction rule','');enabled.type='checkbox';enabled.checked=initial?.enabled??false;enabled.parentElement!.className='askbics-transaction-rule__enabled';enabled.parentElement!.prepend(enabled);
    const name=input('Rule name',initial?.name||'');name.placeholder='Reversal filter';name.maxLength=100;
    const select=(title:string,choices:string[],value:string,parent:HTMLElement=element)=>{const label=document.createElement('label'),control=document.createElement('select');label.append(title,control);control.setAttribute('aria-label',title);for(const text of choices){const option=document.createElement('option');option.value=text;option.textContent=text||'Choose…';control.append(option);}control.value=value;parent.append(label);settingsSelect(control,true);return control;};
    const id=select('Transaction ID field',['',...fields],initial?.keyField||'');
    const kind=select('Rule type',['Conditions','Document matching'],initial?.reversal||!initial?'Document matching':'Conditions');
    const matching=document.createElement('div');matching.className='askbics-transaction-rule__matching';element.append(matching);
    const method=select('Matching method',['Reference lookup','Confirmed offsetting pairs'],initial?.reversal&&initial.reversal.method!=='lookup'?'Confirmed offsetting pairs':'Reference lookup',matching);
    const documentField=select('Document number',['',...fields],initial?.reversal?.documentField||'',matching);
    const reversalField=select('Rev With / reversal reference',['',...fields],initial?.reversal?.reversalField||'',matching);
    const amountMeasure=select('Signed amount measure (additive)',['',...measures],initial?.reversal?.amountMeasure||'',matching);
    const advanced=document.createElement('details');const advancedTitle=document.createElement('summary');advancedTitle.textContent='Matching scope (optional)';advanced.append(advancedTitle);matching.append(advanced);
    const partitionHelp=document.createElement('p');partitionHelp.textContent='Match only within the same company, fiscal year and currency where applicable. Keep document numbers as text to preserve leading zeros. Choose a SUM-based signed amount, not a ratio or absolute value.';advanced.append(partitionHelp);
    let partitionFields=initial?.reversal?.partitionFields.slice()||[];
    const scopeLabel=document.createElement('p');scopeLabel.textContent='Matching scope fields (optional, up to 5)';advanced.append(scopeLabel);
    const partitions=settingsMultiSelect('Matching scope fields',partitionFields,values=>{partitionFields=values;},async()=>fields.filter(n=>n!==documentField.value&&n!==reversalField.value),'No additional scope');advanced.append(partitions.element);
    const scopeHelp=document.createElement('p');scopeHelp.textContent='Both documents are excluded only for an unambiguous, full offset within the current period and filters. Cross-period, partial and unmatched reversals stay visible for review. A unique transaction ID is still required; matching fields can remain hidden.';matching.append(scopeHelp);
    const mode=select('Condition editor',['Builder','Formula'],initial&&!initial.builder?'Formula':'Builder');
    const builder=document.createElement('div');element.append(builder);
    const join=select('Match',['All conditions (AND)','Any condition (OR)'],initial?.builder?.match==='any'?'Any condition (OR)':'All conditions (AND)',builder);
    const rows=document.createElement('div');builder.append(rows);
    const conditions:Array<{field:HTMLSelectElement;operator:HTMLSelectElement;value:HTMLInputElement;row:HTMLElement}>=[];
    const button=(text:string,parent:HTMLElement,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.className='askbics-settings-action';b.textContent=text;b.onclick=action;parent.append(b);return b;};
    const add=(saved?:{field:string;operator:string;value:string})=>{if(conditions.length>=20)return;const row=document.createElement('div');row.className='askbics-transaction-rule__condition';rows.append(row);const field=select('Field or measure',['',...fields,...measures],saved?.field||'',row),operator=select('Operator',['=','<>','>','<','>=','<=','IN','ISBLANK'],saved?.operator||'=',row);const value=document.createElement('input');value.setAttribute('aria-label','Condition value');value.value=saved?.value||'';value.disabled=operator.value==='ISBLANK';value.placeholder='0 or "text"';row.append(value);const condition={field,operator,value,row};conditions.push(condition);operator.onchange=()=>{value.disabled=operator.value==='ISBLANK';};const remove=button('×',row,()=>{conditions.splice(conditions.indexOf(condition),1);row.remove();});settingsActionIcon(remove,'delete','Remove condition');};
    if(initial?.builder)initial.builder.conditions.forEach(add);else add();button('Add condition',builder,()=>add());
    const formula=document.createElement('textarea');formula.setAttribute('aria-label','Transaction rule formula');formula.placeholder='[Revenue Documents] = 0 AND [Revenue] = 0';formula.value=initial?.formula||'';element.append(formula);
    const syntax=document.createElement('p');syntax.textContent='Numbers: 0. Text: "Cancelled". IN ("A", "B"). Use parentheses with AND / OR. ISBLANK([Field]) checks blanks; blanks are not zero. Measure conditions evaluate at the transaction ID level. Formula mode also supports nested groups.';element.append(syntax);
    const builderState=()=>({match:join.value.startsWith('All')?'all' as const:'any' as const,conditions:conditions.map(c=>({field:c.field.value,operator:c.operator.value,value:c.value.value}))});
    const builderFormula=()=>transactionBuilderFormula(builderState());
    const render=()=>{const lookup=method.value==='Reference lookup';id.parentElement!.hidden=kind.value==='Document matching'&&lookup;amountMeasure.parentElement!.hidden=lookup;partitionHelp.textContent=lookup?'Only match documents within the same company, year or currency when numbers repeat. Use the same data type for both document fields.':'Use a signed SUM measure. Match within company, year and currency where needed.';scopeHelp.textContent=lookup?'Like VLOOKUP: exclude a row when its Rev With value exists in Document number. Blank or unmatched references stay visible. No Row ID or amount check is required. Identical displayed rows may be combined by Power BI. Views: Excluding reversals (default), Reversals, All rows. Matching uses the current period and filters.':'Only confirmed, fully offsetting pairs are excluded. Partial, unmatched and ambiguous references stay visible.';const isMatching=kind.value==='Document matching';matching.hidden=!isMatching;mode.parentElement!.hidden=isMatching;builder.hidden=isMatching||mode.value!=='Builder';formula.hidden=isMatching||mode.value!=='Formula';syntax.hidden=isMatching;};kind.onchange=render;method.onchange=render;
    mode.onchange=()=>{if(mode.value==='Formula'){try{formula.value=builderFormula();}catch{formula.value="";}}render();};render();
    const status=document.createElement('p');status.setAttribute('role','status');element.append(status);
    const read=():TransactionRule|undefined=>{
        if(!enabled.checked&&!name.value.trim()&&!formula.value.trim())return undefined;
        if(kind.value==='Document matching'){const rule:TransactionRule={name:name.value.trim(),enabled:enabled.checked,keyField:method.value==='Reference lookup'?'':id.value,formula:'',reversal:{method:method.value==='Reference lookup'?'lookup':'pairs',documentField:documentField.value,reversalField:reversalField.value,amountMeasure:method.value==='Reference lookup'?'':amountMeasure.value,partitionFields}};validateTransactionRule(rule,fields,measures,transactionFields());return rule;}
        const rule={name:name.value.trim(),enabled:enabled.checked,keyField:id.value,formula:mode.value==='Builder'?builderFormula():formula.value.trim(),builder:mode.value==='Builder'?builderState():undefined};
        validateTransactionRule(rule,fields,measures,transactionFields());return rule;
    };
    const actions=document.createElement('div');actions.className='askbics-transaction-rule__actions';element.append(actions);
    button('Check rule',actions,()=>{try{const rule=read();status.textContent=rule?'Condition is valid. Data will be checked when transactions load.':'No transaction rule configured.';}catch(error){status.textContent=(error as Error).message;}});
    button('Remove rule',actions,()=>{enabled.checked=false;name.value='';formula.value='';status.textContent='Rule removed. Save settings to apply.';});
    return {element,read};
}
