# Cross-filtering contract

Every answer renderer (tables, matrices, comparisons, YTD, charts, and saved reports) must route selection through the shared `Visual.selectRows` callback.

- Pass exact source row indices, active fields, and the answer's background fields. A cell uses its own source indices, including its period or YTD range.
- Preserve background context when removing chips. Never reconstruct remaining selections from the full unfiltered dataset.
- Send all compact field conditions in one `applyJsonFilter(filters, "general", "filter", merge)` call. Never distribute conditions across filter2/filter3 properties or truncate them to a property count. Clear legacy properties during migration.
- Chips and highlights represent the same shared selection. Clearing selection clears native filtering and selection UI.
- Ignore superseded asynchronous selection completions so a late response cannot restore cleared chips.
- Presentation changes must not change the source indices or remove answer context.

Run `npm test` and `npm run lint` after changing selection behavior. The tests cover hidden tenant filters, period row/cell intersections, chip removal, and toggle semantics. Validate native cross-filtering in Power BI Desktop before releasing changes to the host integration.
