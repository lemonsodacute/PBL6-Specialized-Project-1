# PROCTORING ALERT SYSTEM

## Completion

| Item | Result |
| --- | --- |
| Normalized event model | DONE |
| Persistence / retry receipts / aggregation | DONE |
| Realtime WebSocket / multiple API workers | DONE |
| Teacher alert feed / filters / live counts | DONE |
| Alert detail / evidence summary / timeline | DONE |
| Dismiss / Confirm / notes / review audit | DONE |
| Existing notification bell / exact event deep link | DONE |
| Post-exam event report | DONE |
| Explicit DEV-only simulator | DONE |
| Production fake alerts | NONE |
| Model adapter ready | YES |
| Face Verification changed | NO |
| Business scoring changed | NO |

No trained monitoring model is bundled or pretended to be connected. Application configuration was verified with `PROCTOR_MODEL_ENABLED=false`, zero configured modules and `PROCTOR_SIMULATOR_ENABLED=false`. The simulator ran only in the isolated QA API/database and those API/frontend processes were closed after verification. No simulated records were inserted into the application database.

YuNet, SFace, 128D embeddings, cosine comparison and identity threshold `0.363` remain unchanged. No new risk/integrity/cheating score exists. Legacy risk weights and grading/finalization rules remain unchanged; new review envelopes are excluded from legacy detector counts/risk to avoid duplication and simulated-score contamination. Existing browser warning/lock behavior is preserved.

## Root audit and concurrency correction

Existing detection/session, browser violation, audit, notification, private-media and WebSocket infrastructure was reused. The unsafe student-authored AI detection endpoint is denied. Normalized intake requires a protected service credential or a server-owned registered adapter. Students receive only camera transport acknowledgment, not AI confidence or teacher decisions.

Concurrent live testing exposed a database lock interaction: the existing attempts list checks expiry with row locks, while synchronous SQL inside an async ingestion route could block the loop needed to complete the list response and release its transaction. Ingestion/review/frame/health transactions now execute in worker threads; the existing browser violation bridge uses the same scheduling approach. No scoring/finalization rules were changed. A focused scheduling regression and concurrent real PostgreSQL list/intake/retry test cover the correction.

## Migrations

`backend/alembic/versions/0023_proctor_alerts.py` extends the existing `detection_events` table, adds retry receipts and safe model health, and links existing notifications to events. Event types become validated strings; `info` is added to the shared severity enum. Historical links/timestamps/confidence are backfilled, not fabricated.

- Applied to the local application database and isolated PostgreSQL QA database; application head verified as `0023_proctor_alerts`.
- Isolated downgrade/upgrade preservation check passed: **11 historical detections and 33 attempt score/counter records** preserved unchanged.
- Downgrade refuses normalized alerts or reviewed legacy alerts, preventing silent review-data loss. PostgreSQL's added enum value is retained if a permitted downgrade occurs.
- Original root `schema.sql` remains the initial bootstrap; existing installations must use Alembic upgrades.

## Verification

| Check | Result |
| --- | --- |
| Alert / adapter / teacher-report / teacher-result backend tests | 41 PASS |
| PostgreSQL commit-only NOTIFY, rollback, lifecycle and score/counter isolation | 2 PASS |
| Existing Face Verification / identity / embedding tests | 88 run: 87 PASS, 1 optional smoke test skipped |
| Real simulator → DB → two-worker WebSocket → feed/count/toast → review → refresh → report | PASS |
| Global bell outside Monitoring → exact event deep link | PASS |
| Concurrent retries plus concurrent existing attempts list | PASS; one meaningful emission, no duplicate alert |
| Remaining live browser checks, including no-model and student authorization | 7 live tests PASS in the final complete run |
| Sidebar expanded/collapsed/flyout/wheel/footer/independent scrolling | 4 PASS |
| Existing teacher result navigation, persisted response, failures, history and CSV | 8 PASS |
| Timeline, keyboard focus/restore and camera controls at 375/768/1440 | 3 PASS |
| Monitoring responsive layouts at 1440/1024/390, including dark mode | PASS; no horizontal overflow |
| Focused lint for new proctor components and API client | PASS; no warnings/errors |
| Production `npm run build` including TypeScript checking | PASS; 42 static pages generated |

The full build retains existing repository hook-dependency and image warnings; it has no build errors. These tests validate infrastructure and workflow, not trained-model detection accuracy. Test-only adapters/pixels/simulator events are explicitly isolated from application code and production defaults.

Commands and setup are documented in [proctoring-alerts.md](proctoring-alerts.md). Browser captures of the test state are under `artifacts/proctoring/`; private runtime tokens and disposable QA diagnostics stay in ignored directories. Temporary Next QA type includes were removed after testing.

## Files changed

Frontend:

- `app/layout.tsx`
- `app/dashboard/monitor/[examId]/page.tsx`
- `app/student/attempts/[id]/page.tsx`
- `components/notifications/NotificationsProvider.tsx`
- `components/proctoring/ProctorConsole.tsx`
- `components/proctoring/ProctorConsole.module.css`
- `components/proctoring/ProctorEventDetail.tsx`
- `components/proctoring/ProctorReport.tsx`
- `components/proctoring/ProctoringProvider.tsx`
- `components/proctoring/useProctorInput.ts`
- `components/teacher/TeacherResults.tsx`
- `lib/proctoring.ts`
- `lib/notifications.ts`
- `types/index.ts`

Backend:

- `backend/.env.example`
- `backend/app/main.py`
- `backend/app/core/config.py`
- `backend/app/core/proctor_limits.py`
- `backend/app/models/entities.py`
- `backend/app/proctoring/__init__.py`
- `backend/app/proctoring/contracts.py`
- `backend/app/proctoring/adapters.py`
- `backend/app/services/proctor_events.py`
- `backend/app/services/proctor_realtime.py`
- `backend/app/services/proctor_lifecycle.py`
- `backend/app/services/risk.py`
- `backend/app/services/reports.py`
- `backend/app/services/report_collections.py`
- `backend/app/api/v1/proctor_alerts.py`
- `backend/app/api/v1/proctoring.py`
- `backend/app/api/v1/router.py`
- `backend/app/api/v1/violations.py`
- `backend/app/api/v1/notifications.py`
- `backend/app/api/v1/attempts.py`
- `backend/alembic/versions/0023_proctor_alerts.py`

QA / handoff:

- `backend/scripts/simulate_proctor_event.py`
- `backend/scripts/proctoring_e2e_fixture.py`
- `backend/scripts/verify_proctor_migration.py`
- `backend/tests/test_proctor_alerts.py`
- `backend/tests/test_proctor_adapters.py`
- `backend/tests/test_proctor_postgres.py`
- `tests/e2e/proctoring-alerts-live.spec.ts`
- `tests/e2e/monitor-ui.spec.ts`
- `.gitignore` (generated QA frontend output)
- `docs/proctoring-alerts.md`
- `docs/proctor-model-integration.md`
- `docs/proctoring-implementation-report.md`

## Model handoff

See [proctor-model-integration.md](proctor-model-integration.md) for the adapter protocol, local/HTTP registration, raw-label mapping, confidence normalization, calibrated temporal/severity policy, protected external ingestion, evidence/privacy, health, failure testing and disabling a module.

All model policies remain disabled until the model team supplies calibration. New alert evidence is metadata-only. For local temporal frame adapters, use attempt-affine routing / one frame worker, or put temporal processing in a dedicated inference service. Persistent aggregation, review, notifications and WebSocket invalidations already work across API workers. No Monitoring UI/database redesign is required when connecting a supported trained model.
