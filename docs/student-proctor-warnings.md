# Student and teacher warning verification — 2026-11-05

The Teacher console already persisted and received proctor events. The Student attempt page previously sent browser violations silently and did not read AI alerts. It now displays each warning with corrective guidance and delivery status.

## Behavior

- Browser signals appear immediately after exam entry (copy, paste, tab switch, window blur, right click, fullscreen exit). Device setup is excluded. Successful responses say the event was recorded for teacher review; failed requests explicitly say delivery failed.
- AI feedback reads committed events every two seconds and on focus/visibility return. It is separate from frame capture, survives refresh and does not restart camera sampling. Detection/temporal thresholds still apply before persistence; two seconds is the polling interval, not a guaranteed total detection latency.
- `GET /api/v1/proctoring/sessions/{attempt_id}/warnings` accepts only the active attempt's Student owner. It returns at most 20 events with ID, event type, last occurrence time and occurrence count. Simulated events, dismissed events and browser envelopes are excluded. Confidence, evidence, teacher notes and other students' events are not exposed.
- The banner lists up to five warnings. A dismissed occurrence remains closed across subsequent polls, but a new occurrence can reappear. Teacher dismissal removes an AI warning on the next refresh. Dismissal on the Student page does not alter Teacher review state.
- Failed warning refreshes preserve the last known warnings and show a reconnection message. Question input and navigation remain usable. Finishing the attempt stops polling and ignores late results.

## Verification completed

- 7 isolated backend pipeline tests passed, including authenticated input, Teacher WebSocket delivery, matching Student warning IDs, owner access, exclusion rules, and inactive attempt rejection.
- 28 existing proctor-alert/adapter tests passed. Their application lifespan was isolated to avoid unrelated background jobs.
- 1 real loopback worker test passed: 21 prerecorded frames produced phone and face-absence events, persisted them in the isolated test DB and delivered the same IDs to Teacher WS and Student warnings. Model outputs were not mocked.
- 6 Chrome browser tests passed: immediate browser feedback; honest failed delivery; answer saving/navigation; AI refresh/dismiss/new occurrence/recovery; mobile dark rendering; and four existing camera sampling regressions. These use controlled API fixtures and synthetic media.
- 1 live two-role Chrome test passed against QA PostgreSQL, FastAPI and the real worker. The actual Teacher console and Student attempt page both showed phone, face absence and copy warnings; AI alerts survived reload. Teacher WebSocket event IDs were checked. Only the Student exam response's device requirement flags were overridden in this test to exclude identity enrollment/camera setup; frames were submitted from a prerecorded fixture through the authenticated frame endpoint. Auth, warning APIs, violation recording, model inference, persistence, Teacher feed and WebSockets were real.
- TypeScript passed. Targeted ESLint passed with no errors; the existing attempt-page hook dependency warnings remain.
- Screenshots inspected: `artifacts/student-warnings/desktop.png`, `mobile-dark.png`, `browser-delivery.png`, `live-student.png`, `live-teacher.png`.

Physical-webcam behavior was not exercised. Directional gaze warnings remain disabled by the existing model policy. This verification does not establish model accuracy on a real student's webcam.

The reused QA database's Alembic marker is `0024_classroom_controls` although `class_recordings` already exists. An attempted QA upgrade failed transactionally on that existing table; no stamp/drop or migration workaround was applied. Warning tests use the already present proctor schema and passed. This pre-existing QA schema-marker mismatch remains separate from this change.

## Repeat the checks

From `backend`:

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_live_proctor_pipeline -v
$env:PROCTOR_WORKER_HTTP_TESTS='1'
.\.venv\Scripts\python.exe -m unittest tests.test_local_worker_http -v
```

From the repository root with the normal frontend running:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://localhost:3000'
$env:PLAYWRIGHT_CHANNEL='chrome'
npx playwright test tests/e2e/exam-experience.spec.ts --grep 'Student warnings:|AI sampling:' --workers=1
```

The opt-in `tests/e2e/student-warnings-live.spec.ts` requires a fresh `proctoring_e2e_fixture.py` fixture in the isolated QA database, QA API on 8001, QA frontend on 3100 pointed at that API, and the local worker on 8765. Resize the existing `val_batch0_labels.jpg` model validation montage to fit 640×640 and save it as JPEG quality 75 at `artifacts/student-warnings/worker-input.jpg`. Set `STUDENT_WARNINGS_LIVE_QA=1`, `PLAYWRIGHT_BASE_URL=http://localhost:3100` and run that spec. Private fixture tokens must stay under `backend/private`.
