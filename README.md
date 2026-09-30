# askBICS Assistant

askBICS Assistant is a standalone, global natural-language Q&A visual for Power BI. It works only with the fields and measures assigned to the visual and has no connection to RetailBICS or any domain-specific map.

## Current capabilities

- Totals, averages, minimum, maximum, counts and distinct counts
- Tables grouped by any loaded field
- Bar, column, line, area and donut charts
- Top, bottom, highest and lowest rankings
- Comparisons between field values
- Filters inferred from loaded field values
- Trends using loaded date or period fields
- Autocomplete for fields, measures and values
- Power BI row selection from table rows and chart marks

The runtime uses generic concepts only: fields, measures, values, filters, aggregations and row indices. It does not contain map, heatmap, geometry, tenant, floor, zone, unit, occupancy or bookmark functionality.

## Build and test

```text
npm install
npm run build
npm test
npm run package
```

The `.pbiviz` package is written to `dist`.
