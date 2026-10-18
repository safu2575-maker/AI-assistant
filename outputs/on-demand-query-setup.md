# Cache retention for conversation updates: 2.9.8.0

The visual records its own pending conversation-property saves (bounded to eight, acknowledged within five seconds). An update echoing that exact saved state retains query caches only when the data, filters, schema and non-conversation metadata match the recorded/current signatures. Such echoes cannot acknowledge a pending model query. Changed data or unknown updates still invalidate conservatively, including identical visible values without a tracked UI write.

Query keys include physical field mappings. Cache hits promote entries within the existing 24-entry LRU and rebuild answers with their semantic selection metadata. Clear without a selected report filter remains a UI-only operation. This optimization does not assume every identical-looking host data update has the same hidden model context, and does not cache failed requests.

Tests cover own Clear/save echoes, changed-data echoes, unknown updates, model mapping changes and existing request/cross-filter regressions. Live Power BI latency remains host-dependent. No package built.

---

# Clear and no-response recovery: 2.9.7.0

Clear no longer resets global model filters when there is no selected model row/cell. Idle partial owned-filter echoes no longer overwrite the complete filter payload previously submitted by this visual. A request receiving no Data event for four seconds gets one clear-and-reapply recovery; the new selection is sent only after a clear acknowledgement. Recovery timers are cancelled on completion, cancellation and destruction. Existing complete-result matching, context invalidation, measure checks and calculations are unchanged.

Tests cover no-op Clear, recovery sequencing, stale retry suppression and partial metadata echoes. This addresses identified unnecessary reset/no-response paths; the screenshot alone does not establish which path caused the live timeout. The original host timeout remains for genuinely unresolved or slow queries. Live Power BI reproduction is required; no zero-latency guarantee and no package built.

---

# Explicit measure binding and detection: 2.9.5.0

The user's Performance Analyzer query applied the measure parameter selection but projected only grouping fields. The provided parameter referenced Rent and Sales numeric columns. Power BI field parameters require explicit measures for measure aggregation; the visual cannot create those model measures or infer their intended aggregation.

Use the existing Rent Measure, create a Sales Measure with the intended DAX aggregation, and reference those calculator-icon measures in the parameter. Keep the parameter labels equal to their measure display names for this version. Clear the parameter slicer for initial discovery. Use detected setup now replaces the measure choices with the currently exposed choices, removing stale manually entered column labels.

Discovery now examines metadata columns, categorical sources and matrix value sources in addition to flattened data columns. Aggregated text parameter labels are excluded from discovered options. Missing measure values after a fresh matching grouped response produce an immediate setup error rather than a 60-second timeout. Diagnostics record source-parameter metadata availability, without row values. The reset comparison also includes the requested measure-parameter filter so unchanged measure selection does not trigger unnecessary clearing.

Tests cover metadata-only discovery, rejection of First measure text labels, immediate missing-measure failure and existing query/filter behaviour. Live host verification remains necessary. No package built.

---

# Comparison date cross-filter correction: 2.9.4.0

Date-window selections now retain a date-day marker. For Cartesian-complete selections (a comparison tenant row, one period cell, or several tenants across the same periods), the global filter callback converts contiguous dates to Advanced date predicates rather than Basic text equalities. Disjoint periods use outer bounds AND exclusion of each gap, preserving both June periods without admitting intervening months. Date chips display month/year context instead of 60 selected values. Existing sparse tuple handling is retained.

Regression tests exercise the Visual callback, midnight and intraday values, both comparison windows, exclusion of intervening dates, period-cell filtering, and clearing. The screenshot establishes an incorrect blank target visual, but its complete host filter state is unavailable: this change fixes the unsafe date-equality path, and must be verified in Power BI Performance Analyzer after import. No package built.

---

# Selective measure queries: 2.9.3.0

A separate measure field parameter now controls which measures Power BI projects for a question. This is an actual self-filter on the measure parameter table, combined with the grouping and question filters. Direct measure bindings cannot be removed by the visual at runtime.

One-time report setup:
1. In Power BI Modeling > New parameter > Fields, create a separate parameter containing the explicit measures users may ask for. Keep the labels identical to the measure display names.
2. Replace individually bound measures in askBICS's Measures and KPIs well with this measure parameter. Keep the grouping parameter in Fields. Do not use one parameter table for both roles.
3. Initially expose all measure choices once so the visual can learn the catalog. Parameter metadata is detected automatically when the host provides it. Otherwise enter the measure parameter table, label column and choices under Settings > Data setup > Advanced configuration and save.
4. In Performance Analyzer, compare a Revenue-only question and a Revenue + Profit question. The main query should project just those selected measures (alongside native subtotal machinery). Remove directly bound measures if extra projections remain.

Example: Rent Measure by Year selects Rent Measure only. Revenue Profit by City selects both. A field-only list currently selects the first configured measure as an anchor instead of selecting all measures; put a cheap appropriate measure first. This is not a guarantee of a measure-free query. Dependencies inside a requested DAX measure still execute as required by its definition.

The learned measure catalog remains available for question parsing, editor choices, autocomplete and # suggestions after a narrowed result. Results with unexpected measures are rejected in selective mode rather than silently treated as an optimized response. Existing direct bindings retain legacy behavior until the report author switches to the measure parameter.

Validation: selective filter payloads, multi-measure requests, list fallback, invalid configuration, metadata discovery, stale/all-measure rejection, catalog retention and existing engine/cross-filter tests. Live Power BI DAX validation is still required. No package built.

---

# Question-format audit: 2.9.2.0

Audited against the conversation examples and commits 554c439, 5ad94fa and dacc1b2. This update fixes scoped Field@ value suggestions, restores explicit field context when accepting a value, splits bracket alternatives into distinct filter values, accepts field aliases in brackets and list wording, preserves chart presentation for month comparisons, and retains hierarchy-level selection targets.

Regression coverage includes single/multiple fields and measures; list/table/matrix and chart formats; totals and top/bottom ranking; independent and multi-value filters; month/date/YTD/TTM boundaries; cached repeated questions; native totals and hierarchy construction; suggestions and bracket insertion; exact period selections and global cross-filter callbacks. Comparison chart tests verify raw numbers and individual period filter context. Existing legacy engine tests include single-child flattening and value-insertion behaviour.

UI controls for expand/collapse, percentages of grand/parent totals, formulas and YTD/TTM remain present. They have not all been exercised end-to-end in Power BI. Parent-subtotal percentages require an actual hierarchy with model-supplied subtotal rows. YTD/TTM questions require an end month; optional derived period-column menus currently attach to month comparisons. Unknown natural-language wording still fails explicitly rather than guessing a measure or filter. No claim is made that arbitrary manager questions are supported.

Host verification checklist: type Show Assigned Tenant Name@ and select two values; ask for a list; add Year and multiple measures; switch table/matrix/chart; expand/collapse; test single-child grouping; enable a subtotal percentage; run June 2024 vs June 2025 as a line chart; click each period; ask anchored YTD and TTM; return to the original question, then Clear and repeat. Compare values/totals and external visual selections with a native Power BI visual.

No package was built.

---

# Automatic setup update: 2.9.1.0

Settings now separates Preferences and Data setup. Advanced configuration and Troubleshooting are collapsed by default. Existing saved configurations remain authoritative; Use detected setup opts into automatic learning without erasing mappings.

A fresh visual detects an unambiguous parameter table and column from sourceFieldParameters expressions and learns the exposed grouping names and physical model targets. It persists schema changes, not a new configuration for every observed row value. No discovery filter requests are issued, and narrowing the active grouping does not remove earlier options.

Power BI still requires the author to bind the field parameter and enable Show selected field. Discovery cannot enumerate fields never exposed by the host, resolve multiple ambiguous parameter sources, or infer custom parameter-row labels reliably. Select all parameter fields once for initial discovery; use Advanced configuration for custom labels or missing metadata. This is automatic setup from available metadata, not unrestricted access to the model catalog.

Validation includes discovery, ambiguity, cumulative options, explicit disable, saved-configuration preservation and existing cross-filter/controller tests. Package/import validation remains necessary; no package was produced.

---

# Current source update: 2.9.0.0

This update restores compatible features from commits 554c439 (edit window V3) and 5ad94fa (YTD cross filtering V2) on the on-demand query path. No package was built for this update.

- Tables and matrices use semantic-model totals, including comparison columns. Missing model totals are never replaced by a sum of non-additive measures.
- The full editor supports rows, columns, measures and value filters while preserving comparison dates and dashboard scopes. The obsolete Variance toolbar action stays removed.
- Dimension header filters request fresh model answers and totals. Local filters on calculated/measure values retain a clearly labeled original-scope total.
- Percentage and calculated-column controls preserve cell selections. Comparison measure menus can fetch YTD/TTM columns only when requested. Native multi-level matrix hierarchies retain model subtotals.
- Saved-report sections, layout editing, expanded cards and scoped comparisons use serialized model queries. Chart suggestions and multiple measure series are restored.
- Semantic row/cell cross-filtering retains hidden predicates and exact comparison periods. Repeated questions use a bounded session query cache; idle host data updates invalidate it.
- Year/Month mappings support YTD and exact twelve-month TTM tuples. Day-level dashboard ranges require a mapped calendar date column.

Validation: TypeScript compilation, engine/controller/parser tests, model-feature tests and Visual cross-filter callback tests. Live Power BI interactions must still be verified after you package and import this source. Host query execution time depends on Power BI and the model; this is not a guarantee of zero latency.

Suggested host regression sequence: tenant list; tenant/year/multiple measures; Home Living by Year; June 2024 versus June 2025; repeat the initial list; Clear; repeat the comparison; change a report slicer; edit rows/columns and filters; select a comparison row and then a single period cell; open saved reports and change their date range. Compare totals and selected filters with a native visual.

The sections below are historical implementation notes. Statements describing missing features or strict filter-echo requirements in earlier versions are superseded by the current update above.

---

# On-demand grouping and model filters

## 2.8.6 hosts without filter echoes

The supplied Desktop trace has empty owned/public filter lists despite DAX containing the tenant predicate. In this mode a complete Data update after the serialized request can acknowledge completion if its resolved grouping matches. Presentation-only updates and cached pre-submission data do not acknowledge filtered requests. Explicit filter conflicts still reject the response. Date/value changes retain the clear-then-apply sequence; the clear response is never treated as an answer. Regression tests reproduce empty echoes for Home Living and for both periods of a June comparison. This relies on Power BI's serialized Data-update lifecycle; no query ID is exposed by this controller integration.

## 2.8.5 filter acknowledgement

The user's Home Living DAX confirms the tenant predicate reaches the model. The acknowledgement reader now combines JSON filters from the owned metadata property and `VisualUpdateOptions.jsonFilters`, instead of discarding the public list whenever the owned property is present. Duplicate predicates are deduplicated; conflicting predicates remain and prevent acceptance. Tests cover split grouping/value acknowledgements, split date-comparison acknowledgements, and conflicting tenant predicates. Diagnostics list the two sources separately with target names and exact-match flags, without values. This change does not accept an unacknowledged filter solely because the grouping matches.

## 2.8.4 filter replacement

Supersedes the earlier `All`-predicate replacement strategy. When prior value/date predicates differ, remove the visual-owned query-filter property and wait for a host data update without those filters before applying the new complete request. Intermediate clearing data cannot resolve the question. Grouping-only transitions still merge directly. Tests include delayed clearing acknowledgement, stale filtered responses, date comparisons followed by lists, and absence of accumulated `All` predicates. Live model targets are now included in diagnostics without row/filter values. A selectable read-only diagnostic textarea is available when clipboard access is blocked.

## 2.8.2 interaction fixes

Configured grouping labels now participate in input highlighting independently of the currently returned fields. Explicit Clear cancels pending query work and clears semantic row selections. Refresh can retry the draft when no successful question is stored. An unchanged filter request with unmatched current data uses `refreshHostData` instead of waiting for an update from a no-op merge.

Table and pivot row selections carry physical targets and raw values from their own result. Clicking rows applies semantic report filters; Ctrl/Cmd selects multiple rows with tuple semantics. Unknown targets do not create partial filters. This restores row filtering without borrowing row indices from a later totals query. Matrix cell-specific selection and model-chart selection are not implemented by this change. Report interaction settings still govern which visuals receive filters.

Automated regression tests cover field highlighting after grouping changes, cancellation/retry host refresh, and raw row selection targets, in addition to the planner and matrix tests. Actual Desktop import and report interaction behavior remain to be verified in the user's PBIX.

## Sequential-question reliability fix

Question transitions now merge the new grouping and predicates together with `All` resets for obsolete visual-owned predicate targets. They no longer clear the complete filter property before merging, which could expose an intermediate all-fields query. Resolved grouping columns acknowledge parameter selection; value/date predicates are checked separately, so a missing parameter-filter echo does not block every question after a date query. Stale value/date predicates still prevent an answer. Empty owned-filter arrays are authoritative rather than being replaced with unrelated report filters.

Regression tests cover comparison responses with omitted parameter-filter echoes, then a field-only list, then a matrix, including removal of old date/tenant predicates. These tests use simulated host data; this fix still requires verification in the actual Power BI report. Refresh reuses the latest complete matching host result; it does not force a semantic-model refresh.

## Regression fixes — list, value and comparison questions

On-demand answers now use the established table renderer for header actions, data bars, hovering, sorting and filtering. Edit puts the original question into the input for rerunning. Snapshot rows do not borrow selection identities from a later model query. Local table filters hide the model-total row rather than showing a total for a different visible subset. Existing calculated-column/period menu behaviour is not automatically enabled on snapshots.

Field-only questions return lists and do not display a default measure. Note that measures bound in the Power BI field well still participate in the host query; this is not a change to the visual's measure bindings.

The visual learns physical targets and up to 10,000 text value hints per resolved field from incoming data during the session. Those hints remain available after switching grouping. It supports field-value parentheses and whitespace-insensitive value lookup (`Home Living` / `homeliving`). It does not enumerate all unknown model values automatically or guess targets that metadata does not expose.

Matrix display pivots grouped cells even when the host supplies no usable native matrix. Additional grouped model queries supply row and column totals. Model-provided grand totals are retained; an unavailable total remains blank rather than being fabricated. Composite matrix hierarchy levels are supported by the adapter.

Explicit month comparisons run two distinct model queries and join their answers by grouping values. A full calendar date mapping is preferred; ordinary month comparisons can use discovered or configured Year and Month columns instead. When both parameter options exist, the visual can first request Year + Month to discover their targets. Fiscal/relative-date interpretation remains outside this path. Value/date filter acknowledgement is still required.

Regression acceptance questions:

- `Assigned Tenant Name`
- `Assigned Tenant Name and Year`
- `Assigned Tenant Name (Tech Hub) Rent Measure`
- `Show homeliving by Year Rent Measure` (after the Tenant field values have been received, or configured)
- `Assigned Tenant Name Rent Measure Year`
- `June 2024 vs June 2025 Assigned Tenant Name Rent Measure`

Validate these in Power BI after reloading the development build. Include a distinct-count/average measure when checking row totals, column totals and grand totals; they must agree with native model calculations. Synthetic tests do not substitute for this host verification.

## Integration update — 14 October 2026

The setup panel now lives inside the gear button's Q&A Settings. Normal conversation no longer displays an on-demand test panel. Configured grouping options supply suggestions and the field list in autocomplete settings, even when only Year is loaded. Saved synonyms are used for grouping recognition. Full field names, unambiguous names without the final word "Name", and field-first questions are supported.

Question changes issue a single filter update. Refresh reuses matching completed host data and replaces the latest answer instead of adding another question. It can still take time to execute a changed model query; there is no artificial 60-second delay.

The capabilities now request a supplementary matrix mapping and host-computed totals/subtotals. On-demand tables use model totals when supplied; `as a matrix` renders model hierarchy rows and subtotals; `as a bar chart`, `as a column chart`, `as a line chart`, `as an area chart`, `as a pie chart`, and `as a donut chart` use existing chart styling. `top N` and `bottom N` rank complete returned model results. KPI requests use the model total. Neither totals nor subtotals are reconstructed by adding displayed rows.

These changes pass local tests and schema validation. The new matrix mapping must still be checked in Power BI Desktop and Service. They do not establish unrestricted natural-language support or full parity with the old engine's comparisons, calculated columns, chart interactions, or editing features.

Live acceptance questions:

- `Show Assigned Tenant Name`
- `Show Assigned Tenant by Rent Measure by Year`
- `Show Rent Measure by City and Year as a matrix`
- `Show Rent Measure by Assigned Tenant Name as a bar chart`
- `Show top 5 Assigned Tenant Name by Rent Measure`
- `Show total Rent Measure`

Compare every grand total and subtotal against a native matrix, including an average or distinct-count measure. Check that Refresh replaces the answer and that City/Tenant suggestions remain after asking Year. If a host returns no model total, the visual must not fabricate one.

The sections below record the original prototype setup and limitations; the update above supersedes its table-only output and floating-panel descriptions.

## Status

The user verified single-field Year and City queries in Power BI. The expanded implementation has automated tests; multiple-field and value/date filter queries still need verification in the report. Do not assume the single-field trial proves the full integration at production data volume.

## Configure

1. Keep the field parameter in askBICS's Fields well, with **Show selected field** enabled. Keep explicit measures in Measures and KPIs. Do not add the individual grouping columns alongside the parameter.
2. Clear external parameter slicer selections so they do not conflict with askBICS's parameter filter. Ordinary report filters remain effective.
3. Open **On-demand grouping**. Enter the parameter table and label column (both `Parameter` in the tested report).
4. Enter `Year, City, Assigned Tenant Name` as grouping options. These labels must match the actual field display names and the parameter choices. Questions match them without case sensitivity; aliases can be configured below.
5. Paste the contents of `on-demand-field-mappings.example.json` into **Model field mappings**. These sample names came from the sample report. Replace them for other models; numeric Year requires type `number`.
6. Enable **Switch grouping and filters from questions**, then click **Save configuration**. Save the PBIX/report too. Configuration is stored with the visual, including aliases and known-value hints.

Field mappings are required only for filtering or aliases. An explicit `where Tenant = Some Shop` filter works without a loaded or preconfigured list of shops. Natural wording such as `Home Living Rent Measure by Year` requires that value in the mapped field's `values` list. Unknown or ambiguous text produces a clarification error rather than being ignored. This is not an automatic full-model value search.

## Date setup

Add ONE real date-column mapping to the JSON array, using the actual model names:

```json
{"name":"Date","table":"YOUR_CALENDAR_TABLE","column":"YOUR_DATE_COLUMN","type":"date"}
```

The column must contain full dates and have the appropriate relationship to the fact data. Do not map a numeric Day column or a month-name column as `date`. Creating that calendar/relationship is a model change, not something this visual performs. Calendar YTD starts January 1. TTM uses the 12 complete calendar months ending with the named month. Fiscal calendars and relative phrases such as “today” are not implemented.

## Test questions

| Question | Expected grouping | Expected model filter |
| --- | --- | --- |
| Show Rent Measure by City and Year | City, Year | None |
| Show Rent Measure by Year where Tenant = Home Living | Year | Tenant = Home Living |
| Home Living Rent Measure by Year | Year | Same, using configured known-value hint |
| Show Rent Measure by City for 2025 | City | Numeric Year = 2025 |
| Show Rent Measure by City for June 2025 | City | Date >= 2025-06-01 and Date < 2025-07-01 |
| Show Rent Measure by City from 2025-06-01 to 2025-06-30 | City | Same date range |
| Show Rent Measure by Tenant YTD ending June 2025 | Assigned Tenant Name | Date >= 2025-01-01 and Date < 2025-07-01 |
| Show Rent Measure by Tenant TTM ending June 2025 | Assigned Tenant Name | Date >= 2024-07-01 and Date < 2025-07-01 |
| Show Rent Measure by City for June 2025 where Tenant = Home Living | City | Both tenant and date filters |

Place explicit filters at the end, after `where`. Separate fields with `;` or `and`, and alternative values within a field with `|`, e.g. `where Tenant = Home Living | Bean Street; City = Riyadh`. Date clauses go before `where`. This version uses a bounded grammar; unsupported wording, ranking, and comparison requests return an error.

## Verify in Power BI

- Compare every value with a native table using equivalent slicers.
- Inspect askBICS's main query: only requested grouping columns belong in `SUMMARIZECOLUMNS`. Filter-only fields must appear in filter expressions, not output grouping.
- Ask a tenant-filtered question, then an unfiltered question with the same grouping. The second query must no longer contain the tenant filter.
- Switch rapidly between questions. Only the newest completed request should display.
- Test an empty result and a conflicting external parameter slicer. An incomplete or unmatched response must not produce a local fallback answer.
- Save configuration and a question; close/reopen the report. Enable on-demand mode if necessary, open Saved reports, and run the saved query again.
- For TTM, verify July 2024 through June 2025 exactly. Other report filters intersect this window; the visual does not remove external date slicers.

## Saved questions and output

Saved questions are persisted and can be rerun or edited. Their results are session snapshots, labeled with the last-run time; reopening the report requires rerunning them. This mode does not use the normal live multi-card dashboard recalculation because each question has a different Power BI data context.

On-demand answers show the model's measure values directly in a read-only table and support copying results. They do not synthesize a grand total by summing averages, ratios or distinct counts. Row cross-filtering, local calculated columns, charts, table editing and right-click YTD/TTM controls are not part of this new mode. Existing loaded-data mode remains available. YTD/TTM are supported here as explicitly anchored questions.

All measures assigned to the visual remain in Power BI's mapping; choosing a measure in a question controls which result columns are displayed. Dynamic measure field-parameter selection is not implemented.

The visual accepts an answer only after the actual fields, applied filter payloads and complete segment status match the request. A timeout or rejected fetch produces an error, not an answer based on stale rows. If Power BI does not expose the self-filter payload in its update, the strict verification may time out; capture the generated query and report behaviour for investigation.

## 2.8.7 – totals and editor integration

- Uses a single matrix data mapping with host subtotals enabled; avoids categorical precedence hiding model totals. No summation fallback for averages, ratios or distinct counts.
- Restores the committed v3 editor for model answers. Rows, columns, measures and encoded value filters go through the model planner. Multiple column fields are preserved.
- Uses the configured field catalog for the four welcome cards and editor, and learned values for filter browsing.
- Removes the obsolete Variance toolbar button. Comparison rows now carry semantic report-selection metadata.
- Preserves month comparisons and mapped date periods when changing the answer layout.

Validation: automated planner/controller/engine tests and TypeScript checks. Native Power BI import and report interactions still require host verification.

Remaining parity work: YTD/TTM derived-column menus, matrix hierarchy expansion without a column grouping, chart/cell selection parity, and model-recalculated totals after local header filtering. YTD/TTM questions themselves require a mapped real calendar date column. These are not claimed complete by this release.

Recommended architecture: one active host request with cancellation; immutable answer snapshots and semantic selections; a stable learned schema separate from the active grouping; invalidate cached answers on external data/filter updates; request totals from the semantic model; load optional calculations on demand rather than delaying every initial answer. Keep any first-time report author setup separate from the reader's question flow.

## 2.8.8 – global report selection

Compared against 554c439 (edit window V3) and the committed cross-filter callback tests. Model answers now retain semantic row/cell selections, including hidden Basic predicates and daily calendar ranges. Comparison row selections union both periods; cells retain their own period. Matrix pivots preserve the source-cell selection sets. Chart renderers use answer-local indices to bind semantic selections, never current host row indices. Shared mouse/keyboard toggles work across answer cards. Native selections are cleared before semantic report filters are applied, with revision guards against stale callbacks. Clear and chip removal use the same handler. Cartesian-complete selections use Basic conjunctions; sparse selections retain exact Tuple filters.

Validation: planner/controller, UI-toggle and actual Visual callback tests; live Power BI import still required. This changes selection delivery, not report-author Edit interactions settings.
