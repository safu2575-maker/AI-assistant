# Development status and next handoff

## Scoped cash-flow loading — 2.9.111.0, 2026-10-29

Approved and implemented: Data scope in Cash flow and Settings → Filters & transactions → Cash flow. Choose company field and up to 50 company values; add up to 10 starting-field filters with up to 100 exact values each (OR within field, AND across fields). Field changes clear dependent values. Shared searchable value pickers load a bounded sample (201 query rows / 200 offered choices); exact values can be entered. Optional mapped posting-date period and configured bank codes filter the starting query. Account-description bank filtering is used where no explicit account/description/document starting filter overrides it. Company values and filter defaults are saved with the existing cash-flow setup.

Loading now queries scoped starting postings first, then walks document/clearing references in batches of 40 per company. Starting field/date/bank predicates are absent from linked lookups; company, currency, Always filters, report context and model security remain. Multiple companies are traced independently before presentation. Synthetic grouped-posting identities are stable across queries. Limits: 5,000 rows per posting response, 20,000 returned rows and 100 posting queries per run, plus bounded graph depth. Truncated/segmented responses mark the trace incomplete. Progress, query cache, refresh, scope-change cancellation and stale-result checks are included. No automatic continuation through all Power BI segments for bounded cash-flow queries; unrelated pending queries retain normal segment handling. Cash-flow cached host views are trimmed and isolated from ordinary query cache keys. Teams uses TOPN(limit+1) and preserves incomplete metadata. A first Power BI segment may be smaller than the limit and is conservatively incomplete; native report/query performance still depends on the model. No claim of live million-row performance verification.

Files: src/cashFlow.ts, cashFlowQuery.ts, cashFlowLoad.ts, parameterQuery.ts, fieldParameterTrial.ts; src/qna/cashFlowScope.ts, cashFlowSettings.ts, cashFlowWorkspace.ts, cashFlowResults.ts, kpiFilterSettings.ts, settingsMultiSelect.ts, ui.ts; askbics-teams/app/model-service.ts; shared LESS. Build identifiers synchronized at 2.9.111.0. Added root scope regressions and non-image browser scope test; expanded Teams cash-flow adapter tests. Root/Teams suites and browser checks pass before final presentation/help refinements; final checks recorded below. Live host validation after the user's package/import remains pending. No packaging, images or deployment.

## Cash-flow settings tab — 2026-10-29

Added Settings → Filters & transactions → Cash flow using the existing settings pages, searchable selectors, multi-select, help markers and shared label spacing. Essentials are company/document/clearing, signed amount, optional account and description. Other mappings stay in Advanced; users can choose up to 10 starting-posting columns. Empty column selection uses defaults. The tab and workspace share the existing layout.cashFlow setting; no second configuration store or host copy. Existing legacy rules are preserved, with no new mandatory account roles. Edits validate and commit only with Save settings; Cancel leaves saved state unchanged. Untouched/unconfigured cash flow does not block unrelated settings saves.

Files: src/qna/cashFlowSettings.ts, src/qna/settingsLayout.ts, src/qna/ui.ts, style/visual.less; browser regression askbics-teams/test/cash-flow-settings.mjs. Root build/regressions and the non-image browser check pass (navigation, shared selectors, invalid drafts, save/cancel, reopen, column cap, help). Teams regression passed with localhost access after the sandbox fetch restriction. No package, screenshots or deployment; live host verification remains pending.

## 2026-10-29 — 2.9.110.0 cash-flow transaction table

Implemented: up to 10 selected starting-posting columns plus Destination account, Destination amount and Details; shared answer table controls/styles, source-column query mapping, explicit unresolved rows, root/destination grouping, filtered allocation totals and unique starting totals. Details retains all grouped paths and original available document entries. Columns are persisted in cash-flow setup and must be available in the visual catalogue. Same shared source serves Power BI and Teams. Clearing traversal/settlement rules are unchanged; this does not establish support for every SAP partial-clearing scenario.

Verification: root build and regression suite pass, including new grouping, deduplication, filtered-total, column-bound and extra-source-query tests. Focused non-image browser checks pass for global computed styles, ten-column cap, grouped paths, sorted Details actions, filtered PDF/Excel totals, popup close and automatic Bank description detection. Teams non-packaging regression passes with localhost access outside the sandbox (sandbox-only attempt failed its localhost fetch). No screenshots or package generated. Live Power BI and Teams integration testing remains required after user activation.

## Global-theme reuse correction, 2.9.109.0

Fixed a real mismatch, not just cosmetic similarity: broad cash-workspace button CSS overrode Copy for Excel/PDF styling, and detail grids were hand-built. Replaced grids with shared answer-table renderer; removed bespoke cell/header styles; lowered generic button-rule specificity. Adopted shared clearing-overlay/panel/body for the document entries popup, including the standard close icon. Compact Bank → destination UI retained. Root and Teams suites passed before final popup-frame refinement; browser computed-style parity checks passed for toolbar/header/cells. Final non-packaging build and popup browser verification follow. No calculation, query, account mapping or security changes.

## Compact cash-flow presentation, source version 2.9.108.0

User clarified that the prior result was still too busy compared with their sample designs. Updated cashFlowWorkspace, cashFlowResults and shared LESS: collapsed Trace options after success, on-demand filters, removed default KPI cards/repeated text, compact header/status, Bank → destination summaries with document/clearing paths and right-aligned amount. Retained filtered exports, unresolved visibility, multiple paths, original/allocated distinctions and cached document popup. Mapping or model failures reopen options; active filter chips remain outside collapsed controls. Existing light-theme typography, borders and table colors retained.

Root compilation and cash-flow browser checks passed, including automatic roots, manual fallback, exports, caching, cancellation, collapsed options/filters, no KPI strip and Bank → Expense labels. Captured and visually reviewed `.tmp/cash-flow-compact.png` and `.tmp/cash-flow-compact-expanded.png`. First sandboxed Teams suite stopped at its localhost fetch test; rerunning outside sandbox. Packaging is explicitly not run; the user must package/import this source version to see the new layout.

## Automatic bank identification, 2.9.107.0

User reported a Bank-labelled sample still demanded manual selection. Source confirmed Account description was absent from cash-field mappings/query groups. Added optional description mapping, conservative unambiguous field detection and exact bank-label identification (`src/cashFlowStarts.ts`). Workspace now auto-runs one identified bank; multiple identified banks offer all or individual choices. Explicit bank account codes take precedence. Missing identifiers show binding guidance instead of silently assuming every posting is a bank. No amounts/signs are used to guess bank identity. Clearing-based traversal stays unchanged; endpoint descriptions are presentation labels.

Root regressions passed, including false-positive/ambiguity checks. Expanded browser checks passed for description included in the query, automatic single-bank selection, multiple-bank-only options, all/individual selection and previous manual fallback. Live model binding is still required: Account description must be available in the grouping parameter; merely importing the Excel column into the model does not expose it to the visual.

## Update: approved cash-flow UI implementation, 2026-10-29

Runtime changes after the continuity review below: new `src/qna/cashFlowResults.ts`, workspace integration, shared LESS styling, expanded cash-flow browser checks, and build version 2.9.105.0. Destination-first summaries replace the separate summary/path list; lazy expansions preserve multiple paths and show posting versus allocated amounts. Cached document-entry popup supports all/selected lines with original debit/credit, scoped document identities and scroll/focus restoration. Setup collapses after successful tracing. Engine rules and model-query behavior were not changed.

Validation: root `npm test` passed; Teams `npm --prefix askbics-teams test` passed; expanded browser tests passed for no-account sample, exports, cache reuse, cancellation, destination grouping, unresolved percentage base, selected/all entry lines, Escape and scroll restoration. Initial checks caught a TypeScript NodeList compatibility issue and missing setup collapse; both were corrected. Browser tooling requires the Teams Node 22 executable and permission to spawn esbuild/Chrome.

Latest user screenshots show the simple 100 payment resolving successfully. The earlier configuration-loading report therefore is not a blocker for that demonstrated run, but its root cause was not diagnosed or fixed by this presentation change. Actual Power BI/Teams activation and live split-data acceptance remain separate from automated checks. Existing account descriptions are not newly inferred from unmapped fields.

The earlier continuity snapshot below is retained as historical evidence, not current test/build status.

Reviewed 2026-10-29. This was a documentation/continuity review; no runtime source was changed, no tests were rerun and nothing was committed or deployed.

## Current build and evidence

- `pbiviz.json` visual.version and `src/buildInfo.ts` both say **2.9.104.0**. The corresponding `.pbiviz` exists in `dist/`. Existence does not prove it is installed or that it matches every current working-tree edit.
- Root package.json has a different historical package version; use visual.version for the visual build.
- Prior supplied handoff reports root tests, Teams tests, the cash-flow browser test and packaging passed for v104. These are historical reports, not checks repeated during this review and not live Power BI acceptance.
- Source contains cash-flow, transaction, clearing/document, reversal, settings and other regression suites. Tests existing on disk are not evidence that every scenario currently passes.

## Immediate unresolved issue: cash-flow setup loading

Latest user screenshot: company 9720 entered and Show cash flow clicked, then:

> Dynamic grouping configuration is not loaded. Open Settings > Data, save the on-demand grouping configuration once, and retry.

Source confirms this exact error remains in `src/fieldParameterTrial.ts`'s `executeQuestion`. `automaticEnabled()` requires both the automatic checkbox and `hydrated`. When that predicate is false and parameter context exists, execution fails before the cash-flow query branch. `hydrate()` reads `metadata.objects.parameterTrial.configuration`, validates it and sets hydrated; it retries on later updates when saved objects were initially missing.

This narrows the failure to query setup state, but does not establish why this report lacks an enabled/hydrated configuration. Do not label it fixed. Earlier advice to refresh detection and save settings was a troubleshooting suggestion, not verified resolution. “Settings > Data” is stale wording relative to the supplied settings screenshots.

Next diagnostic work when requested:

1. Reproduce fresh field-parameter binding and saved cash mappings with the current package.
2. Inspect discovery, automatic preference, configuration save/hydrate, metadata update order and the snapshot catalogue passed to the cash-flow workspace.
3. Distinguish disabled automatic mode, absent/invalid configuration, late persisted metadata and incomplete discovery. Do not bypass validation or host security merely to suppress the message.
4. Add a regression for the demonstrated lifecycle, then verify the six-row sample in actual Power BI. Teams uses an always-enabled generated query adapter, so a Teams-only passing test cannot validate this Power BI hydration path.

## Transaction requirements still need scenario-level verification

The supplied history prioritizes reliability/performance: 60-second response acceptance, local summary filtering, model queries only when needed, cache keys including question/period/row/reversal, stale cancellation, Back cleanup, removable chips, table-first rendering, combined summary work, OR within a card and AND across cards, and hiding empty cards.

Source review confirms `transactionLocal.ts` uses OR within each selected field and AND across fields, and only reuses complete raw additive results; `transactionSummaryReuse.ts` has similar completeness/additivity guards. Modules/tests for cards, subtotals, total scrolling and popups exist. This review did not audit every orchestration path or confirm all listed requests are finished.

Earlier supplied handoff flags unresolved or unverified cases: 60-second tuple/filter response acceptance, reopening latency/cache lifetime after Back, and inherited versus summary-only filter chips. Preserve them as investigation items until reproduced and checked against current source. Likewise, verify filtered PDF/Excel totals, widths, hierarchy subtotals and popup scroll restoration before claiming all transaction experience work is complete.

## Verification commands

- Root compile: `npm run build`
- Root regressions: `npm test`
- Teams build/regressions: `npm --prefix askbics-teams test`
- Cash-flow browser: run `node test/cash-flow-browser.mjs` from `askbics-teams` using its supported Node runtime and installed browser.
- Both builds plus visual package: `npm run build:all`
- Both regression suites: `npm run test:all`
- Cross-filter changes: also follow `SELECTION_CONTRACT.md` including lint/native Desktop verification.

Power BI must import the built package; Teams server/browser artifacts require activation separately. Do not change app IDs, tunnels, authentication or live deployment as part of an unrelated UI fix.

## This continuity update

Created root `AGENTS.md`, `docs/PROJECT_MEMORY.md`, and this status file. Reviewed root/Teams READMEs, selection contract, settings-help guidance, build scripts/versions, Git history/status, cash-flow source, query gating/hydration, local transaction helpers, column layout rule, design tokens and integration source locations. This is a targeted architectural review, not an exhaustive audit of every source file or the inaccessible previous conversation.

Final artifact verification: 2.9.105.0 Power BI packaging completed successfully (existing optional feature warnings). Final Teams build and cash-flow browser checks also passed after header/setup refinements. Package: dist/askBICSAssistantBBA47C69F49C41FB89A0801541EF7FD9.2.9.105.0.pbiviz. No commit or deployment performed.

2026-10-29 layout refinement (2.9.106.0): removed Waterfall home card's full-row span so it occupies the second column beside Compare. Existing one-column mobile breakpoint remains. Shared LESS change applies to Power BI and Teams; no business logic changed.
2.9.106.0 verification: build:all completed successfully; headless Chrome verified equal-width Waterfall/Compare on the same desktop row and preserved mobile stacking. No deployment performed.
2.9.107.0 artifact: Power BI packaging succeeded, root/Teams regression suites and bank-identification browser tests passed. Shared UI still requires the description column to be bound in Power BI; no live deployment or model edit performed.
2.9.108.0 final verification: root npm test and Teams regression suite passed; Teams localhost test succeeded outside sandbox. Cash-flow browser checks passed and collapsed/expanded previews were visually reviewed. No .pbiviz package was created and nothing was deployed.
2.9.109.0 final verification: root compile and Teams build passed after modal reuse; cash-flow browser suite passed including computed global-style parity, exports, automatic/manual starts, all/selected entries and scroll/Escape behavior. No .pbiviz packaging or deployment performed.
Final verification for 2.9.111.0: npm run build passed; npm test passed (including new scope query/graph/limit/date-intersection regressions); npm --prefix askbics-teams test passed with approved localhost access, including actual adapter TOPN/incomplete metadata coverage. Focused non-image cash-flow browser, settings browser and new cash-flow-scope browser tests passed. npm run lint passed before final date-predicate refinement; final rerun recorded next. Date value filters intersect the starting period into one predicate rather than issuing conflicting duplicate targets. Native Power BI retains its existing initial host page/data-reduction size: the visual caps retained/processed rows and stops fetching further segments, but does not inject Teams-style TOPN into native Power BI queries. Source-model scans and live performance are not benchmarked or guaranteed. Package creation/import and native integration validation remain with the user.
Final npm run lint rerun after the date-predicate refinement: passed.

## Destination description — 2026-10-29
Added Destination description immediately after Destination account in the shared cash-flow result table. Account now prefers the destination account code; description uses the terminal posting's mapped Account description, with a dash when unavailable or unresolved. Totals include a blank description cell. Shared table filtering and PDF/Excel receive the same column. Updated column-picker help and regression expectations. No package or images generated. Verification pending below.

Verification: final npm test (TypeScript plus root regressions) and non-image cash-flow browser check passed, including new column order, description values, blank unresolved description, totals, filtered exports and Details. Initial checks overlapped edits and were superseded by these final reruns. No native Power BI verification or packaging. Targeted whitespace check passed; repository-wide check reported an unrelated existing blank EOF in settingsHelp.ts.
Teams non-packaging regression suite also passed after the destination-description change.

## Explicit cash-flow starting filters — 2026-10-29
Fixed a verified query conflict: user starting filters (such as Input = Cash and bank) were intersected with hard-coded account-description Bank/Cash labels. Automatic description predicates now apply only with no explicit starting filters. Configured bank codes, company, currency, period, Always filters and security remain. This does not classify arbitrary scoped postings as banks: unmatched descriptions still require manual starting-posting selection or configured account codes. Linked-document queries unchanged. Updated workspace help and regression assertions. Actual customer data not available for verification; no package generated.

Verification: npm test (TypeScript and root regressions) and npm --prefix askbics-teams test passed for explicit starting-filter fix. Actual customer model remains unverified; user must package/import before testing.
Final lint passed for starting-filter fix.

## Settings portability and popup — 2026-10-29
Verified saved cashFlow already serializes through engine layout, including mapped fields, display columns, scope companies/filters/period and saved rules. Fixed renamed-field import for mapping-object fields and displayColumns without rewriting selected data values. Backup visualVersion now uses buildInfo. Raised backup overlay above sticky settings search/tabs. Added cash-flow copy/merge/replace/missing-field regression coverage and browser checks for copied JSON and modal stacking. AGENTS.md now requires future persistent settings to support serialization, validated import/export, field remapping and regression tests. Copy uses saved configuration, not unsaved drafts; no credentials or model results exported. No package/images generated.

Verification: root npm test (including TypeScript and cash-flow backup validation) and non-packaging Teams test suite passed. Browser checks verified saved cash-flow JSON and popup stacking; extended rename/apply check pending final rerun. Live Power BI import remains unverified.
Final non-image settings browser rerun passed, including Copy settings JSON, popup stacking/hit testing and renamed company-field/display-column import followed by Apply settings. Earlier hidden-native-select test timeout corrected in test harness; application controls unchanged.

## Focus-mode viewport and table overflow — 2026-10-29
Power BI Visual now retains its host element and applies finite nonnegative update.viewport dimensions before data handling, including resize-only updates. Previously the host was percentage-sized against its containing canvas. Shared host width is bounded; cash-flow flex body/trace now have explicit min-width/max-width/box sizing and flexible scrolling height. Existing global table scrollbar/styles retained. Browser regression added wide-table scroll and right-bound checks across 800/1300/700 widths without rebuilding the view. Native focus-mode verification still required after user packaging; no package/screenshots created.

Verification: root npm test (including TypeScript) and focused non-image cash-flow browser test passed, including resize overflow assertions at 800/1300/700px. Live Power BI focus mode remains unverified.
Teams non-packaging regression suite and targeted whitespace checks also passed for viewport fix.

## Transaction summary Grand Total — 2026-10-29
Added non-selectable Grand Total footer outside each card's scrolling member list using total-row colors. Local summaries use complete explicitly additive raw rows and model formats. Model-based summaries now obtain scalar totals with the same predicates (one combined measure-total request per summary group, cached with its summary response); ratios/KPIs are not summed. Existing facet semantics preserved: each card excludes its own selection, retaining other-card filters. Updated query-count and local-total regressions. No package or images generated.

Teams non-packaging regression suite passed for summary totals. No live Power BI verification or packaging performed.
Final root npm test passed, including revised model-summary total requests and additive local-total regression.

## Focus viewport follow-up — 2026-10-29
User reported reported-viewport-only fix insufficient in native focus mode. Replaced direct sizing with visualViewport helper: clamps requested dimensions to iframe window and parent client bounds, reacts to window resize and parent ResizeObserver, disconnects on visual destroy. No data/UI recreation or theme changes. Added non-image browser tests for oversized reported viewport, iframe resize, parent resize, normal-sized requested viewport and expansion restoration. Root source change is Power BI host-specific; no Teams UI logic change. Native screenshot outcome remains to verify after user packaging; no package created.

Browser viewport test and lint passed. Initial root regression used a non-DOM host stub; viewport binding now only initializes when an ownerDocument window exists. Final root rerun in progress. No native focus-mode verification claimed.
Final root npm test passed after viewport follow-up. Teams source unchanged in this host-specific fix.

## Popup close icon — 2026-10-29
Adjusted shared popup-header close-button CSS to explicit flex centering and zero padding; SVG is block-level and nonshrinking. Preserves existing colors, size and close action. No summary/cross-filter logic changed. No package or images.

Settings browser regression and LESS compilation passed for close-icon CSS; targeted whitespace check passed.

View trace button (2026-10-29): cash-flow-only pill styling with subtle outline and arrow, preserving global light theme and accessible button name/click behavior. No calculation, filtering or export-data changes. No package/images.

View trace pill: focused non-image browser regression (including Details, export and resize) and targeted whitespace checks passed.

## View trace graphical tabs — 2026-10-29
Added Flow diagram and Cash allocation tabs alongside existing Accounting entries (default each opening). Shared cashFlowCharts uses selected trace allocations already loaded; no transport/query hooks or model-filter callbacks. Lazy once-per-popup rendering; flow paths paginated 10 at a time, exact posting/document steps with clearing/reference labels; accounting view unchanged. Allocation Sankey aggregates allocated absolute cash by destination/status, partitions company/currency/payment versus receipt, keeps unresolved labels, provides full text values and top-12 plus Others for diagrams. Scope explicitly Selected trace only, not a whole-payment/all-company report. No persistent preference added; active tab transient. Keyboard tabs and visible-button focus trap, existing close/scroll restoration retained. Global light theme. No package or images generated.

Verification: npm run build, npm test, Teams non-packaging suite and focused non-image cash-flow browser passed. Browser covers tab switching, 70.00 selected allocation, clearing labels, no extra query count, existing entries/filter/export/close and resize checks. Live Power BI validation remains pending after user packaging.
Added explicit Cash allocation scope toggle: Selected trace (default) or All loaded payment destinations for the same root. The latter explains it can include destinations hidden by result filters; it changes presentation only and does not query or modify filters. Final TypeScript build passed; earlier root/Teams suites and lint passed.
Final browser rerun passed with explicit all-loaded-payment allocation toggle, including Equipment and Unresolved destinations and unchanged query count.

## Flow account navigation — 2026-10-29
Flow nodes are keyboard-accessible buttons opening existing Accounting entries and highlighting matching account rows within company/currency among the popup documents (exact posting fallback without account). Keeps current all/trace-only mode, scrolls to clicked document and positions its internal table toward posting. Highlight is transient presentation metadata, retained during table redraw/virtualization; no host selections, filters or queries. Popup closing continues restoring background scroll. Shared UI styles preserved. No package/screenshots.


Verification: root npm test (including TypeScript compilation), Teams npm test and npm run lint passed. Focused cash-flow browser passed with Enter activation, account row highlighting, Accounting tab activation, short-popup scroll, unchanged query count and existing exports/close regressions. Initial scroll test assumed overflow in a full-height popup; revised fixture constrains body height and includes hidden tab when preparing it. Live Power BI/Teams validation remains pending; no pbiviz package run.


## Cash-flow optimization and compact diagram — 2026-10-29
Source changed: src/cashFlow.ts, cashFlowLoad.ts, cashFlowTable.ts, src/qna/cashFlowWorkspace.ts, cashFlowResults.ts, cashFlowCharts.ts, style/visual.less; new performance regression in scripts/test-cash-flow-performance.cjs wired into package.json and expanded cash-flow-browser.mjs.
Group-statistics/key caching, Set root matching, frontier graph loading, linear chart grouping and cached formatting remove repeated work. Document tables paginate 20 at a time; node navigation selects the relevant page. Compact centred diagram combines adjacent identified account postings across documents, preserving original entries and clearing-reference attribution. Global style, filters, query bounds, statuses and capacity/ambiguity logic retained.
Root suite, new large fixture, Teams suite, lint and focused browser passed. Old/new result equivalence: 250 cases plus 3,000 payments. Shared-clearing timing ~31.9s → 0.28s on 6,002 synthetic postings; 4,000 payments reconciled; virtual million-row model exercised bounded 4,000-row/50-query loading. Actual million-row model latency/full-ledger processing is NOT verified or promised; current limits/incomplete warnings stay. No pbiviz packaging or image generation. Workspace-wide diff check reports an existing unrelated trailing blank in settingsHelp.ts; touched tracked package/style files pass scoped diff check. See PROJECT_MEMORY for details.

## Explicit cash-flow filters select starting postings — 2026-10-29
Latest user requirement implemented in shared cashFlowWorkspace: any validated explicit cash-flow starting filters (e.g. Input = Cash and cash equivalents) select all returned eligible nonzero postings automatically and hide the starting-posting selector. No secondary bank-description identification or previously selected manual row narrows these results. Without explicit filters, existing bank-code/description identification and manual fallback remain. Company/currency/period scope and configured bank-code query restrictions remain enforced; linked lookup and clearing/allocation logic are unchanged. Bounded/incomplete states remain. Help updated in cashFlowWorkspace and shared cashFlowScope.
Verification: root npm test (including large cash-flow regression), Teams non-packaging tests, lint and cash-flow-browser passed. cash-flow-scope browser now uses Input values Cash and cash equivalents / Petty cash across two companies, with Bank and unrecognized Operating treasury descriptions; asserts both starts, hidden dropdown, automatic status, older linked documents, cache/refresh, incomplete state and stale navigation. Final changes after suites were explanatory help text only. Live host verification pending; no pbiviz package or screenshots. This supersedes the earlier documented need for separate bank identification when explicit starting filters are supplied.

## Fully funded many-line clearing groups — 2026-10-29
User reported Allocation unclear for multiple vendor lines / invoices sharing a final GL. Added conservative per-root deferred clearing-group joins in src/cashFlow.ts. Existing one-to-one/one-to-many traversal stays intact. Ambiguous clearing links can join only when source scope is complete, this one root funds every source posting in full, source funding equals total opposing group amounts, and opposing capacities have not been allocated. Explicit invoice references are not overridden. Partial funding, competing roots/additional sources, incomplete scope, missing links, cutoff, cycles and limits continue to produce unresolved outcomes. No amount-equality pair matching or proportional guessing is used. The same rule supports fully funded branches joining at a later GR/IR group.

Paths carry transient settlementSources and settlementPaths evidence on the incoming target posting. These are original source lines and incoming paths, not fabricated pairwise matches or synthetic posted amounts. cashEvidence deduplicates shared evidence arrays/objects to avoid repeated graph expansion. Accounting entries includes supporting source documents/lines in selected trace mode. Path expansion explains group settlement, lists source lines, and offers lazy incoming path details in batches of 25. Flow connector explicitly says Clearing group / source lines and no source-to-invoice pairing. Grouped same-GL output sums destination cash once while retaining each invoice path; original signs and starting totals unchanged. No host querying/filter/security changes or package creation.

Files: src/cashFlow.ts; src/qna/cashFlowResults.ts, cashFlowCharts.ts; scripts/test-cash-flow-clearing-groups.cjs; package.json; askbics-teams/test/cash-flow-browser.mjs. Root npm test, Teams npm test, lint, focused browser all passed. New regressions: multiple vendor lines 60/30/10 and nonmatching 55/45 funding invoices 60/30/10; equal invoice amounts distinct identities; downstream 62,850 + 32,000 + 32,000 fixture; incomplete/partial/competing roots; mapped cutoff; limits; reversed signs; company isolation; 500-source/500-invoice shared evidence. Browser confirms one summary row, three invoice paths, contributing vendor rows retained/highlighted and clearing-group explanation.

Actual screenshots: company 2396, payment document 1500005336 total 126,850, resolved 62,850, unresolved 64,000 comprising invoices 5100011942 and 5100011943 at 32,000 each. First two attachments appear duplicated. They are distinct invoice documents, not proven duplicate cash. Appears to involve downstream GR/IR clearing; exact GR/IR reference(s) and linked postings were requested but not supplied. Synthetic reproduction passes, but actual dataset/live host remains unverified. Do not claim this specific report resolved solely from screenshots. User will package/import; no pbiviz package or screenshots generated.

## Return from entries to flow diagram — 2026-10-29
Added contextual Back to flow diagram control in the existing trace popup, below tabs outside the scrolling entries body. Appears in Accounting entries after a flow-node inspection; restores existing flow scroll offsets and focus to clicked node (tab fallback if unavailable). No diagram rebuild, queries, filters or accounting changes. Shared styles retained. Files: src/qna/cashFlowResults.ts, style/visual.less, askbics-teams/test/cash-flow-browser.mjs. Root build/test, Teams non-packaging tests and focused browser passed, including return tab, scroll position, node focus, hidden button in flow, and unchanged query count. No package or screenshots; live-host verification pending.

## Temporary diagram inspection highlighting — 2026-10-29
Updated cashFlowResults so direct tab actions (including the active Accounting entries tab) clear inspected posting state and flow-return context, repainting bounded document tables without transient row highlights. Flow-node navigation activates entries first, then establishes fresh inspection state and the Back control. Back to flow diagram saves the return target locally before tab activation clears the context, retaining diagram scroll/focus. Entries mode, document page, report filters and queries are unchanged. Highlight metadata is removed by rebuilding tables, so it cannot return on virtualized redraw. Tooltip updated. Browser covers highlight → Back → no highlight, manual entries tab clean, fresh node click re-highlights, clicking active entries tab clears and hides Back. Root build/tests, Teams tests, lint and focused browser passed. No package/screenshots; live-host verification pending. Files: src/qna/cashFlowResults.ts, askbics-teams/test/cash-flow-browser.mjs.

## Cash-flow troubleshooting report — 2026-10-31
Added a session-only Cash-flow troubleshooting disclosure in the shared workspace. Copy reports build, mappings/scope, up to 100 executed requests with timings/counts/completeness and host-returned DAX, plus errors. Cached requests may not have records; text explicitly discloses this and missing host DAX. No additional model queries, ledger export, persistent settings or tracing changes. Posting conflict errors now include identity, both amounts and lookup predicate. Report contains business filter values; review-before-sharing notice and clipboard fallback provided. Tests: root suite, lint, TypeScript and focused non-image browser passed; added conflict-details regression passed. Teams build passed but sandbox local HTTP test failed; retry with local-server access pending. Live hosts unverified. No pbiviz package/images. Files: cashFlowWorkspace.ts, cashFlowLoad.ts, cash-flow-browser.mjs, test-cash-flow-scope.cjs.

Teams non-packaging suite passed on retry with local test-server access. Browser diagnostics and conflict-detail tests passed; final focus-trap includes the report textarea.

## Cash-flow setup global dropdowns — 2026-10-31
Reused settingsSelect for company/document/clearing/amount and all Advanced mapping controls in cashFlowWorkspace. Underlying native select values/change events and serialization unchanged; company mapping caption refreshes when scope company field changes. Existing searchable global popup, keyboard controls and theme reused; no custom CSS or queries. Root build/tests and Teams non-packaging suite passed. Browser regression added searchable company selection and hidden native control checks; final run pending. No packaging/images; native host verification pending.

Focused non-image cash-flow browser regression passed, including global mapping picker selection and existing exports/trace navigation.

## Cash-flow column picker alignment — 2026-10-31
Corrected shared multiselect CSS scoping: global compact flex option rows and checkbox styling now apply outside settings-panel too. Cash-flow input styling excludes checkbox/radio; vertical form labels target direct grid/rule children rather than dropdown rows. Preserves shared picker selection/search/max-10 logic and saved columns. Browser regression verifies 15px checkbox left of vertically centred label, clicking text toggles and untoggles, max-10 enforcement and existing operations. Root/Teams regression and focused browser passed. No model logic changes, images or pbiviz packaging. Files: style/visual.less, askbics-teams/test/cash-flow-browser.mjs. Native host verification pending.

## Company-values picker — 2026-10-31
Company scope picker now has a neutral div wrapper rather than nesting checkbox option labels inside an outer label. Existing caption/help and spacing retained via scope-values class; shared compact multiselect CSS from previous fix applies. Browser regression confirms checkbox 15px, value aligned beside it, no ancestor label, and label click selects/deselects company. Browser and Teams non-packaging suite passed; root suite pending. Scope logic and settings format unchanged. No pbiviz/images. Files: cashFlowScope.ts, visual.less, cash-flow-browser.mjs.

Root regression suite passed for company picker follow-up; live Power BI remains to verify after user packaging.

## Focused flow-node inspection — 2026-10-31
Implemented approved two-mode trace popup. cashFlowCharts passes exact grouped-node postings to inspection callback; cashFlowResults restricts inspection documents to those node identities, displays account/document caption and all available original lines with account highlights. Tabs, repeated paths and all/selected toggle hidden only during inspection. Existing Back restores flow scroll/focus and clears inspection; normal entries retains prior all/selected mode. Shared theme and queries unchanged. CSS enforces hidden children inside entries. Browser regression updated for hidden tabs/controls, exact single late document and return behavior; passed. Root/Teams suites passed during implementation; final TypeScript and focused browser passed after callback refinement. No pbiviz or images; native host verification pending. Files: cashFlowCharts.ts, cashFlowResults.ts, visual.less, cash-flow-browser.mjs.

## Trace popup close alignment — 2026-10-31
Shared clearing-panel header close button now explicitly uses flex centering, zero padding/margin and line-height 1 inside its existing 30px square. Prevents cash-workspace form-button padding from offsetting the multiplication glyph within blue hover background. Existing close semantics, colors and dimensions retained. LESS/shared build passed; focused browser initially hit unrelated asynchronous diagnostic-text timing and was retried. No package/images. CSS-only change.

Focused non-image cash-flow browser passed on retry, including popup closing.

## Compact cash-flow workspace — 2026-10-31
Implemented approved separation: everyday company values, removable starting-filter chips/Add/Edit, run/refresh and results remain on main screen. Company field is mapped only in Setup. Reuses original controls/state in secondary shared clearing-style panel via cashFlowPanels; main body/header inert during modal, Escape/focus trap and scroll/focus restore. Setup has Basic mappings, Identity & dates, Clearing & references tabs and fixed Save footer; optional account fields stay optional. Autoopens for missing/invalid initial mapping and reports validation errors. Columns (max10) and troubleshooting are separate header actions, existing table Columns action opens same picker. Save columns retains existing serialization; no persistent schema or tracing changes. Help uses panel-level installer so moved controls retain contextual explanations. Existing scope read/set and model predicates preserved; no query on panel open. New browser assertions cover setup tabs; existing browser adapted to panel navigation and Save columns, scope test adapted to Edit filters. Root and Teams nonpackaging suites, focused browser and scope browser passed; final TypeScript/lint rerun recorded separately. No pbiviz or images; native Power BI validation pending. Files: cashFlowWorkspace.ts, new cashFlowPanels.ts, cashFlowScope.ts, visual.less, cash-flow-browser.mjs, cash-flow-scope.mjs.

Final UI regression exposed overly broad help installation interfering with trace controls. Help is now scoped to options and Setup separately (supersedes panel-level statement above); final cash-flow browser rerun passed including tabs and trace Back. No tracing logic change.

## Cash-flow self-audit — 2026-10-31
Read traversal, capacity, deferred clearing-group joins and frontier loader. npm test passed. Added standalone scripts/test-cash-flow-depth-audit.cjs (run after compiled root tests), passed: 1/3/10/20-document chains preserve full path and reconcile 100; 21/30/50-document chains hit engine depth limit with full 100 unresolved. Loader reaches closure for 20 documents/40 rows/39 queries; longer synthetic chains stop after40 frontier rounds with41rows and complete=false. Thus current system does NOT support arbitrary depth; default maxDepth40 counts posting transitions, not documents, plus40 loader rounds/100queries/20k returned-row limits. Tested split-order permutations and closed cycle termination with full amount conservation. Existing regression passes partial payment via explicit reference, two instalments/capacity, full three-invoice same-GL and multi-source groups, downstream GRIR join, ambiguous partial split remains unresolved. No application/limit changes; no packaging. Real SAP coverage not proven; recommend resumable bounded traversal/loading and explicit per-run limit diagnostics before claiming long-chain/million-row completeness.


## Resumable cash-flow loading and traversal — 2026-10-31
Implemented user-approved bounded continuation beyond 40 posting transitions in the shared workspace. Loader retains frontier/seen rows; generator traversal retains paths, cycle state, used capacities and pending clearing-group evidence. Continue tracing resumes in-memory work; Stop, scope changes and Back cancel it. Incomplete checkpoints display their reason and are included in troubleshooting. No completed result is presented while paused. Existing synchronous engine callers retain original limits. No allocation guessing or persistent settings schema change.

Batches: 40 discovery rounds / 100 queries / approximately 20,000 returned rows, and traversal depth/work checkpoints. Hard safety caps remain: 512 posting transitions, 1,000,000 traversal steps, 1,000 queries, 100,000 returned rows and 1,024 discovery rounds. Model responses remain capped at 5,000 rows; continuation cannot recover rows omitted by an incomplete response. Safety-stopped amounts remain unresolved; incomplete loading is disclosed. This supersedes the preceding audit for the interactive workspace, not unlimited-depth/full-ledger support.

Files: src/cashFlow.ts, src/cashFlowLoad.ts, src/qna/cashFlowWorkspace.ts, src/qna/cashFlowScope.ts; new scripts/test-cash-flow-continuation.cjs (root test chain) and askbics-teams/test/cash-flow-continuation.mjs. Root suite passed including 21/50/100-document chains, allocation equivalence, many-vendor splits, cycles, cancellation and depth safety conservation. Final root TypeScript build passed; synthetic 50-document browser continuation passed with no repeated queries and Stop/scope/Back cancellation. Scope browser passed during implementation. Final Teams suite/lint/existing popup regression results recorded below. No pbiviz packaging or images; native Power BI/Teams and actual SAP data remain unverified.

Final verification: Teams non-packaging suite, root lint and existing cash-flow browser regression all passed.


## Automatic cash-flow batches — 2026-10-31
Supersedes manual Continue tracing: shared workspace automatically resumes each loading/traversal checkpoint after a cancellable 32ms UI yield. Global loading-card/spinner styles reused in a nonblocking bottom toast with stage/batch progress. Stop remains available; scope changes, refresh and Back cancel pending work and dismiss progress. Results/error completion dismisses toast. Checkpoints remain in troubleshooting. Engine allocation, company/security scope, hard limits and incomplete-response handling unchanged. No persisted setting introduced: transient progress is not copied/exported. Help updated in cashFlowScope and workspace.
Files: cashFlowWorkspace.ts, cashFlowScope.ts, style/visual.less, cash-flow-continuation.mjs. TypeScript and synthetic 50-document automatic browser test passed: multiple loading/tracing batches without Continue clicks, no repeated queries, toast lifecycle, Stop, scope invalidation and Back. Full suites/lint results recorded below. No pbiviz or images; live host verification pending.

Final automatic-batch checks: root npm test, Teams non-packaging npm test and root lint all passed.


## Selected-step / entire-trace inspection — 2026-10-31
Added Show entire trace toggle beside Back to flow diagram in node inspection. Default remains selected step. Entire trace uses existing loaded document tables and 20-document pagination, opens the page containing the clicked posting and scrolls to its document; button switches to Show selected step. Only matching account rows in the clicked node documents remain highlighted, not unrelated occurrences elsewhere. Original lines/totals, filtering, diagram return scroll/focus and normal entries controls retained. No model queries, new persistent state or copied settings. New inspection resets to selected step. Global action styles reused with contextual title/help.
Files: src/qna/cashFlowResults.ts, askbics-teams/test/cash-flow-browser.mjs. TypeScript and focused browser passed including late-document expansion, paging, highlight isolation, returning to selected step and existing Back/clear behavior. Full suites/lint pending below. No package or screenshots; live host validation pending.

Final selected-step toggle verification: root and Teams regression suites and lint passed.
