const assert = require('node:assert/strict');
assert.equal(require('../.tmp/test/buildInfo').visualBuild, require('../pbiviz.json').visual.version,
  'Diagnostic build must match the packaged visual version');
const capabilities = require('../capabilities.json');
for (const mapping of capabilities.dataViewMappings) {
  for (const condition of mapping.conditions || []) {
    assert.ok(Object.values(condition).filter(role => role.min >= 1).length <= 1,
      'Power BI allows only one required role per mapping condition');
  }
}
for (const [fields, measures] of [[1,0],[10,0],[1,1],[10,3],[0,1],[0,3]]) {
  const matches = capabilities.dataViewMappings.filter(mapping => !mapping.conditions || mapping.conditions.some(condition =>
    Object.entries(condition).every(([role, limits]) => {
      const count = role === 'fields' ? fields : measures;
      return count >= (limits.min || 0) && count <= (limits.max ?? Infinity);
    })));
  assert.equal(matches.length, 1, `Exactly one mapping for ${fields} fields / ${measures} measures`);
  assert.ok(matches[0].categorical);
}
assert.equal(capabilities.dataViewMappings[0].categorical.categories.for.in, 'fields');
assert.equal(capabilities.dataViewMappings[0].categorical.values.select[0].for.in, 'measures');
const { readModelMatrix } = require('../.tmp/test/modelMatrix');
const scalarMatrix = readModelMatrix({
  rows: { levels: [], root: { values: { 0: { value: 125 }, 1: { valueSourceIndex: 1, value: 0 } } } },
  valueSources: [{ displayName: 'Actual' }, { displayName: 'Budget' }]
});
assert.deepEqual(scalarMatrix.table.rows, [[125, 0]]);
assert.deepEqual(scalarMatrix.table.totals, [125, 0]);
require('./test-settings-select.cjs');
const { planParameterQuestion, parameterFilters, validateParameterConfig } = require('../.tmp/test/parameterQuery');
const config = {
  table: 'Parameter', column: 'Parameter', enabled: true,
  options: ['Year', 'City', 'Assigned Tenant Name'],
  fields: [
    { name: 'Assigned Tenant Name', table: 'Retail', column: 'Tenant', aliases: ['Tenant'], values: ['Home Living', 'Bean Street'] },
    { name: 'City', table: 'Retail', column: 'City', values: ['Riyadh'] },
    { name: 'Year', table: 'Calendar', column: 'Year', type: 'number' },
    { name: 'Date', table: 'Calendar', column: 'Date', type: 'date' }
  ]
};
const plan = question => planParameterQuestion(question, config, ['Rent Measure']);
const defaultConfig = {...config,defaultMeasure:'Rent Measure'};
const tenantDefaultConfig = {...defaultConfig,groupAliases:{'Sales Measure':['sales']}};
for (const [question, measures] of [
  ['list Assigned Tenant Name', []],
  ['Assigned Tenant Name', ['Rent Measure']],
  ['Assigned Tenant Name sales', ['Sales Measure']]
]) {
  const result = planParameterQuestion(question,tenantDefaultConfig,['Rent Measure','Sales Measure']);
  assert.deepEqual(result.groups,['Assigned Tenant Name']);
  assert.deepEqual(result.measures,measures);
  assert.equal(result.listOnly,measures.length === 0);
}
assert.deepEqual(planParameterQuestion('show City',defaultConfig,['Rent Measure','Revenue']).measures,['Rent Measure']);
assert.deepEqual(planParameterQuestion('show total',defaultConfig,['Rent Measure','Revenue']).measures,['Rent Measure']);
assert.deepEqual(planParameterQuestion('Revenue by City',defaultConfig,['Rent Measure','Revenue']).measures,['Revenue']);
assert.equal(planParameterQuestion('list City',defaultConfig,['Rent Measure','Revenue']).listOnly,true);
assert.throws(()=>planParameterQuestion('show City',defaultConfig,['Revenue']),/default measure is no longer available/);
const synonymConfig = {...config, groupAliases:{'Rent Measure':['rent','lease amount'],City:['location']}};
assert.deepEqual(planParameterQuestion('rent by location',synonymConfig,['Rent Measure']).measures,['Rent Measure']);
assert.deepEqual(planParameterQuestion('lease amount by location',synonymConfig,['Rent Measure']).groups,['City']);
assert.deepEqual(planParameterQuestion('Rent Measure rent by City',synonymConfig,['Rent Measure']).measures,['Rent Measure']);
assert.deepEqual(planParameterQuestion('rent by Year where location = Riyadh',synonymConfig,['Rent Measure']).filters[0].values,['Riyadh']);
assert.deepEqual(planParameterQuestion('Rent Measure by City where Tenant = rent',synonymConfig,['Rent Measure']).filters[0].values,['rent']);
assert.deepEqual(planParameterQuestion('Rent Measure by Tenant (rent)',synonymConfig,['Rent Measure']).filters[0].values,['rent']);
assert.throws(()=>planParameterQuestion('rent by City',{...config,groupAliases:{'Rent Measure':['rent'],Revenue:['rent']}},['Rent Measure','Revenue']),/Ambiguous synonym/);
assert.throws(()=>planParameterQuestion('rent by City',{...config,groupAliases:{'Rent Measure':['rent'],City:['rent']}},['Rent Measure']),/Ambiguous synonym/);
assert.throws(()=>planParameterQuestion('lease amount by City',config,['Rent Measure']),/Could not safely interpret/);
const { normalizeMonthPeriods, monthIndexValues } = require('../.tmp/test/timeSetup');
const { recognizedTimeTerms } = require('../.tmp/test/timeSetup');
const { monthIndexLabel } = require('../.tmp/test/timeSetup');
for (const phrase of ['ttm june','June TTM','YTD may','Jun YTD']) {
  assert.equal(recognizedTimeTerms(phrase,{monthIndexField:'MonthIndex'},[],true).length,2);
  assert.equal(recognizedTimeTerms(phrase,{monthIndexField:'MonthIndex'}).length,0,'month-only highlighting must not change query routing');
}
assert.equal(monthIndexLabel(24306),'June 2025');
assert.equal(monthIndexLabel(24289),'January 2024');
for (const input of ['2026 jun','Jun 26','26 June','06-26','26/06','June 2024']) {
  assert.deepEqual(recognizedTimeTerms(input),[{start:0,end:input.length,kind:'value'}]);
}
assert.deepEqual(recognizedTimeTerms('06/07'),[]);
assert.equal(recognizedTimeTerms('06/07',{numericOrder:'month-year'}).length,1);
assert.deepEqual(recognizedTimeTerms('2026/13'),[]);
assert.deepEqual(recognizedTimeTerms('where Tenant = 2026 jun'),[]);
assert.deepEqual(recognizedTimeTerms('June 26 Shop',{},['June 26 Shop']),[]);
assert.equal(recognizedTimeTerms('YTD ending 2026 jun',{monthIndexField:'MonthIndex'}).length,2);
for (const variant of ['June 2026','Jun 2026','june 26','26 june','2026 jun','06-26','26-06','26/06','6/2026','2026/6','Jun. 26']) {
  assert.equal(normalizeMonthPeriods(variant), 'June 2026', variant);
  assert.deepEqual(plan('Rent Measure by City for '+variant).filters, plan('Rent Measure by City for June 2026').filters, variant);
}
assert.equal(normalizeMonthPeriods('Jun 24 vs 26/06'), 'June 2024 vs June 2026');
assert.throws(()=>normalizeMonthPeriods('06/07'), /Ambiguous period/);
assert.equal(normalizeMonthPeriods('06/07',{numericOrder:'month-year'}), 'June 2007');
assert.equal(normalizeMonthPeriods('06/07',{numericOrder:'year-month'}), 'July 2006');
assert.equal(normalizeMonthPeriods('June 49',{twoDigitYearStart:1950}), 'June 2049');
assert.equal(normalizeMonthPeriods('June 50',{twoDigitYearStart:1950}), 'June 1950');
assert.equal(normalizeMonthPeriods('from 2024-02-01 to 2024-02-29'), 'from 2024-02-01 to 2024-02-29');
assert.equal(normalizeMonthPeriods('City (06/07) where Tenant = Jun 26'), 'City (06/07) where Tenant = Jun 26');
assert.equal(normalizeMonthPeriods('Rent June 26 Shop',{},['June 26 Shop']), 'Rent June 26 Shop');
assert.throws(()=>normalizeMonthPeriods('2026/13'), /Invalid month/);
const indexedConfig = {...config, fields:[...config.fields,{name:'MonthIndex',table:'Calendar',column:'MonthIndex',type:'number'}],time:{monthIndexField:'MonthIndex',monthIndexBase:1}};
const indexedPlan = q => planParameterQuestion(q,indexedConfig,['Rent Measure']);
assert.deepEqual(indexedPlan('Rent Measure by City June 26').filters[0].values,[24318]);
assert.deepEqual(indexedPlan('Rent Measure by City YTD ending Jun 26').filters[0].values,[24313,24314,24315,24316,24317,24318]);
assert.deepEqual(indexedPlan('Rent Measure by City TTM ending 26/06').filters[0].values,Array.from({length:12},(_,i)=>24307+i));
assert.equal(indexedPlan('Rent Measure by City from 2026-06-02 to 2026-06-15').filters[0].target.column,'Date','day ranges retain the calendar date field');
const renamedTime = {...config,fields:config.fields.filter(f=>!['Date','Year'].includes(f.name)).concat([{name:'Calendar Year',table:'C',column:'Y',type:'number'},{name:'Month No',table:'C',column:'M',type:'number'}]),time:{yearField:'Calendar Year',monthField:'Month No'}};
assert.deepEqual(planParameterQuestion('Rent Measure by City Jun 26',renamedTime,['Rent Measure']).filters.map(f=>f.values),[[2026],[6]]);
assert.throws(()=>planParameterQuestion('Rent Measure by City TTM ending Jan 26',renamedTime,['Rent Measure']),/MonthIndex/);
assert.deepEqual(monthIndexValues(new Date('2024-01-01Z'),new Date('2024-02-01Z'),1),[24289]);
assert.deepEqual(monthIndexValues(new Date('2024-01-01Z'),new Date('2024-02-01Z'),0),[24288]);
assert.throws(()=>validateParameterConfig({...indexedConfig,time:{monthIndexField:'City'}}),/numeric/);
assert.throws(()=>validateParameterConfig({...config,time:{yearField:'Unknown'}}),/map Unknown/);

for (const prefix of ['shw','shwo','pls shw me','could you please show me','i would like to see','kindly dispaly','can you plz shwo']) {
 const actual=plan(prefix+' Rent Measure by City');
 assert.deepEqual(actual.groups,['City']); assert.deepEqual(actual.measures,['Rent Measure']); assert.equal(actual.filters.length,0);
}
assert.deepEqual(plan('shw Rent Measure by Year where Tenant = "Please Show Me"').filters[0].values,['Please Show Me']);
const fillerConfig={...config,fields:config.fields.map(field=>field.name==='Assigned Tenant Name'?{...field,values:['Please','Shw']}:field)};
assert.deepEqual(planParameterQuestion('Rent Measure by Year Please',fillerConfig,['Rent Measure']).filters[0].values,['Please'],'known business values take precedence over filler words');
assert.deepEqual(planParameterQuestion('Rent Measure by Year Shw',fillerConfig,['Rent Measure']).filters[0].values,['Shw'],'known business values take precedence over command typos');
assert.throws(()=>plan('show Rent Measure by City not Riyadh'),/Could not safely interpret/);
assert.throws(()=>plan('show Rnet Measure by City'),/Could not safely interpret/);
assert.throws(()=>plan('show Rent Measure by City exclude unknown tenant'),/Could not safely interpret/);
for (const question of ['list Assigned Tenant Name', 'show list of Assigned Tenant Name', 'Assigned Tenant Name as a list', 'Assigned Tenant Name in a list']) {
  assert.equal(plan(question).listOnly,true,question);
  assert.deepEqual(plan(question).groups,['Assigned Tenant Name']);
}
assert.deepEqual(plan('Tenant (Home Living | Bean Street) Rent Measure by Year').filters[0].values,['Home Living','Bean Street']);
assert.deepEqual(plan('Assigned Tenant Name (Home Living) City (Riyadh) Rent Measure').filters.map(filter=>filter.values),[['Home Living'],['Riyadh']]);
assert.throws(()=>plan('Tenant (Home Living | ) Rent Measure'),/cannot be empty/);
for (const visual of ['table','matrix','bar','column','line','area','pie','donut','combo','waterfall','scatter','treemap','funnel','gauge','bullet','heatmap','sparkline']) {
  assert.equal(plan('Rent Measure by City as a '+visual).presentation,visual);
}
for (const connector of ['as as a','as a as a','in a as a','as as as a']) {
 assert.equal(plan('Assigned Tenant Name Rent Measure '+connector+' stacked bar chart').presentation,'stackedBar');
 assert.equal(plan('City and Assigned Tenant Name Rent Measure '+connector+' column chart').presentation,'column');
}
assert.deepEqual(plan('Rent Measure by City as as a table where Tenant = "as a column chart"').filters[0].values,['as a column chart']);
assert.deepEqual(plan('Tenant (as as a column chart) Rent Measure by Year').filters[0].values,['as as a column chart']);
assert.throws(()=>plan('Rent Measure by City as nonsense as a column chart'),/Could not safely interpret/);
assert.deepEqual(planParameterQuestion('Rent Measure Revenue by City Year as a line chart',config,['Rent Measure','Revenue']).measures,['Rent Measure','Revenue']);
assert.equal(plan('show total Rent Measure').totalOnly,true);
assert.deepEqual(plan('show top 5 Assigned Tenant Name by Rent Measure').rank,{count:5,ascending:false});
assert.deepEqual(plan('show bottom 3 Assigned Tenant Name by Rent Measure').rank,{count:3,ascending:true});

const selectiveConfig = {...config, measureParameter:{table:'Measure Choice',column:'Label',options:['Rent Measure','Revenue','Profit']}};
const selectivePlan = {...plan('Rent Measure by City'), measures:['Revenue']};
assert.deepEqual(parameterFilters(selectivePlan, selectiveConfig).map(filter=>filter.values),[['City'],['Revenue']]);
assert.deepEqual(parameterFilters({...selectivePlan,measures:['Revenue','Profit']},selectiveConfig)[1].values,['Revenue','Profit']);
assert.deepEqual(parameterFilters({...selectivePlan,measures:[]},selectiveConfig)[1].values,['Rent Measure'],'lists use one available measure without requiring model changes');
const listSupportConfig={...selectiveConfig,measureParameter:{...selectiveConfig.measureParameter,options:[...selectiveConfig.measureParameter.options,'askBICS List Support']}};
assert.deepEqual(parameterFilters({...selectivePlan,measures:[]},listSupportConfig)[1].values,['askBICS List Support'],'lists request only the constant supporting measure');
assert.throws(()=>parameterFilters({...selectivePlan,measures:['Unknown']},selectiveConfig),/missing/);
assert.throws(()=>validateParameterConfig({...selectiveConfig,measureParameter:{...selectiveConfig.measureParameter,table:config.table}}),/separate/);
assert.deepEqual(planParameterQuestion('Rent Measure Sales Measure by City',config,['Sales Measure','Rent Measure']).measures,['Rent Measure','Sales Measure'],'measure columns follow question order, not longest-name order');
assert.deepEqual(planParameterQuestion('Sales Measure Rent Measure by City',config,['Rent Measure','Sales Measure']).measures,['Sales Measure','Rent Measure']);
const editorQuestion = 'Matrix; rows: Assigned Tenant Name; columns: City > Year; values: Rent Measure; answerFilters: ' + encodeURIComponent(JSON.stringify([{ field: 'Assigned Tenant Name', values: ['Home Living', 'Bean Street'] }]));
assert.deepEqual(plan(editorQuestion).groups, ['Assigned Tenant Name', 'City', 'Year']);
assert.equal(plan(editorQuestion).matrixRowCount, 1);
assert.deepEqual(plan(editorQuestion).filters[0].values, ['Home Living', 'Bean Street']);
assert.equal(plan('Table; rows: Year; columns: ; values: Rent Measure').presentation, 'table');
assert.equal(plan('Matrix; rows: City > Year; columns: ; values: Rent Measure').matrixRowCount, 2);
const { pivotModelTable } = require('../.tmp/test/modelPivot');
const multiPivot = pivotModelTable({ columns: ['Tenant', 'City', 'Year', 'Rent'], rows: [['A', 'Riyadh', '2024', '10'], ['A', 'Riyadh', '2025', '20']], rowIndices: [[], []] }, 3, undefined, 1);
assert.deepEqual(multiPivot.columns, ['Tenant', 'Riyadh · 2024', 'Riyadh · 2025']);
assert.deepEqual(multiPivot.rows, [['A', '10', '20']]);
assert.deepEqual(multiPivot.modelPivot.columnFields, ['City', 'Year']);
assert.deepEqual(plan('Show Rent Measure by City and Year').groups, ['City', 'Year']);
assert.deepEqual(plan('Show Rent Measure per Year, City').groups, ['City', 'Year']);
assert.equal(plan('Rent Measure by Year').presentation,'table');
assert.equal(plan('Rent Measure by City and Year').presentation,'matrix');
assert.equal(plan('Rent Measure by City and Year').matrixRowCount,1);
assert.equal(plan('Rent Measure by City and Year as a table').presentation,'table');
assert.deepEqual(plan('Rent Measure by Year and City as a table').groups,['Year','City']);
assert.equal(plan('Rent Measure by Year and City as a bar chart').presentation,'bar');
const monthLayoutConfig={...config,options:[...config.options,'Month'],fields:[...config.fields,{name:'Month',table:'Calendar',column:'Month'}]};
assert.equal(planParameterQuestion('Rent Measure by Month',monthLayoutConfig,['Rent Measure']).presentation,'table');
assert.deepEqual(planParameterQuestion('Rent Measure by Month and City',monthLayoutConfig,['Rent Measure']).groups,['City','Month']);
const {compareTimeLabels}=require('../.tmp/test/qna/timeLayout');
assert.deepEqual(['December','February','January'].sort(compareTimeLabels),['January','February','December']);
assert.deepEqual(['2028','2027','2026','2025'].sort(compareTimeLabels),['2025','2026','2027','2028']);
assert.deepEqual(plan('Show Assigned Tenant').groups, ['Assigned Tenant Name']);
assert.deepEqual(plan('Assigned Tenant Name').measures, []);
assert.equal(plan('Assigned Tenant Name and Year').listOnly, true);
assert.deepEqual(plan('Assigned Tenant Name (Tech Hub) Rent Measure').filters[0].values, ['Tech Hub']);
assert.deepEqual(plan('show homeliving by Year Rent Measure').filters[0].values, ['Home Living']);
assert.deepEqual(plan('Show Assigned Tenant by Rent Measure by Year').groups, ['Assigned Tenant Name', 'Year']);
assert.equal(plan('Show Rent Measure by City as a bar chart').presentation, 'bar');
assert.equal(plan('Show Rent Measure by City as an area chart').presentation, 'area');
assert.equal(plan('Show Rent Measure by City as a line graph').presentation, 'line');
assert.equal(plan('Show Rent Measure by City and Year as a matrix').presentation, 'matrix');
assert.deepEqual(plan('Home Living Rent Measure by Year').filters[0].values, ['Home Living']);
assert.deepEqual(plan('Show Rent Measure by Year where Tenant = Unloaded Shop').filters[0].values, ['Unloaded Shop']);
assert.deepEqual(plan('Rent Measure by Year where Tenant = Home Living | Bean Street and City = Riyadh').filters.map(f => f.values), [['Home Living', 'Bean Street'], ['Riyadh']]);
assert.deepEqual(plan('Rent Measure by City for 2025').filters[0].values, [2025]);
assert.deepEqual(plan('Rent Measure by City where Year = 2025').filters[0].values, [2025]);
const bounds = question => plan(question).filters.find(f => f.conditions).conditions.map(c => c.value);
assert.deepEqual(bounds('Rent Measure by City for June 2025'), ['2025-06-01T00:00:00.000Z', '2025-07-01T00:00:00.000Z']);
assert.throws(() => plan('Rent Measure by Tenant YTD ending June 2025'), /MonthIndex/);
assert.throws(() => plan('Rent Measure by Tenant TTM ending June 2025'), /MonthIndex/);
assert.throws(() => plan('Rent Measure by City trailing 12 months ending January 2025'), /MonthIndex/);
assert.deepEqual(bounds('Rent Measure by City for February 2024'), ['2024-02-01T00:00:00.000Z', '2024-03-01T00:00:00.000Z']);
const calendarColumns = { ...config, fields: [...config.fields.filter(field => field.type !== 'date'), { name: 'Month', table: 'Calendar', column: 'Month Name', values: ['June'] }] };
assert.throws(() => planParameterQuestion('Rent Measure by Tenant YTD ending June 2025', calendarColumns, ['Rent Measure']), /MonthIndex/);
assert.throws(() => planParameterQuestion('Rent Measure by Tenant TTM ending June 2025', calendarColumns, ['Rent Measure']), /MonthIndex/);
const scopeQuestion = 'Rent Measure by Tenant; modelScope: ' + encodeURIComponent(JSON.stringify({start:'2025-06-01',end:'2025-06-30'}));
assert.deepEqual(plan(scopeQuestion).filters[0].conditions.map(item => item.value), ['2025-06-01T00:00:00.000Z','2025-07-01T00:00:00.000Z']);
assert.deepEqual(planParameterQuestion(scopeQuestion, calendarColumns, ['Rent Measure']).filters[0].values, [[{value:2025},{value:'June'}]]);
assert.equal(plan('Rent Measure by City as a stacked column chart').presentation, 'stackedColumn');
assert.equal(plan('Rent Measure by City as small multiples').presentation, 'smallMultiples');

assert.deepEqual(planParameterQuestion('June 2024 Assigned Tenant Name Rent Measure', calendarColumns, ['Rent Measure']).filters.map(filter => filter.values), [[2024], ['June']]);
assert.deepEqual(bounds('Rent Measure by City between 2024-02-29 and 2024-03-01'), ['2024-02-29T00:00:00.000Z', '2024-03-02T00:00:00.000Z']);
assert.throws(() => plan('Rent Measure by City from 2025-02-29 to 2025-03-01'), /Invalid date/);
assert.throws(() => plan('Rent Measure by City from 2025-07-01 to 2025-06-01'), /end date/);
assert.throws(() => plan('Rent Measure by City TTM'), /end month/);
assert.throws(() => plan('Unknown Shop Rent Measure by Year'), /safely interpret/);
assert.throws(() => plan('Rent Measure by Region'), /safely interpret/);
assert.throws(() => plan('Rent Measure by City where Region = West'), /mapping/);
assert.throws(() => plan('Rent Measure by City where Year = twenty'), /numeric/);
assert.throws(() => planParameterQuestion('Rent Measure by City for June 2025', { ...config, fields: [] }, ['Rent Measure']), /calendar date/);
assert.throws(() => validateParameterConfig({ ...config, fields: [...config.fields, { name: 'Tenant', table: 'X', column: 'Y' }] }), /Ambiguous/);
assert.throws(() => validateParameterConfig({ table: 'X' }), /grouping options/);

const { appendPeriodResult, modelHierarchy } = require('../.tmp/test/modelFeatures');
const periodSource = { columns:['Tenant','June 2025'], rows:[['A','10'],['B','20'],['Grand Total','25']], rowIndices:[[],[],[]], modelTotals:['Grand Total','25'], modelCellSelections:[[[],[]],[[],[]]] };
const periodAnswer = { columns:['Tenant','Rent Measure'], rows:[['B','200'],['A','100']], rowIndices:[[],[]], modelTotals:['Grand Total','250'], modelRowSelections:[[[{table:'T',column:'Tenant',value:'B'}]],[[{table:'T',column:'Tenant',value:'A'}]]] };
const appended = appendPeriodResult(periodSource, periodAnswer, 1, 'YTD', 'Rent Measure', 1);
assert.deepEqual(appended.rows, [['A','10','100'],['B','20','200'],['Grand Total','25','250']]);
assert.deepEqual(appended.ytdColumns, [{sourceColumn:1,ytdColumn:2}]);
assert.equal(appended.modelCellSelections[0][2][0][0].value, 'A', 'derived selection follows row identity rather than response order');
const revenueColumn = appendPeriodResult(periodSource, {...periodAnswer, rows:[['B','20.00%'],['A','10.00%']], modelTotals:['Grand Total','12.50%']}, 1, '% of revenue', 'Rent Measure', 1);
assert.deepEqual(revenueColumn.columns, ['Tenant','June 2025','June 2025 % of revenue']);
assert.deepEqual(revenueColumn.rows, [['A','10','10.00%'],['B','20','20.00%'],['Grand Total','25','12.50%']]);
assert.deepEqual(revenueColumn.revenueColumns,[{source:'June 2025',column:'June 2025 % of revenue'}]);
const comparisonSource = {...periodSource,columns:['Tenant','June 2024','June 2025'],rows:[['A','10','20']],modelTotals:['Grand Total','10','20'],modelCellSelections:[[[],[],periodAnswer.modelRowSelections[0]]],modelPeriods:[{sourceColumn:2,period:'June 2025'}],hiddenColumns:[2],__percentageColumns:[{sourceColumn:2,grandColumn:2}],__calculatedColumns:[2]};
for (const firstKind of ['YTD','TTM']) {
 const first = appendPeriodResult(comparisonSource,periodAnswer,1,firstKind,'Rent Measure',1);
 const both = appendPeriodResult(first,periodAnswer,1,firstKind === 'YTD' ? 'TTM' : 'YTD','Rent Measure',1);
 assert.deepEqual(both.columns,['Tenant','June 2024','June 2024 YTD','June 2024 TTM','June 2025']);
 assert.deepEqual(both.rows[0],['A','10','100','100','20']);
 assert.deepEqual(both.modelTotals,['Grand Total','10','250','250','20']);
 assert.equal(both.modelPeriods[0].sourceColumn,4);
 assert.deepEqual(both.hiddenColumns,[4]);
 assert.deepEqual(both.__calculatedColumns,[4]);
 assert.equal(both.__percentageColumns[0].grandColumn,4);
 assert.equal(both.modelCellSelections[0][4],comparisonSource.modelCellSelections[0][2]);
 assert.equal(both.modelCellSelections[0][2][0][0].value,'A');
 assert.equal(both.ytdColumns[0].ytdColumn,2); assert.equal(both.ttmColumns[0].ttmColumn,3);
}
const hierarchySource = {columns:['Parent','Child','Rent'],rows:[['P','A','10'],['P','B','20']],rowIndices:[[],[]],modelTotals:['Grand Total','','99']};
const hierarchy = modelHierarchy(hierarchySource, { table:{columns:[{displayName:'Parent'},{displayName:'Child'},{displayName:'Rent'}]}, hierarchy:[{label:'P',key:'["P"]',depth:0,branch:true,values:[99]},{label:'A',key:'["P","A"]',parent:'["P"]',depth:1,branch:false,values:[10]},{label:'B',key:'["P","B"]',parent:'["P"]',depth:1,branch:false,values:[20]}] }, ['Parent','Child'], ['Rent']);
assert.deepEqual(hierarchy.rows,[['P','99'],['A','10'],['B','20']], 'hierarchy uses model subtotal 99 rather than adding leaves');
assert.deepEqual(hierarchy.matrix.levelNames,['Parent','Child']);

const elements = [];
global.document = { createElement(tag) {
  const e = { tag, value: '', checked: false, children: [], append(...c) { this.children.push(...c); }, insertBefore(child, before) { const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); }, prepend() {}, replaceChildren() { this.children = []; }, setAttribute() {}, remove() {} };
  elements.push(e); return e;
}, createTextNode(text) { return text; } };
const { FieldParameterTrial } = require('../.tmp/test/fieldParameterTrial');
const { GlobalQnaUi } = require('../.tmp/test/qna/ui');
{
  const ui=Object.create(GlobalQnaUi.prototype);
  let resets=0, paints=0;
  ui.modelSelected=new Map([['old row',[]]]);
  ui.filterChips={childElementCount:1};
  ui.paintModelSelection=()=>paints++;
  ui.setFilterChips=labels=>{assert.deepEqual(labels,[]);ui.filterChips.childElementCount=0;};
  ui.resetQuestionSelection=()=>resets++;
  ui.modelSelectionTimer=setTimeout(()=>{throw new Error('old selection must not dispatch');},150);
  ui.clearQuestionSelection();
  assert.equal(ui.modelSelected.size,0);
  assert.equal(ui.modelSelectionTimer,undefined);
  assert.equal(resets,1);
  assert.equal(paints,1);
  ui.clearQuestionSelection();
  assert.equal(resets,1,'further typing does not repeatedly clear Power BI filters');
}
const selectionUi = Object.create(GlobalQnaUi.prototype);
selectionUi.modelSelected = new Map();
selectionUi.modelSelectionKeys = new WeakMap(); selectionUi.elementSelectionKeys = new WeakMap(); selectionUi.modelSelectionSequence = 0;
selectionUi.dispatchModelSelection = () => selectionUi.selectModelRows([...selectionUi.modelSelected.values()].flat());
const marks = [];
selectionUi.root = { querySelectorAll: () => marks };
let selectedModelRows;
selectionUi.selectModelRows = rows => { selectedModelRows = rows; };
const mark = tagName => {
  const attributes = new Map(); const handlers = {}; const classes = new Set();
  const item = { tagName, setAttribute(key,value) { attributes.set(key,value); }, getAttribute(key) { return attributes.get(key); }, classList: { toggle(key, active) { if(active) classes.add(key); else classes.delete(key); } }, addEventListener(key, handler) { handlers[key] = handler; }, fire(type, extra={}) { handlers[type]({ stopPropagation() {}, preventDefault() {}, ...extra }); } };
  marks.push(item); return item;
};
const firstMark = mark('TR'), secondMark = mark('TD');
const homeSelection = [{table:'Retail',column:'Tenant',value:'Home Living'}];
const beanSelection = [{table:'Retail',column:'Tenant',value:'Bean Street'}];
selectionUi.bindModelSelection(firstMark, [homeSelection]);
selectionUi.bindModelSelection(secondMark, [beanSelection], true);
firstMark.fire('click'); assert.deepEqual(selectedModelRows, [homeSelection]);
secondMark.fire('keydown', {key:'Enter',ctrlKey:true}); assert.deepEqual(selectedModelRows, [homeSelection,beanSelection]);
firstMark.fire('click'); assert.deepEqual(selectedModelRows, [homeSelection], 'ordinary click replaces a multi-selection');
firstMark.fire('click'); assert.deepEqual(selectedModelRows, [], 'repeat click clears the selected mark');
secondMark.fire('click'); selectionUi.clearModelSelection(); assert.deepEqual(selectedModelRows, []);
selectedModelRows = 'unchanged'; selectionUi.clearModelSelection(); assert.equal(selectedModelRows, 'unchanged', 'Clear without selected model rows must not reset host filters');
assert(firstMark.getAttribute('data-model-selection').length < 10, 'DOM selection uses a short ID');
const oldSet = global.setTimeout, oldClear = global.clearTimeout; const tasks = new Map(); let timerId = 0;
global.setTimeout = callback => { tasks.set(++timerId,callback); return timerId; }; global.clearTimeout = id => tasks.delete(id);
try {
 delete selectionUi.dispatchModelSelection;
 firstMark.fire('click'); secondMark.fire('click'); firstMark.fire('click');
 assert.equal(tasks.size,1,'rapid clicks retain only the final host update');
 [...tasks.values()][0](); tasks.clear();
 assert.deepEqual(selectedModelRows,[homeSelection]);
 secondMark.fire('click'); selectionUi.clearModelSelection();
 assert.equal(tasks.size,0,'clear cancels any queued click');
 assert.deepEqual(selectedModelRows,[]);
} finally { global.setTimeout=oldSet; global.clearTimeout=oldClear; }
const chartHandlers = [];
const chartMark = {setAttribute(){},classList:{contains:name=>name==='askbics-qna__bar',toggle(){}},addEventListener(name,handler){chartHandlers.push({name,handler});}};
selectionUi.drawingModelChart = {modelRowSelections:[[homeSelection]]};
selectionUi.attachTooltip(chartMark,['Home Living','Rent','10'],[0]);
assert.equal(chartHandlers.filter(item=>item.name==='click').length,1,'model bar has one click handler; legacy tooltip cannot undo selection');
selectionUi.drawingModelChart = undefined;
// Chart label selection follows category identity, not equal displayed values.
{
 const makeLabel = key => ({ textContent: '71,820', getAttribute: () => key, active: false, classList: { toggle(name, active) { this.owner.active = active; } } });
 const labels = [makeLabel('Home Living'), makeLabel('Bean Street')];
 labels.forEach(label => label.classList.owner = label);
 let selected = ['Home Living']; let dimming = false;
 const svg = { tagName: 'svg', classList: { toggle(name, active) { dimming = active; } }, querySelectorAll(selector) { return selector === '[data-label-key]' ? labels : selected.map(key => ({ getAttribute: () => key })); } };
 const scope = { querySelectorAll: () => [svg] };
 selectionUi.paintChartLabels(scope);
 assert(dimming && labels[0].active && !labels[1].active, 'equal values retain separate category highlight');
 selected = ['Home Living', 'Bean Street']; selectionUi.paintChartLabels(scope);
 assert(labels.every(label => label.active), 'multiple selections highlight all related labels');
 selected = []; selectionUi.paintChartLabels(scope);
 assert(!dimming && labels.every(label => !label.active), 'clearing selection restores all labels');
}
const highlightUi = Object.create(GlobalQnaUi.prototype);
highlightUi.engine = { recognizedTerms() { return [{ start: 21, end: 25, kind: 'field' }]; } };
highlightUi.automaticGroupingEnabled = () => true;
highlightUi.groupingOptions = () => ['Assigned Tenant Name', 'Year'];
highlightUi.valueOptions = () => [{ label: 'Home Living', detail: 'Assigned Tenant Name' }];
highlightUi.engine.configurationOptions = () => ({ fields: ['Year'], measures: ['Rent Measure'] });
highlightUi.engine.getLayoutSettings = () => ({synonyms:{'Rent Measure':['lease amount','rent']},synonymEnabled:{}});
assert(highlightUi.fieldSuggestions('lease',12,'lease').some(item=>item.label==='lease amount' && item.detail==='Measure'));
assert.equal(highlightUi.fieldSuggestions('rent',12,'rent')[0].label,'rent','exact synonym is offered before partial canonical matches');
assert(highlightUi.inputTerms('lease amount by Year').some(term=>term.start===0 && term.end===12 && term.kind==='measure'));
highlightUi.engine.getLayoutSettings = () => ({synonyms:{'Rent Measure':['lease amount']},synonymEnabled:{'Rent Measure':false}});
assert(!highlightUi.fieldSuggestions('lease',12,'lease').some(item=>item.label==='lease amount'),'disabled synonym is not suggested');
assert.equal(highlightUi.stableStarterPrompts().length, 4);
assert(highlightUi.stableStarterPrompts().some(item => item.title === 'Compare'));
assert(highlightUi.inputTerms('Assigned Tenant Name Year Rent Measure').some(term => term.start === 0 && term.end === 20), 'configured tenant stays recognized when only Year is loaded');
assert(highlightUi.inputTerms('Home Living Year Rent Measure').some(term => term.start === 0 && term.end === 11 && term.kind === 'value'));
assert(highlightUi.inputTerms('June 2024 vs June 2025').some(term => term.start === 0 && term.end === 9 && term.kind === 'value'));
highlightUi.engine.configurationOptions = () => ({ fields: ['Year'], measures: ['Rent Measure'] });
assert(highlightUi.fieldSuggestions('as a', 12, 'Rent Measure by Year as a').some(item => item.label === 'as a matrix'));

highlightUi.valueOptions = () => [{label:'Home Living',detail:'Assigned Tenant Name'},{label:'Bean Street',detail:'Assigned Tenant Name'},{label:'Riyadh',detail:'City'}];
highlightUi.groupingOptions = () => ['Assigned Tenant Name','City','Year'];
assert.deepEqual(highlightUi.modelValueSuggestions('', 'show Assigned Tenant@').map(item=>item.label),['Home Living','Bean Street']);
assert.deepEqual(highlightUi.modelValueSuggestions('home', 'Assigned Tenant Name@home'),[{label:'Home Living',detail:'Assigned Tenant Name'}]);
assert.deepEqual(highlightUi.modelValueSuggestions('', 'Assigned Tenant Name City@'),[{label:'Riyadh',detail:'City'}]);
highlightUi.engine.getLayoutSettings = () => ({autocompleteFields:['Year'],autocompleteMeasures:[],synonyms:{'Assigned Tenant Name':['tenant'],'Rent Measure':['rent']}});
assert.equal(highlightUi.fieldSuggestions('tenant',12,'tenant')[0].label,'tenant');
assert.equal(highlightUi.fieldSuggestions('rent',12,'rent')[0].label,'rent');
assert.deepEqual(highlightUi.fieldSuggestions('Home',12,'Home'),[]);
assert.deepEqual(highlightUi.modelValueSuggestions('', 'Assigned Tenant Name@'),[]);
assert(highlightUi.fieldSuggestions('Year',12,'Year').some(item=>item.label==='Year'));
assert(highlightUi.inputTerms('tenant').some(term=>term.kind==='field'),'hidden synonym can still be typed directly');
highlightUi.engine.getLayoutSettings = () => ({autocompleteFields:['Assigned Tenant Name','Year'],autocompleteMeasures:['Rent Measure']});
assert(highlightUi.modelValueSuggestions('Home', 'Assigned Tenant Name@Home').some(item=>item.label==='Home Living'),'rechecking restores values');
const inserted = GlobalQnaEngineForInsertion();
function GlobalQnaEngineForInsertion() { const {GlobalQnaEngine}=require('../.tmp/test/qna/engine');return Object.create(GlobalQnaEngine.prototype); }
const selectedQuestion=inserted.insertValueFilter('show Assigned Tenant Name@',25,'Assigned Tenant Name','Home Living');
assert.deepEqual(plan(selectedQuestion).filters[0].values,['Home Living']);
const calls = [], persistence = [];
let refreshes = 0;
const trial = new FieldParameterTrial({ prepend() {} }, { refreshHostData() { refreshes++; }, applyJsonFilter(...args) { calls.push(args); if (args[0] === null) trial.update(view(["Year"], [])); }, persistProperties(value) { persistence.push(value); } });
const inputs = elements.filter(e => e.tag === 'input');
inputs[0].value = config.table; inputs[1].value = config.column; inputs[2].value = config.options.join(', '); inputs[3].checked = true;
elements.find(e => e.tag === 'textarea').value = JSON.stringify(config.fields);
const view = (names, filters, values = [123], segment = false) => ({
  metadata: { ...(segment ? { segment: {} } : {}), objects: { parameterTrial: { filter: filters } } },
  categorical: {
    categories: names.map(displayName => ({ source: { displayName, roles: { fields: true }, sourceFieldParameters: [{}] }, values: values.map((_, i) => `${displayName}-${i}`) })),
    values: [{ source: { displayName: 'Rent Measure', roles: { measures: true }, format: '#,0.00' }, values }]
  }
});

const { discoverParameter, parameterMetadataColumns } = require('../.tmp/test/parameterDiscovery');
// Settings edits remain drafts until Save; closing restores the original configuration.
const settingsWrites = [];
const settingsTrial = new FieldParameterTrial({prepend(){}}, {persistProperties(value){settingsWrites.push(value)},applyJsonFilter(){}});
settingsTrial.hydrate({ metadata: { objects: { parameterTrial: { configuration: JSON.stringify(config) } } } });
const originalTable = settingsTrial.table.value;
settingsTrial.mountSettings({append(){}});
settingsTrial.table.value = 'Draft table'; settingsTrial.table.oninput();
settingsTrial.automatic.checked = !settingsTrial.automatic.checked; settingsTrial.automatic.onchange();
assert.equal(settingsWrites.length, 0, 'editing must not persist before Save');
settingsTrial.cancelSettings();
assert.equal(settingsTrial.table.value, originalTable, 'Cancel restores configuration');
settingsTrial.mountSettings({append(){}});
settingsTrial.mappings.value = '{bad json';
assert.equal(settingsTrial.saveSettings(), false, 'invalid settings keep dialog open');
assert.equal(settingsWrites.length, 0);
settingsTrial.cancelSettings();
settingsTrial.mountSettings({append(){}});
settingsTrial.automatic.checked = !settingsTrial.automatic.checked;
assert.equal(settingsTrial.saveSettings(), true);
assert.equal(settingsWrites.length, 1, 'Save persists once');
settingsTrial.cancelSettings();
settingsTrial.destroy();
const timeWrites = [];
const timeTrial = new FieldParameterTrial({prepend(){}}, {persistProperties(value){timeWrites.push(value)},applyJsonFilter(){}});
timeTrial.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify(indexedConfig)}}}});
assert.equal(timeTrial.timeSelectors.monthIndexField.value,'MonthIndex');
timeTrial.mountSettings({append(){}});
timeTrial.timeOrder.value='year-month'; timeTrial.timeYearStart.value='1950';
timeTrial.cancelSettings();
assert.equal(timeTrial.readTimeSetup().monthIndexBase,1,'MonthIndex uses the fixed convention');
assert.equal(timeTrial.timeOrder.value,'auto');
timeTrial.mountSettings({append(){}});
timeTrial.timeOrder.value='month-year';
timeTrial.timeSelectors.monthIndexField.value='';
assert.equal(timeTrial.saveSettings(),true);
assert.equal(JSON.parse(timeWrites[0].merge[0].properties.configuration).time.numericOrder,'month-year');
timeTrial.mountSettings({append(){}});
timeTrial.timeSelectors.monthIndexField.value='MonthIndex';
assert.equal(timeTrial.saveSettings(),true);
assert.equal(JSON.parse(timeWrites.at(-1).merge[0].properties.configuration).time.monthIndexField,'MonthIndex','Save persists the selected MonthIndex');
const indexSelections = timeTrial.selectionWithContext([{table:'Retail',column:'Tenant',value:'Home Living'}],indexedPlan('Rent Measure by City TTM ending Jun 26'));
assert.equal(indexSelections.length,12,'TTM selection contains 12 months, not hundreds of daily dates');
assert.deepEqual(indexSelections.map(row=>row.find(item=>item.column==='MonthIndex').value),Array.from({length:12},(_,i)=>24307+i));
assert(indexSelections.every(row=>row.some(item=>item.column==='Tenant' && item.value==='Home Living')),'period cross-filter retains selected tenant');
timeTrial.destroy();
const discoveredColumn = (name, parameter = 'Grouping') => ({ displayName: name, roles: {fields:true}, expr: {source:{entity:'Retail'},ref:name}, sourceFieldParameters:[{displayName:'Choose fields',expr:{source:{entity:parameter},ref:'Field label'}}] });
assert.deepEqual(discoverParameter([discoveredColumn('Tenant'),discoveredColumn('Year')]), {table:'Grouping',column:'Field label',options:['Tenant','Year']});
assert.equal(discoverParameter([discoveredColumn('Tenant'),discoveredColumn('Year','Other')]), undefined, 'multiple parameter sources must not be guessed');
assert.equal(discoverParameter([{displayName:'Year',sourceFieldParameters:[{displayName:'Parameter'}]}]), undefined);

assert.deepEqual(discoverParameter([{displayName:'Revenue',isMeasure:true,roles:{measures:true},sourceFieldParameters:[{displayName:'Label',expr:{source:{entity:'Measure Choice'},ref:'Label'}}]}],true),{table:'Measure Choice',column:'Label',options:['Revenue']});
const metadataMeasure = {displayName:'Revenue',isMeasure:true,sourceFieldParameters:[{displayName:'Label',expr:{source:{entity:'Measure Choice'},ref:'Label'}}]};
assert.deepEqual(discoverParameter(parameterMetadataColumns({metadata:{columns:[metadataMeasure]},table:{columns:[],rows:[]}}),true)?.options,['Revenue'],'discovery reads metadata even when flattened table omits its source');
assert.deepEqual(discoverParameter([{...metadataMeasure,displayName:'First measure',type:{text:true}}],true)?.options,[],'an aggregated parameter label is not a usable measure');
const autoSaves=[];
const discovered = new FieldParameterTrial({prepend(){}}, {persistProperties(value){autoSaves.push(value)},applyJsonFilter(){throw new Error('Discovery must not issue filter queries')}});
const discoveredView = names => ({metadata:{columns:[]},table:{columns:names.map(name=>discoveredColumn(name)),rows:[]}});
discovered.update(discoveredView(['Tenant','Year']));
assert.equal(discovered.automaticEnabled(),true);
assert.deepEqual(discovered.groupingOptions(),['Tenant','Year']);
discovered.update(discoveredView(['Tenant']));
assert.deepEqual(discovered.groupingOptions(),['Tenant','Year'],'narrow grouping must not erase learned fields');
assert.equal(autoSaves.length,1,'unchanged discovery must not loop persistProperties');
discovered.automatic.checked=false; discovered.automatic.onchange();
discovered.update(discoveredView(['City']));
assert.equal(discovered.automaticEnabled(),false,'discovery must preserve explicit disable');
assert.deepEqual(discovered.groupingOptions(),['Tenant','Year','City']);
discovered.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify(config)}}}});
discovered.update(discoveredView(['Other field']));
assert.deepEqual(discovered.groupingOptions(),config.options,'saved manual options must remain authoritative');
discovered.destroy();
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
(async () => {
  const sumController = Object.create(FieldParameterTrial.prototype);
  sumController.requestConfig = config;
  const sumView = {metadata:{columns:[]},table:{
    columns:[{displayName:'City',roles:{fields:true}},{displayName:'Rent Measure',roles:{measures:true},format:'0'}],
    rows:[['Electronics',182543],['Home and Lifestyle',109228],['Fashion',98754],['Food and Beverage',70324]],totals:[null,null]}};
  const sumPlan={groups:['City'],measures:['Rent Measure'],filters:[],summary:[],presentation:'table'};
  assert.equal(sumController.answer(sumView,sumPlan).table.modelTotals[1],'460,849');
  assert.equal(sumView.table.totals[1],null,'total fallback must not mutate the host response or cache');
  sumController.requestConfig = config;
  assert.equal(sumController.answer(sumView,sumPlan).table.modelTotals[1],'460,849','V3 fallback works without configuration');
  sumController.requestConfig = config;
  assert.equal(sumController.answer({...sumView,table:{...sumView.table,totals:[null,123]}},sumPlan).table.modelTotals[1],'123','host total is authoritative');
  assert.equal(sumController.answer({...sumView,metadata:{columns:[],segment:{}}},sumPlan).table.modelTotals[1],'—','partial data cannot produce a summed total');
  const safeScalar = Object.create(FieldParameterTrial.prototype);
  const safeConfig = {...config, options:['LineItem'], fields:[{name:'LineItem',table:'Ledger',column:'LineItem'}]};
  const scalarCalls = [];
  safeScalar.requestBase = async query => {
    scalarCalls.push(query);
    return {text:'',table:{columns:['LineItem','Amount'],rows:[['Revenue','100']],rowIndices:[[]],modelRawRows:[[null,100]],modelRawTotals:[null,null],modelFormats:[undefined,'0']}};
  };
  const denominatorFilter = {target:{table:'Ledger',column:'LineItem'},operator:'In',values:['Revenue']};
  const denominator = await safeScalar.requestScalarWithGrouping({groups:[],measures:['Amount'],filters:[denominatorFilter],summary:[]},safeConfig,false);
  assert.deepEqual(scalarCalls[0].groups,['LineItem'],'scalar requests retain a nonempty field parameter');
  assert.deepEqual(scalarCalls[0].filters,[denominatorFilter],'revenue-member filter is preserved');
  assert.deepEqual(denominator.table.modelRawRows,[[100]],'fixed revenue member supplies the denominator even without aggregate metadata');
  const unavailableTotal = await safeScalar.requestScalarWithGrouping({groups:[],measures:['Amount'],filters:[],summary:[]},safeConfig,false);
  assert.deepEqual(unavailableTotal.table.rows,[['—']],'one arbitrary visible group is not an overall model total');
  const {revenueRequest}=require('../.tmp/test/revenue');
  const revenueLoads=[];
  const revenuePlan={groups:['LineItem'],measures:['Amount'],filters:[],summary:[],presentation:'table'};
  const revenueConfig={...config,fields:[{name:'LineItem',table:'Ledger',column:'LineItem'}],revenue:{field:'LineItem',value:'Revenue'}};
  let revenueView;
  await revenueRequest(revenuePlan,revenueConfig,async query=>{
    revenueLoads.push(query);
    const denominator=query.filters.length>0;
    return {text:'',table:query.groups.length
      ? {columns:['LineItem','Amount'],rows:[['Cost','20'],['Other','30']],rowIndices:[[],[]],modelRawRows:[[null,20],[null,30]],modelRawTotals:[null,null]}
      : {columns:['Amount'],rows:[[String(denominator?100:40)]],rowIndices:[[]],modelRawRows:[[denominator?100:40]],modelRawTotals:[null]}};
  },view=>{revenueView=view;return {text:''};});
  assert.equal(revenueLoads.length,3,'revenue requests an ungrouped numerator only when aggregate metadata is missing');
  assert.deepEqual(revenueView.table.rows,[['Cost',0.2],['Other',0.3]]);
  assert.deepEqual(revenueView.table.totals,[null,0.4],'revenue grand total uses the scalar numerator, not the sum of displayed rows');
  const accountingFields = ['LineItem','Details','GL Description','Year','Property'].map(name=>({name,table:'Ledger',column:name}));
  const accountingConfig = {...config,fields:accountingFields,revenue:{field:'LineItem',value:'Total Net Revenue'}};
  const {revenueChildFields} = require('../.tmp/test/revenue');
  assert.deepEqual(revenueChildFields(accountingConfig.revenue,accountingFields.map(f=>f.name)),['Details','GL Description']);
  assert.deepEqual(revenueChildFields({...accountingConfig.revenue,childFields:[]},accountingFields.map(f=>f.name)),[],'an explicit override can disable the accounting defaults');
  assert.deepEqual(revenueChildFields({field:'Category',childFields:['Account']},['Category','Account','Year']),['Account'],'custom hierarchy names are supported');
  const yearFilter = {target:{table:'Ledger',column:'Year'},operator:'In',values:[2026]};
  const propertyFilter = {target:{table:'Ledger',column:'Property'},operator:'In',values:['Mall A']};
  for (const [item,details] of [
    ['Rental Revenue',[['Rental Revenue',-380407050]]],
    ['FM',[['FM Contracts',11405439],['Housekeeping',10808788]]],
    ['Total Net Revenue',[['Landlord Incentive',15070479],['Rental Revenue',-380407050]]]
  ]) {
    const filters = [yearFilter,propertyFilter,{target:{table:'Ledger',column:'LineItem'},operator:'In',values:[item]},
      {target:{table:'Ledger',column:'Details'},operator:'In',values:details.map(row=>row[0])}];
    const request = {groups:['Details','Year'],measures:['Amount'],filters,summary:[],presentation:'table'};
    let calls = 0, rendered;
    await revenueRequest(request,accountingConfig,async query=>{
      calls++;
      if(calls===1) {
        assert.deepEqual(query.groups,['Details','Year']);
        assert.deepEqual(query.filters,filters);
        return {text:'',table:{columns:['Details','Year','Amount'],rows:details.map(([name,amount])=>[name,'2026',String(amount)]),
          rowIndices:details.map(()=>[]),modelRawRows:details.map(([,amount])=>[null,2026,amount]),
          modelRawTotals:[null,null,details.reduce((sum,row)=>sum+row[1],0)]}};
      }
      assert.deepEqual(query.groups,['Year'],'child grouping is excluded while the period is retained');
      assert.deepEqual(query.filters.slice(0,2),[yearFilter,propertyFilter],'unrelated filters survive unchanged');
      assert.equal(query.filters.length,3,'both accounting parent and child restrictions are replaced');
      assert.deepEqual(query.filters[2].values,['Total Net Revenue']);
      return {text:'',table:{columns:['Year','Amount'],rows:[['2026','-518511038']],rowIndices:[[]],
        modelRawRows:[[2026,-518511038]],modelRawTotals:[null,-518511038]}};
    },view=>{rendered=view;return {text:''};});
    assert.equal(calls,2,'hierarchy shares one denominator request across child rows');
    details.forEach((row,index)=>assert.equal(rendered.table.rows[index][2],row[1]/-518511038));
    assert.equal(rendered.table.totals[2],details.reduce((sum,row)=>sum+row[1],0)/-518511038);
    if(details.length===1) assert.equal(rendered.table.rows[0][2],rendered.table.totals[2],'single detail and total use the same denominator');
  }
  const mixedTuple = {target:[{table:'Ledger',column:'Details'},{table:'Ledger',column:'Year'}],operator:'In',
    values:[[{value:'FM Contracts'},{value:2026}],[{value:'Security'},{value:2026}]]};
  const tupleBefore = JSON.stringify(mixedTuple);
  let tupleCalls=0;
  await revenueRequest({groups:['Year'],measures:['Amount'],filters:[mixedTuple,propertyFilter],summary:[]},accountingConfig,async query=>{
    if(++tupleCalls===2) {
      assert.deepEqual(query.filters[0].target,[{table:'Ledger',column:'Year'}]);
      assert.deepEqual(query.filters[0].values,[[{value:2026}]],'removing accounting tuple components retains and deduplicates the period restriction');
      assert.deepEqual(query.filters[1],propertyFilter);
    }
    return {text:'',table:{columns:['Year','Amount'],rows:[['2026','100']],rowIndices:[[]],modelRawRows:[[2026,100]],modelRawTotals:[null,100]}};
  },()=>({text:''}));
  assert.equal(JSON.stringify(mixedTuple),tupleBefore,'denominator changes cannot mutate numerator filters');
  const fieldOnly = new FieldParameterTrial({prepend(){}}, {applyJsonFilter(){},persistProperties(){}});
  fieldOnly.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify(selectiveConfig)}}}});
  fieldOnly.defaultMeasure=()=> 'Rent Measure';
  fieldOnly.update({metadata:{columns:[]},table:{columns:[{displayName:'Assigned Tenant Name',queryName:'Retail.Tenant',roles:{fields:true},sourceFieldParameters:[{}]}],rows:[['Tech Hub'],['Bean Street']]}});
  assert.equal(fieldOnly.readConfig().measureParameter,undefined,'field-only mapping ignores previously saved measure selector');
  assert.equal(fieldOnly.readConfig().defaultMeasure,undefined);
  assert.deepEqual(fieldOnly.measureOptions(),[]);
  const pureListPlan=planParameterQuestion('list Assigned Tenant Name',fieldOnly.readConfig(),[]);
  assert.equal(parameterFilters(pureListPlan,fieldOnly.readConfig()).length,1,'only the field parameter is filtered');
  assert.deepEqual(fieldOnly.answer(fieldOnly.latest,pureListPlan).table.rows,[['Bean Street'],['Tech Hub']]);
  fieldOnly.destroy();
  // Cancel and the overall timeout must settle the UI even if a host promise never settles.
  {
    const createElement = document.createElement, realSetTimeout = global.setTimeout, realClearTimeout = global.clearTimeout;
    let deadlineCallback;
    const nodes = [];
    document.createElement = tag => {
      const node = {tag,children:[],listeners:{},classList:{add(){}},setAttribute(){},append(...children){this.children.push(...children)},addEventListener(name,fn){this.listeners[name]=fn},remove(){this.removed=true}};
      nodes.push(node); return node;
    };
    global.setTimeout = (callback, delay) => { if(delay===60000) deadlineCallback=callback; return 123; };
    global.clearTimeout = () => {};
    try {
      for (const timedOut of [false,true]) {
        const ui=Object.create(GlobalQnaUi.prototype), failures=[];
        let finish;
        Object.assign(ui,{questionRequest:0,input:{value:'slow question'},hasConversation:true,messages:{append(){},appendChild(){},scrollHeight:0},engine:{getLayoutSettings:()=>({})},automaticGroupingEnabled:()=>true,prepareQuestion:()=>new Promise(resolve=>{finish=resolve}),cancelQuestion:()=>{throw new Error('host cancellation failed')},clearQuestionSelection(){},renderInputHighlight(){},closeSuggestions(){},displayQuestion:text=>text,addBubble(){},showRequestFailure:message=>failures.push(message),render(){throw new Error('late answer must not render')}});
        const pending=ui.submit();
        if(timedOut) deadlineCallback();
        else nodes.filter(node=>node.textContent==='Cancel').at(-1).listeners.click();
        await pending;
        assert.equal(ui.pendingQuestion,undefined);
        assert.equal(ui.loadingStage,undefined);
        assert.equal(failures.length,1);
        assert.match(failures[0],timedOut ? /60 seconds/ : /cancelled/);
        assert.ok(nodes.filter(node=>node.tag==='div').at(-1).removed);
        finish({text:'late'}); await flush();
        assert.equal(failures.length,1);
      }
    } finally { document.createElement=createElement; global.setTimeout=realSetTimeout; global.clearTimeout=realClearTimeout; }
  }
  // Cold sessions load enabled field dictionaries before an answer is requested.
  const suggestionTrial = new FieldParameterTrial({prepend(){}}, {applyJsonFilter(){},persistProperties(){}});
  suggestionTrial.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify(config)}}}});
  suggestionTrial.latest = view(['City'], []);
  const dictionaryRequests = [];
  let dictionaryUpdates = 0, restorations = 0;
  suggestionTrial.onSuggestionValuesChanged = () => dictionaryUpdates++;
  suggestionTrial.request = async request => {
    dictionaryRequests.push(request);
    return {table:{columns:request.groups,rows:[[request.groups[0] + ' value']],rowIndices:[[]]}};
  };
  suggestionTrial.clearPendingFilters = () => {
    restorations++;
    const pending = suggestionTrial.pending;
    suggestionTrial.pending = undefined;
    clearTimeout(suggestionTrial.timer);
    pending.resolve({});
  };
  assert.equal(dictionaryRequests.length,0,'hydration must not issue background queries');
  await suggestionTrial.loadSuggestionValues(['City','Assigned Tenant Name']);
  assert.deepEqual(dictionaryRequests.map(request=>request.groups),[['City'],['Assigned Tenant Name']]);
  assert.ok(dictionaryRequests.every(request=>request.listOnly && request.measures.length===0));
  assert.ok(suggestionTrial.valueOptions().some(value=>value.detail==='Assigned Tenant Name' && value.label==='Assigned Tenant Name value'));
  assert.equal(dictionaryUpdates,2);
  assert.equal(restorations,1);
  assert.equal(suggestionTrial.loadingSuggestionValues,false);
  await suggestionTrial.loadSuggestionValues(['City','Assigned Tenant Name']);
  assert.equal(dictionaryRequests.length,2,'loaded dictionaries are reused for the session');
  let finishDictionary;
  suggestionTrial.request = () => new Promise(resolve=>{finishDictionary=resolve;});
  const interrupted = suggestionTrial.loadSuggestionValues(['Year']);
  suggestionTrial.cancelQuestion();
  finishDictionary({table:{rows:[['2026']]}});
  await interrupted;
  assert.equal(restorations,1,'cancelled warmup must not overwrite a new question with old filters');
  assert.equal(suggestionTrial.suggestionFieldsLoaded.has('Year'),false);
  assert.equal(suggestionTrial.dataRequestsStopped,true,'cancellation stops paging and ignores late updates');
  suggestionTrial.dataRequestsStopped=false; // A new request resumes data delivery.
  suggestionTrial.update({metadata:{},table:{columns:[{displayName:'City',queryName:'Retail.City',roles:{fields:true}}],rows:[['New context city']]}});
  assert.equal(suggestionTrial.suggestionFieldsLoaded.size,0,'report-context changes invalidate loaded dictionaries');
  assert.ok(suggestionTrial.valueOptions().some(value=>value.label==='New context city'),'ordinary bound columns supply values without sourceFieldParameters metadata');
  assert.ok(!suggestionTrial.valueOptions().some(value=>value.label==='Assigned Tenant Name value'),'old learned values are cleared with the report context');
  suggestionTrial.destroy();
  trial.update(view(['City'], []));
  elements.find(e => e.textContent === 'Save configuration').onclick();
  assert.deepEqual(JSON.parse(persistence[0].merge[0].properties.configuration), { ...config, autoDetected: false });
  const restored = new FieldParameterTrial({ prepend() {} }, { applyJsonFilter() {} });
  restored.hydrate({ metadata: { objects: { parameterTrial: { configuration: JSON.stringify(config) } } } });
  assert.equal(restored.automaticEnabled(), true); restored.destroy();
  const late = new FieldParameterTrial({ prepend() {} }, { applyJsonFilter() {} });
  late.hydrate({ metadata: { objects: {} } });
  assert.equal(late.automaticEnabled(), false, 'an incomplete first update must not fabricate configuration');
  late.hydrate({ metadata: { objects: { parameterTrial: { configuration: JSON.stringify(config) } } } });
  assert.equal(late.automaticEnabled(), true, 'a later update must hydrate persisted configuration'); late.destroy();

  const comparisonChart = new FieldParameterTrial({prepend(){}},{applyJsonFilter(){}});
  comparisonChart.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify(config)}}}});
  comparisonChart.measures=['Rent Measure'];
  comparisonChart.request=async requested => {
    const year=requested.filters[0].conditions[0].value.slice(0,4);
    const value=year==='2024'?12:34;
    const selection=[[{table:'Calendar',column:'Year',value:Number(year)}]];
    if (!requested.groups.length) return {text:'',table:{columns:['Rent Measure'],rows:[[String(value)]],rowIndices:[[]]}};
    assert.equal(requested.presentation,'line','comparison must preserve requested chart');
    return {modelQuery:true,text:'',table:{columns:['City','Rent Measure'],rows:[['Riyadh',String(value)]],rowIndices:[[]],modelRowSelections:[selection],modelEditor:{rows:['City'],columns:[],measures:['Rent Measure'],filters:[{field:'MonthIndex',values:[String(Number(year)*12+6)]},{field:'Tenant',values:['Tech Hub']},{field:'Tenant',values:['Tech Hub']}]}},
      chart:{type:'line',title:'',labels:['Riyadh'],values:[value],valueLabels:[String(value)],rowIndices:[[0]],modelRowSelections:[selection]}};
  };
  const chartComparison=await comparisonChart.prepareQuestion('June 2024 vs June 2025 City Rent Measure as a line chart');
  assert.deepEqual(chartComparison.chart.values,[12,34]);
  assert.deepEqual(chartComparison.table.modelEditor.filters,[{field:'Tenant',values:['Tech Hub']}],'comparison editor retains shared filters once, never the first period MonthIndex');
  assert.deepEqual(chartComparison.chart.labels,['Riyadh · June 2024','Riyadh · June 2025']);
  assert.deepEqual(chartComparison.chart.modelRowSelections.map(rows=>rows[0][0].value),[2024,2025],'each plotted period preserves its own filter');
  const variantComparison = await comparisonChart.prepareQuestion('24 June vs 06/25 City Rent Measure as a line chart');
  assert.deepEqual(variantComparison.chart.values,[12,34]);
  assert.deepEqual(variantComparison.table.modelPeriods.map(item=>item.period),['June 2024','June 2025'],'variant comparisons provide canonical YTD/TTM anchors');
  comparisonChart.destroy();
  const singleMonth = new FieldParameterTrial({prepend(){}},{applyJsonFilter(){}});
  singleMonth.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify(indexedConfig)}}}});
  singleMonth.measures=['Rent Measure'];
  singleMonth.request=async requested => ({modelQuery:true,text:'',table:{columns:[...requested.groups,...requested.measures],rows:[],rowIndices:[]}});
  for (const month of ['06/2025','2025 Jun','June 25']) {
    const answer = await singleMonth.prepareQuestion(`show Rent Measure City for ${month}`);
    const anchor = answer.table.modelPeriods[0];
    assert.equal(anchor.period,'June 2025');
    assert.equal(anchor.sourceColumn,1);
    const expanded = planParameterQuestion(`${anchor.question} TTM ending ${anchor.period} as a table`,indexedConfig,['Rent Measure']);
    assert.equal(expanded.filters[0].values.length,12,'period action replaces the single-month restriction');
  }
  singleMonth.destroy();
  const yearlyPeriod = new FieldParameterTrial({prepend(){}},{applyJsonFilter(){}});
  yearlyPeriod.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify(indexedConfig)}}}});
  yearlyPeriod.measures=['Rent Measure'];
  const yearlyRequests=[];
  yearlyPeriod.request=async requested => {
    yearlyRequests.push(requested);
    if (requested.listOnly) return {table:{columns:['Year'],rows:[['2026'],['2024'],['2025']],rowIndices:[[],[],[]]}};
    return {table:{columns:[...requested.groups,...requested.measures],rows:[],rowIndices:[],modelTotals:['Grand Total','123'],modelRawTotals:[null,123],modelFormats:[undefined,'#,0']}};
  };
  const yearlyAnswer=await yearlyPeriod.prepareQuestion('May TTM Home Living Rent Measure');
  assert.deepEqual(yearlyAnswer.table.columns,['Period','Rent Measure']);
  assert.deepEqual(yearlyAnswer.table.rows,[['May 2024','123'],['May 2025','123'],['May 2026','123']]);
  assert.equal(yearlyRequests.length,4,'one year discovery and one bounded calculation per year');
  for (const [offset,requested] of yearlyRequests.slice(1).entries()) {
    const indexFilter=requested.filters.find(filter=>filter.target.column==='MonthIndex');
    assert.equal(indexFilter.values.length,12);
    assert.equal(indexFilter.values.at(-1),(2024+offset)*12+5);
    assert(requested.filters.some(filter=>filter.target.column==='Tenant' && filter.values.includes('Home Living')));
  }
  assert.equal(yearlyAnswer.table.modelRowSelections[0].length,12);
  assert.equal(yearlyAnswer.chart,undefined,'no chart without an explicit chart request');
  const yearlyBars=await yearlyPeriod.prepareQuestion('May TTM Home Living Rent Measure IN as a bar chart');
  assert.equal(yearlyBars.chart.type,'bar');
  assert.deepEqual(yearlyBars.chart.values,[123,123,123]);
  assert.equal(yearlyBars.chart.modelRowSelections[0].length,12);
  assert.match(yearlyBars.chart.periodDetails[0],/June 2023 – May 2024/);
  assert.deepEqual(yearlyBars.chart.labels,['May 2024','May 2025','May 2026']);
  const yearlyTable=await yearlyPeriod.prepareQuestion('May TTM Home Living Rent Measure as a table');
  assert.equal(yearlyTable.chart,undefined);
  yearlyPeriod.defaultMeasure=()=> 'Rent Measure';
  for (const [wording,month,kind] of [
    ['May YTD',5,'YTD'],['YTD may',5,'YTD'],['ytd MAY',5,'YTD'],
    ['Jun YTD',6,'YTD'],['YTD June',6,'YTD'],['June year to date',6,'YTD'],
    ['TTM jun',6,'TTM'],['ttm June',6,'TTM'],['Jun TTM',6,'TTM'],['trailing 12 months June',6,'TTM']
  ]) {
    yearlyRequests.length=0;
    const answer=await yearlyPeriod.prepareQuestion(wording);
    assert.equal(answer.table.rows.length,3,wording);
    assert.equal(answer.chart,undefined,wording + ' defaults to a table');
    assert.deepEqual(answer.table.columns,['Period','Rent Measure']);
    assert.deepEqual(answer.table.rows.map(row=>row[0]),[2024,2025,2026].map(year=>`${month===5?'May':'June'} ${year}`));
    for (const [offset,request] of yearlyRequests.slice(1).entries()) {
      const values=request.filters.find(filter=>filter.target.column==='MonthIndex').values;
      const end=(2024+offset)*12+month;
      assert.deepEqual(values,Array.from({length:kind==='YTD'?month:12},(_,i)=>end-(kind==='YTD'?month:12)+1+i),wording);
    }
  }
  yearlyPeriod.destroy();
  const coveragePeriod = new FieldParameterTrial({prepend(){}},{applyJsonFilter(){}});
  coveragePeriod.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify({...indexedConfig,options:[...indexedConfig.options,'MonthIndex']})}}}});
  coveragePeriod.measures=['Rent Measure'];
  coveragePeriod.request=async request => request.listOnly
    ? {table:{columns:['Year','MonthIndex'],rows:Array.from({length:5},(_,i)=>['2024',String(24289+i)]),rowIndices:[]}}
    : {table:{columns:['Year','Rent Measure'],rows:[],rowIndices:[],modelTotals:['Grand Total','100'],modelRawTotals:[null,100]}};
  const partialPeriod=await coveragePeriod.prepareQuestion('May TTM Home Living Rent Measure as a bar chart');
  assert.match(partialPeriod.chart.subtitle,/Partial period/);
  assert.match(partialPeriod.chart.periodDetails[0],/5\/12 months available/);
  coveragePeriod.destroy();
  const monthlyTrial=new FieldParameterTrial({prepend(){}},{applyJsonFilter(){}});
  monthlyTrial.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify({...indexedConfig,options:[...indexedConfig.options,'MonthIndex']})}}}});
  monthlyTrial.measures=['Rent Measure']; monthlyTrial.additiveMeasures=()=>['Rent Measure'];
  let monthlyCalls=0;
  monthlyTrial.request=async request=>{
    monthlyCalls++;
    assert.deepEqual(request.groups,['MonthIndex']);
    assert(request.filters.some(filter=>filter.target.column==='Tenant' && filter.values.includes('Home Living')));
    const months=Array.from({length:36},(_,i)=>24289+i);
    return {table:{columns:['MonthIndex','Rent Measure'],rows:months.map(month=>[String(month),'10']),rowIndices:months.map(()=>[]),modelRawRows:months.map(month=>[month,10]),modelFormats:[undefined,'#,0']}};
  };
  const monthlyTtm=await monthlyTrial.prepareQuestion('May TTM Home Living Rent Measure');
  assert.equal(monthlyCalls,1,'all years use one monthly request, without year discovery');
  assert.equal(monthlyTtm.chart,undefined);
  assert.deepEqual(monthlyTtm.table.rows.map(row=>row[1]),['50','120','120']);
  assert.equal(monthlyTtm.table.modelRowSelections[1].length,12);
  monthlyCalls=0;
  const monthlyYtd=await monthlyTrial.prepareQuestion('YTD May Home Living Rent Measure');
  assert.equal(monthlyCalls,1);
  assert.equal(monthlyYtd.chart,undefined);
  assert.deepEqual(monthlyYtd.table.rows.map(row=>row[1]),['50','50','50']);
  monthlyTrial.destroy();
  const {monthlyPeriod}=require('../.tmp/test/monthlyPeriods');
  const blankMonthly=monthlyPeriod({columns:['MonthIndex','M'],rows:[['24289','—'],['24290','0']],rowIndices:[[],[]],modelRawRows:[[24289,null],[24290,0]]},0,['M'],24289,24289,true);
  assert.equal(blankMonthly.table.modelRawTotals[1],null,'missing monthly data stays blank, not zero');
  const groupedMonthly=monthlyPeriod({columns:['Tenant','MonthIndex','M'],rows:[['A','24289','2'],['B','24289','8'],['A','24290','3']],rowIndices:[[],[],[]],modelRawRows:[[null,24289,2],[null,24289,8],[null,24290,3]]},1,['M'],24289,24290,false);
  assert.deepEqual(groupedMonthly.table.rows,[['A','5'],['B','8']],'monthly aggregation keeps categories separate');

  const revenueIsolation = new FieldParameterTrial({prepend(){}},{applyJsonFilter(){},persistProperties(){}});
  revenueIsolation.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify(config)}}}});
  revenueIsolation.measures=['Rent Measure']; revenueIsolation.hasParameterContext=true;
  const ordinaryPlans=[]; revenueIsolation.request=async(plan)=>{ordinaryPlans.push(plan);return {text:'fixture'};};
  await revenueIsolation.prepareQuestion('Rent Measure by City',true);
  revenueIsolation.revenue=()=>({field:'City',value:'Riyadh'});
  await revenueIsolation.prepareQuestion('Rent Measure by City',true);
  assert.deepEqual(ordinaryPlans[1],ordinaryPlans[0],'configuring revenue must not change an ordinary question');
  revenueIsolation.destroy();
  const sparseTrial = new FieldParameterTrial({prepend(){}},{applyJsonFilter(){},persistProperties(){}});
  sparseTrial.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify(config)}}}});
  const sparseMatrix={metadata:{columns:[]},matrix:{rows:{levels:[{sources:[discoveredColumn('City')]}],root:{children:[{level:0,value:'Riyadh',values:{0:{value:42}}}],values:{0:{value:42}}}},columns:{levels:[],root:{}},valueSources:[{displayName:'Rent Measure',type:{numeric:true}}]}};
  const sparseChosen=sparseTrial.selectDataView([{metadata:{columns:[]},table:{columns:[],rows:[]}},sparseMatrix]);
  assert.equal(sparseChosen.table.columns.length,2,'resolved matrix wins over an empty table mapping');
  sparseTrial.update(sparseChosen);
  assert.deepEqual(sparseTrial.measureOptions(),['Rent Measure'],'matrix valueSources are measures without role flags');
  sparseTrial.update({metadata:{columns:[]}});
  assert.deepEqual(sparseTrial.measureOptions(),['Rent Measure'],'an empty transient update must not erase measure discovery');
  sparseTrial.destroy();
  const {categoricalAsTable,buildContext}=require('../.tmp/test/dataAdapter');
  assert.deepEqual(categoricalAsTable({values:[{source:{displayName:'Amount'},values:[12,18],subtotal:25}]}).totals,[25],'legacy host subtotal must be read without summing cells');
  assert.deepEqual(categoricalAsTable({values:[{source:{displayName:'Amount',aggregates:{subtotal:0}},values:[12,18],subtotal:25}]}).totals,[0],'current aggregate metadata including zero takes precedence');
  assert.deepEqual(buildContext(categoricalAsTable({values:[{source:{displayName:'Amount'},values:[42]}]})).measures.map(m=>m.name),['Amount']);
  assert.deepEqual(buildContext({columns:[{displayName:'Amount',isMeasure:true}],rows:[[42]]}).measures.map(m=>m.name),['Amount']);
  const directTrial = new FieldParameterTrial({prepend(){}},{applyJsonFilter(){},persistProperties(){}});
  directTrial.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify(selectiveConfig)}}}});
  const directView={metadata:{columns:[]},table:{columns:[discoveredColumn('City'),{displayName:'Rent Measure',isMeasure:true,roles:{measures:true}}],rows:[['Riyadh',42]],totals:[null,42]}};
  directTrial.update(directView);
  assert.equal(directTrial.readConfig().measureParameter,undefined,'stale selector configuration must not override a directly dropped measure');
  assert.deepEqual(directTrial.measureOptions(),['Rent Measure']);
  directTrial.requestConfig=directTrial.readConfig();
  assert.equal(directTrial.matches(directView,{groups:['City'],measures:['Rent Measure'],filters:[],summary:[]},parameterFilters({groups:['City'],measures:['Rent Measure'],filters:[],summary:[]},directTrial.readConfig())),true);
  const startupCalls=[];
  directTrial.startup=()=>({enabled:true,fields:['City'],measure:'Rent Measure'});
  directTrial.requestBase=async(plan)=>{startupCalls.push(plan);return {text:''};};
  directTrial.applyStartup(); directTrial.runStartup(); await flush();
  assert.equal(startupCalls.length,1,'startup runs once, not on each presentation update');
  assert.deepEqual(startupCalls[0].groups,['City']); assert.deepEqual(startupCalls[0].measures,['Rent Measure']);
  directTrial.startup=()=>({enabled:true,fields:['City','Year','Assigned Tenant Name','Extra'],measure:'Rent Measure'});
  directTrial.applyStartup(); assert.equal(startupCalls.length,1,'invalid startup must not issue a large query');
  directTrial.destroy();
  const mixedConfig={...selectiveConfig,directMeasures:['Fixed Measure']};
  const mixedPlan={groups:['City'],measures:['Fixed Measure','Revenue'],filters:[],summary:[]};
  assert.deepEqual(parameterFilters(mixedPlan,mixedConfig)[1].values,['Revenue'],'only dynamic measures go to the measure parameter filter');
  const selective = new FieldParameterTrial({prepend(){}},{applyJsonFilter(){},persistProperties(){}});
  selective.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify(selectiveConfig)}}}});
  selective.requestConfig=selectiveConfig;
  const measureView=names=>({metadata:{columns:[]},table:{columns:[{displayName:'City',roles:{fields:true},sourceFieldParameters:[{}]},...names.map(displayName=>({displayName,roles:{measures:true},sourceFieldParameters:[{}]}))],rows:[]}});
  assert.equal(selective.matches(measureView(['Revenue']),selectivePlan,parameterFilters(selectivePlan,selectiveConfig)),true);
  assert.equal(selective.matches(measureView(['Rent Measure','Revenue','Profit']),selectivePlan,parameterFilters(selectivePlan,selectiveConfig)),false,'an all-measures response must not be accepted for selective queries');
  selective.update(measureView(['Revenue']));
  assert.deepEqual(selective.measureOptions(),['Rent Measure','Revenue','Profit'],'measure catalog survives narrowed query results');
  selective.latest = undefined; // Simulate an initial unresolved measure binding, not a reusable completed result.
  const missingMeasure = selective.prepareQuestion('Revenue by City', true).then(()=>{throw new Error('Should reject missing measure');}, error=>error.message);
  selective.update(measureView([]));
  assert.match(await missingMeasure,/no measure values.*explicit DAX measures/,'matching groups without values must fail immediately rather than timeout');
  selective.destroy();
  const clearTimers = []; let clearRefreshes = 0; const clearCalls = [];
  const clearRecovery = new FieldParameterTrial({prepend(){}}, {applyJsonFilter(...args){clearCalls.push(args)},refreshHostData(){clearRefreshes++}});
  clearRecovery.pending = {plan:{},filters:[],resolve(){},reject(){}};
  const originalTimer = global.setTimeout;
  global.setTimeout = callback => { clearTimers.push(callback); return -1; };
  try { clearRecovery.clearPendingFilters(); } finally { global.setTimeout = originalTimer; }
  assert.equal(clearCalls.length, 1);
  assert.equal(clearCalls[0][0], null);
  clearTimers[0]();
  assert.equal(clearRefreshes, 1, 'missing clear acknowledgement requests a host refresh');
  assert.equal(clearCalls.length, 1, 'recovery never merges before clear acknowledgement');
  clearRecovery.destroy(); clearTimers[0]();
  assert.equal(clearRefreshes, 1, 'cancelled clear cannot refresh');
  const dateController = new FieldParameterTrial({prepend(){}}, {persistProperties(){},applyJsonFilter(){}});
  const dateFilter = { target:{table:'T',column:'Date'}, conditions:[{operator:'GreaterThanOrEqual',value:'2024-01-01T00:00:00.000Z'},{operator:'LessThan',value:'2025-01-01T00:00:00.000Z'}] };
  const datePlan = {groups:['Tenant'],measures:['Rent Measure'],filters:[dateFilter],summary:[]};
  const datesA = dateController.selectionWithContext([{table:'T',column:'Tenant',value:'A'}],datePlan);
  const expanded = dateController.expandedDateValues.get(dateFilter);
  const datesB = dateController.selectionWithContext([{table:'T',column:'Tenant',value:'B'}],datePlan);
  assert.equal(datesA.length,366,'leap-year range is unchanged');
  assert.equal(datesB.length,366);
  assert.equal(dateController.expandedDateValues.get(dateFilter),expanded,'date expansion is shared across rows');
  assert.equal(datesB[0][0].value,'B','tenant context remains separate');
  dateController.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify(config)}}}});
  dateController.executeQuestion = async () => ({text:'Period',table:{columns:['Tenant','Rent Measure'],rows:[['A','10']],rowIndices:[[]],modelRowSelections:[datesA],modelCellSelections:[[datesA,datesA]]}});
  await dateController.prepareQuestion('period');
  const cachedPeriod = await dateController.prepareQuestion('period');
  assert.equal(cachedPeriod.table.modelCellSelections[0][1],cachedPeriod.table.modelRowSelections[0],'cache clone retains shared selection arrays');
  cachedPeriod.table.rows[0][1]='changed';
  assert.equal((await dateController.prepareQuestion('period')).table.rows[0][1],'10','cached answer remains isolated from edits');
  dateController.destroy();
  const selectionEcho = new FieldParameterTrial({prepend(){}},{persistProperties(){},applyJsonFilter(){}});
  selectionEcho.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify(config)}}}});
  const outgoingYtd = {target:{table:'Retail',column:'Date'},logicalOperator:'And',conditions:[{operator:'GreaterThanOrEqual',value:'2025-01-01'},{operator:'LessThan',value:'2025-07-01'}]};
  const externalDate = {...outgoingYtd,conditions:[{operator:'LessThan',value:'2026-01-01'}]};
  const echoView = view(['Year'],[]);
  echoView.metadata.objects.general = {filter:[outgoingYtd]};
  selectionEcho.update(echoView,[outgoingYtd,externalDate]);
  assert.deepEqual(selectionEcho.latestFilters,[externalDate],'outgoing selection is not an incoming query acknowledgement; external filters remain');
  echoView.metadata.objects.parameterTrial.filter = [outgoingYtd];
  selectionEcho.update(echoView,[outgoingYtd]);
  assert.deepEqual(selectionEcho.latestFilters,[outgoingYtd],'owned query filter is retained even when identical to selection');
  selectionEcho.destroy();
  const recoveryCalls=[]; const scheduled=[];
  const recovery = new FieldParameterTrial({prepend(){}},{applyJsonFilter(...args){recoveryCalls.push(args)},refreshHostData(){},persistProperties(){}});
  recovery.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify(config)}}}});
  const realTimeout=global.setTimeout;
  global.setTimeout=(callback,delay)=>{scheduled.push({callback,delay});return -1;};
  let recovering;
  try { recovering=recovery.request({groups:['Year'],measures:['Rent Measure'],filters:[],summary:[]},config); }
  finally {global.setTimeout=realTimeout;}
  scheduled.find(item=>item.delay===4000).callback();
  assert.equal(recoveryCalls.at(-1)[0],null,'no host response retries by clearing owned query filters');
  assert.equal(recovery.pending.clearing,true,'retry must await clear acknowledgement');
  recovery.update(view(['City'],[]));
  assert.equal(recoveryCalls.at(-1)[0][0].values[0],'Year','requested grouping reapplied after clear');
  recovery.update(view(['Year'],[],[45]));
  assert.equal((await recovering).table.rows[0][1],'45.00');
  const callsAfterRecovery=recoveryCalls.length;
  scheduled.find(item=>item.delay===4000).callback();
  assert.equal(recoveryCalls.length,callsAfterRecovery,'a completed request cannot be retried again');
  recovery.appliedFilters=[...parameterFilters(selectivePlan,selectiveConfig)];
  recovery.update(view(['Year'],[recovery.appliedFilters[0]]));
  assert.equal(recovery.appliedFilters.length,2,'partial metadata echoes must not erase known measure selection');
  recovery.destroy();
  const cacheController = new FieldParameterTrial({prepend(){}},{applyJsonFilter(){},persistProperties(){}});
  cacheController.hydrate({metadata:{objects:{parameterTrial:{configuration:JSON.stringify(config)}}}});
  const cacheView = view(['Year'],[],[10]); cacheController.update(cacheView);
  cacheController.queryCache.set('test-snapshot',cacheView);
  cacheController.noteUiStateWrite('cleared-conversation');
  const echo = JSON.parse(JSON.stringify(cacheView)); echo.metadata.objects.state={conversation:'cleared-conversation'};
  const revisionBeforeEcho=cacheController.dataRevision;
  cacheController.update(echo);
  assert.equal(cacheController.queryCache.size,1,'matching own conversation-only echo retains complete cached snapshots');
  assert.equal(cacheController.dataRevision,revisionBeforeEcho,'UI echo must not acknowledge an outstanding data query');
  cacheController.update(JSON.parse(JSON.stringify(echo)));
  assert.equal(cacheController.queryCache.size,0,'an untracked data update must still invalidate even when visible values match');
  cacheController.queryCache.set('test-snapshot',cacheView); cacheController.noteUiStateWrite('another-clear');
  const changed = view(['Year'],[],[20]); changed.metadata.objects.state={conversation:'another-clear'};
  cacheController.update(changed); assert.equal(cacheController.queryCache.size,0,'a state echo with changed data cannot retain cache');
  assert.notEqual(cacheController.queryKey(selectivePlan,config),cacheController.queryKey(selectivePlan,{...config,fields:config.fields.map(field=>({...field,table:'DifferentModel'}))}),'physical mapping changes must miss the cache');
  cacheController.destroy();
  let finished = false;
  const pending = trial.prepareQuestion('Show Rent Measure by year').then(response => { finished = true; return response; });
  const yearFilters = calls.at(-1)[0];
  assert.deepEqual(yearFilters[0].values, ['Year']);
  assert.equal(calls.length, 1, 'grouping-only requests must not send an intermediate clear');
  trial.update(view(['Year', 'City'], yearFilters)); await flush(); assert.equal(finished, false);
  trial.update(view(['Year'], [], [123], true)); await flush(); assert.equal(finished, false, 'incomplete data is never accepted without acknowledgement');
  trial.update(view(['Year'], yearFilters, [123], true)); await flush(); assert.equal(finished, false);
  trial.update(view(['Year'], [], [1.5, 2.5]));
  const response = await pending;
  assert.deepEqual(response.table.rows, [['Year-0', '1.50'], ['Year-1', '2.50']]);
  assert.equal(response.table.rows.length, 2, 'do not fabricate a grand total for a possibly non-additive measure');
  assert.equal(response.modelQuery, true);

  const count = calls.length;
  await trial.prepareQuestion('Rent Measure by Year'); assert.equal(calls.length, count, 'reuse only a matching complete current response');
  const refresh = trial.prepareQuestion('Rent Measure by Year', true);
  assert.equal(refreshes, 0, 'Refresh reuses Power BI\'s latest complete result without a redundant wait');
  assert.equal((await refresh).table.rows[0][1], '1.50');
  trial.update(view(['Year'], [], [9]));
  const chart = await trial.prepareQuestion('Rent Measure by Year as a bar chart');
  assert.deepEqual(chart.chart.values, [9]);
  let filteredFinished = false;
  const filtered = trial.prepareQuestion('Rent Measure by Year where Tenant = Home Living').then(value => { filteredFinished = true; return value; });
  const filteredPayload = calls.at(-1)[0];
  assert.equal(filteredPayload.length, 2);
  trial.update(view(['Year'], []), [], false); await flush(); assert.equal(filteredFinished, false, 'presentation-only updates cannot acknowledge value filters');
  trial.update(view(['Year'], yearFilters)); await flush(); assert.equal(filteredFinished, false, 'same grouping with previous filters is stale');
  const conflictingTenant = { ...filteredPayload[1], values: ['Bean Street'] };
  trial.update(view(['Year'], filteredPayload), [conflictingTenant]); await flush();
  assert.equal(filteredFinished, false, 'conflicting public and owned predicates must not be accepted');
  trial.update(view(['Year'], [filteredPayload[0]], [42]), filteredPayload.slice(1)); assert.match((await filtered).text, /Home Living/);

  let cleared = false;
  const unfiltered = trial.prepareQuestion('Rent Measure by Year', true).then(value => { cleared = true; return value; });
  assert.equal(calls.at(-2)[0], null, 'clear old predicates before sending a replacement');
  assert(calls.filter(call => call[0]).every(call => call[0].every(filter => filter.operator !== 'All')), 'never accumulate All predicates');
  trial.update(view(['Year'], filteredPayload)); await flush(); assert.equal(cleared, false, 'old tenant filter must not leak into the next question');
  trial.update(view(['Year'], [])); await unfiltered;

  const multi = trial.prepareQuestion('Rent Measure by City and Year for June 2025 as a table');
  const multiFilters = calls.at(-1)[0];
  assert.deepEqual(multiFilters[0].values, ['City', 'Year']);
  trial.update(view(['Year', 'City'], multiFilters, [10]));
  assert.deepEqual((await multi).table.columns, ['City', 'Year', 'Rent Measure']);

  const cancelled = trial.prepareQuestion('Rent Measure by Year', true);
  const cancellation = assert.rejects(cancelled, /cancelled/);
  await assert.rejects(trial.prepareQuestion('Rent Measure by Unknown'), /safely interpret/); await cancellation;
  const failed = trial.prepareQuestion('Rent Measure by City'); const failure = assert.rejects(failed, /incomplete/);
  trial.fail('incomplete data'); await failure;
  const reset = trial.prepareQuestion('Rent Measure by City'); const resetCheck = assert.rejects(reset, /cancelled/);
  elements.find(e => e.textContent === 'Reset query filters').onclick(); await resetCheck;
  const closing = trial.prepareQuestion('Rent Measure by City'); const closeCheck = assert.rejects(closing, /cancelled/);
  trial.destroy(); await closeCheck;
  const unresolved = view(['Parameter'], []);
  const label = unresolved.categorical.categories[0].source;
  delete label.sourceFieldParameters;
  label.expr = { source: { entity: 'Parameter' }, ref: 'Parameter' };
  trial.update(unresolved);
  const beforeInvalid = calls.length;
  await assert.rejects(trial.prepareQuestion('Rent Measure by Year'), /Show selected field/);
  assert.equal(calls.length, beforeInvalid, 'reject label mapping immediately without issuing a query');
  delete label.expr;
  unresolved.categorical.categories[0].values = ['Year'];
  trial.update(unresolved);
  await assert.rejects(trial.prepareQuestion('Rent Measure by Year'), /Show selected field/);
  assert.equal(calls.length, beforeInvalid, 'detect label-only host payload without queryName or expression');
  trial.update(view(['City'], []));
  const invalidUpdate = trial.prepareQuestion('Rent Measure by Year');
  const invalidCheck = assert.rejects(invalidUpdate, /Show selected field/);
  trial.update(unresolved); await invalidCheck;
  trial.update(view(['City'], []));
  const matrixPending = trial.request(plan('Rent Measure by City and Year as a matrix'), config);
  const matrixFilters = calls.at(-1)[0];
  const source = displayName => ({ displayName, roles: { fields: true }, sourceFieldParameters: [{}] });
  const matrixView = { metadata: { objects: { parameterTrial: { filter: matrixFilters } } }, matrix: {
    rows: { levels: [{ sources: [source('City')] }, { sources: [source('Year')] }], root: { children: [
      { level: 0, value: 'Riyadh', children: [
        { level: 1, value: 2024, values: { 0: { value: 4 } } },
        { level: 1, value: 2025, values: { 0: { value: 6 } } },
        { level: 1, isSubtotal: true, values: { 0: { value: 5 } } }
      ] },
      { level: 0, isSubtotal: true, values: { 0: { value: 7 } } }
    ] } }, columns: { levels: [], root: {} },
    valueSources: [{ displayName: 'Rent Measure', roles: { measures: true }, format: '#,0.00' }]
  } };
  trial.update(matrixView);
  const matrixAnswer = await matrixPending;
  assert.deepEqual(matrixAnswer.table.columns, ['City', '2024', '2025', 'Total']);
  assert.deepEqual(matrixAnswer.table.rows, [['Riyadh', '4.00', '6.00', '5.00']]);
  assert.deepEqual(matrixAnswer.table.modelTotals, ['Grand Total', '—', '—', '7.00'], 'missing column totals must not be invented from leaf sums');
  const plain = await trial.prepareQuestion('Rent Measure by City and Year as a table');
  assert.equal(plain.table.rows.length, 2, 'table excludes subtotal nodes from ordinary rows');
  assert.deepEqual(plain.table.modelTotals, ['Grand Total', '', '7.00']);
  const cachedCount = calls.length;
  const cachedPlan = await trial.request(plan('Rent Measure by City and Year as a table'), config);
  assert.deepEqual(cachedPlan.table.rows, plain.table.rows);
  assert.equal(calls.length, cachedCount, 'same semantic query reuses validated data without a host request');
  const ranked = await trial.prepareQuestion('Show top 1 City and Year by Rent Measure');
  assert.deepEqual(ranked.table.rows, [['Riyadh', '2025', '6.00']]);
  assert.equal(ranked.table.modelTotals, undefined);
  const totalPending = trial.prepareQuestion('Show total Rent Measure');
  const totalFilters = calls.at(-1)[0];
  const totalView = view(['Year'], totalFilters, [4, 6]);
  totalView.categorical.values[0].source.aggregates = { subtotal: 7 };
  trial.update(totalView);
  assert.equal((await totalPending).kpi.value, '7.00');
  const anchoredList = await trial.prepareQuestion('Year');
  assert.deepEqual(anchoredList.table.columns,['Year'],'direct measures remain hidden in list answers');
  const fieldOnlyView = view(['Year'], []);
  fieldOnlyView.categorical.values = [];
  const list = trial.answer(fieldOnlyView, plan('Year'));
  assert.deepEqual(list.table.columns, ['Year']);
  assert.equal(list.table.modelTotals, undefined);
  const fallback = trial.request(plan('Rent Measure by City and Year as a matrix'), config, true);
  trial.update(view(['City', 'Year'], calls.at(-1)[0], [8]));
  assert.deepEqual((await fallback).table.rows, [['City-0', '8.00']], 'categorical grouped cells can be pivoted without a matrix payload');
  const learnedView = view(['Assigned Tenant Name'], [], [3]);
  learnedView.categorical.categories[0].source.expr = { source: { entity: 'Retail' }, ref: 'Tenant' };
  learnedView.categorical.categories[0].values = ['Tech Hub'];
  trial.update(learnedView);
  assert(trial.valueOptions().some(value => value.label === 'Tech Hub'));
  const learned = trial.prepareQuestion('Tech Hub Rent Measure by Year');
  assert.deepEqual(calls.at(-1)[0][1].values, ['Tech Hub']);
  trial.update(view(['Year'], calls.at(-1)[0], [3]));
  const learnedAnswer = await learned;
  assert(learnedAnswer.table.modelRowSelections[0][0].some(part => part.column === 'Tenant' && part.value === 'Tech Hub'), 'hidden tenant filter travels with Year selections');
  const comparison = trial.prepareQuestion('June 2024 vs June 2025 Assigned Tenant Name Rent Measure');
  assert.equal(calls.at(-1)[0][1].conditions[0].value, '2024-06-01T00:00:00.000Z');
  trial.update(view(['Assigned Tenant Name'], [calls.at(-1)[0][0]], [12]), calls.at(-1)[0].slice(1)); await flush();
  assert.equal(calls.at(-1)[0][1].conditions[0].value, '2025-06-01T00:00:00.000Z');
  trial.update(view(['Assigned Tenant Name'], [calls.at(-1)[0][0]], [18]), calls.at(-1)[0].slice(1)); await flush();
  const compared = await comparison;
  assert.deepEqual(compared.table.columns, ['Assigned Tenant Name', 'June 2024', 'June 2025']);
  assert.deepEqual(compared.table.rows[0].slice(1), ['12.00', '18.00']);
  assert.deepEqual(compared.table.modelTotals, ['Grand Total','12.00','18.00'], 'comparison totals use each complete period by default');
  assert(compared.table.modelRowSelections[0].every(row=>row.some(part=>part.column==='Date' && part.dateDay===true)));
  assert.equal(compared.table.modelRowSelections[0].length, 60, 'comparison row carries both June date windows');
  assert.equal(compared.table.modelCellSelections[0][1].length, 30, 'period cell carries only its own June window');
  assert(compared.table.modelCellSelections[0][1].every(row => row.some(part => part.column === 'Date' && part.value.startsWith('2024-06'))));
  assert(compared.table.modelCellSelections[0][2].every(row => row.some(part => part.column === 'Date' && part.value.startsWith('2025-06'))));
  trial.measures = []; // Field-only binding: no direct measure remains in the well.
  const namesAfterComparison = trial.prepareQuestion('Assigned Tenant Name');
  assert.equal(calls.at(-1)[0].length, 1, 'list request contains only its grouping after date filters are cleared');
  const namesOnlyView = view(['Assigned Tenant Name'], [], [21]);
  namesOnlyView.categorical.values = [];
  trial.update(namesOnlyView);
  assert.deepEqual((await namesAfterComparison).table.columns, ['Assigned Tenant Name']);
  trial.measures = ['Rent Measure'];
  const completedMatrix = trial.prepareQuestion('Rent Measure by City and Year as a matrix');
  trial.update(view(['City', 'Year'], calls.at(-1)[0], [4, 6])); await flush();
  assert.deepEqual(calls.at(-1)[0][0].values, ['City']);
  const rowSummary = view(['City'], calls.at(-1)[0], [5, 8]);
  rowSummary.categorical.values[0].source.aggregates = { subtotal: 9 };
  trial.update(rowSummary); await flush();
  assert.deepEqual(calls.at(-1)[0][0].values, ['Year']);
  trial.update(view(['Year'], calls.at(-1)[0], [7, 11]));
  const complete = await completedMatrix;
  assert.deepEqual(complete.table.modelTotals, ['Grand Total', '7.00', '11.00', '9.00']);
  assert.equal(complete.table.rows[0].at(-1), '5.00');
  const repeatCalls = calls.length;
  const repeated = await trial.prepareQuestion('Rent Measure by City and Year as a matrix');
  assert.deepEqual(repeated.table, complete.table);
  assert.equal(calls.length, repeatCalls, 'a repeated matrix must not rerun its three queries when no data changed');
  repeated.table.rows[0][0] = 'edited';
  assert.notEqual((await trial.prepareQuestion('Rent Measure by City and Year as a matrix')).table.rows[0][0], 'edited', 'render edits cannot corrupt the reusable response');
  // Categorical hosts can omit all aggregate metadata. V3-style totals are
  // automatic and do not send an empty grouping selection to the host.
  trial.queryCache.clear(); trial.responseCache?.clear();
  const scalarMatrix = trial.executeQuestion('Rent Measure by City and Year as a matrix', true);
  trial.update(view(['City','Year'], calls.at(-1)[0], [4,6])); await flush();
  trial.update(view(['City'], calls.at(-1)[0], [5,8])); await flush();
  trial.update(view(['Year'], calls.at(-1)[0], [7,11])); await flush();
  assert.deepEqual(calls.at(-1)[0][0].values, ['Year'], 'overall total keeps a valid field-parameter selection');
  assert.deepEqual((await scalarMatrix).table.modelTotals, ['Grand Total','7.00','11.00','13.00'], 'default total sums the complete row marginal');
  const labelWithMetadata = view(['Parameter'], [], [1]);
  labelWithMetadata.categorical.categories[0].source.expr = { source: { entity: 'Parameter' }, ref: 'Parameter' };
  labelWithMetadata.categorical.categories[0].values = ['Year'];
  trial.update(labelWithMetadata);
  await assert.rejects(trial.prepareQuestion('Assigned Tenant Name'), /Show selected field/, 'parameter metadata must not hide an unresolved label binding');
  const resolvedView = view(['Assigned Tenant Name'], [], [5]);
  const chosen = trial.selectDataView([labelWithMetadata, resolvedView]);
  assert.equal(chosen.table.columns[0].displayName, 'Assigned Tenant Name', 'a label-only first view must not hide resolved fields in another view');
  resolvedView.categorical.categories[0].source.expr = { source: { entity: 'Retail' }, ref: 'Tenant' };
  trial.update(resolvedView);
  const selectionAnswer = await trial.prepareQuestion('Rent Measure by Assigned Tenant Name');
  assert.deepEqual(selectionAnswer.table.modelSelections[0], [{ table: 'Retail', column: 'Tenant', value: 'Assigned Tenant Name-0' }]);
  const beforeRetry = refreshes;
  const waiting = trial.prepareQuestion('Rent Measure by City');
  const cancelledWaiting = assert.rejects(waiting, /cancelled/);
  trial.cancelQuestion(); await cancelledWaiting;
  const retry = trial.prepareQuestion('Rent Measure by City');
  assert.equal(refreshes, beforeRetry + 1, 'retrying an unchanged filter must explicitly ask the host for data');
  trial.update(view(['City'], calls.at(-1)[0], [17])); await retry;
  trial.destroy();
  console.log('Parameter planner, saved configuration, date boundaries, filter acknowledgement, cancellation and multi-field checks passed.');
  const transactionalCalls = [];
  const transactional = new FieldParameterTrial({ prepend() {} }, { applyJsonFilter(...args) { transactionalCalls.push(args); }, refreshHostData() {} });
  transactional.hydrate({ metadata: { objects: { parameterTrial: { configuration: JSON.stringify(config) } } } });
  transactional.update(view(['City'], []));
  const initial = transactional.prepareQuestion('Home Living Rent Measure by Year');
  const initialPayload = transactionalCalls.at(-1)[0];
  transactional.update(view(['Year'], initialPayload, [42])); await initial;
  const next = transactional.prepareQuestion('Rent Measure by Assigned Tenant Name');
  assert.equal(transactionalCalls.at(-1)[0], null);
  const clearingCount = transactionalCalls.length;
  transactional.update(view(['Year'], initialPayload, [42]));
  assert.equal(transactionalCalls.length, clearingCount, 'stale filtered data must not trigger the replacement merge');
  transactional.update(view(['Year', 'City'], []));
  assert.equal(transactionalCalls.length, clearingCount + 1, 'replacement follows a cleared host response');
  assert.equal(transactionalCalls.at(-1)[0].length, 1);
  transactional.update(view(['Assigned Tenant Name'], transactionalCalls.at(-1)[0], [1]));
  assert.deepEqual((await next).table.columns, ['Assigned Tenant Name', 'Rent Measure']);
  const noEcho = transactional.prepareQuestion('Home Living Rent Measure by Year', true);
  transactional.update(view(['Year'], [], [520704]));
  assert.equal((await noEcho).table.rows[0][1], '520,704.00', 'fresh filtered Data update is accepted when this host echoes no filters');
  const noEchoComparison = transactional.prepareQuestion('June 2024 vs June 2025 Assigned Tenant Name Rent Measure');
  assert.equal(transactionalCalls.at(-1)[0], null);
  transactional.update(view(['Year'], [])); // acknowledge the clear, then send June 2024
  const firstComparisonPeriod = view(['Assigned Tenant Name'], [], [12]);
  firstComparisonPeriod.categorical.values[0].source.aggregates = {subtotal:12};
  transactional.update(firstComparisonPeriod); await flush();
  assert.equal(transactionalCalls.at(-1)[0], null); // separate periods cannot reuse old data
  transactional.update(view(['Assigned Tenant Name'], [])); // acknowledge clear, send June 2025
  const secondComparisonPeriod = view(['Assigned Tenant Name'], [], [18]);
  secondComparisonPeriod.categorical.values[0].source.aggregates = {subtotal:18};
  transactional.update(secondComparisonPeriod);
  assert.deepEqual((await noEchoComparison).table.rows[0].slice(1), ['12.00', '18.00']);
  transactional.destroy();
})().catch(error => { trial.destroy(); console.error(error); process.exitCode = 1; });
