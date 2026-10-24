# Admin analytics redesign

Scope: Admin Dashboard (`/admin`, and `/dashboard` for admin users) and the admin presentation of `/dashboard/reports`. Teacher dashboard/report presentation, AI Activity, Monitoring, Knowledge Base, sidebar, logo, authentication, authorization, API contracts, and backend remain unchanged in this iteration.

## Visual system

The `ui-ux-pro-max` data dashboard guidance is applied through an isolated CSS module: neutral background, existing ProctoOwl body font, 28–30px page titles, 18px section titles, 32px KPI values, compact controls, 14px table text, soft borders, and restrained chart colors. Teal `#006D77` remains the primary brand and sidebar color. Light/dark chart tokens and existing React/SVG primitives are reused; no chart dependency was added. Module selectors apply only when the new Admin wrappers are present.

## Data lineage

| Visual | Frontend value | API field | Backend query/source |
| --- | --- | --- | --- |
| Total users KPI | Sum of the three exhaustive user role totals | `/users?role=student|teacher|admin&page=1&limit=1` → `meta.total` | `api/v1/users.py:list_users`, persisted `User.role` filters + `page_query` count |
| Role distribution donut | Student, teacher, admin counts | Same three responses | Same queries, no duplicate user requests |
| Classes KPI | `stats.classes` | `/dashboard/stats` → `data.classes` | `api/v1/dashboard.py:dashboard_stats`, authorized classes count |
| Exams KPI | Exam collection total | `/exams?page=1&limit=5&sort=newest` → `meta.total` | `api/v1/exams.py:list_exams`, persisted authorized exam collection count |
| Pending card KPI/queue | Count + up to three records | `/admin/student-cards?status=PENDING_CONFIRMATION&page=1&limit=3` → `meta.total`, `data[]` | `api/v1/student_card_admin.py:list_cards`, effective persisted card/valid preview state and SQL count |
| Recent admin activity | Four audit rows | `/audit-logs?role=admin&sort=newest&page=1&limit=4` → `data[]` | `api/v1/audit_logs.py:list_audit_logs`, role-filtered persisted `AuditLog` records |
| Dashboard operational fallback | Active exam/attempt counts + recent warnings; recent exams | Dashboard stats and the same exams response used by the KPI | Existing dashboard queries; no new risk, activity, or date inference |
| Dashboard/Reports submission area | Completed rows grouped by Vietnam submission date | `/teacher/reports` → `results[].submitted_at`, `completed_statuses` | `services/report_collections.py:attempt_projection`/`filtered_reports`, persisted attempt times and statuses |
| Reports total attempts/completed/warnings | Server summary values | `summary.attempt_count`, `completed_attempts`, `total_violations` | `projection_summary`, SQL aggregate over the complete authorized filter scope |
| Reports normalized average | Server average percentage | `summary.average_percentage`, `percentage_attempts` | Per-attempt score/max-score percentage followed by SQL average; no cross-exam raw-score averaging |
| Reports score distribution | Five percentage bins over visible completed rows | `results[].percentage` | Persisted score/max-score projection; missing, non-finite, out-of-range, and incomplete results excluded |
| Reports detailed risk | Existing saved risk field, only in details/advanced filters | `results[].risk_score`, existing `risk_min`, `has_risk` filters | Existing severity/confidence weighting in `services/risk.py`; no frontend recalculation |

## Scope and fallback rules

- User/exam/card totals are never inferred from a short page of rows. Missing counts are omitted and the affected section is retryable.
- Trends require four observed submission dates. Missing days are not filled with zeros. Dashboard falls back to a compact operational summary and real exam list; Reports displays a compact empty state.
- Submission and score charts explicitly describe only the current result page. Summary KPIs describe the full server filter scope. No growth comparisons are created.
- Reports reuse the existing URL state, debounced search, server filters, race protection, pagination, and CSV export. No date/class/teacher filter is invented. Existing risk filters are available behind “Bộ lọc khác”.
- Main table remains the detail source. On narrow screens its eight real columns can scroll inside the table region without overflowing the page.
- API failures remain unknown/error states. No demo records, random values, sample production data, estimated escalation counts, or decorative time series are added.

## Verification

Tests include role/count provenance, omitted unknown totals, operational fallback, percentage bin boundaries, keyboard chart tooltips, supported filters, exports, preserved URL state, 4/2/1 KPI layout, light/dark screenshots, and unchanged teacher/admin navigation workflows. Browser fixture values live only in tests.

Screenshots are produced in `artifacts/admin-analytics-redesign/` at 1440, 1024 and 390px, in both themes.

Verified 2026-10-23:

- `npx tsc --noEmit --incremental false`: passed.
- Targeted Next/ESLint checks for all new components, helper, and tests: no warnings or errors.
- `npm run build`: passed after the final table readability change. Existing repository hook/image warnings remain; build output is in `artifacts/admin-analytics-build.log`.
- Production Edge run: all 30 tests across Admin analytics, existing analytics, Admin navigation, and teacher reports passed. The final 9-test Admin suite passed again after the mobile table change.
- Visual review completed for both pages at desktop/mobile and in dark mode. KPI counts use 4/2/1 columns, table text remains readable within its own scroll region, and no page overflow was detected.
- Screenshots use isolated API response fixtures for reproducible verification. They do not seed the database, replace production API data, or introduce product defaults.
