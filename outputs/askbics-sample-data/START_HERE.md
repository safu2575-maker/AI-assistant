# askBICS sample data

All records are synthetic. No actual business results are represented. Currency: QAR (Qatari riyal). Fictional amounts are unchanged; no exchange-rate conversion was applied.

## Import and bind

1. In Power BI Desktop, choose Home > Get data > Text/CSV and select askBICS_Sample_Retail_Data.csv. Use UTF-8 encoding and comma delimiter.
2. Choose Transform Data and confirm Date is Date; Year and the nine numeric metrics are Whole number; Month, Record ID, Unit and descriptive fields are Text. Load the table.
3. Add the askBICS visual. For the first test, put Assigned Tenant Name, Unit, Assigned Sales Category, Assigned Group, City, Region, Mall, Floor, Zone, Month, Year, Quarter and Record ID in Fields. Record ID preserves the 864-row grain. Month is deliberately YYYY-MM text for sorting. Date is available for later date testing.
4. Add Sales, Cost, Rent, Target, Transactions, Items Sold, Footfall, Profit and Variance to Measures and KPIs with Sum aggregation. If Power BI prefixes the names with Sum of, rename them for this visual to the original column names to match the test questions.
5. Start with no report filters. Ask: Show total sales for Tech Hub. Expected answer: 19,417,060 QAR.
6. Try the questions in askBICS_Test_Questions.csv and compare with askBICS_Expected_Results.csv. These support CSVs are reference files; do not append them to the main data or bind them to the assistant.

## What the data covers

864 rows = 24 months (January 2024–December 2025) x 36 stores. There are 12 fictional tenants, four categories, three cities and three malls. All amount and count columns can be summed across these disjoint store-month rows. Profit = Sales - Cost. Variance = Sales - Target. As CSV does not store formulas, these two columns are materialized calculated values.

Total Sales: 124,553,658 QAR. Highest tenant: Tech Hub (19,417,060 QAR). Lowest tenant: Sweet Spot (4,843,567 QAR).

## Current feature boundaries

This dataset supports chart, table, comparison, ranking, filtering and trend development. The current assistant parser recognizes bar, column, line, area and donut chart requests. Pie requests map to donut. Not every question or chart request is guaranteed to work: the question file includes actual local engine observations so failures can guide development. These observations do not validate the UI or Power BI interactions.

Charts rendered by this custom visual are inside askBICS; the current implementation does not insert separate native Power BI visual objects onto a report page. A true pie, scatter, waterfall and other chart types remain development tasks. The assistant sees only fields and measures bound to it, subject to report filters.

Do not sum monthly margin percentages for comparison. For later margin development, calculate SUM(Profit) / SUM(Sales) at the requested grouping. To count physical stores use distinct Unit, not the number of monthly rows.

Power BI import reference: https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-data-sources
