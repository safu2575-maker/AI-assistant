import {BasicFilter,TupleFilter} from 'powerbi-models';
import {TransactionScope} from './answerTransactions';
import {ParameterConfig,ParameterPlan,planParameterQuestion} from './parameterQuery';
import {dateSelectionFilters} from './selectionFilter';
import {resolveValueSynonyms} from './valueSynonyms';
import {revenueQuestion} from './revenue';
/** Fail closed when an answer cannot be represented as one exact starting scope. */
export function cashSelectionFilters(scopes:TransactionScope[],config:ParameterConfig,measures:string[]):ParameterPlan['filters'] {
 if(!Array.isArray(scopes)||scopes.length!==1)throw new Error('Select an individual period/value for cash flow; combined calculation scopes are not supported.');
 const scope=scopes[0];
 if(!scope.question||scope.question.startsWith(';')||scope.question.includes(';analysisState:')||scope.documentDetails||scope.clearingDetails||scope.lookupFilters?.length)throw new Error('Cash flow cannot determine the starting scope for this selection. Select a regular answer cell.');
 const plan=planParameterQuestion(resolveValueSynonyms(revenueQuestion(scope.question).question,config.valueSynonyms,config.fields,measures),config,measures);
 const filters=[...plan.filters,...(scope.inheritedFilters||[])];
 for(const f of scope.summaryFilters||[]){const field=config.fields.find(x=>x.name===f.field);if(!field||!f.values.length)throw new Error('Selected filter is unavailable: '+f.field);filters.push(new BasicFilter({table:field.table,column:field.column},'In',f.values as any).toJSON());}
 const rows=scope.selections||[];
 if(scope.requireSelection&&!rows.some(r=>r.length))throw new Error('The selected cell has no model context. Run the answer again.');
 if(rows.length){const targets=rows[0].map(p=>({table:p.table,column:p.column!}));
 if(!targets.length||rows.length>30000||rows.some(r=>r.length!==targets.length||r.some((p,i)=>p.table!==targets[i].table||p.column!==targets[i].column||!config.fields.some(f=>f.table===p.table&&f.column===p.column))))throw new Error('Selected cell fields are unavailable in the current model.');
 if(rows.some(r=>r.some(p=>p.dateDay))){if(rows.length!==1)throw new Error('Select an individual date for cash flow.');rows[0].forEach((p,i)=>filters.push(...(p.dateDay?dateSelectionFilters(targets[i],[String(p.value)]):[new BasicFilter(targets[i],'In',[p.value]).toJSON()])));}
 else if(targets.length===1)filters.push(new BasicFilter(targets[0],'In',rows.map(r=>r[0].value)).toJSON());
 else filters.push(new TupleFilter(targets,'In',rows.map(r=>r.map(p=>({value:p.value})))).toJSON());
 }
 if(!filters.length)throw new Error('This cell has no filter context. Use the main Cash flow workspace for all payments.');
 const unique=filters.filter((f,i)=>filters.findIndex(other=>JSON.stringify(other)===JSON.stringify(f))===i);
 for(const f of unique){const peers=unique.filter(other=>JSON.stringify(other.target)===JSON.stringify(f.target));if(peers.length>1&&peers.some(other=>!Array.isArray((other as any).values)))throw new Error('Overlapping selected date/range filters cannot be safely combined. Select a simpler period.');}
 return unique;
}
