# Project memory

## Scoped cash-flow loading — 2.9.111.0, 2026-10-29

Approved and implemented: Data scope in Cash flow and Settings → Filters & transactions → Cash flow. Choose company field and up to 50 company values; add up to 10 starting-field filters with up to 100 exact values each (OR within field, AND across fields). Field changes clear dependent values. Shared searchable value pickers load a bounded sample (201 query rows / 200 offered choices); exact values can be entered. Optional mapped posting-date period and configured bank codes filter the starting query. Account-description bank filtering is used where no explicit account/description/document starting filter overrides it. Company values and filter defaults are saved with the existing cash-flow setup.

Loading now queries scoped starting postings first, then walks document/clearing references in batches of 40 per company. Starting field/date/bank predicates are absent from linked lookups; company, currency, Always filters, report context and model security remain. Multiple companies are traced independently before presentation. Synthetic grouped-posting identities are stable across queries. Limits: 5,000 rows per posting response, 20,000 returned rows and 100 posting queries per run, plus bounded graph depth. Truncated/segmented responses mark the trace incomplete. Progress, query cache, refresh, scope-change cancellation and stale-result checks are included. No automatic continuation through all Power BI segments for bounded cash-flow queries; unrelated pending queries retain normal segment handling. Cash-flow cached host views are trimmed and isolated from ordinary query cache keys. Teams uses TOPN(limit+1) and preserves incomplete metadata. A first Power BI segment may be smaller than the limit and is conservatively incomplete; native report/query performance still depends on the model. No claim of live million-row performance verification.

Files: src/cashFlow.ts, cashFlowQuery.ts, cashFlowLoad.ts, parameterQuery.ts, fieldParameterTrial.ts; src/qna/cashFlowScope.ts, cashFlowSettings.ts, cashFlowWorkspace.ts, cashFlowResults.ts, kpiFilterSettings.ts, settingsMultiSelect.ts, ui.ts; askbics-teams/app/model-service.ts; shared LESS. Build identifiers synchronized at 2.9.111.0. Added root scope regressions and non-image browser scope test; expanded Teams cash-flow adapter tests. Root/Teams suites and browser checks pass before final presentation/help refinements; final checks recorded below. Live host validation after the user's package/import remains pending. No packaging, images or deployment.

## Cash-flow settings tab — 2026-10-29

Added Settings → Filters & transactions → Cash flow using the existing settings pages, searchable selectors, multi-select, help markers and shared label spacing. Essentials are company/document/clearing, signed amount, optional account and description. Other mappings stay in Advanced; users can choose up to 10 starting-posting columns. Empty column selection uses defaults. The tab and workspace share the existing layout.cashFlow setting; no second configuration store or host copy. Existing legacy rules are preserved, with no new mandatory account roles. Edits validate and commit only with Save settings; Cancel leaves saved state unchanged. Untouched/unconfigured cash flow does not block unrelated settings saves.

Files: src/qna/cashFlowSettings.ts, src/qna/settingsLayout.ts, src/qna/ui.ts, style/visual.less; browser regression askbics-teams/test/cash-flow-settings.mjs. Root build/regressions and the non-image browser check pass (navigation, shared selectors, invalid drafts, save/cancel, reopen, column cap, help). Teams regression passed with localhost access after the sandbox fetch restriction. No package, screenshots or deployment; live host verification remains pending.

Last reviewed: 2026-10-29 (Asia/Riyadh).

Packaging preference: the user will create `.pbiviz` packages from now on. Do requested code edits and relevant non-packaging validation; do not invoke packaging directly or through `build:all` unless explicitly requested again.

Preview preference: do not generate design PNGs, preview images or routine screenshots unless explicitly requested. Focus on code modifications and relevant non-image tests/checks; avoid screenshot-producing test steps for routine edits.

## Latest approved implementation: transaction-style cash-flow table (2.9.110.0)

The user's latest approval supersedes the destination-card UI. Cash flow now uses the actual shared answer-table renderer. Users choose up to 10 starting-posting columns via Columns → Setup; Destination account, Destination amount and Details are appended as visual-derived columns (not model calculated tables). The signed posting measure is the available amount choice. Other source columns must already be bound/available in the catalogue. At least one dimension is required for the total label. Source columns describe the starting posting; mapped trace fields remain in the query even when hidden from display.

Rows group by starting posting, destination and status. Multiple paths remain available through View trace. The starting-amount total deduplicates postings while Destination amount sums allocations; filtering updates both totals and PDF/Excel exports. Unresolved rows remain explicit. The shared renderer accepts optional transient detailAction, filteredTotals and totalRowIndices hooks; ordinary answer tables keep their existing behavior. Cash-flow tables omit additional formula/percentage actions because totals and allocations are externally calculated. Details retains original signed posting amounts, clearing references, all/selected available document lines, and scroll/focus restoration. Paths render on expansion and in batches; document lookup is indexed for the popup.

Files: src/cashFlowTable.ts, src/cashFlow.ts, src/cashFlowQuery.ts, src/qna/cashFlowWorkspace.ts, src/qna/cashFlowResults.ts, src/qna/types.ts, src/qna/ui.ts, src/qna/settingsMultiSelect.ts. The shared multi-select has opt-in maximum and known-values-only behavior; existing callers retain defaults. Build identifiers synchronized at 2.9.110.0. No package, deployment, image generation or screenshots. Live Power BI/Teams activation remains unverified; the user packages and imports the visual.
## Earlier implementation: destination-first cash flow

2.9.109.0 corrects actual theme reuse after user reported mismatched buttons/tables: cash-flow's broad button selector was overriding the shared answer toolbar. Its specificity is now lowered so global toolbar styles apply unchanged. Journey and entry grids now call the same table renderer as answers (their redundant local toolbars/menus are removed), replacing bespoke HTML/CSS grids. Entries reuse the existing clearing/document modal frame and close icon. Compact expansion behavior and all calculations remain intact. Browser regression compares computed font/padding/background/border styles directly against a normal answer table. No packaging.

2.9.108.0 simplifies the presentation to match the user's reference images: no default four-card KPI strip or repeated explanations. After a successful run, Trace options collapses; Filter results is on demand, with active chips still visible. Cash Flow Trace has a compact company/starting-amount caption, scoped trace badge, Bank-to-destination rows, explicit clearing path labels, right-aligned signed amount and Payment/Receipt caption. Expansion shows original posting versus allocated cash and opens the existing available-document-entry popup. Same shared light theme, exports and clearing calculations; no new package was generated (user packages manually).

Build 2.9.107.0 adds optional Account description mapping and requests it with posting rows. An unambiguous available field named Account description, Account desc or GL account description is suggested automatically. Exact Bank/Cash/Bank account/Cash account labels identify roots (case insensitive); configured account codes take precedence. One identified root runs automatically; multiple identified roots offer All bank postings or a specific root. Missing identification retains explicit manual selection with instructions to bind the description field. Unbound workbook columns cannot be accessed by the visual. Description labels also appear in paths/entries and endpoint labels; they do not control intermediate/end traversal.

The user approved the combined single/multi-level presentation. Build 2.9.105.0 introduces `src/qna/cashFlowResults.ts`: grouped destination summaries, signed cash movement, shares of gross starting cash including unresolved amounts, expandable individual allocation paths, and cached original document-entry popups. Opposite cash directions and different unresolved statuses remain separate. Multiple paths for the same destination are retained inside its expansion. Shared PDF/Excel controls export the filtered summary. Account labels fall back to document labels when Account is not mapped; no new mandatory role mappings were introduced.

Document entries are always labelled available rows, since complete query results do not prove complete accounting documents under external filters. All document lines shows cached rows for the path's company/year/document/currency identities; Selected trace lines hides other rows and totals, warning the subset may not balance. Popup close restores focus/scroll; Escape closes the popup before the workspace. Existing tracing/calculation code remains unchanged.

## Evidence and history

The separate Codex conversation “Create standalone askBICS Assistant” was not accessible by title through the available tools. This record uses the history supplied in the current chat, current source, repository documentation and Git history. It is not a complete review of the old conversation.

Git's latest commit at review: `8603346` (2026-10-22), “V8 added explain & investigste”. Earlier commits include V7/V6 (2026-10-20), V5 (2026-10-18), edit window V3 and YTD cross filtering V2 (2026-10-11), cross filtering V1 (2026-10-06), and the initial working version (2026-09-30). Much newer work is modified/untracked, including cash-flow source and tests. Commit history alone is insufficient to reconstruct current behavior.

## Architecture and integration map

| Area | Canonical source / responsibility |
| --- | --- |
| Power BI lifecycle and selection | `src/visual.ts`; host callback wiring, native visual integration |
| Dynamic query orchestration | `src/fieldParameterTrial.ts`; discovery, persisted configuration hydration, query acceptance, cancellation, response conversion |
| Query planning and metadata | `src/parameterQuery.ts`, `src/parameterDiscovery.ts`, time/model helpers |
| Shared application UI | `src/qna/ui.ts`, settings, table/chart/report and transaction components in `src/qna/` |
| Shared design | `style/visual.less`; existing control variables and component classes |
| Transactions | `src/answerTransactions.ts`, `src/qna/transactionView.ts`, transaction cards/local filtering/summary reuse/subtotals modules |
| Cash flow | `src/cashFlow.ts`, `src/cashFlowQuery.ts`, `src/qna/cashFlowWorkspace.ts` |
| Teams browser/model adapter | `askbics-teams/app/visual-client.ts`, `app/model-service.ts` |
| Teams generated adapter | `askbics-teams/scripts/build-visual.mjs`; extracts shared query methods; generated outputs are not editable source |
| Teams authentication and routes | `askbics-teams/src/tab.ts`, `teams.ts`, `remembered-session.ts` |
| Teams model access | `connections.ts`, `selected-model.ts`, `powerbi.ts`, `visual-service.ts` |
| Persistence | Power BI host properties; Teams encrypted server state in `report-state.ts` |

Source confirms Teams Power BI REST answer queries use `executeQueries`; metadata discovery uses `executeDaxQueries`. OAuth requests delegated Dataset.Read.All / Workspace.Read.All and offline_access. Report-state code uses AES-256-GCM and a stable STATE_KEY. Do not read or expose credentials to document architecture. The Teams README describes user/tenant/model isolation, single-instance pilot limits and activation instructions; preserve these boundaries. No replacement database or new external service is authorized.

Teams shares the visual interface and calculation source but does not inherit Power BI report/page slicers or native host cross-filtering. Matching output requires equivalent model, permissions and filter context. Native Chat and Ask have different presentation and connection behavior; see `askbics-teams/README.md`.

## Approved UI continuity

Preserve the existing settings navigation, answer/transaction tables, Back navigation, expandable sections, chips, document popups, saved reports and chart controls. Source design tokens include accent `#2563eb`, control border `#d6e0ee`, control height 36px, radius 9px; typography is Segoe UI/Arial. Existing components include exceptions and responsive styles: reuse them rather than forcing these tokens globally.

User requests retained from supplied history: transaction chips should match answer chips; selecting Filter should directly open the selected column's value dialog; Select all should toggle to Unselect all without a redundant Clear action that does the same thing. These are intent, not blanket confirmation of current behavior across all screens.

`src/columnLayout.ts` confirms a threshold of more than 12 non-time category combinations for moving columns to rows, with month/year exemptions. Preserve the distinction between unique category combinations and a raw row count.

## Cash-flow decisions (latest override earlier designs)

1. Main setup has Company code, Document number, Clearing document and Signed posting amount. Account and other fields are under Advanced.
2. Users select the starting bank posting after data loads, or optionally identify starting bank accounts when Account is mapped. Manual Intermediate/Destination roles are not required.
3. Alternate between counterpart lines in the same document and related postings sharing clearing references (or configured invoice references). Exclude the current posting, not its entire document.
4. A counterpart with no outgoing clearing/reference ends the path. A nonblank reference with no matching posting is unresolved. Cycles, processing limits, unbalanced available documents and ambiguous allocations must remain explicit.
5. Carry the allocated cash amount through the path. Intermediate amounts are evidence, not additional cash flow. Do not connect unrelated documents simply because amounts match.
6. Keep company and security boundaries. The current query retains model/source filters and Always filters; it does not guarantee removal of all non-company host filters. Never advertise complete company-wide coverage when only a filtered subset is available.
7. Optional years/currency/date/line mappings can be omitted for the simple controlled sample. Production repeated document numbers, mixed currencies, historical periods and merged posting groups need the corresponding mappings/data. No-year mode requires unique document numbers across years; no-currency mode requires a single currency.
8. Legacy `CashRule` types/settings still exist for compatibility, root fallback and labels. Their presence does not mean intermediate/destination rules still control traversal termination.

Source-verified flow: workspace -> encoded `;cashflow:` question -> shared query orchestration -> `answerCashFlow` -> grouped raw posting rows -> `cashPostings` -> `traceCash`. Raw numeric measures and completeness metadata are required. Workspace caching is local to the workspace; it does not establish persistent cross-session caching.

## Simple acceptance sample

Workbook: `outputs/cash-flow-simple-20261028/CashFlow_Simple_Test.xlsx`; table `CashFlowSample`. User is currently testing this before expanding to split payments.

| Company | Document | Amount | Account label | Clearing |
| --- | --- | ---: | --- | --- |
| 9720 | 1 | -100 | Bank | blank |
| 9720 | 1 | 100 | Vendor | 201 |
| 9720 | 2 | -100 | Vendor | 201 |
| 9720 | 2 | 100 | GR/IR | 202 |
| 9720 | 3 | -100 | GR/IR | 202 |
| 9720 | 3 | 100 | Expense | blank |

Expected: choose document 1's -100 posting; document 1 -> clearing 201 -> document 2 -> clearing 202 -> document 3; receipts 0, payments 100, net -100, unresolved 0. Without Account mapped the endpoint label is Ending document 3, not Expense.

The supplied testing instructions use `Signed Amount = SUM(CashFlowSample[Amount])` in Measures and KPIs and a grouping field parameter containing Company, Document number and Clearing document in Fields. Preserve identifier text/leading zeros. Identical posting groups can merge without line identity. Actual Power BI acceptance is currently blocked by the configuration error recorded in DEVELOPMENT_STATUS.md.

## Missing historical context

The complete old transcript, unsupplied design decisions, deployment acceptance records and actual live tenant/model configuration are unavailable. If a future change depends on these, request only the relevant excerpt/export or live evidence. Do not ask the user to repeat the entire project before working on source-verifiable tasks.
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


## Cash-flow performance and compact diagram — 2026-10-29

Implemented shared-source optimization without raising query/row/depth limits: traceCash caches posting keys, sign partitions/group balances and reference subsets, and uses sets for starting identities/bank membership. loadCashLinks discovers relationships from newly added rows instead of rescanning the full graph at each level. Workspace root matching uses a Set. Cash allocation chart grouping appends rather than copying accumulated arrays; repeated number formatting reuses Intl.NumberFormat. Available document entries renders 20 documents per page with Previous/Next, preserving all documents, all/trace-only modes and totals. Diagram navigation jumps directly to the matching document page. Shared answer-table virtualization remains in place.

Approved compact Flow diagram now centres nodes (maximum 360px) and CSS line/arrow connectors. Only adjacent identified accounts across documents within the same company/currency combine; blank account labels are never guessed. Combined nodes retain document/year and internal clearing/reference labels. Original posting lines remain in Accounting entries. Node click/keyboard highlighting retained; charts remain presentation-only. No new model queries, security/filter changes, package or screenshots.

Verification: root npm test passed, new scripts/test-cash-flow-performance.cjs passed separately and added to npm test. Teams non-packaging regression and lint passed. Focused cash-flow browser passed for grouped nodes, computed width/centres, keyboard navigation, query-count stability, 26-document pagination/jump, exports and close. Differential comparison against pre-change engine passed 250 varied cases and a 3,000-payment shared-clearing case with identical allocations/paths/statuses/totals. On this machine that 6,002-posting fixture measured ~31,861ms before and ~281ms after (synthetic run, not a live-host SLA). A 4,000-payment/8,002-posting case passed reconciliation in ~895ms with 124,020 amount reads; a lazy simulated million-row source returned only 4,000 scoped rows in 50 batches. This does NOT test transferring/tracing a million rows inside the visual or live Power BI latency. Existing caps remain 5,000 response rows, 20,000 cumulative returned rows, 100 queries and bounded depth/steps, with incomplete/unresolved states preserved. Live Power BI/Teams and actual model indexing/latency still require user verification.

Actual-data screenshot diagnosis: Input = Cash and cash equivalents is a starting filter; current bank identification separately uses configured bank codes or exact supported account-description labels. No bank label identified is not missing clearing data or a performance failure. Start identification behavior was explained and not changed in this work.

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
