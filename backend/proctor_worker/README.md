# Local proctor inference worker

The backend sends sampled JPEG or PNG bytes to one authenticated worker on 127.0.0.1:8765. The service returns measurements. Only the main backend binds them to a student, exam and active attempt, applies review policy and persists events.

## Run on this Windows machine

From the backend directory, start the worker before starting the normal backend. The local development configuration enables the built-in profiles. Restart an already-running backend to load them.

```powershell
.\.venv-proctor\Scripts\python.exe -B -m proctor_worker --init-key
.\.venv-proctor\Scripts\python.exe -B -m proctor_worker
```

The key in `private/proctor-worker.key` is generated once and read by both services. Keep it on the backend host. The worker has no browser CORS configuration, rejects Origin-bearing requests and requires the key for both endpoints. Use one worker process and one backend process for local testing. The existing temporal state is process-local. Multi-worker deployment requires attempt affinity or shared temporal state and separate capacity testing.

## Recreate the two isolated interpreters

MediaPipe 1.2.0 declares opencv-contrib-python. Ultralytics 8.4.198 declares opencv-python. Both distributions own the cv2 binary. The worker therefore runs the unmodified YOLO package in one persistent child process. It communicates only through its parent's private standard streams. Each interpreter has one OpenCV distribution. Start these commands in `backend` using the existing Windows Python 3.12 installation.

```powershell
py -3.12 -m venv .venv-proctor
.\.venv-proctor\Scripts\python.exe -m pip install -r proctor_worker/requirements.txt
.\.venv-proctor\Scripts\python.exe -m pip check
py -3.12 -m venv proctor_worker/yolo_runtime/.venv
.\proctor_worker\yolo_runtime\.venv\Scripts\python.exe -m pip install -r proctor_worker/yolo_runtime/requirements.txt
.\proctor_worker\yolo_runtime\.venv\Scripts\python.exe -m pip check
```

The worker uses the original `models/proctoring/multitier/yolo26_results/yolo26n_7cls/weights/best.pt`. YOLO loads and warms once at startup. The second model, `models/proctoring/multitier/face_landmarker.task`, is the official float16 version 1 file. Verify SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` when provisioning it. Startup uses local assets and runs inference on CPU. [Face Landmarker asset](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task)

## API and scheduling

Send `X-Proctor-Worker-Key` on `GET /health` and `POST /infer?module=object_detection|gaze|both`. Send raw image bytes with the matching JPEG or PNG content type. The worker caps inputs at 1 MiB and two million pixels and rejects concurrent inference with HTTP 429. An OK object response includes class ID, name, confidence and normalized xyxy boxes. An OK gaze response distinguishes a missing face from a missing runtime. Timings are elapsed milliseconds. The worker never stores frames.

The browser reuses the exam video. Its sampler is single-flight. The backend requests YOLO at most every 250 ms and gaze at most every 100 ms. Request, inference and persistence latency can reduce achieved rates. The backend returns an acknowledgement to the student. A failure updates the existing module-health channel, resets broken continuity and generates no positive prediction. Restart the worker after a child exit or initialization failure.

The main backend defaults to monitoring off. Set `PROCTOR_MODEL_ENABLED=true` in an appropriate deployment and leave `PROCTOR_MODELS` unset to use the local profiles. Existing explicit custom profiles retain precedence. Neither camera capture nor the inference key belongs in a frontend environment variable.

### Temporary live-frame diagnostics

Set `PROCTOR_DIAGNOSTICS=true` in the backend environment and restart the backend. Also set `$env:PROCTOR_DIAGNOSTICS='true'` before starting the worker in PowerShell, then reload the Student exam page. The worker reads its process environment, not `backend/.env`. Disable the flag in both processes after verification.

Backend/worker `proctor_pipeline` logs contain ephemeral frame correlation IDs, stage names, module statuses, counts, frame dimensions/byte counts and timings. The Student console uses `[proctor-input]`; detailed frame logs are enabled by the authenticated capabilities response. Warnings for capability failures, disabled models and unavailable frames are deduplicated even when diagnostics are off. Logs exclude images, tokens, worker keys, student/attempt identifiers and pose measurements. Existing, separately controlled gaze calibration logging is unchanged.

Follow `capabilities → frame_send → frame_received → worker_request → worker_infer → worker_response → worker_observation → temporal_policy → event_persistence → frame_committed → websocket_delivery → frame_ack`. A `temporal_reset` with `observation_gap` explains why slow inference/network traffic broke continuity. CPU load can delay either alert; the continuity limits remain in force. `websocket_delivery` reports target and successful-send counts, not recipient identifiers. PostgreSQL notifications reach this stage through the existing committed LISTEN/NOTIFY channel.

The November live-input fix replaces undefined settings references in both capabilities and frame acknowledgement. It also retries `CAMERA_SESSION_REQUIRED` during session startup; inactive/forbidden attempts still stop sampling. No detector thresholds or model assets changed. See `docs/proctoring-live-alerts-fix.md` at the repository root for verification scope and the physical-webcam retest.

## Review policy

The isolated YOLO/MediaPipe Worker reports **raw class/confidence and gaze measurements**, **not HIGH/MEDIUM/LOW**.
The trusted Backend assigns severity through `app/proctoring/local_policy.py` and verifies it again when storing each event. The Worker demo's red "NGUY HIỂM CAO" is a standalone HUD decision, not a field in the worker HTTP protocol.

| Actual Worker observation | Backend event | Review severity (provisional demonstration policy) |
| --- | --- | --- |
| `cell phone` | `object_phone` | MEDIUM at 25–59% confidence; HIGH from 60%, observed ≥450 ms |
| `book` | `object_book` | MEDIUM at 25–59%; HIGH from 60%, observed ≥450 ms |
| `smartwatch` | `object_prohibited` | MEDIUM at 25–69%; HIGH from 70%, observed ≥450 ms |
| `headphone` | `object_headphone` | MEDIUM at 25–79%; HIGH from 80%, observed ≥900 ms; **class has weak validation performance** |
| two or more detected `person` boxes | `person_in_background` | MEDIUM when second confidence is 25–69%; HIGH from 70%, observed ≥600 ms |
| `KHONG_THAY_MAT` | `face_not_detected` | LOW after ≥2 seconds continuous absence |
| `LIEC_SANG_TRAI`, `LIEC_SANG_PHAI` | `gaze_away` | HIGH after ≥2 seconds continuous off-screen gaze |
| `QUAY_SANG_TRAI`, `QUAY_SANG_PHAI`, `CUI_XUONG_BAN`, `NGUA_LEN_TREN` | `head_turned` | HIGH after ≥2 seconds continuous head deviation |
| `BINH_THUONG` | No event | No alert |
| `laptop`, `tv` | Not configured | No automatic prohibition without an exam-specific rule |

The max observation gap is 900ms for objects and 600ms for gaze; the default event cooldown is 15 seconds, followed by the database's existing deduplication. A later stronger observation can raise an already aggregated MEDIUM event to HIGH, updating its teacher-visible priority; it never lowers an earlier priority.

**Safety and validity:** These confidence tiers are explicit *demonstration/review* settings, NOT empirically optimized thresholds. Gaze yaw/pitch/iris thresholds follow the research prototype but have not passed validation on a labeled set of real student webcam sequences. Brief glances, face occlusion, glasses, lighting, multiple people in posters or screens, and headphones can cause false positives; each alert is evidence for teacher review, not a cheating conclusion. No event automatically reduces grades, invalidates identity, or terminates an attempt. Calibrate class-specific thresholds with held-out data before using HIGH for disciplinary decisions.

To enable both local profiles, run the isolated Worker and Backend with `PROCTOR_MODEL_ENABLED=true`. Leave `PROCTOR_MODELS` unset so the default profiles are used; any explicit JSON override must be revised separately. Restart the Backend after changing the default policy; historical `DetectionEvent.severity` values are not rewritten automatically.

## Pose and calibration

The supplied six-point solvePnP estimate included a neutral half-turn between its y-up face template and the OpenCV y-down camera. Applying its thresholds directly to that absolute Euler pitch produced -165.49 degrees on the public portrait. The adapted tracker uses MediaPipe's full-face canonical-to-camera transform. It converts both bases with diag(1, -1, -1), removes scale and extracts Z-Y-X Euler angles. Neutral is identity. Yaw spans -90 to +90 degrees, positive toward the subject's right on an unmirrored feed. Pitch and roll span -180 to +180 degrees, with positive pitch up and positive roll clockwise in the image. Pose singularities near 90-degree yaw and individual neutral offsets still need labeled recordings. [MediaPipe face geometry](https://github.com/google-ai-edge/mediapipe/wiki/MediaPipe-Face-Mesh)

Raw gaze ratio uses the supplied two-eye iris-distance method. Reference thresholds remain yaw ±18 degrees, pitch -14/+18 degrees and gaze ratio 0.37/0.63. The backend smooths all four measurements per attempt with a 200 ms time constant. Missing faces or excessive gaps reset smoothing. The live profile recognizes gaze/head direction after the two-second review threshold; accuracy remains uncalibrated and all decisions require human review.

### Live Student-camera calibration preparation

The image CLI is useful for asset diagnostics, but it does not measure the Student webcam. For a live DEV calibration, the existing authenticated Student camera sampler can send frames to `local_gaze`; the backend logs measurements only and never writes frame bytes or images. With the opt-in flag enabled, the active Student attempt also shows a DEV calibration panel. It displays live worker measurements and raw direction, lets the operator collect five-second pose samples, reports descriptive statistics, and exports numerical samples as JSON. The panel holds data in page memory only; clear or close the page to discard it. The data contains no frames or face images. Set this before starting/restarting the main backend:

```powershell
$env:PROCTOR_GAZE_CALIBRATION='true'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

Keep `ENVIRONMENT=development` and `PROCTOR_MODEL_ENABLED=true` in `backend/.env`, use an exam with its existing camera session enabled, and open the active Student attempt. Select one of the seven poses and click `Record 5s`; repeat each pose at least three times, returning to `LOOK_FORWARD` between poses. Keep the face centered, hold a steady distance and lighting, and move eyes without turning the head for the eye poses. The initial second is settling time. Frames without a face and samples with invalid values or large angle jumps are discarded. Review accepted and discarded counts before exporting. The panel and backend logs contain numerical readings only. Disable afterward with `$env:PROCTOR_GAZE_CALIBRATION='false'` and restart the backend. This is measurement collection only; directional alerts remain disabled. Do not use prerecorded frames as evidence of browser-camera calibration.

## Verification on 2 November 2026

- Worker, private YOLO interpreter and main backend passed pip check. The full main-backend distribution/version fingerprint matched before and after installation.
- Grace Hopper portrait, full source resolution: yaw -0.17, pitch -6.06, roll -3.10 degrees, gaze ratio 0.510, BINH_THUONG. Six known rotations passed convention checks. This is a sanity check. Directional accuracy is uncalibrated.
- Fifteen warm 640×640 JPEG calls on the supplied validation montage averaged 197.3 ms for the YOLO child round trip, median 180.9 ms, nearest-rank p95 408.3 ms. One student workload only.
- The opt-in Chrome test exercised the production useExamMedia and useProctorInput hooks on an already active QA attempt using a prerecorded validation image as the camera. The signed-in teacher saw a real object_phone event on the actual dashboard after two observations. PostgreSQL persistence, WebSocket delivery, notification, bounding boxes, authorization, review, submission and the report screen passed. No physical webcam or identity-entry replay was used.
- One real missing-face frame followed by a portrait produced no alert. Sustained absence produced face_not_detected. A disconnected bridge returned UNAVAILABLE for both modules with zero events.
- The backend suites cover thresholds, cooldown, simulator guards, reporting and unchanged Face Verification. The production frontend built all 42 static pages. This worker is integrated but uncalibrated.

## Repeating the browser check

Use the existing isolated release QA database and frontend (localhost:3100) with the QA API on localhost:8001, `PROCTOR_MODEL_ENABLED=true`, and the worker running. Generate a fresh attempt with the existing guarded `scripts/proctoring_e2e_fixture.py` through `scripts/release_qa_runtime.py run`. The test requires a new attempt and submits it. All recording inputs are existing public QA assets.

Set `PROCTOR_WORKER_QA_BUNDLE` to a temporary JS bundle of `tests/fixtures/proctor-worker-camera.tsx`. Bundle with esbuild using the root tsconfig, defining `process.env.NEXT_PUBLIC_API_URL` as the JSON string `"http://localhost:8001"` and `process.env.NODE_ENV` as `"production"`. Set `PROCTOR_WORKER_QA_CAMERA` to a 640×640 YUV4MPEG2 (I420) replay of `val_batch0_labels.jpg`. Set `PROCTOR_WORKER_QA=1`, `PLAYWRIGHT_BASE_URL=http://localhost:3100`, `PLAYWRIGHT_CHANNEL=chrome`, then run `npx playwright test tests/e2e/proctor-worker-real.spec.ts --workers=1` from the repository root. The capture page tests the post-entry camera hooks without modifying student identity records.
