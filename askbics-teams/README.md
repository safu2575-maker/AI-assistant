# askBICS for Teams 0.4.1

The main Power BI project is the canonical shared source. Teams imports `../src/qna`, the shared model/parser helpers and `../style/visual.less` directly. Teams-specific authentication, model connections and REST query transport remain in this folder.

## Activate this update

1. Stop the existing bot terminal with Ctrl+C. Keep the developer tunnel running.
2. Run `npm start` in this directory. The built server and Ask tab listen on port 3978.
3. If the Ask tab is already installed, no package upload is needed for this update. For a fresh installation or catalog version update: in Teams admin center → Teams apps → Manage apps → askBICS, upload `appPackage/askbics-teams-pilot-0.4.1.zip` as an **update to the existing app**. Keep its app ID. Do not submit a second organization app.
4. Reopen/update askBICS in Teams and select the **Ask** tab. Sign in with Microsoft. Native Chat shows compact answers; Ask contains the visual interface.

Keep both Entra Web redirects: `https://token.botframework.com/.auth/web/redirect` and `${TAB_ORIGIN}/ask/auth/callback`. The current tunnel origin remains unchanged. If the tunnel address changes, update `.env` TAB_ORIGIN, the Entra redirect, Azure Bot messaging endpoint, and regenerate/upload the manifest.

## Sign-in and loading update (0.4.1)

- Reopen Ask and sign in once with **Keep me signed in on this device for up to 15 days** checked. Existing logins do not contain refresh tokens and need this one migration sign-in. No additional Power BI scope is needed beyond the connection release; OAuth now explicitly requests offline_access.
- Reopening Ask, reloading, and opening another window within the same browser storage partition restore sign-in without a popup. Sign-out ends that device's remembered access. Entra Conditional Access or revoked consent may require earlier sign-in.
- The lightweight bootstrap initializes Teams before the larger visual bundle and shows a recovery message if loading stalls. API requests time out with a visible retry message. Sign-in only opens a popup on an explicit button click.
- The developer tunnel has a first-visit warning, verified in a clean browser. It can intercept the tab before any app script runs. Open the tunnel URL directly and choose Continue for pilot browser use; Teams desktop storage may be separate. A permanent HTTPS deployment is needed to eliminate this development-host interruption for all users. The app cannot override that upstream page.
- Tests: `npm run test:sessions` checks reload/new-window/restart recovery, latest-answer/draft restoration, transient network failure recovery and cross-window sign-out. These are simulated Entra/Power BI tests; real policy and Teams storage behavior still require a live check.

## In-app connections (InfoBICS)

1. In Entra → App registrations → askBICS Teams Pilot → API permissions, add **Power BI Service → Delegated permissions → Workspace.Read.All**, keeping Dataset.Read.All and existing permissions. Grant organization consent if required by your tenant policy. No client secret or redirect change is needed.
2. Restart the server, reopen Ask and sign in again to obtain the new scope.
3. Click **Connect data → Connect another model**. Choose a workspace/model, or paste its Power BI model-view link.
4. Discover fields, select the measures and dimensions, optionally map Date and numeric Year, then **Test and connect**. Duplicate field names are qualified by table. Create explicit measures in Power BI for numeric totals.
5. Use **Connect data → Use model** to switch, or Remove to disconnect. Connections are encrypted and scoped to the signed-in tenant/user. The last selected model is remembered and access is rechecked on selection. Saved reports stay scoped to their original model; no other user's selection changes.

Automatic metadata discovery uses ExecuteDaxQueries with fixed INFO.VIEW metadata queries and Arrow/LZ4 decoding. It requires Read/Build, compatible models, and the relevant Power BI query/XMLA tenant settings. HTTP-200 Arrow error streams are rejected. If discovery is blocked, the UI offers manual measure/table/column entry, still validated against Power BI before saving. Workspace browsing uses Workspace.Read.All; a model link avoids browsing but does not bypass data permissions. Access to a listed model is not assumed to imply query access.

Native **Chat still uses the pilot configured model**; these new per-user connections apply to **Ask**. This release remains single-tenant InfoBICS and a single server instance, not marketplace/multi-tenant hosting. The sample connection remains available. The app does not import PBIX data or grant Power BI permissions.

If using devtunnel, preserve Origin with `devtunnel update <existing-tunnel-id> --origin-header unchanged`. Keep the same tunnel URL.

Run `npm run test:connections` for the complete browser flow (synthetic Power BI transport, real app routes). Live tenant consent and the manager's actual model still require a signed-in user check.

## Reused interface and behavior

- Original question parser, field/value suggestions, token highlighting, aliases and synonyms; bare measures and business values such as `show Home Living by Year Rent Measure`.
- Tables, model-calculated totals, table/matrix editor, answer filters, hierarchical matrix rows and pivot columns. Subtotals and marginal totals are separate Power BI evaluations, not sums of displayed averages/ratios.
- The original 19 chart types, type picker, labels, zoom, fullscreen, selection highlighting, copy-image and PDF preview/download controls.
- Q&A settings: history/latest-answer mode, autocomplete selection, synonyms, default/additive measure choices, cardinality rules and time settings.
- Saved reports, sections, section locks, report editing, layout/resize/color controls, date/comparison controls and expanded reports.
- Private Teams chat now uses the same model parser. Chat summaries link to Ask. `/ask` retains the guided searchable Adaptive Card.

Time intelligence uses the original parser and needs correct model mappings. Date and Year are configured. In Settings → Time intelligence, choose MonthIndex for YTD/TTM **only if** it is continuous: January 2024 = 24289, February 2024 = 24290. The code does not assume that a column named MonthIndex has this encoding. Two-digit year and ambiguous month/year controls are included.

## Host differences and limits

This is interface/code reuse, not an embedded Power BI report. Teams does not inherit report/page/visual slicers, cross-filter other Power BI visuals, or share the visual's persisted settings/reports. Ask connections are now selected and saved by each user through Connect data. The administrator configuration is only the default/sample model for Ask and native Chat. Numeric columns do not automatically become DAX measures.

The same model, permissions, filters and measure formats are needed for matching answers. Queries use the caller's delegated Power BI token. Never substitute a shared administrator token. Arbitrary DAX is not accepted. Unknown fields and failed/partial provider results fail closed. Answers above 10,000 rows require narrowing the question; suggestions are capped at 2,000 distinct values per field and disclose incomplete dictionaries. Explicit field filters still work beyond that suggestion cap. Field dictionaries expire after five minutes or refresh; answer queries always run against Power BI.

Chat is a preview (up to 8 rows/6 columns); interactive charts and layouts are in Ask. Copy/download behavior also depends on the Teams/browser host permissions. Saved sections provide convenience privacy; model RLS/OLS remains the data security boundary.

## Authentication and saved reports

The Azure Bot uses the `powerbi` OAuth connection. Ask uses authorization code + PKCE, state/nonce and confidential-client exchange. No Power BI token is returned to the browser. Short-lived tab session handles are held in sessionStorage. With Keep me signed in selected, an opaque random device credential is kept in localStorage for an absolute maximum of 15 days. The server stores access/refresh tokens only in AES-GCM-encrypted state, indexed by a hash of that credential. offline_access permits silent renewal; policy/revocation/consent can still require earlier interactive login. Renewal is serialized per device and rotates refresh tokens when Entra returns a replacement. Sign-out revokes the remembered device and its active sessions; other windows in the same storage partition receive a sign-out event. Different browser profiles/Teams storage partitions may require their own first login. Clearing browser storage removes remembered access. The identity used for saved state comes from Entra's token endpoint, not browser-submitted identity.

Saved questions, settings, sections and layouts are encrypted at rest in `data/reports`, partitioned by tenant/user/model. Result rows are not stored there. Remembered OAuth credentials are stored encrypted in separate records in the same protected data directory. `STATE_KEY` in `.env` is a generated 32-byte key encoded as 64 hex characters. **Keep this key stable and protect/back up it with the data directory**; replacing it makes existing reports unreadable. Both are excluded from version control and app packages. Different users have separate saved reports. Server restart does not remove saved reports or remembered sign-ins when STATE_KEY and the data directory are retained. The browser silently obtains a fresh tab session. The most recent question is re-evaluated under current permissions on reopen; drafts and saved reports are restored, without duplicating question history.

This remains a single-instance pilot. For production, use managed secrets, durable shared OAuth/session state, protected persistent storage, monitoring and appropriate hosting. The Dockerfile preserves the build separation; mount persistent storage at `/app/data` and ensure the node user can write it. The local developer tunnel must remain running for Teams to reach this machine.

## Build, verify and package

Dependencies are confined to this directory. The project-local Node 22 runtime is used by npm scripts, leaving the visual's system Node setup unchanged. On another machine run `npm ci`; production needs Node 22.12+.

```powershell
npm test
npm run test:browser
npm run prepare:manifest
Compress-Archive -LiteralPath appPackage/manifest.json,appPackage/color.png,appPackage/outline.png -DestinationPath appPackage/askbics-teams-pilot-0.4.1.zip -Force
npm start
```

Browser tests use installed Chrome by default (`TEST_BROWSER` can point to another Chromium executable), simulated authentication and synthetic data. They exercise autocomplete, tables, matrices, charts, settings, PDF generation/download and saved-report restoration. Backend tests check model totals including non-additive measures, parser compatibility, allowlisted queries, auth/session boundaries and encrypted state isolation/tamper rejection. They cannot prove live Entra consent, tenant API configuration, Teams host behavior or RLS correctness.

After installing, compare these against the Power BI visual with the same filter context:

- `Rent Measure`
- `show Home Living by Year Rent Measure`
- `Show Rent Measure by City as a bar chart`
- `Matrix; rows: Assigned Group; columns: Year; values: Rent Measure`

Test two representative users with different model permissions. The Power BI tenant must allow Execute Queries; callers need model Read/Build permissions and an appropriate license/capacity. Preserve the existing single-tenant app ID, delegated Dataset.Read.All and Workspace.Read.All permissions, Bot OAuth connection and both Web redirects.

The ZIP contains only manifest.json, color.png and outline.png at its root. It contains no server code, credentials or Power BI visual package. Restarting the server and updating the Teams catalog are separate activation steps.

## Snapshot maintenance

`scripts/build-visual.mjs` generates a headless query adapter from the current `../src/fieldParameterTrial.ts` on every build. Generated code goes in `generated/` and must not be edited. Extraction boundaries are checked; if the Power BI host orchestration changes incompatibly, the build fails rather than using an outdated snapshot.

The shared UI defaults to Power BI behavior. The Teams adapter explicitly sets `hostMode = "teams"` and opts into history restoration and answer cross-filtering. New host-specific features must remain opt-in. `tab/shell.css` contains Teams-only shell and scrollbar overrides; shared design changes belong in the root LESS file.

## References

- https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/what-are-tabs
- https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/auth-tab-aad
- https://learn.microsoft.com/en-us/microsoftteams/upload-custom-apps
- https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/execute-queries


## One source, two builds

From the repository root, run `npm run build:all`. This checks the main visual, builds Teams, and packages the Power BI visual into root `dist/`. Run `npm run test:all` for both regression suites, and `npm --prefix askbics-teams run test:sessions` for browser history/cross-filter checks. Install dependencies in both root and Teams folders before the first build.

Edit shared UI/features in root `src/qna/`, shared model helpers in root `src/`, and shared design in root `style/visual.less`. Do not maintain another copy under Teams. The build records the actual browser source inputs in `askbics-teams/dist/shared-inputs.json`. Shared behavior is built into both artifacts; Power BI-only APIs and new data-access features still require adapter work and tests.

Building does not deploy: import the generated `.pbiviz` into Power BI and restart/redeploy the Teams server for server-code changes. Reload Ask for browser changes. No settings export/import is required to distribute features. The Teams manifest ZIP only needs updating when app metadata/capabilities change.

For a Teams container, use the repository root as build context: `docker build -f askbics-teams/Dockerfile -t askbics-teams .`. The image copies the shared source during build; it does not contain a separately maintained visual snapshot.

### Percentage of Revenue (shared visual and Teams)

In Q&A settings > Percentage of Revenue, choose the dimension identifying revenue (for example Line Item), then type or choose its exact revenue value. Save settings. Ask `Amount by Line Item as percentage of revenue` or add a configured period such as `YTD June 2026`.

The model-query path evaluates numerator and denominator in the same period. The denominator replaces the query's filter on the configured revenue dimension, retaining other predicates. Grand totals use total amount / total revenue, not a sum of percentages. Missing or zero denominators display a dash. YTD/TTM require the existing numeric MonthIndex setup. Ordinary questions remain unchanged.

Revenue settings are saved per existing visual/model settings scope. This feature does not override Power BI report/page filters. Combined tuple filters involving the revenue dimension and Teams cross-filters on that dimension must be cleared first. A live financial semantic model still needs acceptance testing after importing the packaged visual.

### Power BI startup loading and direct measures (2.9.93)

The visual supports directly bound measures, measure field parameters, and mixed bindings. Runtime binding metadata takes precedence over an obsolete saved measure-selector configuration. A directly bound measure is always part of the Power BI host query; dynamic parameter filtering cannot unload it. Unbound measures are not made accessible by startup settings.

In Power BI, Settings > Startup loading lets report authors enable a small query with 1–3 different grouping fields and one measure. The selection is applied after startup metadata is available and after external data updates. With no question yet, the visual Refresh button reapplies startup selection; with an existing question, Refresh refreshes that answer. Question and suggestion requests use their needed fields afterward. Focusing the Power BI composer no longer preloads every suggestion dictionary; it only warms configured startup fields, and typing a field name loads that field's values.

Use grouping and measure parameters for selective loading, save the report with the startup selection active, and verify Performance Analyzer on the real model. Power BI controls its first query before the visual receives data; this setting cannot guarantee zero initial queries or suppress directly bound columns/measures. Teams does not show this Power BI host-specific settings section.
