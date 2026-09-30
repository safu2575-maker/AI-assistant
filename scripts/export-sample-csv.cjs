const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const dir = path.resolve('outputs/askbics-sample-data');
const {rows, checks} = JSON.parse(fs.readFileSync(path.join(dir, 'sample-data.json'), 'utf8'));
for (const r of rows) {
  r.Currency = 'QAR';
  r.Profit = r.Sales - r.Cost;
  r.Variance = r.Sales - r['Sales Target']; r.Target = r['Sales Target']; delete r['Sales Target'];
}
const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
function csv(file, records) {
  const headers = Object.keys(records[0]);
  fs.writeFileSync(path.join(dir, file), '\uFEFF' + [headers, ...records.map(r=>headers.map(h=>r[h]))].map(r=>r.map(quote).join(',')).join('\r\n') + '\r\n');
}
csv('askBICS_Sample_Retail_Data.csv', rows);
const lookup = (field, value, metric='Sales') => rows.filter(r=>r[field]===value).reduce((sum,r)=>sum+r[metric],0);
const specs = [
 ['Total','What is total sales?',`Sales = ${checks.totalSales} QAR`],
 ['Lookup','Show total sales for Tech Hub',`Sales = ${lookup('Assigned Tenant Name','Tech Hub')} QAR`],
 ['Highest','Which tenant has the highest sales?',`Tech Hub; ${checks.tenants[0][1]} QAR`],
 ['Lowest','Which tenant has the lowest sales?',`Sweet Spot; ${checks.tenants.at(-1)[1]} QAR`],
 ['Top five','Show top 5 tenants by sales',checks.tenants.slice(0,5).map(([n,v])=>`${n}: ${v}`).join('; ')],
 ['Bottom three','Show bottom 3 tenants by sales',checks.tenants.slice(-3).reverse().map(([n,v])=>`${n}: ${v}`).join('; ')],
 ['Comparison','Compare sales for Tech Hub and Digital World',`Tech Hub: ${lookup('Assigned Tenant Name','Tech Hub')}; Digital World: ${lookup('Assigned Tenant Name','Digital World')}`],
 ['Bar chart','Show sales by category as a bar chart',checks.categories.map(([n,v])=>`${n}: ${v}`).join('; ')],
 ['Column chart','Show sales by tenant as a column chart',`12 tenants; total ${checks.totalSales} QAR`],
 ['Pie request','Show sales by category as a pie chart','Four categories. Current parser maps pie requests to donut; a true pie chart is a future feature.'],
 ['Donut chart','Show sales by category as a donut chart',`Four categories; total ${checks.totalSales} QAR`],
 ['Table','Show sales and profit by tenant in a table',`12 tenants; Sales = ${checks.totalSales}; Profit = ${checks.totalProfit}`],
 ['City','Show sales by City',checks.cities.map(([n,v])=>`${n}: ${v}`).join('; ')],
 ['Filter','Show sales for Riyadh',`Sales = ${lookup('City','Riyadh')} QAR`],
 ['Year filter','Show sales for 2025',`Sales = ${lookup('Year',2025)} QAR`],
 ['Trend','Show sales by Month as a line chart',`24 monthly points in YYYY-MM order; total ${checks.totalSales} QAR`],
 ['Area chart','Show sales by Month as an area chart',`24 monthly points; total ${checks.totalSales} QAR`],
 ['Matrix','Show sales with category as rows and City as columns',`4 categories x 3 cities; total ${checks.totalSales} QAR`],
 ['Profit','What is total profit?',`Gross profit = ${checks.totalProfit} QAR (Sales minus Cost; before Rent)`],
 ['Rent','What is total rent?',`Rent = ${checks.totalRent} QAR`],
 ['Target','Compare sales and target',`Sales = ${checks.totalSales}; Target = ${checks.totalSalesTarget}`],
 ['Future scatter','Create a scatter plot of footfall versus sales by tenant','Future development test; not currently a supported chart type.'],
 ['Future waterfall','Create a waterfall chart from sales to cost to profit','Future development test; not currently a supported chart type.']
];
const metrics = ['Sales','Cost','Rent','Target','Transactions','Items Sold','Footfall','Profit','Variance'];
const dimensions = ['Record ID','Month','Year','Quarter','Assigned Tenant Name','Unit','Assigned Sales Category','Assigned Group','City','Region','Mall','Floor','Zone'];
const {buildContext} = require('../.tmp/test/dataAdapter');
const {VisualAssistantEngine} = require('../.tmp/test/assistant/assistantEngine');
const names = dimensions.concat(metrics);
const table = {columns:names.map(n=>({displayName:n,queryName:n,roles:{[metrics.includes(n)?'measures':'fields']:true}})), rows:rows.map(r=>names.map(n=>r[n]))};
const context = buildContext(table);
assert.equal(context.getMetricValue('Sales',rows.map((_,i)=>i)),checks.totalSales);
assert.equal(context.getMetricValue('Profit',rows.map((_,i)=>i)),checks.totalProfit);
const engine = new VisualAssistantEngine(context);
const questions = specs.map(([type,question,expected],i)=>{
  let observation = 'Future feature; not executed';
  if (!type.startsWith('Future')) {
    const response=engine.answer(question);
    observation=`handled=${response.handled}; output=${response.chart?.type || (response.matrix?'matrix':response.table?'table':'text')}; ${response.text || ''}`;
  }
  return {'Test ID':i+1,Type:type,Question:question,'Expected result with no report filters':expected,'Local engine observation (not Power BI UI validation)':observation};
});
csv('askBICS_Test_Questions.csv',questions);
const expected = [
  {Group:'All data',Label:'Record count',Value:rows.length,Unit:'rows'},
  {Group:'All data',Label:'Sales',Value:checks.totalSales,Unit:'QAR'},
  {Group:'All data',Label:'Profit',Value:checks.totalProfit,Unit:'QAR'},
  ...[['Tenant',checks.tenants],['Category',checks.categories],['City',checks.cities],['Year',checks.years],['Month',checks.months]].flatMap(([group,list])=>list.map(([label,value])=>({Group:group,Label:label,Value:value,Unit:'QAR sales'})))
];
csv('askBICS_Expected_Results.csv',expected);
const definitions = {'Currency':'QAR (Qatari riyal); all monetary columns use this currency.','Record ID':'Unique store-month row identifier.','Date':'Month start, YYYY-MM-DD.','Month':'Year-month text for sortable monthly charts.','Year':'Calendar year; use as a field, not a summed measure.','Profit':'Sales minus Cost; gross profit before rent.','Variance':'Sales minus Target. Negative means below target.','Unit':'Store identifier; 36 stores, repeated monthly.','Assigned Tenant Name':'Fictional tenant; 12 tenants, each with three stores.','Sales':'Monthly sales in QAR.','Cost':'Monthly cost of goods sold in QAR.','Rent':'Monthly rent expense in QAR.','Target':'Monthly sales target in QAR.','Transactions':'Monthly count of purchases.','Items Sold':'Monthly count of items sold.','Footfall':'Monthly estimated visits; not unique people.'};
csv('askBICS_Data_Dictionary.csv',Object.keys(rows[0]).map(name=>({Field:name,'Power BI type':name==='Date'?'Date':typeof rows[0][name]==='number'?'Whole number':'Text','askBICS bucket':metrics.includes(name)?'Measures and KPIs (Sum)':'Fields (do not summarize)',Definition:definitions[name]||'Descriptive grouping field.'})));
fs.writeFileSync(path.join(dir,'START_HERE.md'),`# askBICS sample data\n\nAll records are synthetic. No actual business results are represented. Currency: QAR (Qatari riyal). Fictional amounts are unchanged; no exchange-rate conversion was applied.\n\n## Import and bind\n\n1. In Power BI Desktop, choose Home > Get data > Text/CSV and select askBICS_Sample_Retail_Data.csv. Use UTF-8 encoding and comma delimiter.\n2. Choose Transform Data and confirm Date is Date; Year and the nine numeric metrics are Whole number; Month, Record ID, Unit and descriptive fields are Text. Load the table.\n3. Add the askBICS visual. For the first test, put Assigned Tenant Name, Unit, Assigned Sales Category, Assigned Group, City, Region, Mall, Floor, Zone, Month, Year, Quarter and Record ID in Fields. Record ID preserves the 864-row grain. Month is deliberately YYYY-MM text for sorting. Date is available for later date testing.\n4. Add Sales, Cost, Rent, Target, Transactions, Items Sold, Footfall, Profit and Variance to Measures and KPIs with Sum aggregation. If Power BI prefixes the names with Sum of, rename them for this visual to the original column names to match the test questions.\n5. Start with no report filters. Ask: Show total sales for Tech Hub. Expected answer: ${checks.tenants[0][1].toLocaleString('en-US')} QAR.\n6. Try the questions in askBICS_Test_Questions.csv and compare with askBICS_Expected_Results.csv. These support CSVs are reference files; do not append them to the main data or bind them to the assistant.\n\n## What the data covers\n\n864 rows = 24 months (January 2024–December 2025) x 36 stores. There are 12 fictional tenants, four categories, three cities and three malls. All amount and count columns can be summed across these disjoint store-month rows. Profit = Sales - Cost. Variance = Sales - Target. As CSV does not store formulas, these two columns are materialized calculated values.\n\nTotal Sales: ${checks.totalSales.toLocaleString('en-US')} QAR. Highest tenant: Tech Hub (${checks.tenants[0][1].toLocaleString('en-US')} QAR). Lowest tenant: Sweet Spot (${checks.tenants.at(-1)[1].toLocaleString('en-US')} QAR).\n\n## Current feature boundaries\n\nThis dataset supports chart, table, comparison, ranking, filtering and trend development. The current assistant parser recognizes bar, column, line, area and donut chart requests. Pie requests map to donut. Not every question or chart request is guaranteed to work: the question file includes actual local engine observations so failures can guide development. These observations do not validate the UI or Power BI interactions.\n\nCharts rendered by this custom visual are inside askBICS; the current implementation does not insert separate native Power BI visual objects onto a report page. A true pie, scatter, waterfall and other chart types remain development tasks. The assistant sees only fields and measures bound to it, subject to report filters.\n\nDo not sum monthly margin percentages for comparison. For later margin development, calculate SUM(Profit) / SUM(Sales) at the requested grouping. To count physical stores use distinct Unit, not the number of monthly rows.\n\nPower BI import reference: https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-data-sources\n`);
console.log(JSON.stringify({files:fs.readdirSync(dir).filter(f=>f.endsWith('.csv')),rows:rows.length,columns:Object.keys(rows[0]).length,tests:questions.length,checks},null,2));
