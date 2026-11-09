# Calculation Groups

This is an AskBICS client calculation module, not a Tabular-model calculation group or a DAX editor. It uses the existing Power BI field-parameter/direct-measure adapter and the delegated Teams model adapter. Model access, RLS, configured fields and Always filters remain enforced.

## Setup and use

Settings → Calculation Groups stores named groups and their calculations. Save settings before Copy settings. Groups and calculations have stable IDs, enabled state, description, order, defaults, number format and total policy. Draft preview runs through the host query adapter without saving the draft. Changing formulas/settings invalidates the existing UI answer cache through the normal settings-save path.

Type `#` to select a group. Saved submitted questions encode the group ID as `#calc[id]`; display uses its current name. Multiple group tokens can be used. Existing native-measure suggestions remain a fallback. Individual selections use #metric[id]; selected groups and measures appear as removable chips. Individual calculations can also be requested by their measure name. A group is a collection of additional result measures, not a data-security boundary.

Example:

```text
// Independent operand filters
('Rental', [Year] = 2026, [Month] = 'Aug')
/
('EBITDA', [Year] = 2025, [Month] = 'Dec')
```

`@[Rental ratio]` references another calculation. A quoted name inside parentheses resolves a known model measure or calculation first. If it is not a measure and a default field AND default measure are configured, it means that field's value. For example, default field Input and default measure Actual permit `('Rental')` to mean Actual filtered to Input = Rental. It never infers a raw-row aggregation from a dimension column.

## Grammar

```ebnf
formula = ["="], expression ;
expression = primary | unary, expression | expression, binary, expression ;
primary = number | quotedText | bareMeasure | TRUE | FALSE | NULL
        | "@", identifier | "@[", name, "]"
        | "(", expression, ")"
        | "(", expression, ",", predicate, {",", predicate}, ")"
        | "(", quotedMeasure, {",", predicate}, ")"
        | function, "(", [expression, {",", expression}], ")" ;
predicate = "[", field, "]", comparison, literal
          | "[", field, "]", [NOT], IN, "(", literal, {",", literal}, ")"
          | "[", field, "]", [NOT], BETWEEN, literal, AND, literal
          | predicate, (AND | OR), predicate | NOT, predicate ;
```

Precedence, lowest first: OR; AND; comparisons/membership/range; + and −; * / %; unary signs. NOT applies to a predicate. `%` is remainder, not percentage formatting. Strings use single or double quotes; doubling a quote inside ordinary quoted text escapes it. Paired apostrophe delimiters are also supported: `(''Rental'')` is equivalent to `('Rental')` and `("Rental")`. Begin paired delimiters directly before text; close with two apostrophes followed by a delimiter/operator, whitespace or end of input. Inside paired delimiters, a single apostrophe is literal and a doubled pair followed by further text escapes an apostrophe (for example `''O''Brien''`). Empty `''` remains an empty string. The formatter preserves the chosen source spelling. `//` comments extend to end of line. Bracketed field names and `@[names with spaces]` are supported. There is no JavaScript execution.

Supported scalar functions: IF, CASE(condition,value,…,fallback), COALESCE, DIVIDE(numerator,denominator[,fallback]), ABS, ROUND, CEILING, FLOOR, SUM, AVG, MIN, MAX, COUNT, DISTINCTCOUNT. Aggregate functions operate on their explicit evaluated scalar arguments; `SUM([raw column])` is unsupported. Use a bound native model aggregation for raw rows. IF, CASE, COALESCE and DIVIDE evaluate only needed branches. Null arithmetic remains blank; an unhandled division by zero is unavailable with an explanation, not zero.

## Combined filtered expressions

`(Rental + ServiceCharge, [Year] = 2026, [Month] = 'Aug') / (EBITDA, [Year] = 2025)` applies the shared year/month to both numerator measures before querying. Bare measure identifiers preserve their spelling; use `('Measure with spaces')` or `@[Calculation name]` inside arithmetic. Quoted text alone remains a literal; existing `(quoted measure, filters)` syntax remains compatible.

A comma inside a grouping parenthesis introduces a FilteredExpression AST node around the preceding complete expression. Without a comma it is ordinary grouping. Named function parentheses contain function arguments instead; IN parentheses contain literal lists. Every expression after a filtering comma must be a predicate, otherwise validation reports its source position. Nesting remains bounded at 100 levels.

Inner filters override outer filters on the same field. For example `(Rental + (ServiceCharge, [Year] = 2025), [Year] = 2026, [Month] = 'Aug')` queries Rental for August 2026 and ServiceCharge for August 2025. Shared context is immutable and cannot leak into a sibling or denominator. DAYS() inside a shared expression uses that shared calendar; filters nested in a sibling measure do not change it. Referenced calculations inherit shared context, then apply their own explicit filters. Grand totals evaluate the entire tree without row grouping.

Formatting preserves the AST/comments; autocomplete distinguishes grouping commas from function arguments and IN lists. Validation, preview, dependency checks, renamed-field import and calculation breakdown traverse filtered nodes. Same-field OR, IN, BETWEEN and comparisons use supported host predicates; cross-field OR and unsupported compound tuple overrides still fail explicitly rather than being approximated.

## Filter context and totals

Each scoped measure inherits the AskBICS question predicates and current row context. Its explicit predicates replace AskBICS predicates on the same underlying target only, and remove that dimension from the operand's grouping. Other dimensions remain. Separate operands never share their explicit filters. Compound tuple overrides and cross-field OR that the existing adapter cannot safely express fail explicitly. Host/report filters, RLS, Teams security selections and Always filters cannot be removed by this syntax; they still constrain the query.

The default total policy is Recalculate. It evaluates the formula with the row grouping removed, preserving question and operand predicates. Hide returns no total. Custom evaluates the custom formula in total context. Dependency formulas use their normal expression when referenced by another formula. Display filtering/sorting retains the existing table's model-total behavior; it does not invent a new total by summing visible ratios.

Rows come from the union of native operand results in the outer question context. All operand results must be complete. This is a bound model-result rowset, not an unrestricted enumeration of every dimension member in the semantic model.

## Calendar functions

- DAYS() counts inclusive calendar dates in the explicit outer context, including row dates. It never adopts an arbitrary numerator's period.
- DAYS(('Revenue', [Year] = 2026, [Month] = 'Aug')) binds the calendar to that operand's effective period.
- DAYSINMONTH(year,month), DAYSINYEAR(year), MONTHINDEX(year,month).
- MONTHINDEX uses year × 12 + month (January is 1), matching the default AskBICS convention.
- DATEDIFF('start','end') returns elapsed calendar days, excluding the starting day.
- WORKDAYS('start','end') counts both endpoints and excludes Saturday/Sunday. No holiday calendar is inferred.
- YEAR(date), MONTH(date), DAY(date), STARTOFMONTH(date), ENDOFMONTH(date), STARTOFYEAR(date), ENDOFYEAR(date), PREVIOUSMONTH(date), PREVIOUSYEAR(date) accept ISO dates. Prior-period functions return dates, not model-filter mutations.

Calendar computations use UTC date-only values, validate leap dates, and require a finite explicit year/date-range/MonthIndex domain (open-ended ranges are rejected) for DAYS. They cannot infer hidden report-slicer dates not exposed to the visual. Use explicit dates in that case. Calendar domains are bounded to 200 years.

## Performance and validation

Per request: parsed AST reuse, native-query memoization by grouping/measures/effective predicates, indexed row lookup, and calculation-result reuse by formula/row/context/total policy. No global result cache is shared between models or users. Yielding between row batches keeps the UI responsive. The adapters retain their existing cancellation, data-version and completeness handling. A 250-distinct-query budget, 16,000-character formula limit, 100 nesting levels and 500 KB group-settings budget prevent unbounded work.

Validation distinguishes parsing/catalogue/dependencies from actual evaluation. Circular, disabled and missing dependencies fail. Preview can still fail because of model permissions, unsupported filters, incomplete rows or unavailable data. Result tooltips include operands, effective predicates and evaluated expression steps; serializable notes also reach Teams. Errors remain visible as Unavailable.

## Compatibility and remaining limitations

- Settings copy/merge/replace includes the groups; renamed-field mapping rewrites semantic formula references while preserving literal values/comments. Field and native measure references currently use catalogue names, not durable semantic-model object IDs. Renaming a model object requires validation/remapping; automatic stable-object rebinding is not implemented.
- Legacy KPI formulas cannot reference the new advanced syntax; create that dependent calculation in Calculation Groups. New calculations can use existing legacy KPIs.
- The lightweight editor provides multiline typing, a syntax-coloured companion, formatting, keyboard suggestions, inline diagnostics and model preview. It is not a full IDE: undo/redo includes formatting and completion; matching parentheses are highlighted in the companion. Selected groups/measures appear as removable chips above the chat input.
- Field suggestions list configured fields; the host does not expose an authoritative measure-to-dimension compatibility matrix. Preview verifies execution. Distinct-value suggestions are bounded samples, not proof of complete cardinality.
- Separate group-specific permissions, semi-additive policies and arbitrary raw-column aggregations are not introduced. Access is enforced by the existing host/model permissions.
- Native Power BI interaction and tenant deployment still require validation. No package is created by these changes.

Calculation result layout (2026-11-02): Calculation items always appear as rows, with grouping fields followed by Calculation and Value. Matrix requests use the same long-table layout. Each calculation retains its own total-context result; unlike measures are never summed into a combined Value total. Re-run saved answers to apply the new layout.

## Add KPI names first

Inside a group, enter a unique KPI name and press Enter or Add KPI. Each name appears in the group's compact table with Edit and an actions menu (rename, duplicate, delete). Reorder using the drag handle. Names with no formula are Drafts: stored as an empty formula with enabled=false, excluded from answers and suggestions, and preserved in Save settings and Copy/Paste settings. No placeholder amount or formula is invented.

Edit opens the existing focused formula editor. Done validates and enables a newly completed draft; a deliberate disabled selection is retained. Back/Close retain the draft without enabling it. Save settings applies all group changes. Preview validates a temporary enabled copy of the draft; it does not save settings. An enabled calculation cannot depend on an unfinished draft.

## Hover and calculation details

Calculated cells show a compact hover: calculation/period, formatted value, source and relevant filters. Direct division/DIVIDE expressions show numerator, denominator and result once each. Complex trees are not forced into a two-operand summary. Unavailable messages remain visible. The cell's small details action opens the original cached calculation evidence in a global dialog; this does not query the model, change filters or overwrite the original breakdown. Closing restores focus to the action.

Group navigation uses compact connected tabs. Drag a group tab directly to reorder it, or use Alt+Left/Right on the focused tab. Left/Right/Home/End select tabs. KPI rows retain their own reorder handles. Group order continues to save and copy with settings.
