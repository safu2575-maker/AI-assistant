const assert = require("node:assert/strict");
const { buildContext } = require("../.tmp/test/dataAdapter");
const { GlobalQnaEngine } = require("../.tmp/test/qna/engine");

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
assert.ok(engine.autocomplete("@rev").some((item) => item.label === "Revenue"));
assert.deepEqual(engine.autocomplete("as", 4).map((item) => item.label), ["as a table", "as a matrix", "as a bar chart", "as a column chart"]);
assert.ok(engine.autocomplete("as a", 8, "show Revenue by Department as a").some((item) => item.label === "as a bar chart"));
assert.equal(engine.autocomplete("as a b", 8, "show Revenue by Department as a b")[0].label, "as a bar chart");
assert.equal(engine.autocomplete("as a line")[0].label, "as a line chart");
assert.deepEqual(engine.autocomplete("as", 8, "show Revenue as").map((item) => item.label), ["as a KPI", "as a table"]);
assert.ok(engine.autocomplete("as", 8, "show Revenue by Department as").some((item) => item.label === "as a bar chart"));
assert.ok(!engine.autocomplete("as", 8, "show Revenue by Department as").some((item) => item.label === "as a matrix"));
assert.equal(engine.autocomplete("a bar chart", 8, "show Revenue by Department as a bar chart").filter((item) => item.detail === "Visual").length, 0);
assert.equal(engine.answer("What is total revenue?").kpi.value, "470");
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
assert.deepEqual(implicitCountTable.table.rows.map((row) => row[0]), ["2026-01", "2026-02", "Grand Total"]);
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
const hierarchy = retailEngine.answer("Matrix; rows: Assigned Group > Assigned Sales Category; columns: ; values: Sum of Rent");
assert.equal(hierarchy.table.matrix.rowHeader, "Assigned Group > Assigned Sales Category");
assert.deepEqual(hierarchy.table.columns, ["Assigned Group > Assigned Sales Category", "Sum of Rent"]);
assert.ok(hierarchy.table.matrix.hasChildren.some(Boolean));
console.log("Global Q&A checks passed.");
