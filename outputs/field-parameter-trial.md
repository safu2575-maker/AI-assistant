# askBICS field parameter trial

Status: report-side experiment, not yet verified in Power BI. No visual runtime changes are required for the initial trial. The adapter reads the incoming field names on each data update; this does not prove host compatibility or automatic parameter selection.

## Set up an isolated test page

1. Duplicate the report page and add a fresh askBICS visual so saved questions and cross-filters do not affect the test.
2. In Power BI Desktop choose Modeling > New parameter > Fields.
3. Name it `AskBICS Group By`. Select the actual Year column (not the full date hierarchy), City, and Assigned Tenant Name. Enable adding a slicer to the page, then create it. Use this wizard rather than creating an ordinary calculated table: field parameters need model metadata.
4. In the new askBICS visual, remove the individually assigned dimensions from its Fields well. Add only the new field parameter there. Keep only the explicit Rent Measure in Measures and KPIs. Do not keep Record ID, Unit, or date hierarchy fields alongside the parameter.
5. Set the parameter slicer to single selection and select Year. Do not clear its selection; no selection can mean all parameter fields.
6. Add a native Power BI table with the same parameter and Rent Measure as a reference. Confirm the slicer filters both visuals through Edit interactions.

## Verify each case

| Parameter selection | Question to enter after switching | Expected result grouping |
| --- | --- | --- |
| Year | Show Rent Measure by Year | Year only |
| City | Show Rent Measure by City | City only |
| Assigned Tenant Name | Show Rent Measure by Assigned Tenant Name | Tenant only |

Compare each detail value and the grand total with the native table. Do not assume a matching grand total proves all detail rows were loaded.

Use Performance analyzer to record a refresh and copy the askBICS query for each selection. Inspect the main result query, not just the small query that resolves parameter metadata. With Year selected, the main grouping should be Year; City, Tenant, Record ID and Unit should not remain grouping columns. Power BI may include supporting sort columns. The generated TOPN window can remain 30001 even when only a few result rows exist.

For a tenant-filter test, add a separate slicer on the actual Assigned Tenant Name column and select Home Living. Keep the grouping parameter on Year. Compare yearly results with the native table. Do not assume askBICS can infer an unloaded tenant value from the question in this first trial.

## Pass criteria and next step

- The native table resolves the parameter correctly.
- askBICS receives the selected actual field and correct measure values.
- The main query uses the selected grouping rather than all original dimensions.
- Switching selections refreshes correctly and reference values match.

If the native table works but askBICS does not, retain the generated query and the visible error/result for investigation. This identifies custom-visual compatibility separately from model setup problems.

This trial uses a user-operated slicer. It does not implement question-driven parameter switching. Only after this passes should we test whether a supported parameter-filter interaction can trigger a host requery from askBICS, including resolving fields/values absent from the current data view. YTD/TTM, saved answers and cross-filtering require separate regression checks.

Microsoft documents that its built-in AI/Q&A visuals do not support field parameters; that statement does not establish whether this separately implemented custom visual works. Test it explicitly.

Reference: https://learn.microsoft.com/en-us/power-bi/create-reports/power-bi-field-parameters
