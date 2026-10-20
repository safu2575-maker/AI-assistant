const assert = require("node:assert/strict");
{
 const {evaluateFormula}=require('../.tmp/test/qna/formula');
 const calc=s=>evaluateFormula(s,new Map([['Sales',100],['Rent',0],['Missing',null]]));
 assert.equal(calc('=if([Rent]=0,0,[Sales]/[Rent])'),0);
 assert.equal(calc('IF(ISBLANK([Missing]),25,[Missing]+1)'),25);
 assert.equal(calc('ISBLANK([Rent])'),0);
 assert.equal(calc('COALESCE([Missing],[Rent],99)'),0);
 assert.equal(calc('DIVIDE([Sales],[Missing],7)'),7);
 assert.equal(calc('IFERROR([Sales]/[Rent],5)'),5);
 assert.equal(calc('IF(AND([Sales]>=100,NOT(ISBLANK([Rent]))),1,2)'),1);
 assert.equal(calc('IF(OR(FALSE,[sales]<>0);ROUND(.125,2);0)'),.13);
 assert.equal(calc('IF(FALSE,1,BLANK())'),null);
 assert.throws(()=>calc('IF(1,2,UNKNOWN(3))'),/Unknown function/);
 assert.throws(()=>calc('IF(1)'),/arguments/);
 assert.throws(()=>calc('[Missing]+1'),/Blank value/);
 assert.throws(()=>calc('if'),/parentheses/);
}
const { toggleSelection } = require("../.tmp/test/selectionFilter");
assert.deepEqual(toggleSelection([0, 1], [0, 1], false), [], "repeat row click clears filtering");
assert.deepEqual(toggleSelection([0, 1], [0], false), [0], "cell click narrows a row to its exact period intersection");
assert.deepEqual(toggleSelection([0], [], false), [], "clear removes every selected row");
assert.deepEqual(toggleSelection([0], [1], true), [0, 1], "Ctrl click adds an intersection");
const { applySelectionFilter, buildSelectionFilters, canCompactSelection, resolveFilterTarget } = require("../.tmp/test/selectionFilter");
const tenantPart = { target: { table: "Retail", column: "Tenant" }, supported: true, rawValues: ["Comfort Store"] };
assert.deepEqual(buildSelectionFilters([tenantPart, { supported: true, rawValues: [2024] }]), [], "unresolved Year must not silently become tenant-only filtering");
assert.deepEqual(buildSelectionFilters([tenantPart, { target: { table: "Retail", column: "Year" }, supported: true, rawValues: [2024, 2025] }]).map((filter) => filter.toJSON().values), [["Comfort Store"], [2024, 2025]]);
assert.equal(canCompactSelection([["A", "Jan", 2024], ["A", "Feb", 2025]], [0, 1], [{ index: 0, rawValues: ["A"] }, { index: 1, rawValues: ["Jan", "Feb"] }, { index: 2, rawValues: [2024, 2025] }]), true);
assert.equal(canCompactSelection([["A", "Jan", 2024], ["A", "Feb", 2025], ["A", "Jan", 2025]], [0, 1], [{ index: 0, rawValues: ["A"] }, { index: 1, rawValues: ["Jan", "Feb"] }, { index: 2, rawValues: [2024, 2025] }]), false, "field filters must not introduce an unselected tuple");
assert.equal(canCompactSelection([["A", "July", 2024], ["A", "January", 2025], ["A", "July", 2025]], [0, 1], [{ index: 0, rawValues: ["A"] }, { index: 1, rawValues: ["July", "January"] }, { index: 2, rawValues: [2024, 2025] }]), false, "a TTM window crossing years must preserve exact Month-Year pairs");
assert.deepEqual(resolveFilterTarget({ expr: { source: { entity: "Retail" }, ref: "Assigned Tenant Name" } }), { table: "Retail", column: "Assigned Tenant Name" });
assert.deepEqual(resolveFilterTarget({ expr: { arg: { arg: { entity: "LocalDateTable" }, hierarchy: "Date Hierarchy" }, level: "Year" }, queryName: "Retail.Month.Year" }), { table: "LocalDateTable", hierarchy: "Date Hierarchy", hierarchyLevel: "Year" });
assert.deepEqual(resolveFilterTarget({ queryName: "Retail.Month.Year" }), { table: "Retail", hierarchy: "Month", hierarchyLevel: "Year" });
assert.deepEqual(resolveFilterTarget({ queryName: "Retail.Year" }), { table: "Retail", column: "Year" });
const { BasicFilter } = require("powerbi-models");
assert.deepEqual(resolveFilterTarget({ expr: { source: { entity: "Retail" }, property: "Tenant" }, queryName: "opaque" }), { table: "Retail", column: "Tenant" });
assert.deepEqual(resolveFilterTarget({ expr: { arg: { arg: { source: { entity: "Calendar" }, property: "Date" }, hierarchy: "Date Hierarchy" }, level: "Month" } }), { table: "Calendar", hierarchy: "Date Hierarchy", hierarchyLevel: "Month" });
const filterCalls = [];
const filterHost = { applyJsonFilter: (...args) => filterCalls.push(args) };
const tenantFilter = new BasicFilter({ table: "Retail", column: "Tenant" }, "In", ["Comfort Store"]).toJSON();
const yearsFilter = new BasicFilter({ table: "Retail", column: "Year" }, "In", [2024, 2025]).toJSON();
applySelectionFilter(filterHost, [0, 1], [tenantFilter, yearsFilter]);
assert.equal(filterCalls.length, 9, "all old slots are cleared before one complete filter-array call");
assert.deepEqual(filterCalls.at(-1), [[tenantFilter, yearsFilter], "general", "filter", 0]);
assert.ok(filterCalls.slice(0, -1).every((call) => call[0] === null && call[3] === 1));
filterCalls.length = 0;
const cellYearFilter = new BasicFilter({ table: "Retail", column: "Year" }, "In", [2024]).toJSON();
applySelectionFilter(filterHost, [0], [tenantFilter, cellYearFilter]);
assert.deepEqual(filterCalls.at(-1), [[tenantFilter, cellYearFilter], "general", "filter", 0]);
const manyFilters = Array.from({ length: 10 }, (_, index) => new BasicFilter({ table: "Retail", column: `Field${index}` }, "In", [index]).toJSON());
applySelectionFilter(filterHost, [0], manyFilters);
assert.deepEqual(filterCalls.at(-1), [manyFilters, "general", "filter", 0], "background conditions beyond eight fields must never be truncated");
filterCalls.length = 0;
applySelectionFilter(filterHost, [], []);
assert.equal(filterCalls.length, 8);
assert.ok(filterCalls.every((call) => call[0] === null && call[3] === 1));
filterCalls.length = 0;
applySelectionFilter(filterHost, [0, 1], []);
assert.equal(filterCalls.length, 8);
assert.deepEqual(filterCalls.at(-1)[0].target, [0, 1]);
assert.equal(filterCalls.at(-1)[3], 0);
filterCalls.length = 0;
const monthFilter = new BasicFilter({ table: "Calendar", column: "Month" }, "In", ["July", "January"]).toJSON();
applySelectionFilter(filterHost, [0, 1], [tenantFilter, monthFilter, yearsFilter], [["Bean Street", "July", 2024], ["Bean Street", "January", 2025]], true);
const tuplePayload = filterCalls.at(-1)[0];
assert.equal(tuplePayload.filterType, 6, "cross-year rolling windows use a tuple filter");
assert.deepEqual(tuplePayload.target, [{ table: "Retail", column: "Tenant" }, { table: "Calendar", column: "Month" }, { table: "Retail", column: "Year" }]);
assert.deepEqual(tuplePayload.values, [[{ value: "Bean Street" }, { value: "July" }, { value: 2024 }], [{ value: "Bean Street" }, { value: "January" }, { value: 2025 }]]);
const { buildContext } = require("../.tmp/test/dataAdapter");
const { GlobalQnaEngine } = require("../.tmp/test/qna/engine");

// UI submit uses answerIgnoringSelection, not answer: exercise that exact path.
const homeColumns = [
  { displayName: "Assigned Tenant Name", queryName: "Retail.Tenant", roles: { fields: true } },
  { displayName: "Year", queryName: "Retail.Year", roles: { fields: true } },
  { displayName: "Rent Measure", queryName: "Retail.Rent", roles: { measures: true } }
];
const homeRows = [["Home Living", 2024, 520704], ["Home Living", 2025, 520704], ["Comfort Store", 2024, 448884], ["Comfort Store", 2025, 448884]];
const homeEngine = new GlobalQnaEngine(buildContext({ columns: homeColumns, rows: homeRows }));

// Run the actual Visual selection callback with only DOM/UI and Power BI mocked.
// Unlike helper-only tests, this catches context lost between the UI and host.
async function checkVisualBackgroundSelection() {
  const Module = require("node:module");
  const fs = require("node:fs");
  const filename = require.resolve("../.tmp/test/visual");
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = module.paths;
  let ui;
  class UiStub {
    constructor(element, engine, onSelect) { ui = this; this.engine = engine; this.onSelect = onSelect; }
    updateEngine(engine) { this.engine = engine; }
    getState() { return {}; }
    clearModelSelection() { this.selectModelRows([]); }
    setFilterChips(labels, remove) { this.labels = labels; this.remove = remove; }
  }
  const load = compiled.require.bind(compiled);
  compiled.require = (name) => name === "./fieldParameterTrial" ? { FieldParameterTrial: class { runStartup() {} noteUiStateWrite() {} hydrate() {} selectDataView(views) { return views[0]; } update() {} fail() {} destroy() {} } } : name === "./qna/ui" ? { GlobalQnaUi: UiStub } : name.endsWith(".less") ? {} : load(name);
  compiled._compile(fs.readFileSync(filename, "utf8"), filename);
  const calls = [];
  const nativeSelections = []; let identitySequence = 0;
  const visual = new compiled.exports.Visual({
    element: { classList: { add() {} } },
    host: {
      createSelectionManager: () => ({ clear: () => Promise.resolve([]), select: (identities) => { nativeSelections.push(identities); return Promise.resolve(identities); } }),
      createSelectionIdBuilder: () => { const id = ++identitySequence; const builder = { withCategory: () => builder, withTable: () => builder, createSelectionId: () => ({ getKey: () => String(id) }) }; return builder; },
      applyJsonFilter: (payload, object, property, action) => {
        if (payload !== null) {
          assert.equal(property, "filter", "all active conditions must use the shared filter property");
          if (Array.isArray(payload)) payload.forEach((filter) => calls.push([filter, object, property, action]));
          else calls.push([payload, object, property, action]);
        } else calls.push([payload, object, property, action]);
      },
      persistProperties() {}
    }
  });
  visual.update({ type: 2, dataViews: [{ categorical: {
    categories: homeColumns.slice(0, 2).map((source, index) => ({ source, values: homeRows.map((row) => row[index]) })),
    values: [{ source: homeColumns[2], values: homeRows.map((row) => row[2]) }]
  } }] });
  const answer = ui.engine.answerIgnoringSelection("show Home Living by year Rent Measure").table;
  const selectYear = async (year) => {
    const index = answer.rows.findIndex((row) => row[0] === String(year));
    ui.onSelect(answer.rowIndices[index], false, ["Year"], answer.backgroundFields);
    await Promise.resolve();
  };
  await selectYear(2024);
  assert.equal(nativeSelections.length, 0, "an exact field filter avoids redundant row identities");
  let payloads = calls.filter((call) => call[0] !== null).slice(-2).map((call) => call[0]);
  assert.deepEqual(payloads.map((payload) => payload.target.column), ["Year", "Tenant"]);
  assert.deepEqual(payloads.map((payload) => payload.values), [[2024], ["Home Living"]]);
  assert.deepEqual(ui.labels, ["Home Living · 2024"]);
  const matches = homeRows.filter((row) => payloads[0].values.includes(row[1]) && payloads[1].values.includes(row[0]));
  assert.deepEqual(matches, [["Home Living", 2024, 520704]], "combined payload excludes other tenants in the same year");
  await selectYear(2025);
  payloads = calls.filter((call) => call[0] !== null).slice(-2).map((call) => call[0]);
  assert.deepEqual(payloads.map((payload) => payload.values), [[2025], ["Home Living"]]);
  ui.remove("Home Living · 2025");
  await Promise.resolve();
  assert.equal(calls.at(-1)[0], null, "removing the combined chip clears the selection");
  assert.deepEqual(ui.labels, []);
  const comparisonColumns = [
    { displayName: "Assigned Tenant Name", queryName: "Retail.Tenant", roles: { fields: true } },
    { displayName: "Month", queryName: "Retail.Month", roles: { fields: true } },
    { displayName: "Year", queryName: "Retail.Year", roles: { fields: true } },
    { displayName: "Rent Measure", queryName: "Retail.Rent", roles: { measures: true } }
  ];
  const comparisonRows = [["Bean Street", "June", 2024, 10], ["Bean Street", "June", 2025, 20], ["Comfort Store", "June", 2024, 30], ["Comfort Store", "June", 2025, 40]];
  visual.update({ type: 2, dataViews: [{ categorical: {
    categories: comparisonColumns.slice(0, 3).map((source, index) => ({ source, values: comparisonRows.map((row) => row[index]) })),
    values: [{ source: comparisonColumns[3], values: comparisonRows.map((row) => row[3]) }]
  } }] });
  const comparison = ui.engine.answerIgnoringSelection("June 2024 vs June 2025 Assigned Tenant Name Rent Measure").table;
  const comfortRow = comparison.rows.findIndex((row) => row[0] === "Comfort Store");
  calls.length = 0;
  ui.onSelect(comparison.rowIndices[comfortRow], false, comparison.selectionFieldsByColumn[0], comparison.backgroundFields);
  await Promise.resolve();
  let comparisonFilters = calls.filter((call) => call[0] !== null).map((call) => call[0]);
  assert.deepEqual(comparisonFilters.map((filter) => [filter.target.column, filter.values]), [["Tenant", ["Comfort Store"]], ["Month", ["June"]], ["Year", [2024, 2025]]], "comparison row sends tenant and every period background filter");
  calls.length = 0;
  ui.onSelect(comparison.cellIndices[comfortRow][1], false, comparison.selectionFieldsByColumn[1], comparison.backgroundFields);
  await Promise.resolve();
  comparisonFilters = calls.filter((call) => call[0] !== null).map((call) => call[0]);
  assert.deepEqual(comparisonFilters.map((filter) => [filter.target.column, filter.values]), [["Tenant", ["Comfort Store"]], ["Month", ["June"]], ["Year", [2024]]], "comparison cell sends its exact tenant and Month-Year intersection");
  calls.length = 0;
  ui.selectModelRows([[{table:'Retail',column:'Tenant',value:'Home Living'}, {table:'Retail',column:'Year',value:2024}], [{table:'Retail',column:'Year',value:2025},{table:'Retail',column:'Tenant',value:'Home Living'}]]);
  await Promise.resolve();
  const modelFilters = calls.filter(call => call[0] !== null).map(call => call[0]);
  assert.deepEqual(modelFilters.map(filter => [filter.target.column, filter.values]), [['Tenant',['Home Living']],['Year',[2024,2025]]], 'snapshot row selections preserve all context and normalize field order');
  calls.length = 0;
  ui.selectModelRows([[{table:'Retail',column:'Tenant',value:'Home Living'},{table:'Retail',column:'Year',value:2024}],[{table:'Retail',column:'Tenant',value:'Bean Street'},{table:'Retail',column:'Year',value:2025}]]);
  await Promise.resolve();
  assert.equal(calls.at(-1)[0].filterType, 6, 'diagonal selection uses exact tuples rather than the Cartesian product');
  calls.length = 0;
  ui.selectModelRows([[{table:'Retail',column:'Tenant',value:'Home Living'}]]);
  ui.selectModelRows([]);
  await Promise.resolve();
  assert(calls.every(call => call[0] === null), 'clear wins over an in-flight selection callback');
  assert.deepEqual(ui.labels, []);
  calls.length = 0;
  ui.selectModelRows([[{table:'Dates',hierarchy:'Date Hierarchy',hierarchyLevel:'Year',value:2025}]]);
  await Promise.resolve();
  assert.deepEqual(calls.at(-1)[0].target, {table:'Dates',hierarchy:'Date Hierarchy',hierarchyLevel:'Year'}, 'auto-date hierarchy targets are retained rather than discarded');
  ui.selectModelRows([]); await Promise.resolve();
  calls.length = 0;
  const juneSelection = [2024,2025].flatMap(year => Array.from({length:30},(_,day)=>[{table:'Retail',column:'Tenant',value:'Tech Hub'},{table:'Retail',column:'Month',dateDay:true,value:new Date(Date.UTC(year,5,day+1)).toISOString()}]));
  ui.selectModelRows(juneSelection); await Promise.resolve();
  const juneFilters = calls.filter(call=>call[0]!==null).map(call=>call[0]);
  assert.equal(juneFilters.filter(filter=>filter.target.column==='Month').length,2,'comparison dates use outer range plus gap exclusion');
  assert(juneFilters.filter(filter=>filter.target.column==='Month').every(filter=>filter.conditions),'dates must not be sent as Basic text equality values');
  const matchesDate = value => juneFilters.filter(filter=>filter.target.column==='Month').every(filter=>{
    const conditions=filter.conditions.map(condition=>condition.operator==='LessThan'?value<condition.value:value>=condition.value);
    return filter.logicalOperator==='And'?conditions.every(Boolean):conditions.some(Boolean);
  });
  for(const date of ['2024-06-01T00:00:00.000Z','2024-06-30T12:00:00.000Z','2025-06-01T00:00:00.000Z','2025-06-30T23:59:59.000Z']) assert(matchesDate(date),date);
  for(const date of ['2024-05-31T23:59:59.000Z','2024-07-01T00:00:00.000Z','2025-01-01T00:00:00.000Z','2025-07-01T00:00:00.000Z']) assert(!matchesDate(date),date);
  assert(ui.labels[0].includes('June 2024 + June 2025'));
  calls.length = 0; ui.selectModelRows(juneSelection.slice(0,30)); await Promise.resolve();
  assert.equal(calls.filter(call=>call[0]?.target?.column==='Month').length,1,'one period cell uses one date range');
  ui.selectModelRows([]); await Promise.resolve();
  console.log("Visual background-filter callback checks passed.");
  visual.categorical.categories.forEach((category) => { category.identity = comparisonRows.map((_, index) => ({ key: String(index) })); });
  calls.length = 0;
  ui.onSelect(comparison.rowIndices[comfortRow], false, comparison.selectionFieldsByColumn[0], comparison.backgroundFields);
  await Promise.resolve();
  assert.deepEqual(calls.filter((call) => call[0] !== null).map((call) => [call[0].target.column, call[0].values]), [["Tenant", ["Comfort Store"]], ["Month", ["June"]], ["Year", [2024, 2025]]], "categorical identities are compacted when field filters describe the exact comparison rows");
  calls.length = 0;
  ui.onSelect(comparison.cellIndices[comfortRow][1], false, comparison.selectionFieldsByColumn[1], comparison.backgroundFields);
  await Promise.resolve();
  assert.deepEqual(calls.filter((call) => call[0] !== null).map((call) => [call[0].target.column, call[0].values]), [["Tenant", ["Comfort Store"]], ["Month", ["June"]], ["Year", [2024]]], "categorical comparison cells use compact exact field filters");
  ui.onSelect([], false);
  await Promise.resolve();
  const months = ["January", "February", "March", "April", "May", "June"];
  const ytdRows = months.map((month) => ["Bean Street", month, 2024, 10]);
  visual.update({ type: 2, dataViews: [{ categorical: {
    categories: comparisonColumns.slice(0, 3).map((source, index) => ({ source: { ...source, queryName: "opaque", expr: index === 0 ? { source: { entity: "Retail" }, property: "Tenant" } : { arg: { arg: { source: { entity: "Calendar" }, property: "Date" }, hierarchy: "Date Hierarchy" }, level: source.displayName } }, values: ytdRows.map((row) => row[index]), identity: ytdRows.map((_, index) => ({ key: String(index) })) })),
    values: [{ source: comparisonColumns[3], values: ytdRows.map((row) => row[3]) }]
  } }] });
  calls.length = 0;
  ui.onSelect([0, 1, 2, 3, 4, 5], false, ["Assigned Tenant Name", "Month", "Year"], ["Month", "Year"], false, "June 2024 YTD");
  await Promise.resolve();
  assert.deepEqual(calls.filter((call) => call[0] !== null).map((call) => [call[0].target.column || call[0].target.hierarchyLevel, call[0].values]), [["Tenant", ["Bean Street"]], ["Month", months], ["Year", [2024]]], "runtime hierarchy metadata still sends three YTD field filters rather than six row identities");
  assert.equal(ui.labels.length, 1, "YTD is displayed as one combined selection chip");
  assert.equal(ui.labels[0], "Bean Street · YTD: Jan–Jun 2024", "a time-window selection is displayed as one concise chip");
  ui.remove(ui.labels[0]);
  await Promise.resolve();
  assert.deepEqual(ui.labels, [], "removing the combined YTD chip clears selection");
  visual.categorical.categories.forEach((category, index) => {
    category.source.expr = { level: category.source.displayName };
    category.source.queryName = `opaque${index}`;
    category.identityFields = [{ source: { entity: index ? "LocalDateTable" : "Retail" }, ref: index ? category.source.displayName : "Tenant" }];
  });
  calls.length = 0;
  ui.onSelect([0, 1, 2, 3, 4, 5], false, ["Assigned Tenant Name", "Month", "Year"], ["Month", "Year"]);
  await Promise.resolve();
  assert.deepEqual(calls.filter((call) => call[0] !== null).map((call) => [call[0].target.table, call[0].target.column]), [["Retail", "Tenant"], ["LocalDateTable", "Month"], ["LocalDateTable", "Year"]], "auto-date identityFields resolve physical targets even when hierarchy expressions are incomplete");
  assert.equal(ui.labels.length, 1);
}
checkVisualBackgroundSelection().catch((error) => { console.error(error); process.exitCode = 1; });
homeEngine.updateSelection([2], ["Assigned Tenant Name"]);
const homeAnswer = homeEngine.answerIgnoringSelection("show Home Living by year Rent Measure");
assert.deepEqual(homeEngine.answerIgnoringSelection("show home BY Year Rent Measure").table.rows, homeAnswer.table.rows);
assert.deepEqual(homeAnswer.table.backgroundFields, ["Assigned Tenant Name"]);
assert.deepEqual(homeEngine.backgroundFilterSummary(homeAnswer.table), [{ field: "Assigned Tenant Name", values: ["Home Living"] }]);
assert.equal(homeEngine.selectionMatches([2], ["Assigned Tenant Name"]), true, "submit must restore existing selection state");
const home2024 = homeAnswer.table.rowIndices[homeAnswer.table.rows.findIndex((row) => row[0] === "2024")];
assert.deepEqual(home2024, [0]);
const homeParts = ["Year", ...homeAnswer.table.backgroundFields].map((name) => {
  const index = homeColumns.findIndex((column) => column.displayName === name);
  return { target: resolveFilterTarget(homeColumns[index]), supported: true, rawValues: [...new Set(home2024.map((row) => homeRows[row][index]))] };
});
filterCalls.length = 0;
applySelectionFilter(filterHost, home2024, buildSelectionFilters(homeParts).map((filter) => filter.toJSON()));
assert.deepEqual(filterCalls.at(-1)[0].map((filter) => [filter.target.column, filter.values]), [["Year", [2024]], ["Tenant", ["Home Living"]]]);
assert.deepEqual(homeEngine.answerIgnoringSelection("show Rent Measure by Year").table.backgroundFields, [], "question context must not leak between submissions");
assert.deepEqual(homeEngine.answerIgnoringSelection("show Home Living Rent Measure by Year as a bar chart").chart.backgroundFields, ["Assigned Tenant Name"]);

const columns = [
  { displayName: "Product", queryName: "Product", roles: { fields: true } },
  { displayName: "Department", queryName: "Department", roles: { fields: true } },
  { displayName: "Month", queryName: "Month", roles: { fields: true } },
  { displayName: "Revenue", queryName: "Revenue", roles: { measures: true } },
  { displayName: "Expense", queryName: "Expense", roles: { measures: true } }
];
const rows = [
  ["Alpha", "North", "2026-01", 120, 70],
  ["Beta", "North", "2026-01", 180, 90],
  ["Gamma", "South", "2026-02", 90, 40],
  ["Alpha", "South", "2026-02", 80, 45]
];
const engine = new GlobalQnaEngine(buildContext({ columns, rows }));
assert.ok(engine.autocomplete("rev").some((item) => item.label === "Revenue"));
assert.ok(engine.autocomplete("sum of rev").some((item) => item.label === "Sum of Revenue"));
assert.equal(engine.autocomplete("sum of r")[0].label, "Sum of Revenue");
assert.equal(engine.autocomplete("average r")[0].label, "Average Revenue");
engine.setLayoutSettings({ autocompleteFields: [], autocompleteMeasures: [] });
assert.equal(engine.autocomplete("rev").length, 0);
assert.equal(engine.autocomplete("@rev").length, 0, 'explicit searches respect hidden suggestions');
assert.deepEqual(engine.measureAutocomplete('rev'), []);
assert.deepEqual(engine.valueAutocomplete('', 'Department @'), []);
engine.setLayoutSettings({synonyms:{Revenue:['turnover']}});
assert.equal(engine.autocomplete('turnover')[0].label,'turnover','synonyms remain visible when the original measure is hidden');
assert.equal(engine.measureAutocomplete('turnover')[0].label,'turnover');
assert.ok(engine.answer('Revenue by Department').table,'hidden suggestions remain queryable');
engine.setLayoutSettings({autocompleteFields:engine.configurationOptions().fields,autocompleteMeasures:engine.configurationOptions().measures,synonyms:{}});
assert.deepEqual(engine.autocomplete("as", 4).map((item) => item.label), ["as a table", "as a matrix", "as a bar chart", "as a column chart"]);
assert.ok(engine.autocomplete("as a", 8, "show Revenue by Department as a").some((item) => item.label === "as a bar chart"));
assert.equal(engine.autocomplete("as a b", 8, "show Revenue by Department as a b")[0].label, "as a bar chart");
assert.equal(engine.autocomplete("as a line")[0].label, "as a line chart");
assert.deepEqual(engine.valueAutocomplete("", "Show Revenue by Department @", 3).map((item) => item.detail), ["Department", "Department"]);
assert.deepEqual(engine.valueAutocomplete("sou", "Show Revenue by Department @sou").map((item) => item.label), ["South"]);
assert.ok(engine.valueAutocomplete("alp", "@").some((item) => item.label === "Alpha" && item.detail === "Product"));
assert.deepEqual(engine.measureAutocomplete("rev").map((item) => item.label), ["Revenue"]);
assert.ok(engine.measureAutocomplete("").every((item) => item.detail === "Measure"));
const productList = engine.answer("Show Product").table;
assert.deepEqual(productList.columns, ["Product"]);
assert.deepEqual(productList.rows.map((row) => row[0]), ["Alpha", "Beta", "Gamma"]);
assert.deepEqual(engine.answer("Product").table.rows.map((row) => row[0]), ["Alpha", "Beta", "Gamma"]);
const productDepartmentList = engine.answer("Show Product Department").table;
assert.deepEqual(productDepartmentList.columns, ["Product", "Department"]);
assert.deepEqual(productDepartmentList.rows, [["Alpha", "North"], ["Alpha", "South"], ["Beta", "North"], ["Gamma", "South"]]);
const filteredProductList = engine.answer("Show Product Department (North)").table;
assert.deepEqual(filteredProductList.rows.map((row) => row[0]), ["Alpha", "Beta"]);
assert.deepEqual(filteredProductList.backgroundFields, ["Department"]);
let mention = engine.insertValueFilter("Show Revenue by Department @", "Show Revenue by Department ".length, "Department", "North");
assert.equal(mention, "Show Revenue by Department (North)");
mention = engine.insertValueFilter(mention + " or @", (mention + " or ").length, "Department", "South");
assert.equal(mention, "Show Revenue by Department (North | South)");
assert.equal(engine.insertValueFilter("Show Revenue @", "Show Revenue ".length, "Department", "North"), "Show Revenue Department (North)");
assert.deepEqual(engine.autocomplete("as", 8, "show Revenue as").map((item) => item.label), ["as a KPI", "as a table"]);
assert.ok(engine.autocomplete("as", 8, "show Revenue by Department as").some((item) => item.label === "as a bar chart"));
assert.ok(!engine.autocomplete("as", 8, "show Revenue by Department as").some((item) => item.label === "as a matrix"));
assert.equal(engine.autocomplete("a bar chart", 8, "show Revenue by Department as a bar chart").filter((item) => item.detail === "Visual").length, 0);
assert.equal(engine.answer("What is total revenue?").kpi.value, "470");
const countMeasureEngine = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "Department", queryName: "Department", roles: { fields: true } },
  { displayName: "Count of Records", queryName: "Count of Records", roles: { measures: true } }
], rows: [["North", 600000], ["South", 500000]], totals: [null, 1100000] }));
assert.equal(countMeasureEngine.answer("Show count of records").kpi.value, "1,100,000");
assert.equal(countMeasureEngine.answer("Show count of records by Department").table.rows.at(-1)[1], "1,100,000");
const visualNameFieldEngine = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "Line", queryName: "Line", roles: { fields: true } },
  { displayName: "KPI", queryName: "KPI", roles: { fields: true } },
  { displayName: "Amount", queryName: "Amount", roles: { measures: true } }
], rows: [["Line A", "Good", 10], ["Line B", "Bad", 20]] }));
assert.deepEqual(visualNameFieldEngine.answer("Show Line").table.rows.map((row) => row[0]), ["Line A", "Line B"]);
assert.equal(visualNameFieldEngine.answer("Show Amount by Line").table.columns[0], "Line");
assert.equal(visualNameFieldEngine.answer("Show Amount by Line as a line chart").chart.type, "line");
assert.deepEqual(visualNameFieldEngine.answer("Show KPI").table.rows.map((row) => row[0]), ["Bad", "Good"]);
assert.equal(visualNameFieldEngine.answer("Show Amount by KPI").table.columns[0], "KPI");
assert.equal(visualNameFieldEngine.answer("Show Amount as a KPI card").kpi.value, "30");
const otherVisualNameFields = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "Bar", queryName: "Bar", roles: { fields: true } },
  { displayName: "Column", queryName: "Column", roles: { fields: true } },
  { displayName: "Pie", queryName: "Pie", roles: { fields: true } },
  { displayName: "Gauge", queryName: "Gauge", roles: { fields: true } },
  { displayName: "Amount", queryName: "Amount", roles: { measures: true } }
], rows: [["B1", "C1", "P1", "G1", 10], ["B2", "C2", "P2", "G2", 20]] }));
for (const fieldName of ["Bar", "Column", "Pie", "Gauge"]) assert.equal(otherVisualNameFields.answer(`Show Amount by ${fieldName}`).table.columns[0], fieldName);
assert.equal(otherVisualNameFields.answer("Show Amount by Bar as a column chart").chart.type, "column");
const costAliasEngine = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "Details", queryName: "Details", roles: { fields: true } },
  { displayName: "LineItem", queryName: "LineItem", roles: { fields: true } },
  { displayName: "Total Actual Movement", queryName: "ActualMovement", roles: { measures: true } }
], rows: [["FM Contracts", "FM", 100], ["Landscaping", "FM", 50]] }));
const costAliasAnswer = costAliasEngine.answer("show FM cost Details");
assert.equal(costAliasAnswer.table.columns[1], "Total cost");
assert.equal(costAliasAnswer.text, "Total cost by Details.");
const manyTenantRows = Array.from({ length: 125 }, (_, index) => [`Tenant ${String(index + 1).padStart(3, "0")}`, index + 1]);
const manyTenantEngine = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "Tenant", queryName: "Tenant", roles: { fields: true } },
  { displayName: "Rent", queryName: "Rent", roles: { measures: true } }
], rows: manyTenantRows }));
assert.equal(manyTenantEngine.answer("Show Tenant").table.rows.length, 125);
assert.equal(manyTenantEngine.answer("Show Rent by Tenant").table.rows.length, 126, "grouped tables include every tenant plus Grand Total");
assert.equal(engine.answer("What is total revenue, Month (2026-01)?").kpi.value, "300");
assert.equal(engine.answer("Show Revenue by Product, Department (North)").table.rows.at(-1)[1], "300");
assert.deepEqual(engine.answer("Show Revenue by Product, Department (North)").table.rows.slice(0, -1).map((row) => row[0]), ["Alpha", "Beta"]);
assert.equal(engine.answer("What is total revenue, Department (North), Product (Alpha)?").kpi.value, "120");
assert.equal(engine.answer("What is total revenue, Department (Missing)?").kpi.value, "0");
assert.deepEqual(engine.answer("Show Revenue by Product, Department (North|South)").table.rows.slice(0, -1).map((row) => row[0]), ["Alpha", "Beta", "Gamma"]);
assert.equal(engine.answer("Table; rows: Product; columns: ; values: Revenue; Department (North)").table.rows.at(-1)[1], "300");
const formattedEngine = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "Category", queryName: "Category", roles: { fields: true } },
  { displayName: "Margin", queryName: "Margin", roles: { measures: true }, format: "0.00%" },
  { displayName: "Price", queryName: "Price", roles: { measures: true }, format: "$#,0.00" }
], rows: [["A", 0.125, 1234.5]] }));
assert.equal(formattedEngine.answer("What is total margin?").kpi.value, "12.50%");
assert.equal(formattedEngine.answer("What is total price?").kpi.value, "$1,234.50");
const formattedChart = formattedEngine.answer("Show Margin by Category as a bar chart").chart;
assert.equal(formattedChart.valueLabels[0], "12.50%");
assert.equal(formattedChart.totalLabel, "12.50%");
engine.setDashboardDateRange(new Date("2026-01-01T00:00:00"), new Date("2026-01-31T23:59:59"));
assert.equal(engine.answer("What is total revenue?").kpi.value, "300");
assert.equal(engine.answerInDateRange("What is total revenue?", new Date("2026-02-01T00:00:00"), new Date("2026-02-28T23:59:59")).kpi.value, "170");
assert.equal(engine.answer("What is total revenue?").kpi.value, "300");
engine.setDashboardDateRange();
assert.equal(engine.answer("Show revenue by Product as a bar chart").chart.type, "bar");
assert.equal(engine.answer("Which Product has the highest revenue?").chart.labels[0], "Alpha");
const valueComparison = engine.answer("Compare revenue for Alpha and Beta");
assert.equal(valueComparison.table.rows.length, 3);
assert.deepEqual(valueComparison.table.rows[2], ["Grand Total", "380"]);
assert.equal(engine.answer("Show revenue by Month as a line chart").chart.type, "line");
const blankEngine = new GlobalQnaEngine(buildContext({ columns, rows: [
  [null, "North", "2026-01", 100, 30],
  ["Alpha", "North", "2026-01", 50, 20],
  [undefined, "South", "2026-02", null, 10]
] }));
const blankTable = blankEngine.answer("Show revenue by Product").table;
assert.ok(blankTable.rows.some((row) => row[0] === "(Blank)"));
assert.deepEqual(blankTable.rows.at(-1), ["Grand Total", "150"]);
const implicitCountChart = engine.answer("Show Alpha by Month as a line chart");
assert.equal(implicitCountChart.chart.type, "line");
assert.deepEqual(implicitCountChart.chart.labels, ["2026-01", "2026-02"]);
assert.deepEqual(implicitCountChart.chart.values, [1, 1]);
const implicitCountTable = engine.answer("Show Alpha by Month");
assert.deepEqual(implicitCountTable.table.rows.map((row) => row[0]), ["2026-01", "2026-02"]);
assert.equal(engine.answer("Show revenue by Product as a pie chart").chart.type, "pie");
assert.equal(engine.answer("Show revenue by Product as a donut chart").chart.type, "donut");
assert.equal(engine.answer("Show Revenue and Expense by Product as a stacked bar chart").chart.type, "stackedBar");
assert.equal(engine.answer("Show Revenue and Expense by Product as a stacked column chart").chart.type, "stackedColumn");
assert.equal(engine.answer("Show Revenue and Expense by Product as a combo chart").chart.type, "combo");
assert.equal(engine.answer("Show Revenue by Product as a waterfall chart").chart.type, "waterfall");
assert.equal(engine.answer("Show correlation between Revenue and Expense by Product").chart.type, "scatter");
assert.equal(engine.answer("Show share of Revenue by Product").chart.type, "treemap");
assert.equal(engine.answer("Show Revenue by Product as a funnel chart").chart.type, "funnel");
assert.equal(engine.answer("Show Revenue against Expense as a gauge").chart.type, "gauge");
assert.equal(engine.answer("Show Revenue and Expense by Product as a bullet chart").chart.type, "bullet");
const heatmap = engine.answer("Show Revenue by Department and Month as a heatmap").chart;
assert.equal(heatmap.type, "heatmap");
assert.ok(heatmap.series.length > 0);
assert.equal(engine.answer("Show Revenue by Department and Month as small multiples").chart.type, "smallMultiples");
assert.equal(engine.answer("Show Revenue by Month as a KPI trend").chart.type, "kpiTrend");
assert.equal(engine.answer("Show Revenue by Month as a sparkline").chart.type, "sparkline");
assert.equal(engine.answer("Show average Expense by Department").table.rows.length, 3);
const comparison = engine.answer("Show Revenue vs Expense in North as a bar chart");
assert.deepEqual(comparison.chart.labels, ["Revenue", "Expense"]);
assert.deepEqual(comparison.chart.values, [300, 160]);
const groupedComparison = engine.answer("Show Revenue and Expense by Department as a bar chart");
assert.equal(groupedComparison.chart.series.length, 2);
assert.deepEqual(groupedComparison.chart.labels, ["North", "South"]);
const selectedMultiMeasure = engine.answer("Show Revenue and Expense for Alpha and Beta");
assert.deepEqual(selectedMultiMeasure.table.rows, [["Alpha", "200", "115"], ["Beta", "180", "90"], ["Grand Total", "380", "205"]]);
const selectedMultiMeasureChart = engine.answer("Revenue vs Expense of Alpha Beta in chart");
assert.deepEqual(selectedMultiMeasureChart.chart.labels, ["Alpha", "Beta"]);
assert.deepEqual(selectedMultiMeasureChart.chart.series.map((series) => series.name), ["Revenue", "Expense"]);
assert.equal(selectedMultiMeasureChart.chart.axisTitle, "Product");
const multiFieldTable = engine.answer("Show Revenue and Expense by Department and Month in a table");
assert.deepEqual(multiFieldTable.table.columns, ["Department", "Month", "Revenue", "Expense"]);
assert.equal(multiFieldTable.table.rows.at(-1)[0], "Grand Total");
const singleFieldTable = engine.answer("Show Revenue by Product");
assert.equal(singleFieldTable.table.rows.at(-1)[0], "Grand Total");
const matrixWithColumns = engine.answer("Matrix; rows: Department; columns: Month; values: Revenue");
assert.equal(matrixWithColumns.table.columns.at(-1), "Total");
assert.equal(matrixWithColumns.table.rows.at(-1)[0], "Grand Total");
const matrixWithMultipleColumns = engine.answer("Matrix; rows: Product; columns: Department > Month; values: Revenue");
assert.ok(matrixWithMultipleColumns.table.columns.includes("North > 2026-01"));
assert.ok(matrixWithMultipleColumns.table.columns.includes("South > 2026-02"));
engine.setLayoutSettings({ cardinalityMaxColumnValues: 1 });
const temporalMatrix = engine.answer("Matrix; rows: Department; columns: Month; values: Revenue");
assert.ok(temporalMatrix.table.columns.includes("2026-01"));
assert.ok(temporalMatrix.table.columns.includes("2026-02"));
engine.setLayoutSettings({ cardinalityMaxColumnValues: 5 });
const calendarEngine = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "Month", queryName: "Month", roles: { fields: true } },
  { displayName: "Year", queryName: "Year", roles: { fields: true } },
  { displayName: "Rent", queryName: "Rent", roles: { measures: true } }
], rows: [["September", "2025", 9], ["January", "2025", 1], ["December", "2025", 12], ["March", "2025", 3], ["February", "2025", 2]] }));
const calendarMatrix = calendarEngine.answer("Matrix; rows: Month; columns: Year; values: Rent");
assert.deepEqual(calendarMatrix.table.rows.slice(0, 5).map((row) => row[0]), ["January", "February", "March", "September", "December"]);
const automaticCalendarMatrix = calendarEngine.answer("Show Rent by Year and Month");
assert.equal(automaticCalendarMatrix.table.matrix.rowHeader, "Month");
assert.ok(automaticCalendarMatrix.table.columns.includes("2025"));
assert.deepEqual(automaticCalendarMatrix.table.rows.slice(0, 5).map((row) => row[0]), ["January", "February", "March", "September", "December"]);
const explicitCalendarTable = calendarEngine.answer("Show Rent by Year and Month in a table");
assert.equal(explicitCalendarTable.table.matrix, undefined);
assert.deepEqual(explicitCalendarTable.table.columns.slice(0, 2), ["Year", "Month"]);
const periodLayoutEngine = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "Year", queryName: "Year", roles: { fields: true } },
  { displayName: "Month", queryName: "Month", roles: { fields: true } },
  { displayName: "Category", queryName: "Category", roles: { fields: true } },
  { displayName: "Sales", queryName: "Sales", roles: { measures: true } }
], rows: [["2025", "January", "Fashion", 10], ["2025", "February", "Electronics", 20], ["2026", "January", "Fashion", 30], ["2026", "February", "Electronics", 40]] }));
const singlePeriodOnly = periodLayoutEngine.answer("Show Sales by Year");
assert.equal(singlePeriodOnly.table.matrix, undefined);
assert.deepEqual(singlePeriodOnly.table.columns, ["Year", "Total Sales"]);
const singleMonthOnly = periodLayoutEngine.answer("Show Sales by Month");
assert.equal(singleMonthOnly.table.matrix, undefined);
assert.deepEqual(singleMonthOnly.table.columns, ["Month", "Total Sales"]);
const singlePeriodCategory = periodLayoutEngine.answer("Show Sales by Category and Year");
assert.equal(singlePeriodCategory.table.matrix.rowHeader, "Category");
assert.ok(singlePeriodCategory.table.columns.includes("2025"));
assert.ok(singlePeriodCategory.table.columns.includes("2026"));
const singleMonthCategory = periodLayoutEngine.answer("Show Sales by Category and Month");
assert.equal(singleMonthCategory.table.matrix.rowHeader, "Category");
assert.ok(singleMonthCategory.table.columns.includes("January"));
const multiPeriodOnly = periodLayoutEngine.answer("Show Sales by Year and Month");
assert.equal(multiPeriodOnly.table.matrix.rowHeader, "Month");
assert.ok(multiPeriodOnly.table.columns.includes("2025"));
const multiPeriodCategory = periodLayoutEngine.answer("Show Sales by Category, Year and Month");
assert.equal(multiPeriodCategory.table.matrix.rowHeader, "Month > Category");
assert.deepEqual(multiPeriodCategory.table.matrix.levels.slice(0, 4), [0, 1, 0, 1]);
assert.ok(multiPeriodCategory.table.matrix.hasChildren.some(Boolean));
const explicitPeriodChart = periodLayoutEngine.answer("Show Sales by Category and Year as a column chart");
assert.equal(explicitPeriodChart.chart.type, "column");
const geographyPeriodEngine = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "Year", queryName: "Year", roles: { fields: true } },
  { displayName: "Continent", queryName: "Continent", roles: { fields: true } },
  { displayName: "Country", queryName: "Country", roles: { fields: true } },
  { displayName: "Sales", queryName: "Sales", roles: { measures: true } }
], rows: [["2025", "Asia", "Saudi Arabia", 30], ["2025", "Asia", "Japan", 20], ["2025", "Europe", "France", 10], ["2026", "Asia", "Japan", 40]] }));
const singleYearCategoryHierarchy = geographyPeriodEngine.answer("Show Sales by Continent and Country, Year (2025)");
assert.equal(singleYearCategoryHierarchy.table.matrix.rowHeader, "Continent > Country");
assert.deepEqual(singleYearCategoryHierarchy.table.columns, ["Continent > Country", "Sales · 2025"]);
assert.ok(singleYearCategoryHierarchy.text.includes("for 2025"));
assert.equal(singleYearCategoryHierarchy.table.rows.at(-1)[1], "60");
const multiFieldChart = engine.answer("Show Revenue by Department and Month as a column chart");
assert.equal(multiFieldChart.chart.axisTitle, "Month");
assert.deepEqual(multiFieldChart.chart.labels, ["2026-01", "2026-02"]);
assert.deepEqual(multiFieldChart.chart.series.map((series) => series.name), ["North", "South"]);
const multiFieldLine = engine.answer("Show Revenue by Department and Month as a line chart");
assert.equal(multiFieldLine.chart.type, "line");
assert.deepEqual(multiFieldLine.chart.labels, ["2026-01", "2026-02"]);
assert.deepEqual(multiFieldLine.chart.series[0].values, [300, 0]);
const aliasedColumns = columns.map((column) => column.displayName === "Revenue" ? { ...column, displayName: "Sum of Sales", queryName: "Sum of Sales" } : column);
const aliasedEngine = new GlobalQnaEngine(buildContext({ columns: aliasedColumns, rows }));
assert.equal(aliasedEngine.answer("Show total sales for Alpha").kpi.value, "200");
const retailColumns = [
  { displayName: "Assigned Group", queryName: "Assigned Group", roles: { fields: true } },
  { displayName: "Assigned Sales Category", queryName: "Assigned Sales Category", roles: { fields: true } },
  { displayName: "Sum of Sales", queryName: "Sum of Sales", roles: { measures: true } },
  { displayName: "Sum of Rent", queryName: "Sum of Rent", roles: { measures: true } }
];
const retailRows = [["A", "Food", 100, 10], ["A", "Fashion", 200, 20], ["B", "Food", 300, 30]];
const retailEngine = new GlobalQnaEngine(buildContext({ columns: retailColumns, rows: retailRows }));
const rentOnly = retailEngine.answer("Table; rows: Assigned Sales Category; columns: ; values: Sum of Rent");
assert.deepEqual(rentOnly.table.columns, ["Assigned Sales Category", "Sum of Rent"]);
retailEngine.setLayoutSettings({ synonyms: { "Assigned Sales Category": ["segment"], "Sum of Rent": ["lease amount"] }, synonymEnabled: { "Assigned Sales Category": true, "Sum of Rent": true } });
const synonymAnswer = retailEngine.answer("Show lease amount by segment as a table");
assert.equal(synonymAnswer.table.columns[0], "segment");
assert.ok(synonymAnswer.table.columns[1].includes("lease amount"));
assert.ok(synonymAnswer.text.includes("lease amount") && synonymAnswer.text.includes("segment"));
assert.deepEqual(synonymAnswer.table.selectionFieldsByColumn[0], ["Assigned Sales Category"], "display synonyms must preserve the Power BI field identity");
const synonymChart = retailEngine.answer("Show lease amount by segment as a bar chart");
assert.ok(synonymChart.chart.title.includes("lease amount") && synonymChart.chart.title.includes("segment"));
assert.equal(synonymChart.chart.axisTitle, "Assigned Sales Category", "chart selection keeps the canonical field name");
assert.ok(retailEngine.autocomplete("lease", 10).some((item) => item.label === "lease amount"));
const overlappingEngine = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "FM", queryName: "Work.FM", roles: { fields: true } },
  { displayName: "FM Contracts", queryName: "Work.FMContracts", roles: { fields: true } },
  { displayName: "Rent", queryName: "Work.Rent", roles: { measures: true } }
], rows: [["A", "Contract 1", 10], ["B", "Contract 2", 20]] }));
assert.deepEqual(overlappingEngine.answer("Show Rent by FM Contracts as a table").table.columns, ["FM Contracts", "Total Rent"], "the longest complete field name wins over its prefix");
assert.deepEqual(overlappingEngine.answer("Show Rent by FM and FM Contracts as a table").table.columns.slice(0, 2), ["FM", "FM Contracts"], "separately mentioned overlapping fields remain available");
const overlappingValueEngine = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "Line Item", queryName: "Work.LineItem", roles: { fields: true } },
  { displayName: "Details", queryName: "Work.Details", roles: { fields: true } },
  { displayName: "Cost", queryName: "Work.Cost", roles: { measures: true } }
], rows: [["FM", "FM Contracts", 10], ["Other", "FM Contracts", 20], ["FM", "Other", 30]] }));
assert.equal(overlappingValueEngine.answer("Show total cost for FM Contracts").kpi.value, "30", "a longer value mention must not also activate its FM prefix");
assert.equal(overlappingValueEngine.answer("Show total cost for FM and FM Contracts").kpi.value, "10", "separately mentioned overlapping values remain active");
const periodEngine = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "Assigned Tenant Name", queryName: "Retail.Tenant", roles: { fields: true } },
  { displayName: "Month", queryName: "Retail.Month", roles: { fields: true } },
  { displayName: "Year", queryName: "Retail.Year", roles: { fields: true } },
  { displayName: "Rent Measure", queryName: "Retail.Rent", roles: { measures: true } }
], rows: [
  ["Home Living", "June", 2025, 100], ["Home Living", "June", 2026, 130],
  ["Comfort Store", "June", 2025, 40], ["Comfort Store", "June", 2026, 70],
  ["Home Living", "May", 2025, 999], ["Comfort Store", "May", 2026, 999]
] }));
const monthYearComparison = periodEngine.answer("Assigned Tenant Name June 2025 vs June 2026 Rent Measure").table;
assert.deepEqual(monthYearComparison.columns, ["Assigned Tenant Name", "June 2025", "June 2025 YTD", "June 2025 TTM", "June 2026", "June 2026 YTD", "June 2026 TTM"]);
assert.deepEqual(monthYearComparison.hiddenColumns, [2, 3, 5, 6]);
assert.deepEqual(monthYearComparison.ytdColumns, [{ sourceColumn: 1, ytdColumn: 2 }, { sourceColumn: 4, ytdColumn: 5 }]);
assert.deepEqual(monthYearComparison.ttmColumns, [{ sourceColumn: 1, ttmColumn: 3 }, { sourceColumn: 4, ttmColumn: 6 }]);
assert.deepEqual(monthYearComparison.rows, [["Comfort Store", "40", "40", "40", "70", "1,069", "1,069"], ["Home Living", "100", "1,099", "1,099", "130", "130", "130"], ["Grand Total", "140", "1,139", "1,139", "200", "1,199", "1,199"]]);
assert.deepEqual(monthYearComparison.cellIndices[1][1], [0], "June 2025 is one paired period");
assert.deepEqual(monthYearComparison.cellIndices[1][4], [1], "June 2026 is one paired period");
assert.deepEqual(monthYearComparison.selectionFieldsByColumn[0], ["Assigned Tenant Name"], "row selection keeps periods as background filters");
assert.deepEqual(monthYearComparison.selectionFieldsByColumn[1], ["Assigned Tenant Name", "Month", "Year"]);
assert.deepEqual(monthYearComparison.backgroundFields, ["Year", "Month"], "comparison periods are sent with row cross-filtering");
const singlePeriodTable = periodEngine.answer("show Rent Measure June 2025 by Assigned Tenant Name").table;
assert.deepEqual(singlePeriodTable.columns, ["Assigned Tenant Name", "June 2025", "June 2025 YTD", "June 2025 TTM"]);
assert.deepEqual(singlePeriodTable.hiddenColumns, [2, 3]);
assert.deepEqual(singlePeriodTable.ytdColumns, [{ sourceColumn: 1, ytdColumn: 2 }]);
assert.deepEqual(singlePeriodTable.ttmColumns, [{ sourceColumn: 1, ttmColumn: 3 }]);
assert.deepEqual(singlePeriodTable.rows[1], ["Home Living", "100", "1,099", "1,099"]);
assert.deepEqual(singlePeriodTable.backgroundFields, ["Year", "Month"]);
const singleValueSinglePeriod = periodEngine.answer("Home Living JUNE 2025 Rent Measure");
assert.equal(singleValueSinglePeriod.kpi.value, "100", "one field value and one period returns the filtered measure instead of an empty comparison table");
assert.equal(singleValueSinglePeriod.table, undefined);
assert.deepEqual(periodEngine.resolvedAnswerFilters("show Home Living by Year Rent Measure"), [{ field: "Assigned Tenant Name", values: ["Home Living"] }], "Edit exposes value filters inferred from the original question");
const calendarMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ttmRows = [2023, 2024, 2025].flatMap((year) => calendarMonths.map((month, monthIndex) => ["Home Living", month, year, year * 100 + monthIndex + 1]));
const ttmEngine = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "Assigned Tenant Name", queryName: "Retail.Tenant", roles: { fields: true } },
  { displayName: "Month", queryName: "Retail.Month", roles: { fields: true } },
  { displayName: "Year", queryName: "Retail.Year", roles: { fields: true } },
  { displayName: "Rent Measure", queryName: "Retail.Rent", roles: { measures: true } }
], rows: ttmRows }));
const juneTtm = ttmEngine.answer("Assigned Tenant Name June 2024 vs June 2025 Rent Measure").table;
const june2025TtmIndices = juneTtm.cellIndices[0][6];
assert.equal(june2025TtmIndices.length, 12, "June 2025 TTM contains exactly twelve months");
assert.deepEqual(june2025TtmIndices.map((index) => `${ttmRows[index][1]} ${ttmRows[index][2]}`), ["July 2024", "August 2024", "September 2024", "October 2024", "November 2024", "December 2024", "January 2025", "February 2025", "March 2025", "April 2025", "May 2025", "June 2025"]);
const yearComparison = periodEngine.answer("Assigned Tenant Name 2025 versus 2026 Rent Measure").table;
assert.deepEqual(yearComparison.columns, ["Assigned Tenant Name", "2025", "2025 YTD", "2025 TTM", "2026", "2026 YTD", "2026 TTM"]);
assert.deepEqual(yearComparison.rows[1], ["Home Living", "1,099", "1,099", "1,099", "130", "130", "130"]);
const hierarchy = retailEngine.answer("Matrix; rows: Assigned Group > Assigned Sales Category; columns: ; values: Sum of Rent");
assert.equal(hierarchy.table.matrix.rowHeader, "Assigned Group > Assigned Sales Category");
assert.deepEqual(hierarchy.table.matrix.levelNames, ["Assigned Group", "Assigned Sales Category"]);
assert.deepEqual(hierarchy.table.columns, ["Assigned Group > Assigned Sales Category", "Sum of Rent"]);
assert.ok(hierarchy.table.matrix.hasChildren.some(Boolean));
const oneChildEngine = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "Parent", queryName: "Model.Parent", roles: { fields: true } },
  { displayName: "Child", queryName: "Model.Child", roles: { fields: true } },
  { displayName: "Cost", queryName: "Model.Cost", roles: { measures: true } }
], rows: [["Parent A", "Child A", 10], ["Parent B", "Child B", 20]] }));
oneChildEngine.setLayoutSettings({ cardinalityLowToHighHierarchy: false });
const oneChildMatrix = oneChildEngine.answer("Matrix; rows: Parent > Child; columns: ; values: Cost").table;
assert.equal(oneChildMatrix.matrix, undefined, "one child per parent uses separate columns without redundant expand controls");
assert.deepEqual(oneChildMatrix.columns, ["Parent", "Child", "Cost"]);
const mixedChildEngine = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "Parent", queryName: "Model.Parent", roles: { fields: true } },
  { displayName: "Child", queryName: "Model.Child", roles: { fields: true } },
  { displayName: "Cost", queryName: "Model.Cost", roles: { measures: true } }
], rows: [["Parent A", "Child A1", 10], ["Parent A", "Child A2", 20], ["Parent B", "Child B", 30]] }));
mixedChildEngine.setLayoutSettings({ cardinalityLowToHighHierarchy: false });
assert.ok(mixedChildEngine.answer("Matrix; rows: Parent > Child; columns: ; values: Cost").table.matrix, "mixed child counts keep a consistent hierarchy");

const nullTotalEngine = new GlobalQnaEngine(buildContext({ columns: [
  { displayName: "Tenant", queryName: "Tenant", roles: { fields: true } },
  { displayName: "Rent", queryName: "Rent", roles: { measures: true } }
], rows: [["A", 40], ["B", 60]], totals: [null, null] }));
assert.equal(nullTotalEngine.answer("Show Rent by Tenant as a table").table.rows.at(-1)[1], "100");
const matrixCellContext = engine.answer("Matrix; rows: Product; columns: Month; values: Revenue").table;
assert.deepEqual(matrixCellContext.cellIndices[0][1], [0]);
assert.deepEqual(matrixCellContext.cellIndices[0][2], [3]);
assert.deepEqual(matrixCellContext.selectionFieldsByColumn[0], ["Product"]);
assert.deepEqual(matrixCellContext.selectionFieldsByColumn[1], ["Product", "Month"]);
engine.updateSelection([0], ["Product", "Month"]);
assert.equal(engine.selectionMatches([0], ["Product"]), false);
assert.equal(engine.selectionMatches([0], ["Product", "Month"]), true);
engine.updateSelection([0, 1]);
assert.equal(engine.selectionMatches([0]), true);
assert.equal(engine.selectionMatches([1]), true);
assert.equal(engine.answer("Show Revenue by Product").table.rows.at(-1)[1], "300");
assert.equal(engine.answerIgnoringSelection("Show Revenue by Product").table.rows.at(-1)[1], "470");
engine.updateSelection([]);
const scopedAnswer = engine.answer("Show Revenue by Product, Department (North)");
assert.deepEqual(scopedAnswer.table.backgroundFields, ["Department"]);
assert.deepEqual(engine.answer("Show Revenue by Product").table.backgroundFields, [], "answer context must not leak into another answer");
assert.deepEqual(engine.answer("Show Revenue by Product, Department (North)").table.backgroundFields, ["Department"], "cached answers retain their own context");
const selectedAnswerIndices = scopedAnswer.table.rowIndices[0];
const scopedFilters = buildSelectionFilters(["Product", ...scopedAnswer.table.backgroundFields].map((name) => {
  const index = columns.findIndex((column) => column.displayName === name);
  return { target: { table: "Retail", column: name }, supported: true, rawValues: [...new Set(selectedAnswerIndices.map((row) => rows[row][index]))] };
}));
filterCalls.length = 0;
applySelectionFilter(filterHost, selectedAnswerIndices, scopedFilters.map((filter) => filter.toJSON()));
assert.deepEqual(filterCalls.at(-1)[0].map((filter) => [filter.target.column, filter.values]), [["Product", ["Alpha"]], ["Department", ["North"]]], "host receives hidden answer context in the same filter array");
applySelectionFilter(filterHost, [], []);
assert.deepEqual(filterCalls.at(-1), [null, "general", "filter", 1]);
const rangedAnswer = engine.answerInDateRange("Show Revenue by Product", new Date("2026-01-01T00:00:00"), new Date("2026-01-31T23:59:59"));
assert.deepEqual(rangedAnswer.table.backgroundFields, ["Month"]);
assert.deepEqual(engine.answer("Show Revenue by Product").table.backgroundFields, []);
console.log("Global Q&A checks passed.");
for (const chartType of ["bar", "column", "line", "pie", "combo"]) {
  const chartAnswer = engine.answer(`Show Revenue by Month as a ${chartType} chart, Department (North)`);
  assert.equal(chartAnswer.chart.axisTitle, "Month", `${chartType} must expose its category field for selection`);
  assert.deepEqual(chartAnswer.chart.backgroundFields, ["Department"]);
  const index = chartAnswer.chart.labels.indexOf("2026-01");
  assert.ok(index >= 0);
  assert.ok(chartAnswer.chart.rowIndices[index].every((row) => rows[row][1] === "North" && rows[row][2] === "2026-01"));
}

// A new answer built under a prior selection must keep that selection's context.
engine.updateSelection([0], ["Product"], ["Department"]);
const inheritedAnswer = engine.answer("Show Revenue by Month as a bar chart");
assert.deepEqual(new Set(inheritedAnswer.chart.backgroundFields), new Set(["Product", "Department"]));
assert.equal(engine.selectionMatches([0], ["Product"]), true, "background fields must not alter highlight scope");
engine.updateSelection([]);
assert.deepEqual(engine.answer("Show Revenue by Month as a bar chart").chart.backgroundFields, [], "clearing selection removes inherited context");

const filterQuestion = engine.withAnswerFilters("Table; rows: Product; columns: ; values: Revenue", [{ field: "Department", values: ["North"] }, { field: "Month", values: ["2026-01"] }]);
assert.deepEqual(engine.answerFilters(filterQuestion), [{ field: "Department", values: ["North"] }, { field: "Month", values: ["2026-01"] }]);
assert.deepEqual(engine.answerFilters("Show Revenue, Department (North | South)"), [{ field: "Department", values: ["North", "South"] }]);
assert.deepEqual(engine.answerFilters("Show Revenue, Department (North or South)"), [{ field: "Department", values: ["North", "South"] }]);
assert.deepEqual(engine.answerFilters("Show Revenue, Department (North and South)"), [{ field: "Department", values: ["North", "South"] }]);
assert.deepEqual(engine.answerFilters("Show Revenue, Department (North / South)"), [{ field: "Department", values: ["North", "South"] }]);
assert.equal(engine.answer(filterQuestion).table.rows.at(-1)[1], "300");
assert.deepEqual(new Set(engine.answer(filterQuestion).table.backgroundFields), new Set(["Department", "Month"]));
assert.equal(engine.answer(engine.withAnswerFilters(filterQuestion, [])).table.rows.at(-1)[1], "470");
assert.equal(engine.answer(engine.withAnswerFilters(filterQuestion, [{ field: "Department", values: ["North", "South"] }])).table.rows.at(-1)[1], "470");
assert.deepEqual(engine.fieldFilterValues("Department", "nor"), ["North"]);
const punctuation = [{ field: "Department", values: ["A, B | (C); D"] }];
assert.deepEqual(engine.answerFilters(engine.withAnswerFilters(filterQuestion, punctuation)), punctuation);
const naturalQuestion = "Rent Measure by Product by Month";
const naturalFiltered = engine.withAnswerFilters(naturalQuestion, [{ field: "Department", values: ["North"] }]);
assert.ok(naturalFiltered.startsWith(naturalQuestion + "; answerFilters:"), "filter-only editing preserves the original question wording");
assert.deepEqual(engine.answerFilters(naturalFiltered), [{ field: "Department", values: ["North"] }]);
const matrixToTable = engine.answer("Table; rows: Product > Month; columns: ; values: Revenue");
assert.deepEqual(matrixToTable.table.columns, ["Product", "Month", "Revenue"], "matrix column fields remain visible when converted to table fields");

// Refresh must never treat unfinished composer text as a submitted question.
{
  const { GlobalQnaUi } = require('../.tmp/test/qna/ui');
  for (const automatic of [true, false]) {
    const submitted = [];
    const ui = { automaticGroupingEnabled: () => automatic, showingSavedDashboard: false,
      questions: [], hasConversation: false, input: { value: 'unfinished question' },
      messages: { scrollTop: 0 }, submit: (...args) => submitted.push(args),
      clear: () => { throw new Error('Refresh must preserve a draft'); }, setRefreshAvailable() {} };
    GlobalQnaUi.prototype.refreshCurrentView.call(ui);
    assert.deepEqual(submitted, []);
    assert.equal(ui.input.value, 'unfinished question');
    if (automatic) {
      ui.questions = ['Rent by Year'];
      GlobalQnaUi.prototype.refreshCurrentView.call(ui);
      assert.deepEqual(submitted, [['Rent by Year', true, true]]);
      assert.equal(ui.input.value, 'unfinished question');
    }
  }
}

(async () => {
  const { GlobalQnaUi } = require('../.tmp/test/qna/ui');
  let rejectRequest; let requests = 0;
  const ui = { input: {value: 'Rent by Year'}, automaticGroupingEnabled: () => false,
    questionRequest: 0, clearQuestionSelection(){},renderInputHighlight(){}, closeSuggestions(){}, addBubble(){}, showRequestFailure(){}, setLoadingStage(){},
    prepareQuestion(){ requests++; return new Promise((resolve, reject) => { rejectRequest = reject; }); } };
  const first = GlobalQnaUi.prototype.submit.call(ui);
  assert.equal(ui.input.value, '', 'Ask clears the composer before awaiting Power BI');
  ui.input.value = 'Next question draft';
  await GlobalQnaUi.prototype.submit.call(ui, 'Rent by Year');
  assert.equal(requests, 1, 'duplicate submission does not restart the pending query');
  rejectRequest(new Error('Host unavailable')); await first;
  assert.equal(ui.input.value, 'Next question draft', 'completion must preserve newer typing');
  assert.equal(ui.pendingQuestion, undefined, 'failure permits retry');
})().catch(error => { console.error(error); process.exitCode = 1; });

{
 const { indexGroupRows, collectTextValues } = require('../.tmp/test/queryPerformance');
 const rows = [['A','2024','1'],['B','2025','2'],['A','2024','3'],['A|B','2024','4']];
 const indices = indexGroupRows(rows, 2);
 for (const row of rows) { const key = JSON.stringify(row.slice(0,2)); assert.equal(indices.get(key),rows.findIndex(candidate=>JSON.stringify(candidate.slice(0,2))===key)); }
 const large = Array.from({length:30000},(_,i)=>['Tenant '+i, '2025']);
 assert.equal(indexGroupRows(large,2).get(JSON.stringify(['Tenant 29999','2025'])),29999);
 const values = collectTextValues(['Existing'], [['A'],[null],[12],['A'],['B'],['C']],0,3);
 assert.deepEqual(values,['Existing','A','B']);
 assert.deepEqual(collectTextValues([],large,0),large.slice(0,10000).map(row=>row[0]));
}

{
 const {virtualRowWindow} = require('../.tmp/test/qna/virtualRows');
 for (const count of [0,1,201,1000,30000]) {
   for (const top of [-100,0,360,10000000]) {
     const range = virtualRowWindow(count,top,600);
     assert(range.start>=0 && range.end<=count && range.start<=range.end);
     assert(range.end-range.start<=33,'DOM row count stays bounded');
     assert.equal(range.before+(range.end-range.start)*36+range.after,count*36,'spacers preserve the full scroll height');
   }
 }
 const rows=Array.from({length:30000},(_,i)=>({id:i,value:30000-i}));
 const filtered=rows.filter(row=>row.id%2===0).sort((a,b)=>a.value-b.value);
 const range=virtualRowWindow(filtered.length,3600,600);
 assert.equal(filtered.slice(range.start,range.end)[0],filtered[range.start],'window preserves original row identity');
 assert.equal(rows.length,30000,'windowing does not truncate export data');
 assert.equal(virtualRowWindow(30000,10000000,600).end,30000,'last row stays reachable');
}

(async () => {
 const {GlobalQnaUi} = require('../.tmp/test/qna/ui');
 const originalDocument = global.document;
 const node = () => ({children:[], handlers:{}, classList:{add(){}}, append(...items){this.children.push(...items)}, appendChild(item){this.children.push(item)}, replaceChildren(){this.children=[]}, setAttribute(){}, remove(){this.removed=true}, addEventListener(name,handler){this.handlers[name]=handler}});
 global.document={createElement:node};
 const ui=Object.create(GlobalQnaUi.prototype);
 Object.assign(ui,{input:{value:'Rent by Year'},questions:[],messages:node(),questionRequest:0,automaticGroupingEnabled:()=>true,engine:{getLayoutSettings:()=>({conversationMode:'latest'})},clearQuestionSelection(){},renderInputHighlight(){},closeSuggestions(){},addBubble(){},displayQuestion:x=>x});
 let rejectQuery;
 ui.prepareQuestion=()=>new Promise((resolve,reject)=>{rejectQuery=reject});
 ui.cancelQuestion=()=>rejectQuery(new Error('cancelled'));
 try {
  const running=ui.submit();
  const loading=ui.messages.children[0];
  ui.setLoadingStage('Waiting for Power BI…'); assert.equal(loading.children[1].children[2].textContent,'Waiting for Power BI…');
  assert.equal(loading.children[1].children[0].textContent,'Working on your question…');
  ui.input.value='Next draft';
  loading.children[2].handlers.click();
  await running;
  assert.equal(ui.pendingQuestion,undefined);
  assert.equal(loading.removed,true);
  const notice=ui.messages.children.at(-1);
  assert.equal(notice.children[1].textContent,'Retry');
  let retryArgs; ui.submit=(...args)=>{retryArgs=args};
  notice.children[1].handlers.click();
  assert.deepEqual(retryArgs,['Rent by Year',true,false,true]);
  assert.equal(ui.input.value,'Next draft');
 } finally {global.document=originalDocument;}
})().catch(error=>{console.error(error);process.exitCode=1});

{
 const {comparisonHeading,comparisonPartner}=require('../.tmp/test/qna/comparisonLayout');
 assert.deepEqual(comparisonHeading('2024 · Rent Measure'),{group:'2024',leaf:'Rent Measure'});
 assert.deepEqual(comparisonHeading('June 2025 YTD'),{group:'2025',leaf:'June · YTD'});
 assert.equal(comparisonPartner(['Tenant','2024 Rent Measure','2024 Sales Measure','2025 Rent Measure','2025 Sales Measure'],3),1);
 assert.equal(comparisonPartner(['Tenant','2023 Rent','2024 Rent','2025 Rent'],3),undefined,'ambiguous baseline is not guessed');
 assert.equal(comparisonPartner(['Tenant','June 2024','June 2025'],2),1);
 assert.equal(comparisonPartner(['Tenant','June 2024 YTD','June 2025 YTD'],2),undefined);
 const {GlobalQnaUi}=require('../.tmp/test/qna/ui');
 const calculate=values=>GlobalQnaUi.prototype.evaluateFormula.call({},'([2025 Rent] - [2024 Rent]) / ABS([2024 Rent])',new Map(values));
 assert.equal(calculate([['2025 Rent',120],['2024 Rent',100]]),.2);
 assert.equal(calculate([['2025 Rent',-80],['2024 Rent',-100]]),.2);
 assert.throws(()=>calculate([['2025 Rent',120],['2024 Rent',0]]),/Division by zero/);
}

{
 const {formatPowerBiValue}=require('../.tmp/test/dataAdapter');
 assert.equal(formatPowerBiValue(23276199,'0'),new Intl.NumberFormat(undefined,{maximumFractionDigits:0}).format(23276199));
 assert.equal(formatPowerBiValue(1234.5,'$#,##0.00'),'$'+new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).format(1234.5));
 assert.equal(formatPowerBiValue(.125,'0.0%'),new Intl.NumberFormat(undefined,{minimumFractionDigits:1,maximumFractionDigits:1}).format(12.5)+'%');
 const {GlobalQnaUi}=require('../.tmp/test/qna/ui');
 assert.equal(GlobalQnaUi.prototype.color(0,'Sales Measure'),GlobalQnaUi.prototype.color(3,'Sales Measure'),'measure color survives series reordering');
}
