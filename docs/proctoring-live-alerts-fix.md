# Live AI alert ingestion diagnosis — 2026-11-04

The shared input path contained two reproducible `NameError` failures. Both are fixed. Physical-webcam acceptance is **pending the user's retest**; prerecorded and synthetic tests do not establish physical-webcam success.

## Root cause and evidence

`backend/app/api/v1/proctor_alerts.py` referenced `config.ENVIRONMENT` and `config.PROCTOR_GAZE_CALIBRATION` in `input_capabilities()` and `camera_frame()`. There was no module/global `config`; the application settings object is `settings`. A `config` name used elsewhere was local to other functions or a comprehension.

1. For an authenticated active Student attempt, `GET .../input-capabilities` raised `NameError: name 'config' is not defined`, before returning the sampling interval. This happened even with calibration logging disabled: evaluating `config.ENVIRONMENT` already failed.
2. The Student hook caught the capability error, set its interval to zero and retried after five seconds without explaining the failure. No successful capability response meant no webcam frames, so neither detector could produce an alert. Camera preview, browser tab/blur signals and independent worker health did not depend on this request.
3. A separately submitted valid frame could complete inference/persistence and then fail at the same undefined reference while constructing its acknowledgement. The browser would treat that response as a failed frame and back off.

Before the fix, two isolated authenticated HTTP regression tests both reproduced the exact `NameError`: the capability test and the valid-frame acknowledgement test. The existing proctor-alert suite also reproduced both failures. The source paths and reproductions establish a shared ingestion defect; the earlier physical session's network trace was not available, so this report does not claim to have observed its requests.

A second reproducible reliability defect existed during startup: session creation and sampling run independently, while the hook treated **every** HTTP 409 as terminal. An early `CAMERA_SESSION_REQUIRED` permanently stopped sampling even if session creation completed shortly afterward. The hook now retries that specific condition with the existing bounded backoff. Inactive/forbidden attempts still stop capture. A browser regression exercises capability HTTP 500 → recovery → session HTTP 409 → successful frames.

## Configuration and runtime inspection

- Loaded local settings: `PROCTOR_MODEL_ENABLED=true`, `PROCTOR_GAZE_CALIBRATION=false`, development environment, worker key provisioned. No key value was printed or changed.
- Enabled profiles: `local_yolo`, 250 ms, phone/book/prohibited-object/additional-person policies; `local_gaze`, 100 ms, sustained `face_not_detected` only.
- `LocalWorkerAdapter.start()` creates its authenticated server-side client for **`http://127.0.0.1:8765`**. The protected worker health request returned YOLO `READY`, `model_loaded=true`, CPU and Gaze `UNCALIBRATED`.
- `UNCALIBRATED` remains a statement about directional gaze. The shipping face-presence policy stays enabled. No directional-gaze event policy was added.
- The local database query found no in-progress attempt at inspection time. No targetable browser window was returned by the computer-use inventory. The exact original active exam's camera session could not therefore be inspected. The physical retest must check `require_camera`, an active attempt and an enabled camera session.
- An initial Windows port enumeration was incomplete. Direct authenticated HTTP probes established worker reachability. An attempted additional worker start could not bind the already occupied port; that extra process shut down. The existing worker was used for real-inference verification.

## Pipeline status

Results below describe this turn's verification scope, not physical-webcam acceptance.

| Stage | Result | Evidence / scope |
| --- | --- | --- |
| Local feature flags and worker profiles | PASS | Loaded settings enable both profiles; fixed capability response advertises 100 ms. Original active exam unavailable. |
| Production Student hook mounted and capturing | PASS in browser regression | Actual Student attempt page, live synthetic MediaStreamTracks, JPEG multipart frames; disabled models send no frames. Physical source pending. |
| Browser API and authenticated FastAPI input | PASS | Capability recovery, session-start recovery, frame validation, authentication/authorization and transport-only acknowledgements. |
| Adapter → `127.0.0.1:8765` → protected `/infer` | PASS | Request contract assertions plus actual loopback HTTP inference using the provisioned worker credential. |
| YOLO phone result | PASS with prerecorded input | Real model returned two `cell phone` detections for the validation montage. Existing mapping is `cell phone` → `object_phone`; no new `PHONE_DETECTED` event type was invented. |
| Face presence without direction calibration | PASS with prerecorded/empty input | Real worker returned `status=OK`, `face_detected=false`; sustained observations produced `face_not_detected`. Directional gaze remains off. |
| Temporal duration, continuity and cooldown | PASS | Short observations are suppressed, cooldown is preserved, worker failures break continuity, recovery requires a new sustained sequence. All thresholds unchanged. |
| Event persistence and Teacher WebSocket | PASS in isolated DB | Both real-worker events persisted in SQLite and reached an authenticated Teacher WebSocket. PostgreSQL LISTEN/NOTIFY code was preserved; a fresh production/PostgreSQL end-to-end run was not performed. |
| Worker failures and diagnostics | PASS | Timeout, unavailable observation, malformed output, HTTP 500 and rejected worker authentication create no fabricated events. Privacy/opt-in logging assertions pass. |
| Navigation/answer saving during slow AI input | PASS in new regression | A pending frame leaves answers and question navigation usable; one frame request at a time; camera collapse and React renders do not remount sampling. |
| Existing broader submit-navigation test | FAIL in this environment | One run missed its 7-second result-navigation deadline; the retry timed out during entry, before AI sampling. This does not establish a cause or a passing result for that existing test. Unrelated exam code was left unchanged. |
| Both alerts with a physical webcam | PENDING | User agreed to conduct the retest. No physical-webcam success claimed. |

## Tests executed

- **38 backend checks PASS** across `test_live_proctor_pipeline`, `test_proctor_alerts`, `test_local_worker_policy` and `test_proctor_adapters`. The combined runner temporarily replaced the application lifespan with the test's empty lifespan to avoid starting unrelated OCR, retention and classroom jobs. HTTP routes, authentication, adapters, temporal policy, database transactions and WebSockets remained real inside their stated test fixture. Worker model observations in the regular regression suite are explicitly synthetic.
- **1 opt-in real-worker HTTP integration PASS**: `PROCTOR_WORKER_HTTP_TESTS=1 .\.venv\Scripts\python.exe -m unittest tests.test_local_worker_http -v` from `backend` (set the variable using PowerShell syntax). Twenty-three prerecorded frames sent at wall-clock cadence produced both phone and face-absence events, persisted them, and delivered their identifiers to a Teacher WebSocket. No worker transport/model-output mocks are installed by this test. Database/users/attempts are isolated in memory. This is **not** a physical webcam or browser-to-real-worker acceptance test.
- **4 new browser checks PASS**, run using installed Chrome: `PLAYWRIGHT_BASE_URL=http://localhost:3100`, `PLAYWRIGHT_CHANNEL=chrome`, `npx playwright test tests/e2e/exam-experience.spec.ts --grep 'AI sampling:' --workers=1`. They use synthetic MediaStreamTracks and mocked API responses. An initial browser launch failed because the default Playwright headless binary was absent; using installed Chrome resolved launch. The first recovery run also exceeded the original cold-development-server timeout; it passed with an explicit 90-second test budget.
- The combined browser invocation also ran the existing submit-navigation case, which **failed**; a targeted retry also **failed**, as described above.
- **TypeScript PASS**: `npx tsc --noEmit --incremental false`.
- **Whitespace validation PASS**: `git diff --check` on the tracked files edited for this task.

The worker's observed CPU timings varied: warmed empty-frame requests took roughly 164–331 ms, while other requests exceeded 600 ms and a cold/loaded request took several seconds. Existing maximum-gap limits can deliberately reset continuity during those stalls. Diagnostics now expose those resets. Neither model confidence thresholds nor continuity/duration/cooldown thresholds were weakened to force a passing alert.

## Files edited for this task

- `backend/app/api/v1/proctor_alerts.py` — settings-reference fix; safe capability/frame/persistence diagnostics.
- `components/proctoring/useProctorInput.ts` — retry camera-session startup, deduplicated failure warnings, opt-in frame diagnostics, abort capability requests on cleanup/timeout and validate capture readiness.
- `backend/app/core/config.py`, `backend/.env.example` — default-off `PROCTOR_DIAGNOSTICS` flag.
- `backend/app/proctoring/diagnostics.py` — metadata-only opt-in logger.
- `backend/app/proctoring/adapters.py` — optional ephemeral frame trace and configuration/temporal/failure diagnostics.
- `backend/app/proctoring/local_worker.py` — forward ephemeral trace and log safe transport/result summaries.
- `backend/app/services/proctor_realtime.py` — safe startup profile and delivery-count diagnostics.
- `backend/proctor_worker/main.py` — opt-in trace/result-count/timing diagnostics.
- `backend/proctor_worker/README.md` — diagnostic operation and scope.
- `backend/tests/test_live_proctor_pipeline.py` — authenticated full-path regression coverage and logging privacy assertions.
- `backend/tests/test_local_worker_http.py` — opt-in real-worker inference/persistence/WebSocket regression, explicitly prerecorded.
- `backend/tests/test_proctor_alerts.py` — align the existing capability assertion with the already present calibration flag.
- `tests/e2e/exam-experience.spec.ts` — four browser sampling regressions.
- `docs/proctoring-live-alerts-fix.md` — this report.

Existing uncommitted work was retained. No model weights, YuNet/SFace, grading, question navigation or answer-saving implementation was changed.

## Manual physical-webcam acceptance still required

1. Restart the backend to load the endpoint fix/settings; reload the Student page. Keep the loopback worker running. Use a camera-required, active test attempt and open its Teacher feed.
2. Confirm `input-capabilities` returns 200 with `enabled=true` and frames receive 200 with `processed=true`. If temporarily investigating, enable `PROCTOR_DIAGNOSTICS=true` on the backend and in the worker process environment; reload the Student page to enable correlated browser logs. Never copy credentials or image payloads into diagnostic reports.
3. Hold a real phone clearly in view for 5–10 seconds. Confirm the Teacher feed receives **Phát hiện điện thoại** (`object_phone`).
4. Remove the face completely for 5–10 seconds. Confirm **Không thấy khuôn mặt** (`face_not_detected`), while directional gaze stays disabled. If gaps exceed continuity limits, inspect `temporal_reset` rather than treating `UNCALIBRATED` as a face-presence failure.
5. Confirm both entries remain after Teacher refresh and no fake AI events appear when the worker is unavailable. Disable temporary diagnostics after verification.

No physical webcam success will be inferred from the automated results above.
