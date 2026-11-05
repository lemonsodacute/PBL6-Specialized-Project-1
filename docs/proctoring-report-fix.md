# PROCTORING REPORT FIX

Teacher → **Giám sát → Xem báo cáo** now opens the monitoring report for that exact exam, using the existing `/dashboard/monitor/[examId]` route. Academic results remain in their existing Reports/Results routes.

## Root cause

`MonitorCollection` sent ended exams to `/dashboard/exams/[id]/attempts`. That page renders `TeacherResults`, the academic-results component, whose “Danh sách kết quả đề thi” backlink leads to `/dashboard/reports`. Monitoring context and active navigation were therefore lost. The existing proctor report was only a compact summary embedded in that academic view.

The ended card now links directly to `/dashboard/monitor/[examId]`. The existing monitor route chooses its live console or ended-exam report using the actual exam status/close time. The console's report shortcut stays under the same monitoring route (`?view=report`). Legitimate academic report links are retained.

The data audit also found **55 existing browser logs** that predated the normalized review envelope; the normalized event table was empty. Migration `0026_browser_event_history` connects those exact stored signals to the existing review lifecycle and retry receipts. It keeps their original IDs, attempt/exam/student relationships and timestamps. They are explicitly **BROWSER / TAB_SWITCH**, with nullable confidence and low/info severity, rather than model detections. No image, AI output, notification, score or risk value is invented. Raw browser logs and all existing attempts remain unchanged, verified by full-row fingerprints.

## Acceptance

| Requested check | Result |
| --- | --- |
| Incorrect generic Reports flow | REMOVED from Monitoring |
| Exam-specific report | `/dashboard/monitor/[examId]` |
| Student/attempt detail | Existing `/dashboard/monitor/[examId]/[attemptId]` route |
| Exam summary / Student list | PASS; global counts plus paginated individual attempts |
| Alert counts / severity | PASS; real persisted events; zero-alert attempts remain visible |
| Student detail / timeline | PASS; exact exam/attempt scope, chronological events and review history |
| Evidence viewer | PASS; existing protected evidence viewer; explicit no-image state |
| Confirm / Dismiss | PASS through the existing versioned review endpoint |
| Review persistence | PASS; real historical browser event dismissed, reloaded and reviewed again |
| Sidebar remains Giám sát | PASS |
| Academic Reports regression | PASS |
| Authorization | PASS; owner/Admin rules reused, Student denied |
| Dark mode / Mobile | PASS in viewport checks; mobile detail/timeline uses the full viewport |
| Fake alerts | NONE; historical browser signals are imported from actual existing logs |

The exact requested exam `04a98dd6-17da-4e29-9d6c-f3e4a27f40e8` contains **7** of those stored browser signals. The real browser acceptance followed its card, report, Student timeline, event detail, dismissal, refresh and both back-navigation steps. No step entered `/dashboard/reports`. Confirm and Dismiss transitions also pass backend and browser-fixture checks; the real-data acceptance uses a non-punitive dismissal with an explicit test-review note.

## Data and UI behavior

- The existing `/proctoring/exams/{id}/report` endpoint now includes exam/class/Teacher context, participating-Student count and a paginated per-attempt summary. Aggregation uses joins/grouping, without requesting each Student's events separately.
- Default order prioritizes high/critical severity, unseen events and larger alert counts. Search by name/MSSV, unresolved/confirmed/dismissed filters and severity filters remain server-scoped.
- Multiple attempts are separate rows. Metrics are for the whole exam, independently of the current table page.
- The existing timeline endpoint accepts an optional exam scope, rejects mismatched attempts and pages through all persisted events in stable chronological order. The UI can load subsequent pages.
- Event details reuse `ProctorEventDetail`, existing protected evidence and `NEW / REVIEWED / CONFIRMED / DISMISSED`. Review notes and actor/time history use the existing audit records. No second review store was added.
- A legacy exam video action appears only when its existing private media resource is actually present. No class recording or exam-evidence video is fabricated.
- Academic attempt-list warning counts now match the detail endpoint: a normalized browser review envelope is not counted a second time alongside its original `ViolationLog`.
- Decisions remain independent of academic scores and risk counters. Account, attempt and original browser-log fingerprints remained identical after migration and real report review.

## Verification

- **35 backend cases passed in one final run** across the proctor alert, monitoring report and existing Teacher results suites: 21 existing alert cases, 6 focused report cases and 8 academic-result cases. Tests cover zero-alert rows, separate attempts, filtering/pagination, ownership, mismatched exam scope, persistent decisions, unchanged score, more than 100 timeline events and nonduplicated browser-warning counts.
- **6 report browser scenarios passed** in light/dark at 390/768/1440px, covering timeline, no-image evidence, Confirm/Dismiss, refresh, active navigation and back links.
- **18 existing UI regressions passed**, including monitoring collection, Student dashboard and academic Reports.
- **4 real PostgreSQL-backed browser scenarios passed** using existing accounts: 29 role-specific academic routes plus the requested monitoring flow. All 36 combined viewport scenarios passed; mobile event detail fills the 390×960 viewport. The production build also passed.

Final evidence: `backend/private/livekit-recording/report-combined-final.log`, `artifacts/class-recording/dark-final.log`, `artifacts/class-recording/academic-final.log`, `artifacts/class-recording/build-release.log`, `artifacts/academic-demo/final-results` and `artifacts/dark-polish/final-results`.

The identical request was rechecked on 26 October 2026 against the running production build and actual PostgreSQL-backed API. The exact requested exam returned one participating Student, one attempt and seven persisted browser signals; Student access returned HTTP 403. The real-browser acceptance passed again in 8.8 seconds, following the exam card, report, timeline, evidence detail, refresh and monitoring back links. The existing `DISMISSED` decision, review version and audit-history length were identical before/after this recheck. No new alert or review decision was created. Evidence: `artifacts/class-recording/report-recheck-browser.log` and `artifacts/academic-demo/report-recheck`.

## Files

- `components/teacher/MonitorCollection.tsx`: exact monitoring links; requested overview cards/chart remain removed.
- `app/dashboard/monitor/[examId]/page.tsx`: live/ended report selection on the existing route.
- `components/proctoring/ExamMonitoringReport.tsx` and `.module.css`: exam summary, filters, attempt table/cards and navigation.
- `components/proctoring/ProctorConsole.tsx`: monitoring-scoped report shortcut.
- `components/proctoring/ProctorEventDetail.tsx` and `ProctorConsole.module.css`: scoped, paginated timeline and mobile dialogs.
- `lib/proctoring.ts`: typed report/attempt metadata and scoped timeline client.
- `backend/app/api/v1/proctor_alerts.py`: extends existing reporting/timeline APIs.
- `backend/app/services/monitoring_reports.py`: aggregate attempt summaries.
- `backend/app/api/v1/attempts.py`: prevents duplicate academic browser-warning counts.
- `backend/alembic/versions/0026_browser_event_history.py`: data-preserving historical browser envelope migration; applied locally. Downgrade refuses to discard reviewed history.
- `backend/tests/test_monitoring_reports.py`, `tests/e2e/monitoring-report.spec.ts`, `tests/e2e/academic-demo-real.spec.ts` and updated monitor-collection expectations.

Face Verification, model adapters, scoring rules, question generation, identity/card workflows and Online Classroom business logic are unchanged by this report feature. The separate recording work includes its own narrow host-dialog recovery fix and report.
