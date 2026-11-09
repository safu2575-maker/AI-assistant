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


## Grouped cash-flow identity correction — 2026-10-31
When no line item is mapped, cashPostings now builds a stable field-name/value identity from the same grouping-field helper used by answerCashFlow: mapped fields plus selected source columns, excluding the measure. Raw modelGroupValues take precedence (including null); display values are the fallback only when raw values are unavailable. Field names are sorted, avoiding column-order dependence. Original mapped line-item identity and changed-amount rejection remain intact; no sum/overwrite/amount-based identity introduced. Grouped results are still not guaranteed unique source journal lines: genuine line-item/year mappings remain recommended. The separate 5000-row response limit is unchanged.
Files: src/cashFlowQuery.ts; scripts/test-cash-flow-scope.cjs. Added regressions for the reported 58244.54/-50 grouped shape, Posting Key/date/type distinctions, raw vs display formatting, reordered fields, amount-independent keys, repeated lookup deduplication, genuine conflict rejection and authoritative explicit item mapping. No persisted schema/UI change, no package or images. Actual SAP data needs retest after user packaging. Verification results below.

Identity correction verification: root build, root regression suite (including new identity tests), Teams non-packaging suite and lint passed.


## Automatic oversized cash-flow query partitioning — 2026-10-31
Implemented shared bounded partition loading (not an offset/cursor API). Each incomplete response is split on observed raw grouping values into complementary In/NotIn queries; complete child results replace the parent sample. Applies to starts and links in workspace. Stable posting keys reject overlap/changed amounts; company/start/link/security predicates retained. Basic filters on the same target are consolidated before host execution. Always-filter intersection now handles NotIn; Teams adapter emits NOT IN with allowlisted targets and escaped values. UI uses existing automatic loading toast and Stop/revision cancellation; diagnostic requests include partitions. No persistent settings introduced.
Response cap remains5000; partition depth128, sets up to1000 per split, and existing global1000query/100000returned-row safety budgets remain (parent samples also consume budget). Incomplete responses without separable raw group values or safety-limited work remain incomplete with a reason. This is bounded loading beyond5000, not a million-row completion guarantee or snapshot isolation across changing source data. No extra user Continue clicks.
Files: new src/cashFlowPaging.ts; cashFlowQuery.ts, alwaysFilter.ts, qna/cashFlowWorkspace.ts, cashFlowScope.ts; Teams app/model-service.ts; test-cash-flow-paging.cjs and package test chain; Teams cash-flow-model/scope fixtures. Tests: 6200 starting/link rows recover exact totals and identities; mixed blank/numeric/text values, Always intersection, invalid partition fields, unsplittable response and cancellation. Teams nonpackaging suite passed with NOT IN adapter assertion; TypeScript/lint passed; continuation and scope browser tests passed. Final root-suite result below. No pbiviz or screenshots. Live native Power BI filter/partition acceptance and actual SAP source still require validation after user packaging.

Final partition-loading verification: full root regression suite passed; added mixed-value and Always-filter assertions also passed.


## Cash-flow mapping help — 2026-10-31
All 16 source-field mappings plus signed amount now receive individual contextual descriptions before global help installation. Existing question-mark markers explain meaning, sample values and required/optional conditions. Fiscal-year help explicitly distinguishes document year from clearing year and the current separate-field validation; line item explains why Posting Key is not a unique item. Removed late generic identity help assignment. Reuses shared hover/focus help and caption styling; no tracing, settings schema or validation changes. Files: cashFlowWorkspace.ts, cash-flow-browser.mjs. Browser checks one marker per mapping, meaningful descriptions, focus and clicking without changing company selection. No package/images. Verification recorded below.

Mapping help verification: root build, root and Teams regression suites, and focused non-image browser test passed. Native Power BI verification pending.


## Centered toast placement — 2026-10-31
Moved cash-flow loading card and settings-backup toast from bottom anchors to top/left50% with two-axis translation. Existing global analysis loading overlay already centers its content. Preserved appearance, spinner, pointer behavior and cancellation. CSS-only in style/visual.less; no packaging/images. Shared LESS/browser continuation verification recorded below.
`nCentered-toast verification: shared LESS compilation and non-image continuation browser test passed.


## Processed and Needs attention reports — 2026-10-31
Added shared cashFlowReport with loaded-root counts: completed, partial, unresolved, unverified, not processed. Processed tab contains only Resolved allocations from verified completed company traversal; Needs attention retains unresolved trace paths plus pending/unverified posting table with reason, source amount (suppressed on identity conflict), shared exports and View details dialog. Counts explicitly cover loaded data. Completed company results survive Stop/errors; current in-progress company traversal has no committed partial result and stays unprocessed. Identity/amount conflict conservatively marks all retained roots unverified. Empty initial-load failures show reason without inventing omitted posting counts. No additional queries or persistent settings. Existing company/security/engine logic unchanged. Report titles carry incomplete context into exports. UI filters still apply to allocation results; run-wide pending issues remain visible.
Files: new qna/cashFlowReport.ts; cashFlowWorkspace.ts; scope unit/browser tests. Root and Teams suites, build/lint passed during implementation; summary status regression and continuation browser passed. Final issue-dialog browser result below. No pbiviz/images; native validation pending.

Reviewed user error 4_3710.txt without changing engine validation: 765 requests,100037 returned rows across responses, initial5000 incomplete; global100000row safety limit and missing-identity engine error. With no posting date mapped and numeric validation upstream, blank document/item is the likely failure, but report does not identify the row. Contains old pre-partition warning. Actual source diagnosis still pending.

Final report verification: root build/test/lint and focused cash-flow scope browser passed. Browser covers Needs attention issue details and Processed tab empty state. Fixed shared table detailAction column remapping when derived percentage columns are inserted, verified by that browser. Earlier Teams suite and continuation browser passed. Native Power BI remains unverified; no packaging.

## Blank answer drill-through — 2026-10-31
fieldParameterTrial response mapping now preserves null/undefined grouping values as model null selections instead of discarding the row context. Transactions and Summarize retain the blank-member predicate and original answer filters. Existing missing-context guard remains. Added producer selection regression in test-parameter and required-selection blank transaction/summary assertions in test-answer-transactions. Root build/test/lint passed; Teams suite passed with local HTTP access after sandbox fetch failure. No packaging. Re-run answers after installing the user-created package; live native Power BI validation remains required.

## Explicit numeric field filters — 2026-10-31
parameterQuery now resolves named numeric field/value pairs before generic year inference, longest aliases first, preserving raw text identifiers and rejecting ambiguous aliases. Company Code 2396 Year 2026 works with or without for, retaining Input filtering. Bare ambiguous numbers remain guarded. Added shortcut regressions with colliding company/year values. Root suite, focused regression, build/lint and Teams suite passed. No packaging; actual report validation pending.

## Cash-flow engine validation context — 2026-10-31
Replaced generic pre-traversal missing-identity/date/amount error in cashFlow.ts with company, fiscal year, document, line item and all failed checks for the first invalid posting. Blank identifiers are explicitly labelled; original identifiers including leading zeros are retained. Existing workspace catch copies the message into status and diagnostic error/status. Validation still throws before tracing; no rows skipped or allocations guessed. Regression covers missing document/item separately and together, invalid date and nonfinite amount. Root tests/build and Teams suite passed; no packaging or live validation.

## Cash-flow help styling — 2026-10-31
Extended the existing global Settings help-icon and caption selectors to cash-flow workspace (including its secondary setup panel). The existing help markers were already generated by installSettingsHelp, but CSS was scoped only to global Settings, leaving plain question marks in cash flow. Reuses identical circle, spacing, typography and hover/focus rules; help text/tooltips unchanged. Shared LESS compilation and focused cash-flow scope browser passed without screenshots. CSS-only; no packaging.

## Cash-flow required indicators — 2026-10-31
Added required legend and setup tab indicators plus aria-required on mappings. Conditional indicators follow existing setup dependencies (year/clearing year/reference year/referenced item). Company values caption marked required with updated help; mapped currency and date inputs marked conditionally. Optional account/description and starting filters remain optional. No validation, saved-state or query changes. Root build/test, Teams suite and focused browser required-field/dependency checks passed; no packaging/screenshots.

## Relationship-first cash-flow investigation — 2026-10-31
Added cashFlowDiscovery.ts: bounded, cancellable discovery from loaded postings, alternating document/opposite-sign and reference/clearing relationships, without balance/amount-equality allocation checks. Company/year/currency/account/partner/reference scope retained. Destination paths report tab shows endpoints, path status and whether verified allocation exists; View path renders original postings using shared tables, with no inferred cash totals. Clearly scoped to all loaded payments independent of category filters. Discovery limits:100000 work states,10000 results/pending branches,512 path nodes; UI yields every250 states. No new queries/settings.
Allocation engine unchanged; wrapper partitions conservative undirected document/reference/clearing components, verifies each together, and quarantines engine identity validation failures per component. Shared settlements stay together. Loader conflicts/invalid raw data still stop the run; this does not claim arbitrary bad data isolation. Verified root membership no longer invalidated solely by an independent component failure. Existing incomplete-source rules remain conservative.
Root suite plus new discovery regression passed (imbalance, partial amount, invalid independent component, cancellation); root build/lint, Teams suite and focused scope browser passed, including Destination paths/View path/return-to-Processed interaction. No package/screenshots; live SAP validation pending.

## Compact cash-flow setup — 2026-10-31
Removed three setup tabs. Main setup shows Company, Document, Clearing reference and Signed amount. All existing optional controls moved into one collapsed Advanced mappings disclosure with configured count; missing conditional requirements auto-expand it and show a required-fields warning. Existing values, save/copy settings and validation preserved; help notes explain account labels and year/item/currency needs. Root build/tests, Teams suite and non-image browser checks (no tabs, optional fields hidden/reveal, required dependencies) passed. No package/screenshots.

### 2026-10-31 — Cash-flow setup help tooltip layering
- Corrected the shared tooltip stacking level in `style/visual.less`: help previously rendered behind cash-flow/document overlays. Existing global appearance and hover/focus behavior retained. No settings or calculation changes.
- Updated `askbics-teams/test/cash-flow-scope.mjs` to mount the workspace inside the real Q&A root and verify tooltip text, hover/focus, dismissal and foreground hit-testing over Setup.
- Verification: focused cash-flow scope browser regression passed with compiled LESS, without screenshots. No package created. Native Power BI verification remains pending after user packaging.

### 2026-10-31 — Copy text from shared tables and matrices
- Shared table renderer now enables native text selection via tableTextSelection.ts and global cell CSS, including cash-flow document tables and matrix cells. Pointer events do not initiate enclosing dashboard dragging; a completed text-selection drag does not activate row/cell selection or links. Ordinary clicks retain existing filtering. No persistent settings changed.
- Added non-image browser regression test/table-text-selection.mjs: text and numeric drag selection under a user-select:none host, no filtering on drag, normal click filtering. Passed. Root build, tests and lint passed; Teams suite passed after retry with localhost access (initial sandbox run could not fetch local test server). No package or screenshots. Native Power BI copy/filter validation remains pending.

### 2026-10-31 — Cash-flow Variance column
- cashFlowTable adds Variance immediately after Destination amount: raw signed root amount minus the destination group amount. Grand Total recalculates unique visible starting amounts minus visible destinations, not the sum of split-row variances. Existing unresolved destination rows retain their current meaning; zero variance does not prove resolution.
- cashFlowResults enables existing global data bars for Variance through a view-only QnaTable defaultDataBarColumns hint. Shared filters, copy/PDF and Details use the added column; source-column saved settings remain unchanged. Updated automatic-column help in workspace/settings.
- Root build passed; root regression suite passed up to an old positional destination-column assertion, corrected to name-based lookup; that test and all remaining root tests then passed. Teams suite and focused scope/text-selection browsers (including default data-bar rendering) passed. No packaging/screenshots; live Power BI validation pending.

### 2026-10-31 — Split destination display correction
- Latest screenshot requirement overrides repeated Actual per destination: presentRows in cashFlowTable assigns signed Actual to the first visible row per unique starting posting; subsequent Actual cells are blank. Variance uses displayed Actual (blank = 0) minus destination amount. This is a display reconciliation, not a per-row unresolved balance.
- Shared renderer applies presentation after filtering/sorting without modifying source rows/identities, before virtualization and copy/PDF. Data-bar scale/sign follows presented values. Unique-start totals unchanged; no persistent settings or tracing changes.
- Build/lint and Teams suite passed. Root suite initially encountered a newly added test placed outside its async scope; corrected placement, then all cash-flow tests (including all remaining suite tests) passed. New non-image cash-flow-split-display browser passed initial/sorted Actual-once display, signed bars, Excel and PDF consistency; unit cases cover filtered subset/reordering/source preservation. No package. Live Power BI validation pending.

### 2026-10-31 — Export actions on cash-flow detail tables
- cashFlowResults grid helper now retains the shared Results / Copy for Excel / View PDF toolbar on path, settlement-evidence and document-entry tables. Removes only Edit, preserving fixed accounting layouts and existing global design. No calculation/settings changes or queries.
- Root TypeScript build and focused shared cash-flow scope browser passed: each detail table has both actions; copied document headers/rows match PDF payload. Synthetic shared-renderer verification, not live host verification. No package/screenshots.

### 2026-10-31 — Repeated-posting floating-point comparison
- Added sameCashPostingAmount in cashFlowAmount.ts for repeat-value checks in cashFlowLoad/cashFlowPaging. Finite same-sign values accept at most 8 * Number.EPSILON * max(1, magnitudes), capped at 1e-7. Original loaded amount/object retained; no rounding or allocation tolerance changes. Meaningful changes, nonfinite values and opposing signs remain rejected. Partition duplicates still fail as overlaps even when amounts agree within precision.
- Regression reproduces -154570.2 versus -154570.19999999998, verifies one retained posting, rejects a cent change, large-value changes and invalid values, and preserves partition overlap/conflict checks. Root build/full tests and Teams full suite passed. No package or live Power BI validation.

### 2026-10-31 — Transaction source columns in trace tables
- cashFlowResults traceGrid now includes CashSetup.displayColumns in path, incoming-settlement, document-entry and cashFlowReport destination-path tables. Values come from each linked posting's sourceValues/mapped fields; signed measure uses that posting's amount. Original accounting columns remain, and available-lines totals are recognized as totals rather than sortable detail rows.
- Retains shared table header menus for sorting/filtering/resizing/data bars; shared ui adds Copy column using filtered/sorted presented rows. Escape closes the filter without dismissing the enclosing trace popup.
- Trace Columns opens the existing shared source-column selector (up to 10). Adding/removing source columns changes the same saved displayColumns used by the main table; existing settings validation, field renaming and Copy/Paste settings apply without a new schema. Save then rerun cash flow to fetch newly selected fields. Standard trace/accounting columns remain available. No changes to traversal, allocation, company/security scope or query batching.
- Root build/full tests/lint passed; Teams suite passed with localhost access after sandbox fetch failure. Expanded non-image scope browser passed linked-row values, export payloads, sort/filter/copy-column order, Escape, opening Columns from trace, selection changes/save/rerun and cached repeat requests. Final TypeScript build passed. Live Power BI validation pending; no package or images generated.

### 2026-10-31 — Full transaction inspection
- Added cashFullTransaction.ts, reached through View full transaction inside the existing trace popup and Needs attention processing-issue details. Shows starting payment, confirmed/unresolved or unverified status, cached discovered journeys labelled as evidence, unique document tables, original debit/credit lines including blank clearing, stopping explanations/highlights and Previous/Next issue navigation. Documents paged in groups of 20; journeys rendered on expansion. Existing shared tables retain sorting, filters, copying and PDF.
- cashFlowReport/cashFlowResults pass discovery context; cashFlowWorkspace provides diagnostic report and explicit Load missing entries via existing company/currency-scoped, security-respecting bounded/paged loadCashLinks/fetchRows pipeline. No requests on opening; request revision and popup-active checks discard late results. Additional entries are inspection-only; rerun cash flow to recompute paths/allocations. Missing/unverified data is never promoted to resolved. No persistent configuration/schema added.
- Root build/full suite/lint and Teams full suite passed. cash-full-transaction browser passed cached opening, blank-clearing balancing lines, candidate labels, stopping issue navigation, copy/PDF payloads, explicit loading, company isolation and close-during-load. Existing scope browser also passed integration entry and no-query opening. No screenshots/package; live Power BI validation pending.

### 2026-10-31 — Copy all trace tables
- Available document entries now has Copy all tables in the shared table toolbar style. Copies labelled path/incoming-group tables and document tables into one Excel-compatible clipboard payload, separated by blank rows. Includes collapsed paths and all document pages from loaded data; respects Selected trace lines and selected-step/entire-trace inspection scope.
- Shared tableExport WeakMap exposes current presented columns/filtered/sorted rows and existing clipboard fallback, so combined and per-table exports use the same values, including off-screen virtual rows. No model queries, allocation changes or saved-setting additions.
- TypeScript build, root suite, lint and focused non-image cash-flow-scope browser passed, including combined headings, filtered/sorted rows and no extra queries. Teams suite passed with localhost access. No pbiviz package; live Power BI clipboard validation pending.

### 2026-11-01 — Shared multi-payment clearing groups and opt-in estimates
- Added cashFlowGroup.ts fallback in traceCashComponents. Only wholly Allocation-unclear, complete connected components are retried; existing resolved/partially resolved allocations are preserved. Identifies selected/known bank-account source postings, including loaded outside-period evidence. Requires same sign, no outgoing bank reference, account codes and at least two contributing payments. Uses an internal balanced funding envelope with exact references into original bank posting identities to reuse the existing amount/capacity, partner/year/currency/cutoff, cycle and continuation checks as one root. Synthetic postings are removed from returned evidence. No additional model queries.
- Fully reconciled single-GL groups attribute selected payment amounts at destination level without inferring individual invoice pairings. Mixed-GL groups expose complete group totals separately; original payment splits stay unclear by default. Optional proportional policy weights selected payments by verified group destination totals, marks every derived allocation Estimated, and retains those amounts as unverified. Output expansion capped at 10,000 payment/destination rows; group evidence retained above that bound. Related payments do not increase selected-period totals.
- Shared policy control in Cash-flow setup and Q&A cash settings includes help; optional schema defaults to verified. Existing backup validation/merge/replace retains the enum and rejects unsupported values. Added Estimated allocations and Clearing groups report tabs; labelled allocation basis in table exports/trace/chart. Group evidence and outside-period scope are distinct from individual payment results.
- Tests: root full suite, Teams full suite (localhost permission), TypeScript build, lint, existing cash-flow-scope browser and new non-image cash-multi-payment browser passed. Focused tests cover 60+40 vs 50+30+20, same/mixed GL, estimates conservation, shuffled order, outside-scope payments, missing/partial funding, reversals, multiple layers, company/currency/year/partner isolation and cancellation. Final targeted engine/backup tests and build passed after output bound and additional isolation assertions.
- Limitations: conservative fallback does not replace partially confirmed components, infer unidentified bank accounts, resolve netted mixed-sign/credit/reversal groups, or repair missing downstream data. Proportional values are estimates, not historical settlement proof. Live SAP/Power BI validation pending; no pbiviz package or screenshots created.

### 2026-11-01 — Trace copy menu
- Removed the standalone Copy all tables bar from Available document entries. Its existing table Copy for Excel action now offers Copy this table / Copy all tables using the global column-menu classes. Single-table inspection keeps direct copying; other answer tables remain unchanged.
- Reuses existing presented-row exports and combined trace exporter: filters, sort order, collapsed paths and document pages retained, no additional queries or persistent settings. Menu supports keyboard navigation, Escape without closing the popup, outside dismissal and scroll positioning.
- Verification: TypeScript build, root full tests, lint and Teams full suite passed (Teams localhost access required). Focused non-image cash-flow-scope browser passed per-table/combined copying, filter/sort payload, Escape and no extra model queries. No package/screenshots; native Power BI validation pending.

### 2026-11-01 — Cash-flow allocation status badges
- Added always-visible Allocation status beside Destination amount, before Variance. Shared table presentation metadata renders pale rounded semantic badges while keeping original status text in sorting/filtering/Excel/PDF. Green Verified / Verified · Destination only, amber Estimated · Proportional, orange Unresolved, red Unverified and grey Not processed. Trace popup repeats badge and explanation; report header uses the entire result to avoid marking mixed results fully verified.
- Reuses global typography and shared table layout. No model queries, calculation rules, amount data-bar changes or new saved settings. Engine statuses remain unchanged; cashFlowStatus maps display labels only.
- Validation: root build/full tests/lint, Teams full tests and non-image multi-payment/split-display browser tests passed. Tests cover status labels/tones, same-destination and estimated UI/export text, Actual-once variance and sorting. Live Power BI validation pending. No package or screenshots.

### 2026-11-01 — Grouped accounting-entry presentation
- Available document entries now uses one shared table for document lines, one toolbar/header and a single table scroll region instead of individual document tables. Document groups collapse individually or together; sorting stays within documents and filtering recomputes Visible lines total. Selected trace lines continue to suppress document totals. Real line items remain; the repeated Grouped posting placeholder column is omitted when no item identifiers exist. Account code/description share the Account cell; user-selected extra columns remain available.
- Added optional documentGroups presentation metadata to the shared renderer; existing answer tables are unaffected. Virtualization includes group headers/subtotals. Copy all retains collapsed document rows and current filters/sorting; per-table/PDF exports reflect the visible expanded view. Path tables initially collapsed; trace navigation and temporary row highlights retained. No queries, allocation or persistence changes.
- Build, root regression suite, lint and Teams suite passed. Focused scope browser covers grouped exports/filtering/totals/collapse; additional 600-row grouped-entry test covers virtualization, complete collapsed export and sorting within documents. No packaging or screenshots. Native Power BI verification pending.

### 2026-11-01 — Compact trace summary and visible document subtotals
- Replaced the entry popup paragraphs/path-table disclosure with a compact starting-account → destination / allocated cash / status summary, company/start-document context and retained View full transaction. Allocation basis remains visible when applicable; completeness/original-amount help retained in context tooltip. Full transaction, diagram, allocation tabs and combined evidence exports remain available.
- Renamed controls All entries / Trace only. Group headings show trace-account journey and entry count, with company/year/currency and clearing references below. Repeated mapped Account description is suppressed in the grouped entry presentation because Account already includes it; saved source-column choices unchanged. Accounting view delegates scrolling to its one table region.
- Fixed blank document subtotals: shared renderer's Grand Total label-cell clearing no longer erases document-subtotal values when numeric-column inference misses debit/credit. Group description context is preserved in exported headings.
- Root build/full tests/lint and Teams full tests passed. Focused scope browser passed totals visible, grouped copying/filtering/sorting, diagram inspection/back, updated labels and a single scrolling accounting region. No package/screenshots; live host validation pending.

### 2026-11-01 — Expanded retail/cash-flow fixture and answer menu
- Added Cash flow as third answer/analysis context-menu action below Summarize by, using existing menu/workspace. Shared ui helper reuses saved configuration, no query on opening, no automatic Rent/KPI-to-cash conversion or inferred clicked-row scope. Explicit workspace notice explains saved scope; Back preserves answer. Existing saved-state schema unchanged.
- Added outputs/cash-flow-expanded-20261101 updated workbook/combined CSV and PowerBI_Setup.txt. Original2160 retail rows and measures retained;144 synthetic cash journal lines,71 balanced documents,14 scenarios: simple/multilevel, one-to-three, same/mixed-GL many-to-many, multiple vendor lines, exact-reference partial, ambiguous partial, missing downstream,25-document continuation, cross-year, second-company repeated IDs and receipt. New mapping columns/Scenario ID/Record Type, expected results and setup guide. Import/types/field-parameter/measure setup remains manual in Power BI.
- Independent balanced-document/identity/retail-total assertions and all14 current-engine expected outcomes passed, including explicit proportional-estimate conservation. Root build/tests/lint and Teams tests passed. Focused non-image cash-flow-answer-menu browser passed order/open/no-query/Back for normal and analysis menus. No package or screenshots. Live Power BI integration pending.
- Export verification: reopened XLSX read-only and compared every original Retail/Waterfall/Expected results/Read me cell; all preserved. Combined CSV has2304 rows with leading-zero identities retained,144 unique cash postings and71 balanced documents. No spreadsheet error cells found.

## 2026-11-01 — Calculation Groups

Implemented and regression-tested shared calculation groups, independent formula filter contexts, safe AST execution, default recalculated totals, date functions, formula editor/preview, # group/member tokens/chips, multi-measure tables/matrices, breakdowns and portable settings. See docs/CALCULATION_GROUPS.md for grammar and supported boundaries. Main new modules: calculationFormula, calculationGroups, calculationContext, calculationRequest, qna/calculationGroupSettings; both host adapters use shared source.

Root build/test/lint and Teams build/test passed; focused non-image editor/chat/transport checks passed. Matrix breakdown regression added. No pbiviz package, screenshots or deployment. Native Power BI validation is pending. Automatic stable model-object rebinding, arbitrary raw-field aggregation, full cross-field boolean filter translation, separate group ACL and a full IDE editor are not implemented; unsupported execution reports errors rather than fabricated values.

## 2026-11-01 — Shared-filter formula enhancement

Source implemented/tested: (Rental + ServiceCharge, [Year] = 2026) and nested independently filtered operands. New filtered AST nodes, immutable recursive contexts, inner-over-outer same-field precedence, existing total policies, parser predicate diagnostics, context-aware suggestions, formatting, help and breakdown. Legacy syntax and settings remapping retained. Root/Teams regression suites and non-image editor check passed; actual Power BI remains unverified. No package created. Same-field OR works; unsupported cross-field OR remains an explicit error. See CALCULATION_GROUPS.md.

## 2026-11-01 — Calculation settings layout

Full-width formula editor, compact group chooser, expandable secondary options, collapsed syntax preview and readable option labels implemented. No engine/persistence changes. Root build/tests, Teams build/tests and actual-style non-image browser checks passed at 320/460/700px editor widths. No package created; live-host verification pending.

## 2026-11-01 — Calculation group reorder handle

Replaced Move group up/down buttons with the shared settingsActionIcon dotted grip in the group chooser. Pointer drag/drop and Up/Down keys reorder the existing groups array, retain the selected group/formulas, restore handle focus and announce the new position. Tooltip explains both interactions. Saved settings continue using the existing ordered array; no schema or engine changes.
Files: src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs.
Verified: npm run build, npm test, npm --prefix askbics-teams test (rerun with local fixture-server access after sandbox fetch failure), and non-image calculation-editor browser checks including drag, keyboard boundaries, selection and formula preservation. No package/screenshots created; native Power BI validation remains pending.

## 2026-11-01 — Calculation group delete icon
Reused settingsActionIcon(delete) for Delete group in src/qna/calculationGroupSettings.ts, retaining its accessible name/hover label, existing two-click confirmation and dependency guard. No persistence or calculation changes. Root build/tests, Teams tests and non-image calculation-editor check passed. No package created; live-host appearance remains unverified.

## 2026-11-01 — Quoted formula value autocomplete
Calculation editor now suggests measures and values from the effective default field while typing inside single quotes, including middle-of-token replacement and escaped apostrophes. Values use the existing bounded model catalogue loader/cache; no arbitrary model access or evaluator changes. Missing default-field guidance and formula help added. Pending suggestions are invalidated immediately on edits/Escape.
Files: src/qna/calculationGroupSettings.ts, askbics-teams/test/calculation-editor.mjs.
Verified root build, root tests, Teams tests and non-image editor regression (Home Living, escaped apostrophe, quoted measure replacement, existing formatting/reordering). Default field and default measure must be configured for value shorthand; available suggestions depend on loader coverage. No package/images; live Power BI validation pending.

## 2026-11-01 — Compact formula completion menu
Replaced oversized in-flow suggestion buttons with a compact dropdown anchored beneath the formula input. Shared Segoe UI/blue hover styling, 28px rows, max 164px height/360px width, no horizontal scrollbar. Keyboard active options scroll into view. No formula/persistence changes.
Files: src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs.
Root build/tests, Teams tests and non-image browser geometry/interaction tests passed. No package/screenshots created; native-host appearance pending user verification.

## 2026-11-01 — Calculation card layout simplification
Calculation headers now contain the shared dotted reorder grip, compact Duplicate action and global delete icon. Removed separate Manage calculation disclosure and move buttons. Pointer and keyboard reorder preserve the moved card's expansion; deletion confirmation/dependency checks unchanged. Defaults & formatting uses a responsive two-column grid with full-width description/total settings. Formula starts at four rows and remains resizable. Existing formula engine and saved schema unchanged.
Files: src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs.
Verified root build/tests, Teams tests and non-image browser checks including responsive editor widths, duplicate/reorder/delete confirmation and formula preservation. No package/screenshots. Native Power BI visual verification pending.

## 2026-11-01 — Saved calculation-group list
Calculation Groups opens with New calculation group and compact saved-group rows (name, count, edit icon, existing reorder grip). No group editor opens automatically. Edit opens group settings/calculations; Done closes the editor and explicitly notes that Save settings applies the draft. Search appears for five or more groups. Existing serialization, formulas and dependency protection unchanged.
Files: src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs.
Passed root build/tests, Teams tests and non-image browser checks covering Done/reopen and reconstruction from saved groups without auto-expansion, plus existing CRUD, reorder, autocomplete and responsive checks. No package/screenshots; native host appearance pending.

## 2026-11-01 — Calculation chat cache, editing and chip correction
Fixed calculation responses failing structuredClone: materialized calculationNotes remain plain serializable data, and the temporary calculationDetails closure is removed before caching. KPI evaluation failures now show Unavailable with breakdown/error text. Editing a calculation question resolves internal group/member IDs to readable #names. Removed the separate calculation-selection chip strip; normal # suggestions and internal canonical IDs remain.
Files: src/customKpis.ts, src/qna/ui.ts, style/visual.less, scripts/test-calculation-groups.cjs, askbics-teams/test/calculation-chat.mjs.
Passed: root build, full root tests, lint, Teams regression suite and non-image calculation chat browser test. Added regression coverage for structuredClone of calculation results, preserved notes, KPI failure explanations, readable editing and no chips. No package or screenshots created. Live Power BI execution remains to be checked after the user packages/imports; tests cannot establish the user's saved formula/data validity.

## 2026-11-01 — Calculation group workspaces and tab navigation
Implemented the approved saved group list -> group editor -> calculation editor navigation in src/qna/calculationGroupSettings.ts. Group editor opens Calculations, with Defaults and Group details tabs; existing duplicate/delete protection is behind the global more icon. Calculation editor has Formula, Format & totals and Advanced tabs, breadcrumb/back navigation and visible effective defaults. Reuses global settings tabs, icons, dropdowns and help. No additional save footer or persistence schema: the existing Save settings/Cancel owns the draft. Formula edits, settings and preview-context drafts survive navigation; tabs keep mounted controls/undo history. Saved list retains reorder handles and edit icons. Scoped styling in style/visual.less.
Verification: root build and Teams regression suite passed; non-image calculation-editor browser checks passed for responsive widths, tab navigation, draft retention, formula suggestions/format/preview, duplicate/delete and group/calculation reordering. Root full regression result recorded below. No package, images or native-host verification.
Full root regression suite also passed.


## 2026-11-01: Dynamic calculation field values
Shared parser/runtime/editor now support quoted arithmetic measures and accessible field-value shorthand with a default measure. Without a default field, configured text/number fields are checked through complete, filtered model responses. Multiple matching fields require explicit selection; unavailable values fail clearly. Resolved predicates retain table/column identities. Request-local query caching and the 250-context budget remain.
Autocomplete searches case-insensitively before limiting results, including IN/NOT IN lists and escaped apostrophes. Existing defaults, backup schema, independent scopes and total policies remain. Native/custom measure names take precedence over shorthand values. Syntax validation does not prove shorthand data availability; use preview.
Validation: root build/full npm test, lint, Teams suite and focused calculation-editor browser test passed. No package or screenshots. Live Power BI verification remains pending.
Limitations: suggestions are accessible-data samples. Shorthand lookup is scoped to current context/default measure and may omit blank-measure members; use explicit field predicates then. Unsupported cross-field OR still fails clearly. No arbitrary model access or security bypass introduced.


## 2026-11-01: Aging defaults to today
User requested no date entry for normal aging questions. src/aging.ts now captures the local calendar date once per request and uses it whenever the question omits as-of, even if an old setup contains defaultDate. Explicit ISO dates/today still work; historical balance safeguards remain. Answer text and agingView expose the resolved date. Removed the fixed-default date control from src/qna/agingSettings.ts and updated settingsLayout help. Legacy defaultDate remains serializable for backup compatibility, but is not applied; legacy validation checks its syntax without requiring an unused snapshot mapping.
Verification: root build and full regression suite, Teams regression suite passed. After the final legacy-validation adjustment, TypeScript compilation plus aging and settings-backup tests passed. Added tests for omitted-date today, old fixed default overridden, snapshot date and summary without snapshot. No package/screenshots; native-host testing pending. Due/posting date mapping is still necessary to calculate age.


## 2026-11-01: Field-labelled formula suggestions
Quoted value suggestions now show Value — Field (for example Home Living — Tenant), preserving separate entries when the same value occurs in multiple fields. Selecting inserts a scoped default-measure expression with an explicit field predicate; missing default measure gives guidance rather than an ambiguous insertion. Existing explicit-filter literal suggestions remain unchanged. Reuses global completion menu and accessible value loader/cache; saved formula and backup schema unchanged. Updated formula help.
Files: src/qna/calculationGroupSettings.ts, askbics-teams/test/calculation-editor.mjs.
Verified root build/full tests, Teams suite and non-image editor test including duplicate labels across fields, escaped apostrophes, mid-token replacement and explicit IN/NOT IN suggestions. No package/screenshots; native host verification pending.

## 2026-11-01: Calculation Groups navigation refinement
Verified the existing groups-first navigation and completed its presentation: calculation lists show compact formula previews; the calculation editor replaces the list and hides the parent group header; duplicate/delete use the global more menu; Done returns with drafts retained. Default filter field is labelled separately from Default measure. Existing tabs, drag/edit icons, total default, formula behavior and saved schema remain unchanged. Save settings remains the persistent apply action.
Files: src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs.
Validation: root build and regression suite passed; Teams build/regression suite passed after allowing its local HTTP test server; non-image editor test passed including Done, draft retention, menus, reordering, saved-state reconstruction and responsive controls. No package or images produced. Native host appearance remains to be tested by the user. Existing unrelated diff-check warning in scripts/test-cash-flow.cjs was left untouched.

## 2026-11-01: New group opens its details
New calculation group now opens Group details immediately, focuses and selects the group name. Existing groups still open Calculations. Navigation-only state; saved schema unchanged. Updated src/qna/calculationGroupSettings.ts and askbics-teams/test/calculation-editor.mjs. Root build/full tests, Teams tests and non-image editor test passed, including first/second creation focus and existing-group navigation. No package or screenshots; live Power BI verification pending.

## 2026-11-01: Compact calculation-group workspace
Inside an opened group, added group switch buttons with counts, search by calculation name/formula/description, New group action, calculation count and primary Add calculation styling. Calculation rows retain formula previews and global edit/drag icons and now expose the global more menu directly. Search is local presentation only and retains per-group draft text. Saved groups remain the initial view; New group still opens details with name focus; full calculation editing replaces the list. Default/format/total behavior and persistence schema unchanged.
Changed src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs. Root build/tests, Teams build/tests and non-image browser editor checks passed, including search, empty state, group switching, menu Escape, drafts and saved reconstruction. No package or screenshots generated. Native Power BI/Teams visual appearance not live-verified.

## 2026-11-01: Calculation tenant-value priority and scalar totals
Source fixes: src/parameterQuery.ts preserves longer known field values before matching shorter measure/calculation names (NOVA no longer consumes Nova Fashion). src/fieldParameterTrial.ts scalar adapter propagates modelResultComplete and recognizes single AdvancedFilter Is predicates as fixed-member contexts, as well as Basic In. This lets formula equality filters obtain a scalar from the fixed grouped member and preserves incomplete-data rejection. No settings schema/UI changes.
Added scripts/test-calculation-retail.cjs to root npm test. Reads outputs/askbics-expanded-20261025/askBICS_Sample_Retail_Data.csv and exercises calculationView through the actual host answer/scalar adapter with synthetic filtered model aggregation. Verified Home Living yearly 513130/520828/528640/536570/544618 (total 2643786); Nova Fashion 478525/452034/454892/429574/432433 (total 2247458). Tests ordinary Nova Fashion questions, #test by Year, scalar values, non-additive ratio total and incomplete scalar metadata. Screenshot NOVA values match this dataset. Home Living's blank yearly cells did not reproduce with the shown group defaults; saved calculation overrides or live diagnostics still needed if it persists.
Checks passed: npm run build, npm test, updated retail regression, npm run lint, npm --prefix askbics-teams test (initial restricted local-server fetch failed; rerun with permitted local HTTP access passed). Live Power BI/Teams not verified. No pbiviz package or images generated. Existing unrelated workspace changes preserved.

## 2026-11-01: Dismiss formula suggestions
Added a compact sticky Suggestions header with the shared outline close action in Calculation Groups. Clicking Close suggestions cancels pending suggestion work, clears the popup, preserves formula/caret and returns editor focus; Escape also works from inside the popup. Completion keyboard navigation excludes the close action; typing reopens suggestions. No saved-state changes. Files: src/qna/calculationGroupSettings.ts, src/qna/settingsActionIcon.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs.
Verification: root build/tests, Teams tests and non-image browser editor test passed (close, Escape, unchanged text, focus, reopen and Enter completion). No package or screenshots. Live Power BI verification pending.

### 2026-11-01: Calculation group tab order
- Reordered shared group tabs to Group details, Defaults, Calculations in `src/qna/calculationGroupSettings.ts`. New groups still open Group details; existing groups still open Calculations.
- Updated the existing keyboard-navigation browser assertion for the new order.
- Verified: root build and tests, Teams tests, and focused calculation-editor browser test passed. No package created; live Power BI not verified.

## 2026-11-02: Formula suggestion presentation
Implemented compact caret-positioned suggestions with type markers and Ctrl+Space reopening in the shared editor. Existing data access and calculation logic preserved. Root build/tests/lint, Teams tests and non-image editor browser regression passed. No pbiviz package; live-host validation pending. See PROJECT_MEMORY.md for files and verification detail.

## 2026-11-02: Prefix-only formula suggestions
Removed automatic full lists: formula suggestions require typed text and use case-insensitive prefix matching for available context-appropriate names/values. Partial field names supported. Root build/tests/lint, Teams tests and focused editor browser checks passed. No package or live-host verification. See PROJECT_MEMORY.md for details.

## 2026-11-02: Live formula syntax error indicators
Added red syntax-error styling, exact-character excerpt and Go to error selection to the shared formula editor. Correcting syntax clears the indicators. Root build/tests/lint, Teams tests and focused non-image editor regression passed. No package created; live Power BI not verified. See PROJECT_MEMORY.md for implementation details.

### 2026-11-02 — Readable calculation names in restored composer
- Fixed `src/qna/ui.ts` restoreState and Teams resumeLatestQuestion to convert stored #calc/#metric identifiers into current readable names in the composer. Saved execution questions retain stable identifiers; restoring Power BI state still performs no query.
- Added regression coverage in `askbics-teams/test/calculation-chat.mjs` for last-question fallback, legacy token drafts, Teams drafts, ordinary text and resubmission with stable IDs.
- Verified: root build and npm test, Teams npm test (local-server access required), focused calculation-chat browser test with supported Node runtime passed. No package or screenshots created; native host activation remains unverified. No setting/schema changes.

## 2026-11-02: Formula typing assistance and inline error marks
- Shared editor pairs parentheses, field brackets and quotes, wraps selections, skips existing closers, and leaves comments/quoted content untouched. Existing undo/redo and prefix-only suggestions are retained. Field-value completions now display Value — Field; completing an automatically paired field consumes its closing bracket.
- Added a pointer-transparent editor underline layer for exact parser/unknown-name error positions; existing diagnostic excerpt and Go to error remain. Local catalogue validation flags unknown fields/functions/measures without model queries; shorthand values with defaults still require model preview for availability/ambiguity.
- Files: src/qna/formulaTyping.ts, src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs. No persistence/schema or execution changes. Help updated.
- Root build/tests/lint and Teams tests passed; focused non-image editor coverage includes error marks, delimiter pairing, comments, quotes, completion and narrow layouts. No package or screenshots; native Power BI activation unverified.

## 2026-11-02: Calculation items displayed as rows
- Latest requirement replaces the earlier calculation-columns presentation. Shared customKpiRequest now renders Calculation Group answers as a long table: grouping fields, Calculation, Value. Scalar and matrix-shaped requests also use this row layout; ordinary native-measure/legacy-only answers remain unchanged.
- src/calculationRows.ts preserves formatted/raw values, per-cell breakdowns, source indices and model selection scope. Each item has its own total row using existing total-context evaluation. No aggregate total across unlike calculations is produced. UI drill actions use the original row measure, and generic percent-of-grand-total derivation is disabled for this mixed-metric Value column.
- Corrected breakdown lookup to use typed model selections for numeric grouping labels. No formula, persistence schema or model query changes; saved answers need rerunning to receive the new layout.
- Regression: root build, npm test, lint, Teams npm test, and non-image calculation-rows browser test passed. Teams local HTTP tests required running outside restricted networking. Added retail assertions for both table/matrix requests, scalar rows, totals, raw values and selection scope; updated Teams transport assertions. No pbiviz package or screenshots. Live Power BI cross-filtering/activation remains to be verified. Existing unrelated scripts/test-cash-flow.cjs EOF whitespace warning remains.


## 2026-11-02 — Compatible Calculation Group operand batching
- Source verified: calculationRequest previously loaded each native operand separately. Power BI field-parameter requests and the Teams adapter both apply one filter context per request.
- Changed shared `src/calculationRequest.ts` to plan compatible arithmetic dependencies, batch native measures by identical effective filters/grouping (maximum 16 per request), and cache per-measure projections and row indexes. Anchor queries reuse these batches. Total-context queries remain separate from grouped queries; no summing displayed ratios.
- Independent operand filters remain separate requests. Conditional/function branches remain lazy; shorthand value discovery still uses supported model lookups. This is not arbitrary per-operand DAX pushdown and does not guarantee one query for all formulas.
- Regression fixtures now support multi-measure responses; same-context ratio uses 2 transport calls instead of 4 (grouped inputs plus total inputs). Tests cover independent years, nested/shared filters, incomplete-data rejection, totals and retail values. No persistence/schema or UI changes; no package created. Native Power BI performance/activation still needs user testing.

Validation: root build, full npm test, lint and Teams full regression suite passed. Teams required local HTTP test-server access outside the sandbox after its initial fetch restriction. Focused batching tests also passed for 17 operands split into 16+1 requests. No live Power BI timing claim.
## 2026-11-02 — Calculation request and local processing optimization
- Shared src/calculationRequest.ts now reuses original batched tables and one row index instead of allocating per-operand projections. Anchor row unions scan each shared response once. Metric/filter/value resolution is memoized within the request, including defaults and effective scope; no persistent or cross-model cache.
- Reuse grouped-response totals only when modelEvaluatedTotals explicitly marks a finite native total as model evaluated. Never reuse synthesized row sums or unknown totals. Non-additive formulas still evaluate in total context with independent operand filters.
- Regression: compatible ratio drops from 2 to 1 calculation transport requests when verified model totals are supplied; without that marker it retains 2. Added tests reject fallback totals. Teams test asserts 2 calculation DAX statements (grouped data + model totals), excluding catalogue queries. Different filter contexts remain separate under current adapters; this is not universal single-DAX execution.
- Files: src/calculationRequest.ts, scripts/test-calculation-groups.cjs, askbics-teams/test/calculation-groups.mjs.
- Validation: root npm run build, full npm test, npm run lint, Teams full npm test, and focused Teams calculation test passed. Teams suite required local HTTP access outside restricted networking. An initial test assertion counting catalogue lookups as calculation queries was corrected to count measure-data queries only.
- No UI, settings schema or persistence changes, no package created. Actual Power BI/Teams activation and real-data latency remain unverified.

## Calculation Groups reference-layout adaptation — 2026-11-02

Implemented the supplied HTML design direction in the shared settings UI (src/qna/calculationGroupSettings.ts and style/visual.less): saved groups open the first group's Calculations tab; compact group switching/search and calculation rows remain visible while editing on wider panels; the selected row is highlighted and the inline editor appears beneath. Narrow panels hide the list during editing. New group still opens Group details with name focused. Global edit/delete/close icons and existing reorder/dependency safeguards remain. Formatting, totals and overrides are grouped under Advanced options. Done and Close editor retain drafts; Save settings remains the persistence boundary. No formula/query, schema or host-adapter changes in this UI task.

Verification: npm run build, npm test, npm --prefix askbics-teams test and npm run lint passed. The non-image calculation-editor browser regression passed CRUD, draft preservation, group switching, formatting/validation, autocomplete/help, and responsive widths 320/460/700/850 including overflow and list visibility checks. Live Power BI/Teams validation remains pending. No package or preview images created.

## Calculation Groups navigation correction — 2026-11-02

Supersedes the previous reference-layout adaptation: removed the separate saved-group-list/back route and the Group details / Defaults / Calculations secondary tabs. Saved group names are now the primary tabs, followed directly by the selected group's calculation list and Add calculation action. Group settings opens name, description, enable state and defaults together; Done returns to calculations. New group immediately opens these settings and focuses its name. Empty state has only the create action. Preserved group reorder (drag and keyboard), duplication, dependency-protected deletion, calculation editing, drafts and global Save settings. No persistence schema, formula or query changes.

Files: src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs. Build, root regressions, Teams regressions and lint passed; browser editor regression passed including primary-tab navigation, keyboard switching, responsive layout, CRUD and draft preservation. No screenshots/package; live Power BI/Teams verification pending user packaging/import.

## Calculation Groups action wording — 2026-11-02

Simplified creation labels: Add group in both empty and saved-group states; Add calculation / KPI only inside the selected group. Updated section help and empty-group explanation to clarify the hierarchy. Existing tab navigation, formula behavior and persistence unchanged. Files: src/qna/calculationGroupSettings.ts, src/qna/settingsLayout.ts, askbics-teams/test/calculation-editor.mjs. Build, root/Teams regressions and non-image editor browser test passed. No package; native-host confirmation pending.


## 2026-11-02 — Calculation KPI rows with year columns
- Supersedes the long Year / Calculation / Value layout for a single configured year grouping. Calculation Groups now show one row per KPI, chronological year columns, and a per-KPI Grand Total column. Other grouping layouts and native-only answers are unchanged.
- Shared presentation pivots already evaluated values, raw values, breakdown notes and per-cell model/source selection context; adds no queries and never sums ratios or unlike KPIs. Duplicate cells retain the original layout rather than overwrite data. Global table header handling retains simple year/Grand Total labels; total drilldown does not require a year selection.
- Files: src/calculationRows.ts, src/customKpis.ts, src/qna/ui.ts, scripts/test-calculation-retail.cjs, askbics-teams/test/calculation-rows.mjs.
- Checks: build, root regression suite, lint, Teams regression suite and non-image calculation-rows browser test. Native Power BI activation/cross-filtering still requires user packaging/import and rerunning the question. No package generated or persistence schema changed.

## 2026-11-02 — Readable calculation hover context
- Replaced raw Power BI filter JSON in shared calculation explanations with catalogue display names, readable comparison/IN predicates and effective grouping values. Each operand retains its own context; numeric values, query planning, caching and allocation logic are unchanged. Unknown filter shapes are labelled additional model filter rather than exposed as JSON.
- Files: src/calculationRequest.ts, scripts/test-calculation-groups.cjs. Regression checks cover actual field labels, independent operand filters and range predicates without schema/internal column JSON.
- Validation: root build and full root/Teams suites passed. Teams local HTTP test initially failed under sandbox restrictions; rerun with local-server access passed. No package created. Live host hover verification remains pending user packaging/import.

## 2026-11-02 — Formula editor inline diagnostics and value completion
- Removed the duplicated error excerpt and Go to error action. The existing editor underline and red diagnostic now appear together directly below the formula input; optional syntax preview remains collapsed.
- Completion handles a quoted prefix at the caret and immediately after a closing quote. Shorthand value suggestions search accessible fields with the default field first instead of excluding other fields. Explicit field predicates retain field-scoped suggestions and case-insensitive prefix matching. No values are invented or security boundaries changed.
- Files: src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs. Updated contextual help. No persistence or formula-evaluation changes.
- Passed root build, full root tests, lint, full Teams tests and non-image calculation-editor browser regression, including sout/South for Zone with Tenant default and both open/closed quotes. Teams local HTTP suite required rerun with local-server access after sandbox fetch failure. Native Power BI accessible-value availability still needs testing after user packaging/import. No pbiviz or images created.

## 2026-11-02 — Calculation shorthand query optimization
- Explicit default filter fields now resolve shorthand directly into a typed predicate, without a member-discovery request. Unknown defaults and invalid numeric values fail clearly; unmatched values retain model blank semantics. Model security/filtering still applies.
- Query preplanning includes default-field shorthand, allowing it to batch with explicit native operands under identical filters/grouping. Different contexts remain independent.
- Discovery without a default field retains ambiguity checks. A complete, single-member equality-filtered response can supply its raw scalar value for the exact same filter context. No visible-row summation, incomplete input reuse, cross-session cache or persistent schema change.
- Inspected fieldParameterTrial request reset logic: retained clear/acknowledgement safeguards when predicates change. Fewer redundant requests reduce transitions without weakening stale-filter protection.
- Files: src/calculationRequest.ts; scripts/test-calculation-groups.cjs; scripts/test-calculation-retail.cjs. Retail regression verifies three adapter requests (year anchor + two tenant queries) for five years and correct recalculated totals. Tests also cover shorthand/explicit compatible batching, invalid default fields, independent contexts, incomplete results and non-additive totals.
- Passed npm run build, npm test, npm run lint, and Teams tests with supported Node runtime. Teams local HTTP test initially failed under sandbox network restrictions; rerun with local-server access passed. Focused calculation tests passed again after adding the batching assertion.
- No package, images or deployment. Million-row live-model performance is not verified; aggregation remains model-side and existing query/completeness limits remain enforced.

### 2026-11-02 — Focused Calculation Groups workspace
- Calculation editor now replaces group navigation, group actions, search and calculation list at every width; Back to the named group and Done retain draft changes. External Save settings / Cancel remains the persistence boundary.
- Group settings moved into Group actions; list delete uses the existing more menu instead of a redundant standalone action. Formatting, totals, description and overrides remain in collapsed Options. Existing group tabs, counts, drag ordering, new-group name/defaults form, formula completion and inline diagnostics retained.
- No calculation engine or settings schema changes. Source: src/qna/calculationGroupSettings.ts. Browser coverage: askbics-teams/test/calculation-editor.mjs, including narrow/wide focused layout, CRUD, draft navigation, ordering, preview and help.
- Build and focused browser regression passed; full root/Teams checks recorded below when complete. No package or screenshots created; live Power BI validation remains pending.
- Final verification: npm run build, focused calculation-editor browser regression, npm test, npm run lint and Teams tests passed. Teams local HTTP test required a rerun with local-server access after sandbox fetch failure. No packaging or live-host verification.
- 2026-11-02: Corrected Calculation Groups action popup to compact vertical labelled menu (Group settings, Duplicate group, Delete group), using global colours/icons and hidden-state protection. TypeScript build passed; no package created.

### 2026-11-02 — Compact calculation editor controls
- Smaller Format and Validate toolbar above the formula; model preview and its optional context remain available in collapsed Preview. Options use compact two-column rows at normal settings widths (single column below 340px); long total/description fields span the row.
- Reduced card, label and options spacing without changing formula execution or persistence. Existing help and preview validation retained. Files: src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs.
- TypeScript build, root tests and focused browser tests passed, including paired format/decimal controls, compact spacing and model preview. No package or images created; native Power BI appearance remains to be tested after packaging.
- Lint and all Teams tests passed; local HTTP test required local-server access after sandbox fetch failure.

### 2026-11-02 — Calculation Groups settings backup assurance
- Source verified that saved calculationGroups already participate in settings export, catalogue/dependency validation, semantic renamed-field mapping, merge/replace and application through the shared backup UI. Added explicit backup description and copied group/calculation counts so users can confirm inclusion.
- Added settings-backup regressions for JSON round trip of IDs/order, descriptions, formulas/references, group and item defaults, enabled state, number formatting, decimals, all total modes/custom formulas, merge/replace, and blocked missing model fields/measures/dependencies. No schema change; save pending settings before copying.
- Files: src/qna/settingsBackupView.ts, scripts/test-settings-backup.cjs. Build passed; regression results follow. No package or images created.
- Verification passed: npm run build, npm test (including calculation backup coverage), npm run lint, and 22 Teams tests. Teams local endpoint required rerun with local HTTP access. Live copy/paste in packaged Power BI remains unverified.

### 2026-11-02 — Hash group autocomplete continuation
- Fixed hash completion swallowing all subsequent question text. If the active hash search has no matches, normal field/value/measure suggestions resume. Hash and ordinary completion now use the caret position; bounded replacements preserve following question text while editing before a group or in the middle of a question.
- Shared UI source: src/qna/ui.ts. Extended calculation-chat browser regression covers group placement at start/middle/end, later field/value/measure routing, bounded group replacement, and normal completion before a trailing group. Stable internal IDs and submitted questions remain supported.
- Build and focused browser regression passed. No package/screenshots; native Power BI validation still required before release.
- Final verification: build, root regression tests, lint, calculation-chat browser tests and 22 Teams tests passed. Teams local HTTP test required a rerun with local-server access after sandbox failure.

### 2026-11-02 — Calculation columns with multiple grouping fields
- Removed the single-group-only Year pivot restriction. Calculation items stay in rows with remaining grouping fields (for example Company Code), while Year or explicitly selected matrix column fields become columns. Preserved explicit matrix column choices before calculation evaluation normalizes its input to a table.
- Per-row-group Grand Total uses a separate formula evaluation in the row-group context, never a sum of ratios. Pivot preserves formatted/raw cells, notes, row/cell selection scopes, missing cells and editor row/column roles. Duplicate pivot cells retain the original table rather than overwrite data.
- Sources: src/calculationRows.ts, src/customKpis.ts. Added retail integration tests for multi-group Year columns, explicit (c), recalculated ratios and scopes; extended calculation-rows browser test for Company Code, missing year cells and source cell indices. Build, root tests and focused browser passed. Additional totals require supported model context requests; no package/images created; native Power BI validation pending.
- Final verification: TypeScript build, root suite, calculation-rows browser regression, lint and 22 Teams tests passed. Teams local HTTP endpoint required rerun with local-server access after sandbox fetch failure.

### 2026-11-02 — Alternate calculation quote delimiters
- Added paired-apostrophe delimiters: (''Rental'') is equivalent to ('Rental'); existing double-quoted text remains supported. The shared quote reader is used by tokenizer, formula suggestions and delimiter pairing. Formatting preserves token spelling; autocomplete may insert canonical single-quoted text.
- Ordinary empty strings and apostrophe escapes remain supported; malformed paired strings report Unclosed quoted text. Updated formula help and docs/CALCULATION_GROUPS.md with delimiter/escape rules.
- Tests cover AST equivalence, mixed arithmetic/filter/IN strings, apostrophes, malformed quotes, formatting, remapping, evaluation, settings backup preservation, and browser suggestions for paired-quoted names and values. Build, root suite, focused calculation tests and editor browser passed. No package/images created; live host verification pending.
- Files: src/calculationFormula.ts, src/qna/calculationGroupSettings.ts, src/qna/formulaTyping.ts, scripts/test-calculation-groups.cjs, askbics-teams/test/calculation-editor.mjs, docs/CALCULATION_GROUPS.md.
- Final verification: npm run build, npm test, focused calculation parser/backup and editor-browser tests, lint and 22 Teams tests passed. Teams test endpoint required local HTTP access after sandbox fetch failure.

### 2026-11-02 — Names-first KPI table within calculation groups
- Reviewed user HTML as a design reference, then reused shared settings styling/icons and the focused formula editor. Each group now has a compact Name / Status / Actions table, name input + Add KPI (Enter supported), search, drag ordering, Edit and actions menu with Rename/Duplicate/Delete. Rename updates formula dependencies while preserving IDs.
- New names are disabled empty-formula drafts, not invented placeholder measures. They can be saved/backed up/imported; unfinished entries stay out of answers. Enabled empty formulas are blocked by group validation and KPI compilation. Done validates/enables a newly defined draft unless the user explicitly chooses disabled; Back/Close keeps drafts, Preview evaluates a temporary enabled copy.
- Empty disabled definitions are accepted without parsing; nonempty invalid syntax and dependency checks remain strict. Added formula help/status explanation, updated docs/CALCULATION_GROUPS.md, settings round-trip and compiler/dependency tests, and browser coverage for consecutive names, duplicates, draft reload/rename, editing, ordering and preview.
- Files: src/qna/calculationGroupSettings.ts, src/calculationGroups.ts, src/customKpis.ts, style/visual.less, scripts/test-calculation-groups.cjs, askbics-teams/test/calculation-editor.mjs. Build, root suite, lint and focused browser passed; no package/images created; native Power BI verification pending.
- Final verification: build, full root tests, lint, extended calculation-editor browser tests (including duplicate group with drafts), and 22 Teams tests passed. Teams local HTTP test required local-server access after sandbox fetch failure. Draft storage uses the existing formula/enabled properties, preserving backup compatibility.

### 2026-11-02 — Compact calculation hover and full evidence dialog
- Condensed calculated-cell hover to calculation/period, formatted result, source labels and relevant context. Removed repeated raw leaf/tree/Result lines from hover; simple division and DIVIDE show numerator, denominator and formatted result once. Complex expressions and unavailable results retain meaningful summaries without inventing two-operand breakdowns.
- Added a small keyboard-accessible cell details action, opening the original cached notes/tree in the shared global modal pattern. No model queries, persistent schema or selection scopes changed. Close/Escape restores focus; original breakdown remains available for investigation.
- Sources: src/qna/calculationTooltip.ts, src/qna/ui.ts, style/visual.less. Added unit checks in scripts/test-calculation-groups.cjs and browser hover/dialog/focus checks in askbics-teams/test/calculation-rows.mjs; updated docs/CALCULATION_GROUPS.md. No package/images created. Native host validation pending.
- Final verification: build, full root suite, lint, calculation-rows browser regression (hover, full evidence, focus restoration and no selection side effect) and 22 Teams tests passed. Teams local HTTP endpoint required local-server access after sandbox fetch failure.

### 2026-11-02 — Calculation action menu icon consistency
- Replaced mixed text/icon-only KPI menu items with labelled outline Duplicate, Rename and Delete actions in list/editor menus; kept existing accessible names and handlers. Added shared duplicate and rename glyphs plus settingsMenuAction helper, and compact 32px aligned menu rows with a restrained destructive tone for Delete.
- Files: src/qna/settingsActionIcon.ts, src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs. Browser coverage verifies visible labels, SVG icons, compact row heights and existing menu operations. Build and focused browser passed; no package/screenshots; live Power BI appearance pending.
- Final checks passed: build, full root regression suite, lint, calculation-editor browser test and 22 Teams tests. Teams local HTTP endpoint required rerun with local-server access after sandbox fetch failure.

### 2026-11-02 — Single-row KPI entry and search toolbar
- Combined New KPI name, Add KPI and local search into one compact row at normal widths. Added an outline search glyph and global close-icon clear action; Escape clears a nonempty search and retains focus. Search wraps to a full second row only below 400px of editor width.
- Existing name-first drafts, per-group search, filtering and formula operations retained. No persistent schema or model-query changes. Clear action explains its scope; it does not delete KPIs.
- Files: src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs. Build and focused browser passed, including one-row alignment, narrow wrapping, clear/focus and Escape checks. No package/images; native host appearance pending.
- Final verification passed: build, full root suite, lint, calculation-editor browser tests and 22 Teams tests. The Teams local HTTP test required local-server access after sandbox fetch failure.

### 2026-11-02 — Removed local KPI search
- Removed the local Search KPIs input, icon, clear action and transient search state from Calculation Groups at user request. The KPI name input now fills available width beside Add KPI; all KPI rows remain visible. Global settings search and group navigation are retained.
- Files: src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs. Build and focused browser passed, including absence of local search and continued name-first draft/edit/menu flows. No schema changes, package or screenshots; native host verification pending.
- Final verification: build, full root tests, calculation-editor browser test and 22 Teams tests passed. Teams local HTTP test required local-server access after sandbox fetch failure.

### 2026-11-02 — Compact borderless Calculation Groups actions
- Removed permanent button borders/backgrounds from the Calculation Groups edit, overflow and close controls; icons are 15px within compact 28px targets, with subtle circular hover and visible keyboard focus. Back now uses the shared arrow plus a short borderless Back label, retaining its full accessible group name.
- Scope is Calculation Groups only. Add/save actions, labelled action menus, navigation handlers and draft persistence remain unchanged.
- Files: src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs. Build and browser regression passed, including computed border/icon/control sizes and existing editor operations. No package/images; native Power BI appearance pending.
- Final verification: build, full root suite, lint, calculation-editor browser tests and 22 Teams tests passed. Teams local HTTP endpoint required local-server access after sandbox fetch failure.

### 2026-11-02 — Compact connected group tabs
- Calculation Groups now uses 28px connected tabs in the existing light/blue theme. Drag the tab itself to reorder; removed the separate visible group drag handles. Active group and drafts remain intact during reorder. Long names truncate with a full-name tooltip and the strip scrolls horizontally when needed.
- Keyboard: Left/Right/Home/End select groups; Alt+Left/Right reorder the focused tab. Existing KPI row handles remain unchanged. Uses the existing saved group order, with no persistence schema changes.
- Files: src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs. Build, root regression suite, lint, focused browser (compact size, connected spacing, direct drag and active-group preservation), and all 22 Teams tests passed. Teams local HTTP test needed local-server access after sandbox fetch failure. No package or screenshots created; live Power BI appearance/interaction remains to be verified.

### 2026-11-03 — KPI formula previews and Options shortcut
- Added a compact shared settings icon in an Options column before Status in each KPI row. It opens the existing editor with Options expanded and focused; format, totals and overrides reuse the same controls and draft state.
- Formula text now appears below each KPI name in muted grey, single-line with ellipsis and full formula on hover. Empty drafts show No formula yet. No new queries or persistence schema changes.
- Files: src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs. Build, root tests, focused browser regression and 22 Teams tests passed (Teams local HTTP required local-server access). No package/images; native Power BI check pending.

### 2026-11-03 — Calculation KPI typing suggestions
- Regular chat autocomplete now includes enabled, defined KPIs from enabled calculation groups using case-insensitive partial names, labelled (Calculation KPI) in the existing suggestion style. Selection inserts the readable #KPI reference, then the existing submission path resolves stable metric identifiers. Hash-mode KPI suggestions carry the same label plus group context.
- Draft/disabled KPIs stay excluded; existing fields, measures and values remain available. No extra model requests or persistence changes.
- Files: src/qna/ui.ts, askbics-teams/test/calculation-chat.mjs. Build, root tests, lint, focused chat browser regression and all 22 Teams tests passed (local HTTP access needed after sandbox failure). No package/images; native Power BI verification pending.

### 2026-11-03 — Visible KPI mouse dragging
- KPI row now follows the pointer vertically when dragging its grip, with a light lifted-row treatment and directional blue drop line. Corrected target styling to apply to actual table rows rather than the hidden editor cards. Pointer cancellation/lost capture clears drag styling; existing keyboard movement and saved array order remain.
- Files: src/qna/calculationGroupSettings.ts, style/visual.less, askbics-teams/test/calculation-editor.mjs. Build, root regression suite, lint, focused mouse-drag browser regression and 22 Teams tests passed (Teams local HTTP required local-server access after sandbox failure). No package/images; live Power BI dragging remains to be checked. No persistence schema changes.

### 2026-11-03 — Formula autocomplete responsiveness
- Updated shared calculationGroupSettings and ui catalogue callback: render accessible cached field values immediately, prioritize default-field lookup, progressively display remaining matches, reduce typing debounce to 60ms. Preserve prefix/case-insensitive matching and explicit field insertion.
- Stale typing/dismissal/selection invalidates pending suggestion rendering; preserve selected suggestion during progressive updates. No calculation or persistent schema changes.
- Added Tech Hub prefix-selection regression in askbics-teams/test/calculation-editor.mjs.
- Verified: root build, npm test, lint and focused calculation-editor browser test passed. Teams build passed; full Teams test command stopped on local HTTP pilot test fetch failure. Live Power BI autocomplete remains to be verified; inaccessible model values cannot be invented. No pbiviz package created.

### 2026-11-03 — Muted formula hover
- Formula preview in KPI list now explicitly uses global data-tooltip and keyboard focus. Generic title conversion intentionally omits titles equal to textContent, which suppressed single-line formula tooltips despite visual truncation.
- src/qna/calculationGroupSettings.ts only; no calculation/persistence changes. Root build and focused calculation-editor browser regression passed; live Power BI hover not verified. No package.

### 2026-11-03 — KPI Options icon
Replaced only the Calculation Groups KPI Options gear with a compact horizontal-sliders SVG through the shared settingsActionIcon helper. Existing action, tooltip and global button styling preserved. Root build and focused calculation-editor browser regression passed. No package or live-host verification.

### 2026-11-03 — Calculation editor header
Removed redundant editor Close action; retained Back and Group › KPI breadcrumb, preserving draft navigation and dialog close. Root build and focused editor regression passed. No package.

### 2026-11-03 — Inline formula syntax
Moved token colours and bracket highlighting into the formula typing surface; removed separate Syntax preview disclosure. Preserved red error underlines, autocomplete and validation. Incomplete tokens retain visible plain text. Root build and focused editor regression passed including responsive overflow checks. No package/live-host verification.

### 2026-11-03 — Taller formula editor
Increased formula editing area to nine rows with a 190px minimum and vertical resizing. Existing caret-positioned suggestions and directly adjacent diagnostics retained. Root TypeScript build and focused calculation-editor browser regression passed. No package or live-host verification.

### 2026-11-03 — Calendar ordering correction
- Calculation pivot headers now sort Year and Month components chronologically before rendering (Jan–Dec), retaining cell metadata and existing theme.
- Root build/regressions and focused Teams calculation rows browser test passed. Full Teams test run had one demo HTTP fetch failure (11 passed). Package/live verification remains with user; no pbiviz created.

### 2026-11-03 — Compact cash-flow scope and pinned result actions
- Successful cash-flow runs collapse starting controls into a company/currency/period/posting-count summary; native disclosure reopens editing. Status remains outside the collapsed section, retaining incomplete-data warnings. Errors and invalidation keep controls open.
- Result presentation projects columns so Destination amount and Details occupy the frozen right edge. Existing selected source columns, reconciliation values, filtered totals, exports and row-detail identity remain available; no calculation, query or persistence schema change.
- Files: src/qna/cashFlowWorkspace.ts, src/qna/cashFlowResults.ts, style/visual.less; new askbics-teams/test/cash-flow-compact.mjs.
- Verified: npm run build, full npm test, full Teams npm test; focused non-image Chromium regression at 800/600px checks collapse/reopen, visible pinned amount/action and trace-dialog navigation. Browser check uses bundled Node 24 because default Node 18 is unsupported by Playwright. No packaging, screenshots or deployment; native Power BI verification remains pending after user package/import.

### 2026-11-03 — Payment overview with expandable destinations
- Cash-flow results now default to one expandable row per original starting-posting identity (company/year/document/item), retaining separate bank lines when document numbers repeat. Payment amount appears once; status considers all loaded allocations for that payment. Child destination rows retain individual allocation evidence, signed amounts, status, filtered totals and trace actions.
- View trace stays visible on the responsive payment summary; detailed source columns, flat exports and Variance remain accessible through Detailed table. Default overview contains no Variance. Views are transient; saved columns/settings, tracing and query semantics are unchanged.
- Files: src/qna/cashFlowResults.ts, style/visual.less, askbics-teams/test/cash-flow-compact.mjs. TypeScript build and root regression suite passed. Non-image browser check passed: collapse/reopen scope, one payment with four unmerged allocations, hidden default variance, child trace identity, detailed pinned columns and 800/600/400px action visibility. Teams verification recorded below. No package, screenshots or deployment; live Power BI appearance remains pending user package/import.
- Final verification: full Teams regression suite passed, including all 22 integration tests. No package created.

### 2026-11-03 — Restore shared transaction-style cash-flow results
- User superseded the expandable payment design with the supplied existing table screenshot. Removed the payment overview and view switch, restored original cashFlowTable column order with visible Variance, allocation status, Details/View trace and Grand Total. Removed grouped and pinned-column styling; retained earlier scope collapse/reopen behavior.
- Source changes limited to src/qna/cashFlowResults.ts and style/visual.less; updated askbics-teams/test/cash-flow-compact.mjs. Existing calculation, allocation, query and saved settings semantics retained.
- TypeScript build and focused non-image browser regression passed (column order, visible Variance, split-allocation export totals, trace navigation and scope collapse). Full regression results follow. No package or deployment; native Power BI verification pending user import.
- Final verification: full root and Teams regression suites passed. No package created.

### 2026-11-03 — Light cash-flow entries popup layout
- Scoped CSS only: entries table fills the popup content width, summary/control gaps are tighter, and the table wrapper is the single vertical scroll owner. Background cashflow scrolling is suppressed while the entries popup is open. Existing transaction-table structure, grouping, totals, tabs and operations retained.
- Files: style/visual.less and askbics-teams/test/cash-flow-compact.mjs. Non-image browser checks passed at 800/600px for full-width card, one scroll owner, containment, plus existing trace/export/totals behavior. Changes isolated in a labelled CSS block for straightforward reversal. No package or screenshots created; live Power BI verification pending user import.
- Final checks: TypeScript build, full root and Teams regression suites passed. No packaging.

### 2026-11-03 — Cash-flow document heading distinction
- Popup document headings now have a pale-blue gradient, slim blue left accent, stronger expanded tint, semibold label, muted clearing context and a 14px chevron area with right/down outline glyph. Hover and keyboard focus remain visible. Styles target only cash-flow document-group rows, leaving ordinary entries and totals unchanged.
- Shared group renderer separates the decorative arrow into an aria-hidden span; outside the cash-flow popup the existing text arrow remains. Existing native button and aria-expanded behavior retained, with no grouping/calculation/state change.
- Files: src/qna/ui.ts, style/visual.less, askbics-teams/test/cash-flow-compact.mjs. TypeScript build and non-image browser checks passed, including gradient, arrow direction, Enter expansion, unchanged totals and prior popup width/scroll/trace/export checks. Full suites recorded below. No package or screenshots; live Power BI verification pending user import.
- Final verification: full root and Teams regression suites passed. No package created.

### 2026-11-03 — Compact cash-flow summary and expandable explanations
- Single scope disclosure now includes selected companies/currency/period and starting filters; removed repeated scope/company/posting lines from the result card. A compact starting-posting outcome summary replaces seven always-visible counters. Detailed counts and routine successful-run messages remain in collapsed Run details; Actual/Variance definitions remain in collapsed How amounts are calculated.
- Successful routine status text is cleared only after preserving it in run details. Errors, incomplete runs and loading-limit warnings remain visible outside disclosures; attention counts include partial, unresolved, estimated, pending and unverified postings. No scope/value cleanup or financial/calculation changes.
- Files: src/qna/cashFlowWorkspace.ts, cashFlowReport.ts, cashFlowResults.ts; style/visual.less; askbics-teams/test/cash-flow-compact.mjs. TypeScript build and root tests passed. Non-image browser checks passed for compact summary, disclosure defaults, help expansion, visible incomplete warning, and existing table/export/trace/popup behavior. No package or screenshots; native Power BI verification pending user import.
- Final verification: full Teams regression suite passed; no package created.

### 2026-11-03 — Summarize submenu hover dismissal
- Shared Summarize by flyout now closes when the pointer leaves the trigger/flyout region or moves onto another parent menu item (including Cash flow). Pointer transfers into the flyout remain open. Focus transfers to other controls dismiss it; ArrowRight, Up/Down and Escape behavior retained. No query/selection logic changed.
- Files: src/qna/transactionView.ts; new askbics-teams/test/summary-menu-hover.mjs. TypeScript build and focused non-image browser test passed for sibling hover dismissal, flyout entry/return, outside exit and keyboard navigation. Full suites recorded below. No package/screenshots; live Power BI verification pending user import.
- Final verification: full root and Teams regression suites passed. No package created.

### 2026-11-03 — Cash flow for selected answer cell
- Answer-cell menu now passes its existing transaction drill scopes to Cash flow for this selection. With valid saved mappings, a bounded company/currency context lookup precedes automatic tracing; no Show cash flow click is required. Main Cash flow entry remains manual and retains saved general scope.
- Selected source-question filters, exact model member tuples, inherited and summary filters constrain starting postings only. Signed Amount remains the configured measure, never the clicked KPI. Linked lookups retain company/currency/security without carrying starting category/period restrictions. Cell periods select starting cash activity, not inferred rent-to-payment matching; no historical cutoff is inferred from a non-date cell period.
- Cell runs use transient companies/filters and do not persist them on success or setup save. Invalid mappings can open setup. Missing context, multi-scope calculations, analysis-state-only cells, ambiguous overlapping ranges and multiple currencies fail with visible guidance instead of broadening to all payments. Bank identification still requires configured codes or identifiable bank labels; absent identification retains the existing manual starting-posting fallback within the selected scope.
- Files: new src/cashFlowSelection.ts; cashFlowQuery.ts; qna/ui.ts, transactionView.ts, cashFlowWorkspace.ts, cashFlowScope.ts; new scripts/test-cash-flow-selection.cjs registered in package.json; new Teams cash-flow-selected-cell.mjs and updated cash-flow-answer-menu.mjs.
- Verified: TypeScript build, lint, root and Teams suites (final root rerun in progress), selected query regression (month/category/native measure/company intersection/link isolation/fail-closed cases), selected-cell browser (auto-run, saved-scope isolation, main manual entry, errors), actual answer/analysis menu integration. No package/screenshots/deployment; live Power BI integration pending user package/import.
- Final root rerun passed, including registered selected-cell query coverage. No package created.

### 2026-11-04 — Custom KPI synonyms in the KPI editor
- Added a KPI synonyms multiline field (comma/newline separated) and saved alias summary to each custom KPI editor. Uses the existing shared synonyms/synonymEnabled settings, so question matching, autocomplete, serialization and Copy/Paste settings use the same source in both hosts; no new persistent schema.
- KPI and general synonym editors share the draft. Aliases are deduplicated case-insensitively; collisions with other known field/measure/KPI names and aliases are rejected. Renaming moves synonyms; deleting removes them. Cancelled KPI edits do not apply alias changes. Contextual help explains suggestions, saving and formula naming.
- Files: src/qna/customKpiSettings.ts, synonymSettings.ts, ui.ts; askbics-teams/test/kpi-synonyms.mjs.
- Verified: TypeScript build, full root and Teams regression suites, focused non-image browser coverage of editing/reopening, deduplication, typing suggestions, question resolution, settings backup validation, rename and delete. Final build/browser rerun passed after alias summary/collision refinement. No package or screenshots created. Native Power BI verification remains pending user package/import.

### 2026-11-04 — Automatic time windows, running totals and targeted performance
- Shared on-demand query handler src/timeWindow.ts resolves undated YTD/TTM using the latest nonblank raw measure month within existing query/report filters. Numeric MonthIndex mapping is required; zero/one bases supported. Explicit month and across-year month queries retain their prior paths. Response text shows the resolved window and partial measure-data coverage. No new persistent settings.
- Monthly running/cumulative total supports a calendar year (or latest available year), restarts in January and preserves category grouping. Each window uses the model for non-additive/native/custom KPI measures. Grouped automatic YTD/TTM totals are separately model evaluated. Cumulative rows are never added to a grand total. Result selections retain their window filters; cancelled/superseded queries cannot return results.
- Performance: measures explicitly configured Additive across months reuse one complete monthly dataset for running totals, excluding custom KPIs and percentage-of-revenue calculations. Tests confirm a one-query grouped/scalar additive path versus discovery plus per-month evaluations. Complete-data/raw-value, duplicate-month and 30,000-row/200,000-cell safeguards prevent partial or ambiguous aggregation. No unqualified latency improvement claimed.
- Added automatic-query typing suggestions and examples under Time setup. Shared Teams adapter generator imports the new handler; no generated source was manually edited.
- Limits: calendar-year monthly running totals currently return a table; no fiscal-year configuration added. Automatic undated windows and running totals require on-demand model querying and mapped numeric MonthIndex. Top/Bottom and conflicting explicit MonthIndex filters require clarification; running-total comparisons/date ranges require a single year. Existing external filters continue to constrain windows; no model security/filter removal. Partial month coverage refers to measure data, not proof of missing transactions.
- Files: src/timeWindow.ts, fieldParameterTrial.ts, qna/ui.ts, qna/settingsLayout.ts; askbics-teams/scripts/build-visual.mjs; scripts/test-time-window.cjs registered in package.json; askbics-teams/test/time-window.mjs.
- Verification: TypeScript build, full root and Teams suites, lint, focused generated-adapter/browser regression. Tests cover latest nonblank month, filters, bases, literals, explicit periods, incomplete results, cancellation, custom ratios (70/300 rather than summed monthly ratios), grouped identities and one-query additive reuse. No package/screenshots/deployment; native Power BI selection/time verification remains pending user import.

### 2026-11-04 — Consistent welcome actions
- Cause: startup rendered before the catalogue was ready; updateEngine returned for automatic mode without refreshing the welcome cards. Clear rebuilt them with the populated catalogue.
- All six actions now remain visible: Cash flow, Summarize, Visualize, Rank, Compare and Waterfall. Data-dependent actions show a waiting description and stay disabled until suitable fields/measures are available. Catalogue/engine updates refresh only existing card labels and availability; no draft clearing or answer resubmission. Clicks resolve current catalogue names. Unchanged labels skip DOM writes; no-card views skip catalogue lookup.
- Files: src/qna/ui.ts; scripts/test.cjs fixture adjustment; askbics-teams/test/welcome-catalogue.mjs.
- Non-image browser checks passed for initial six-card state, catalogue arrival, Clear/Refresh, draft preservation and time suggestions. Root/Teams regressions and lint passed. No package created; live Power BI verification pending user import.

### 2026-11-04 — Apply each settings section without closing
- Each settings tab now has Apply section and an inline status. Successful validation displays Applied · not saved yet; subsequent control edits mark the section Changes not applied. Section apply never persists host settings or closes the dialog. Final action renamed Save all & close; it validates every tab, includes unapplied edits, selects the first invalid tab and retains the dialog on failure. Cancel/close discard the normal dialog drafts.
- Reuses existing editor draft validation. Transactions, Summary cards, Clearing details, Document details and Explain have independent analysis-editor checks. Power BI data/time/technical tabs use a new non-persisting validation hook; final host save is unchanged. Existing explicit backup-import/restore actions retain their separate workflow; Apply section does not execute those actions. No new persistent schema or backup format.
- Added contextual help, accessible live status and lightweight layout. Section controls/listeners are removed on disposal so reused host panels do not accumulate buttons. Page text/help clicks do not falsely mark drafts dirty.
- Files: src/qna/settingsSectionApply.ts (new), settingsLayout.ts, analysisSettings.ts, ui.ts; src/fieldParameterTrial.ts, visual.ts; style/visual.less. Existing browser selectors updated for Save all & close; new askbics-teams/test/settings-section-apply.mjs.
- Verified: TypeScript build, root and Teams regressions, lint; non-image section-apply browser checks (stays open, no persistence, dirty status, Cancel discard, global save without applying, invalid-value blocking), and existing cash-flow settings browser checks (validation/save/cancel/persistence/help). No package or screenshots created. Native Power BI verification pending user import.

### 2026-11-04 — Preserve value-suggestion field identity
- Ordinary typing suggestions displayed a field beside a value but only inserted the bare value. They now carry valueField and canonical value metadata, matching the existing @ value-suggestion convention. Accepting a value inserts Field (value), so Company Code 2396 cannot be reassigned to an identically named vendor value.
- Value acceptance runs before the generic replaceEnd path and preserves the suffix/caret when inserting mid-question. Existing parenthesized filter grouping semantics are unchanged. Measures, fields, visuals and time suggestions retain their own insertion paths.
- Files: src/qna/ui.ts; new askbics-teams/test/value-suggestion-identity.mjs. Verified TypeScript build, full root/Teams suites, lint and non-image browser/parser regression for company/vendor duplicate 2396, October 2026 period, Vendor Name grouping, mid-question as a table suffix and @ suggestions.
- The screenshot also showed an unparsed as token; that alone does not establish its origin. This fix covers the reproduced lost field association and suffix handling, without claiming every incomplete visual phrase is valid. No package/screenshots; native Power BI verification pending user import.

### 2026-11-04 — Conversational fillers and general numeric-value suggestions
- Residual grammar now tolerates what is/what are/what's, I want to know/I would like to know/I need, of and as after model entities, values, periods and visual instructions are recognized. This is a bounded vocabulary expansion, not deletion of all non-highlighted text; negation, unknown terms, comparisons and unsupported instructions remain guarded.
- Confirmed the prior valueField suggestion fix is generic: clicking a known GL 2575 value inserts GL (2575), and Company Code 2396 retains its own field even with an identical vendor value. No Company Code hardcoding or new catalogue scan. Suggestions require the field/value to be available from the host catalogue; unselected bare four-digit values can still need clarification because of year/field ambiguity.
- Files: src/parameterQuery.ts; scripts/test-parameter.cjs; askbics-teams/test/value-suggestion-identity.mjs. Root/Teams suites, lint and browser/parser regression passed, including October 2026 GL selection, alternate English wording, preserved business names, meaningful-word rejection and mid-question suffix preservation.
- No package or screenshots; live Power BI verification pending user import.

### 2026-11-04 — Simplified aging editor
- Removed Age based on and Aging display controls. New setups retain valid Due date/detailed storage defaults; existing basis/display values are preserved when edited. Age calculation continues to use the mapped date field; result text now names that field rather than a potentially misleading hidden basis label.
- Moved Model as-of date field and historical-date guidance into collapsed Advanced options. Retained historical validation, saved mappings, mandatory grouping and bucket settings. Help explains due/posting date meaning and summary questions.
- Files: src/qna/agingSettings.ts, src/aging.ts; askbics-teams/test/aging-simple.mjs. Build, root and Teams suites passed. Focused non-image browser check verified removed controls, collapsed advanced mapping and preserved posting-date/summary/snapshot settings. No package created; live Power BI verification pending user import.

### 2026-11-04 — Aging sample ready for Power BI import
- Current combined sample workbook now includes Aging data (18 synthetic snapshot balances), Aging tests (fixed expected results at 2026-11-04) and Aging setup. Import Aging data as Aging Sample; existing Retail/Waterfall/cash sheets and CSV preserved.
- Total 10,850 QAR; explicit as-of testing requires Advanced > Aging Snapshot Date. Includes all default boundaries, negative credit, missing date and settled zero. Detailed setup/DAX in outputs/cash-flow-expanded-20261101/Aging_Test_Steps.txt.
- Artifact-tool export plus independent readback and existing sample verification passed. No app code/build/package changes. Live Power BI behavior requires user import; no routine images generated.

### 2026-11-04 — Conditional section Apply
- Apply section now hidden initially and after success, shown on edits/additions and validation errors. Filled blue action, no question-mark icon; saved-state behavior unchanged.
- Build/root and focused browser checks passed; no package created. Native verification pending user import.

### 2026-11-04 — Saved aging autocomplete
- Saved aging setup names now participate in normal typing suggestions in both query modes, labeled Aging setup. Acceptance adds the required aging keyword, avoids duplicating an existing aging suffix, and retains normal prefix/suffix insertion behavior. Uses saved settings, not unsaved editor drafts; deletion removes the suggestion.
- Files: src/qna/ui.ts; askbics-teams/test/aging-suggestions.mjs. TypeScript build, root/Teams regressions and focused browser acceptance checks passed. No package created; native Power BI activation pending user import.

### 2026-11-04 — Reported what/thee conversational wording
- Residual parser accepts standalone what and the common article typo thee only after measure/field/value recognition. Exact screenshot questions now produce the same measure, grouping and June 2024 filters as the canonical show question. Explicit quoted what/thee filter values remain intact; excluding and other meaningful unsupported instructions remain rejected.
- Files: src/parameterQuery.ts; scripts/test-parameter.cjs. TypeScript build and root/Teams regressions passed. This does not fix the separate 60-second Power BI filter-reset/data-loading issue. Only project files changed; no package created.

### 2026-11-04 — Aging performance and accepted suggestion records
- Aging requests mark their query plans. For unchanged parameter selectors, reset removes only prior model predicates using FilterAction.remove with the predicate list; field/measure selectors remain selected. Clear acknowledgement ignores retained selector targets, still rejects stale model predicates, and waits before submitting replacement filters. Changed projection retains the existing full reset. Native Power BI partial-removal behavior/performance remains pending verification; no claim of live timeout resolution.
- Aging Advanced adds explicit Use additive aging optimization (default off). Only opted-in non-custom/non-ratio measures use one complete customer/due-date query. Raw ISO dates/numbers, completeness, row-limit and duplicate checks gate aggregation; buckets, missing dates, grand totals and drill scopes preserved. Monthly additive settings are deliberately not reused as proof of customer/date additivity. Raw grouping values exposed for aging and separated in query-cache keys. Settings backup validation and merge/replace preserve the new optional flag.
- AcceptedSuggestions retains transient kind/name/field and span metadata after accepting suggestions. Submit resolves canonical text from these records; the existing planner remains the execution validator. Value choices stay explicit Field (value); canonical field/measure suggestions use catalogue names. Prefix/suffix edits shift spans; overlapping edits revoke identity. This is not an AI/NLP fallback or a new backend structured-intent API. Composer records are not settings/exported state.
- Files: src/aging.ts, agingAdditive.ts, fieldParameterTrial.ts, parameterQuery.ts, qna/agingSettings.ts, qna/acceptedSuggestions.ts, qna/ui.ts; tests for aging, parameter reset, backup, accepted records and browser value identity. Build, root/Teams suites and browser value/aging editor checks passed. No package/screenshots created. Enable additive optimization for the supplied SUM outstanding fixture, map Snapshot date, and test after user package/import.

### 2026-11-04 — Offline catalogue typo fallback
- User explicitly requires no AI connection. Existing parameter parser runs first; only unsafe-interpretation failures retry bounded field/measure/alias spelling corrections against the configured catalogue. Successful corrections are disclosed in plan summaries. Equal best matches request clarification. No backend, network dependency or persistent setting added.
- New src/catalogueTypos.ts handles one-character omissions/substitutions/transpositions per word with bounded names/questions/replacements. Numeric identifiers, known values, quoted/bracketed/parenthesized text, explicit comparison literals and semantic operators are protected. Unsupported instructions still fail. This is conservative catalogue matching, not unrestricted natural-language understanding; local GlobalQnaEngine grammar remains unchanged.
- Shared suggestion matching offers typo matches for Field/Measure only when exact/substring matches are absent; clicked suggestions retain the existing accepted-identity behavior. Tests cover canonical plan equivalence, two misspelled entities, ambiguous matches, protected values/codes/operators and suggestion fallback.
- Files: src/catalogueTypos.ts, src/parameterQuery.ts, src/qna/suggestionMatching.ts, scripts/test-catalogue-typos.cjs, scripts/test-parameter.cjs, package.json. Build, lint, root/Teams suites passed; final explicit-literal guard passed recompilation and focused regression. No package created. Native Power BI activation/verification pending user packaging/import.

### 2026-11-04 — Aging without default grouping; simplified editor
- Removed Default grouping field and the entire Advanced options section at user request. Editor now exposes name, date, measure and buckets. Existing stored group, snapshot mapping, additive opt-in and hidden basis/display remain preserved by edits and backups; new setups have no snapshot mapping or additive opt-in. Legacy group values no longer drive implicit grouping.
- Questions without by return one All balances row across buckets. Explicit by <field> retains grouped results and validates the requested field. Model-evaluated scalar totals preserve nonadditive measures; opted-in additive setups support date-only one-query aggregation. Update aging omits by when ungrouped. Bucket drill scopes, snapshot/Always filters and historical missing-mapping safeguards remain.
- Removing the snapshot editor does not create historical balance support: new setups without a saved snapshot mapping reject historical dates. No automatic inference of snapshots or additive measure semantics.
- Files: src/aging.ts, src/agingAdditive.ts, src/qna/agingSettings.ts, src/qna/ui.ts; aging, backup and browser editor regressions. Root build/tests/lint passed; Teams suite and focused browser editor check passed, including absence of both removed controls and retention of saved snapshot/additive settings. No package or screenshots created; native Power BI verification pending user packaging/import.

### 2026-11-04 — Follow-up aging timeout in mixed catalogue
- User still observed 60-second timeout and repeated queries; screenshot alone does not prove exact host timing. Found that ungrouped scalar adapter selected config.options[0], potentially an unrelated retail field. Aging plans now carry agingDateField; scalar adapter requires and selects that field, retains model total semantics, and rejects missing parameter mapping. Fixed-member shortcut applies only when that member is the actual anchor.
- The previous removal of Advanced also hid the additive opt-in, leaving new setups on ten model band requests. Added only a compact Balances can be added checkbox under the amount measure (Advanced/snapshot/default-group controls remain absent). Explicit SUM-compatible opt-in uses existing one-complete-query daily aggregation; default remains false to protect ratios/averages/distinct counts. Existing opt-in serialization/backup validation retained.
- Aging no-response recovery now waits 15 seconds before its single reset retry, rather than interrupting a potentially healthy query at four seconds. Overall 60-second request limit unchanged. Initial host updates/reset queries may still occur; one aging data load is not a promise of one Performance Analyzer entry.
- Files: src/aging.ts, parameterQuery.ts, fieldParameterTrial.ts, qna/agingSettings.ts; parameter, aging and browser regressions. Native Power BI performance remains unverified; user must import their updated package and enable the opt-in for the sample SUM measure. No package created.
- Verification: TypeScript build, root/Teams regression suites, lint and focused browser checkbox/save compatibility check passed.

### 2026-11-04 — Aging result calendar/action styling
- Aging toolbar has visible As-of date and Display labels, consistent 38px rounded input/picker/button, light background, blue Update aging action and visible keyboard focus. Flex wrapping supports narrow visuals. Native calendar retained; two-option display picker omits unnecessary search. Query text/group/date behavior unchanged.
- Files: src/qna/ui.ts, style/visual.less, askbics-teams/test/aging-toolbar.mjs. Build and root/Teams suites passed; browser test compiled LESS, checked 800/400/280px widths without horizontal page overflow, equal heights and date-update query. No screenshots/package; native Power BI verification pending import.

### 2026-11-04 — Compact inline aging actions
- Replaced the separate aging header with inline Results toolbar controls alongside copy/PDF: calendar icon with selected-date tooltip, compact Detailed/Summary picker without search, and update icon with Update aging tooltip/accessibility label. Native date popup replaced with themed month/day picker, previous/next navigation, selected-day highlight and Today. Outside click and Escape dismiss it; updates preserve grouping/date/display query semantics.
- Shared module src/qna/agingControls.ts; src/qna/ui.ts, style/visual.less and askbics-teams/test/aging-toolbar.mjs updated. Browser check passed at 800/400/280px, calendar selection, summary selection, grouped update query and Escape. No screenshots/package; native Power BI verification pending import.
- Final validation: TypeScript build and root/Teams regression suites passed; browser interaction checks passed.

### 2026-11-04 — Aging actions match export toolbar
- Removed form-style borders/background from calendar and display triggers, matched export action font/color/hover treatment and 26px compact controls. Refined calendar grid and single circular-refresh SVG icons to 15px. Popup/date/update behavior unchanged.
- Fixed specificity against the host theme, and updated browser harness to use askbics-host and assert transparent background/border and matching Copy for Excel text color. Build and focused browser appearance/interactions passed at 800/400/280px. No screenshots or package; only project files changed.

### 2026-11-04 — Smaller aging calendar
- Reduced popup target width from 272px to 224px, tightened padding and grid spacing, reduced date cells to 24px and navigation icons to 26px. Date selection, labels and update behavior unchanged.
- Build and existing browser interaction/responsive checks passed. No package/screenshots created; only project files changed.

Clear and welcome-screen Refresh share the Power BI startup/default-field reload path. A confirmed parameter defaults to Assigned Group when startup grouping is unconfigured. Live Power BI verification remains pending.

Refresh re-applies the field selector instead of racing a broad host refresh. Scoped refresh resets retain selectors while removing old predicates. Refresh detection no longer clears the parameter to enumerate fields. Validate the resulting DAX in Performance Analyzer after importing the updated visual.

The Format visual pane now accepts a single-item TREATAS fragment under askBICS query defaults. It maps to a dedicated hidden calculation-item self-filter independent of question filters. First-load timing and native calculation item evaluation require verification in Desktop.

Calculation item TREATAS now uses an Edit-mode-only textarea in Q&A settings > Advanced > Advanced setup. Existing defaultCalculation.expression and its native self-filter are reused.

### 2026-11-09 — Lease expiry parameter switch
The supplied 2.9.111.0 trace shows three fields, seven measures, zero rows and empty filter acknowledgements. Switching from Total Area to Earliest Lease Expiry with Unit triggered a full filter clear. requestBase now compares model predicates separately from both incoming parameter selectors. The regression in scripts/test-parameter.cjs verifies a direct apply for this switch. Build and root tests passed. First host query and live Power BI timeout remain unverified.


### 2026-11-09 — Retry after unacknowledged suggestion request
A matching submitted filter can belong to a cancelled suggestion lookup. sendPending now refreshes only a confirmed current view with matching filter signatures, otherwise it merges the requested selectors. Trace action now reflects the actual host call. Root regressions passed. Live host filter acknowledgement and initial report query remain unverified.


### 2026-11-09 — Automatic field and measure self-filter
Requests with no acknowledged legacy filter now write the parameter pair to general.selfFilter, enabled as a self-filter in capabilities.json. The controller reads that property on host updates and also supports the previous parameterTrial.filter property for existing reports. The adapter regression verifies both MallUnits 2 / Unit and Map Measures. / Earliest Lease Expiry are sent in one call without slicer input. Live Power BI parameter expansion requires import and Performance Analyzer verification. No package created.


2026-11-09 — 2.9.112.0 on-demand query recovery. A broad data update without filter acknowledgement used to suppress the single retry. The controller now resends the pending filters once without clearing selectors and logs the field/measure selector values. The regression simulates an unacknowledged broad response and completes only after matching data arrives. Root build, root tests, lint and Teams tests passed. Source only; the MallUnits report still needs a live host trace with this build.

2.9.113.0: The MallUnits native slicer capture returned 172 rows using the generated Fields columns and qualified DAX member references. The visual translates resolved field and measure selectors at the host boundary and normalizes incoming echoes. Slicer-free live verification pending.

2.9.114.0: Saved MallUnits PBIX confirms physical selector predicates were persisted on page 2; native slicers on test page also persist label-to-key identity metadata. Resolved selectors now use BasicFilterWithKeys. Root regressions, lint and Teams tests passed. Desktop execution without slicers remains unverified.

2.9.115.0 restores the live-verified 9.8 on-demand selector path: ordinary label BasicFilters merged together on parameterTrial.filter. The Optimization self-filter remains separate. Newer cancellation and bounded retry handling are retained. A regression submits the MallUnits selectors, accepts a synthetic 172-row narrow result with no filter echo, and verifies one-time cleanup of an observed obsolete general.selfFilter. Build, root tests, lint and Teams tests passed. No package created or live 2.9.115.0 run performed.

2.9.115.0 live MallUnits trace sent labels but received three fields, seven measures and zero rows. 2.9.116.0 declares only parameterTrial.filter as a self-filter and sends the saved Optimization filter in the same merge as field/measure selectors. Tests verify the combined payload, scoped removal, and the single declaration. Root build, tests, lint and Teams tests passed. Live Desktop behavior pending.
