# ProctoOwl frontend analytics

The shared analytics components use native React/SVG, with no additional runtime dependency. Brand primary remains `#006D77`. Chart colors, surfaces, grid, and typography use shared semantic tokens in `app/analytics.css`, including explicit dark theme colors. Tooltips appear on pointer hover and keyboard focus; line charts also expose the observed values as a table.

## Sources and scope

| Page | Visual | Existing data source | Scope |
| --- | --- | --- | --- |
| Admin / Teacher dashboard | Operational KPI cards | `GET /dashboard/stats` | Server snapshot and its reported recent window |
| Admin / Teacher dashboard | Completed attempts and warning KPI cards | `GET /teacher/reports?page=1&limit=20` summary | Full authorized report scope |
| Dashboard / Reports | Submission area chart | `results[].submitted_at`, `completed_statuses` from `/teacher/reports` | Only rows on the displayed page; grouped by Vietnam calendar date |
| Dashboard / Reports | Warning source donut | Report summary `browser_violation_count`, `detection_count` | Full current report filter scope |
| Reports | Attempt status bars | `results[].status` | Current page, explicitly labeled |
| AI Activity | Question outcome donut | `/admin/ai-support/activity` question `success`, `failures`, `requests` | Applied date range; counts must form a complete partition |
| AI Activity | Support outcome bars | Activity support `sessions`, `resolved_by_ai_count`, `escalated_count` | Applied date range; independent, potentially overlapping groups |
| AI Activity | Provider health and latest failure table | Activity `health` | Latest recorded provider event across the system, potentially outside the applied range |
| Monitoring | KPI cards and exam phase bars | Existing exam list and `monitoringPhase` | Total matched exam count; phase counts only for current page |

No backend, API contract, database, scoring rules, or export behavior changes. Frontend charts do not create historical comparison metrics, infer missing dates as zeros, or treat paginated rows as full-population data. Dashboard report loading has an independent loading/error/retry state.

## Empty states and limitations

- Submission trends require four observed days with valid submission timestamps. Missing dates remain unobserved. Curves connect observed daily counts only.
- AI Activity has aggregate metrics but no daily history. Its trend card deliberately shows an empty state. No series is reconstructed from totals or the latest provider timestamps.
- Zero-total or invalid distributions show an empty state instead of a decorative chart. Missing KPI fields are not replaced by demo values.
- Support resolved and escalated sessions may overlap, so bars are used instead of a donut or invented remainder.
- Monitoring cannot infer average session risk or global warning rankings from an exam list. Existing per-exam attempt summaries and actions remain available.
- Student pages are unchanged; the shared dashboard analytics apply only to admin/teacher routes.

## Verification

`tests/e2e/analytics.spec.ts` covers observed-only aggregation, Vietnam date boundaries, pagination disclosure, keyboard tooltips, empty/error/retry states, and desktop/tablet/mobile charts in both themes. Fixtures exist only in tests and are not product defaults. Existing teacher reports, monitoring, and AI Activity tests cover filters, pagination, provider health, rates, and exports.

Verified on 2026-10-23:

- `npx tsc --noEmit --incremental false`: passed.
- Targeted lint for new analytics components, helper, tests, AI Activity, and Overview: passed without warnings.
- `npm run build`: passed; existing repository hook/image lint warnings remain. Log: `artifacts/analytics/build.log`.
- Edge against the production build: all 32 tests in `analytics.spec.ts`, `ai-activity.spec.ts`, `teacher-reports.spec.ts`, and `monitor-collection.spec.ts` passed. A cold-development Knowledge Base navigation timeout did not recur in the production run.
- Screenshots: `artifacts/analytics/` and `artifacts/ai-activity-redesign/`; monitoring screenshots are in the corresponding Playwright test output directory.
- After the final monitoring card spacing adjustment, the production build and all 6 monitoring tests passed again.
