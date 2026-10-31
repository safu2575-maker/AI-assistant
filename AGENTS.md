# askBICS development continuity

This is the existing askBICS Assistant application, not a new project. Read `docs/PROJECT_MEMORY.md` and `docs/DEVELOPMENT_STATUS.md` before changing behavior. These files record provenance and limitations; they are not proof that every requested feature works.

## Scope and preservation

- Make only the user's requested changes. Latest confirmed requirements override older proposals. Verify behavior against source before describing it as implemented.
- Keep edits inside `C:\Users\safu2\Downloads\askBICSAssistant` unless the user explicitly changes scope.
- Preserve existing UI/UX, business rules, saved settings, integrations and working functionality. Do not redesign unrelated screens.
- Inspect Git status before work. This workspace has substantial existing modified and untracked implementation. Do not reset, clean, overwrite or commit unrelated work.
- Do not claim to have reviewed the separate conversation titled “Create standalone askBICS Assistant” unless its actual transcript is accessible. Supplied excerpts and project memory are partial context.

## One shared source, two hosts

- Shared UI: `src/qna/`; shared calculations/query helpers: `src/`; shared styling: `style/visual.less`.
- Power BI host: `src/visual.ts`, `src/fieldParameterTrial.ts`, `capabilities.json`.
- Teams host: `askbics-teams/app/` and `askbics-teams/src/`. Its build generates a query adapter from the root source through `askbics-teams/scripts/build-visual.mjs`.
- Never maintain a second copy of shared features in Teams or edit generated adapter/build files as source. Check both hosts when shared behavior changes; host APIs and data access still require separate integration checks.
- Preserve the visual GUID, existing Teams app identity, delegated authentication, model/user isolation and persisted settings compatibility. Never substitute an administrator token or bypass model security.
- Build/package is not deployment. Do not claim a local fix is active in Power BI or Teams without activation and verification.

## Design and calculations

- Reuse existing components, icons, filter chips, popups, settings helpers and CSS classes. Preserve current Segoe UI typography, blue accent, white/light surfaces, rounded controls and existing layout patterns.
- Follow `SELECTION_CONTRACT.md` for selection, cross-filtering, row identity, chips and stale asynchronous results.
- Follow `docs/settings-help-maintenance.md` when controls/settings change.
- Preserve raw numeric values, model context and completeness metadata. Never sum displayed ratios, custom KPIs or formatted strings to invent model totals.
- Cash flow follows document and clearing relationships. A blank outgoing reference is an endpoint under the approved rule; a present but missing link is unresolved. Do not restore mandatory Intermediate/Destination account roles. See project memory for sample limits.

## Verification and handoff

- User preference: do not create design PNGs, preview images or routine screenshots unless explicitly requested. Make code edits and use relevant non-image checks/tests. Avoid screenshot-producing test steps when they are not needed; do not invoke image generation for routine UI edits.

- User preference (2026-10-29): do not run `pbiviz package`, `npm run package`, `npm run build:all` (which packages), or another command that creates a `.pbiviz`. The user will create the package. Make requested code edits and run relevant non-packaging checks only, unless the user explicitly requests packaging again.

- Run relevant regression tests for code changes. Root: `npm run build`, `npm test`; Teams: `npm --prefix askbics-teams test`. Selection changes also require `npm run lint` per the selection contract and native Power BI validation before release.
- Focused browser tests live under `askbics-teams/test/`; these use synthetic transports and cannot prove live Power BI/Teams behavior.
- `npm run build:all` checks both builds and packages the visual; `npm run test:all` runs both regression suites. Teams requires Node >=22.12. Preserve the existing toolchain separation.
- When releasing a new visual package, keep `pbiviz.json`'s `visual.version` and `src/buildInfo.ts` synchronized. Do not infer the visual build from root package.json's version.
- Update memory/status after material decisions or changes, recording files, actual tests/results, remaining limitations and next work. Separate requested, source-verified, tested and live-verified states. Never promote a proposed fix to a resolved issue without evidence.
- Documentation-only work does not require rebuilding or deploying application artifacts.

## Saved settings portability
Every new or changed persistent feature must participate in saved-state serialization and Copy/Paste settings, with validation, merge/replace behavior, renamed-field mapping where applicable, and regression coverage. Do not export credentials, cached results or transient requests. Save settings before copying; import must respect the receiving model catalogue and security.
