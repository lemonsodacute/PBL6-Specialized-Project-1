# PROCTOR MODEL VALIDATION & CALIBRATION

## Isolated worker follow-up

The local worker now runs both detectors outside the main backend. The dependency conflict below describes the earlier single-environment trial. See the [worker runbook](../backend/proctor_worker/README.md) for the current setup, policy and calibration limits.

## 2 November 2026 single-environment validation

**DEPENDENCY_CONFLICT.** The supplied multitier package is present. The deployed model flag is off and no local model provider is configured.

- The existing backend uses Windows x64 and Python 3.12.10. Ultralytics 8.4.198 loaded the supplied best.pt as a CPU DetectionModel. The ordered classes are person, book, cell phone, laptop, tv, headphone and smartwatch.
- With a 640-pixel input, confidence 0.25 and IoU 0.45, the annotated val_batch0_labels.jpg montage yielded one person, one cell phone and two smartwatches. The first prediction took 6435 ms and the median of six warm predictions was 195 ms including image loading. This measures standalone latency on one image.
- ONNX Runtime 1.31.1 loaded best.onnx with CPUExecutionProvider during temporary inspection. The float32 input images has shape [1, 3, 640, 640] and float32 output0 has shape [1, 11, 8400].
- The backend already contains opencv-python 5.0.0.93 and opencv-python-headless 4.14.0.94. Both own cv2/cv2.pyd. The imported binary reports 5.0.0. MediaPipe 1.2.0 resolves to a third overlapping wheel, opencv-contrib-python 5.0.0.93. MediaPipe 0.10.30 and 0.10.31 avoid this overlay but their Windows wheels declare cp39-cp39-linux_x86_64 internally. Installing 0.10.31 caused pip check to fail. The resolver rejected the older candidates under the current NumPy 2.5.3 and OpenCV constraints.
- During the temporary 0.10.31 trial, GazeAndHeadTracker.analyze_frame accepted a BGR frame from Matplotlib's existing grace_hopper.jpg and returned landmarks, pose, gaze ratio and status. The Tasks Face Landmarker used the official float16 version 1 asset (SHA-256 64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff). The warm median was 21.4 ms across six frames. The supplied classifier labeled this portrait CUI_XUONG_BAN at pitch -165.49 degrees. Direction and temporal accuracy require labeled sequences.
- The failed MediaPipe trial and its three new dependencies were removed. Final pip check passed with all pre-existing package versions preserved. The demo and tracker are outside the production path. Real browser-to-teacher integration, gaze smoothing, event scenario calibration and live frame rates remain unverified.

## Historical audit from 26 October 2026

Audit date: **26 October 2026**, Asia/Saigon.

Current integration status: **MODEL_PACKAGE_INCOMPLETE**. The requested model directory does not exist in the current workspace.

Follow-up package audit: the supplied `MODEL_DIR`, `D:\ChauAnh\PBL6 new\backend\models\proctoring\`, was checked directly on 26 October 2026. Both path-existence and directory checks returned false; `backend/models` currently contains only `face` and `ocr`. There are no delivered proctor weights, inference entry point, label/preprocessing/output definitions, calibration policy or labeled samples at that location. Standalone load/inference and model integration were therefore stopped before modifying application code. Model monitoring remains disabled.

The request describes an already integrated trained model, but the current workspace and backend configuration do not contain one. The existing adapter, normalized event, review, realtime and reporting infrastructure must not be mistaken for a trained detector. No model accuracy or inference benchmark can be inferred from its regression tests.

## Actual model and runtime audit

| Item | Observed result |
| --- | --- |
| Requested model package | INCOMPLETE: `MODEL_DIR` not found |
| Proctor model / framework / version | NOT PROVIDED |
| Trained proctor weights or inference entry point | NOT FOUND |
| Real raw labels / supported model events | NOT PROVIDED; none enabled |
| Preprocessing and confidence output contract | NOT PROVIDED |
| Calibration and held-out labeled samples | 0 supplied |
| `PROCTOR_MODEL_ENABLED` | `false` |
| Configured providers | 0 |
| Registered local adapter factories | 0 |
| Active frame adapters | 0 |
| Running backend health API | 0 modules; simulator disabled |
| DEV simulator enabled in application configuration | `false`; preserved |
| Model health | DISABLED |
| Identity threshold | `0.363`; unchanged |

The scan included ignored/private workspace directories and excluded dependency environments and generated package code. The four existing weight files are YuNet/SFace under `backend/models/face` and PaddleOCR detector/recognizer parameters under `backend/models/ocr`. They belong to identity verification and Student Card OCR. They were not reused as proctoring detectors or benchmark inputs. No real proctor label map, inference service configuration or model evaluation dataset was found.

The generic adapter contract and disabled configuration template remain in [proctor-model-integration.md](proctor-model-integration.md). Browser telemetry and `TEST_SIMULATOR` remain separate sources; neither establishes real computer-vision accuracy.

## Measured results and missing measurements

| Requested measurement | Result |
| --- | --- |
| Model load / preprocessing / inference | NOT RUN: trained model unavailable |
| TP / FP / FN / TN | NOT MEASURED |
| Precision / recall / F1 / false-positive rate | NOT MEASURED |
| Model load time | NOT MEASURED |
| Average / p50 / p95 / p99 inference latency | NOT MEASURED |
| Effective inference FPS | NOT MEASURED |
| Inference CPU / RAM / GPU usage | NOT MEASURED |
| 1 / 2 / 4 / 8-stream inference capacity | NOT TESTED |
| Comparison of inference sampling rates | NOT TESTED |
| Real-model end-to-end alert delay | NOT MEASURED |
| Real-model evidence and exam-report integration | NOT TESTED |

These are unavailable measurements, not zero errors or zero latency. No confidence distribution, quality metric, detection-delay target or production capacity is invented. There is no real-model end-to-end pass claim.

Host inventory only: **Intel Core i5-12450H, 8 physical cores / 12 logical processors, 8,280,305,664 bytes reported physical RAM (about 7.71 GiB)**. This inventory is not an inference resource measurement. CPU/GPU compatibility cannot be established without the delivered model/runtime.

## Calibration table

| Actual connected event | Confidence threshold | Minimum duration | Maximum gap | Cooldown | Sampling rate | Readiness |
| --- | --- | --- | --- | --- | --- | --- |
| No connected model/event | NOT CONFIGURED | NOT CONFIGURED | NOT CONFIGURED | NOT CONFIGURED | NOT CONFIGURED | DISABLED |

No event-specific numeric policy was changed. The request's example labels and candidate values are not a model label list or evidence of calibration. An absent model cannot be classified as `INTEGRATED_BUT_UNCALIBRATED`, `READY_FOR_DEMO` or `READY_FOR_LIMITED_USE`.

## Repeatable evaluation protocol awaiting artifacts

The following is a test plan, **not executed model evidence**. Before execution, obtain the actual versioned weights/runtime, preprocessing, raw labels, confidence meaning and a permitted labeled dataset. Keep calibration and final evaluation samples separate by participant/session; record the exact split, sample counts and event-matching rules before selecting policy values. Do not use private Student Card/identity images as proctoring samples.

| Scenario family | Required observations | Execution |
| --- | --- | --- |
| Normal baseline | One participant facing the camera, ordinary study movements, no target behavior | BLOCKED: no model or labeled clips |
| Negative behavior | Brief glance, blinking, keyboard reading, small head/chair movement, hand near face, background motion | BLOCKED |
| Sustained positive behavior | Each actual supported event, including a 10–20-second episode and return to normal | BLOCKED; supported labels unknown |
| Repeated episode | Positive → normal → positive, preserving raw timestamps and existing aggregation results | BLOCKED |
| Lighting | Bright, normal, low light, backlight and screen-only illumination | BLOCKED |
| Camera quality / position | 720p/480p, blur, compression, angle, face near border, partial view and distance | BLOCKED |
| Multiple-person / object confounders | Only for supported labels: brief/sustained second face, printed/displayed faces, posters, phone/tablet/calculator | BLOCKED |
| Multiple students / attempts | Correct event, evidence and temporal-state isolation; no cross-attempt reuse | Real-model validation BLOCKED |
| Start / submit / disconnect | Start only for an active session; bounded work; reconnect without stale frames; release on submit | Real-model validation BLOCKED |
| Model failure | Missing weights/dependency, failed load, invalid output, exception and timeout | Real-model fault injection BLOCKED |

For supplied confidence distributions, compare candidate thresholds per actual event and record TP/FP/FN and detection delay for each. Compare temporal windows and sampling rates using the same versioned inputs. Keep discarded/false-positive/false-negative results in the evaluation artifacts; do not delete inconvenient samples. Do not assign arbitrary global thresholds, minimum durations or a relaxed demo policy.

Once ground truth and incident-matching criteria exist, calculate precision `TP/(TP+FP)`, recall `TP/(TP+FN)`, F1 and, when meaningful negative units are defined, `FP/(FP+TN)`. Report undefined denominators and insufficient samples explicitly. Use the held-out set for the readiness decision after calibration.

For performance, separate cold model load, warm inference and the full alert pipeline. Record actual sample counts, warmup, resolution, device, concurrency, effective cadence, raw timing samples and resource measurements. For real alert delay, record detection, backend receipt/commit, Teacher WebSocket receipt and UI render timestamps; do not count configured temporal duration as inference latency.

## Existing-system regression verification

Tests use existing isolated fixtures and synthetic adapter inputs; they validate the application infrastructure, not trained-model quality. No real-model inference is enabled for these checks.

| Scope | Status |
| --- | --- |
| Proctor adapters / alerts / monitoring reports / academic reports/results | PASS in the combined backend batch |
| Exam state / question selection | PASS in the combined backend batch |
| Face / identity regressions | PASS with two explicit opt-in cases skipped |
| Combined backend batch | 204 run: 202 PASS, 2 SKIP, no failures/errors; 60.756 seconds |
| Monitoring/report/exam browser regressions | 63 PASS in 1.7 minutes |
| Production build | PASS; isolated build output, existing lint warnings remain |
| Application historical-data and identity preservation | PASS after all verification |

The first backend regression run found six errors in `test_student_identity_profile.py`: its SQLite notification fixture omitted the nullable foreign-key target `detection_events`. The fixture now creates the same minimal ID-only target as its existing exam/attempt stubs, with foreign-key enforcement retained. No production table, model logic, identity service or recognition threshold was changed. The full selected 204-case batch was rerun after this fixture correction and passed with two skips: the opt-in private card-image/model regression (`STUDENT_CARD_TEST_IMAGE`) and the isolated PostgreSQL identity migration round trip (`IDENTITY_TEST_POSTGRES`). No private identity image was supplied or reused for proctor evaluation.

The 63 frontend cases cover exam media lifecycle, autosave/submit/error handling, timers, terminal/retry/multiple-attempt state, student/exam isolation, monitor collection, live timeline/camera controls, academic Reports and the exact monitoring-report route in light/dark at 390/768/1440px. They use explicit UI/network fixtures, not a trained vision model.

| Workflow property | Existing infrastructure | Real-model validation |
| --- | --- | --- |
| Dedup / cooldown | PASS with synthetic calibrated adapter/event fixtures | NOT TESTED |
| Student / attempt isolation | PASS | NOT TESTED |
| Protected evidence and no-image handling | PASS for existing evidence paths | NOT TESTED |
| Teacher review / audit / persistence | PASS | NOT TESTED |
| Exam monitoring report / route | PASS | NOT TESTED with real inference |
| Failure / timeout / disabled-model isolation | PASS with synthetic adapter fixtures | NOT TESTED against actual model |

Commands, from `backend`, using the existing virtual environment:

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_proctor_alerts tests.test_proctor_adapters tests.test_monitoring_reports tests.test_teacher_reports tests.test_teacher_results tests.test_student_exam_state tests.test_question_selection tests.test_face_recognition tests.test_face_embeddings tests.test_face_phase2 tests.test_identity tests.test_student_identity_profile tests.test_identity_migrations
```

Frontend command, from the repository root with the production app running:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://localhost:3000'
$env:PLAYWRIGHT_CHANNEL='chrome'
npx playwright test tests/e2e/monitor-ui.spec.ts tests/e2e/monitor-collection.spec.ts tests/e2e/monitoring-report.spec.ts tests/e2e/teacher-reports.spec.ts tests/e2e/exam-experience.spec.ts tests/e2e/student-exam-status.spec.ts
```

The production build used `AI_PROCTO_DIST_DIR=.next-perf-model-evaluation` and `npm run build`. That output is already Git-ignored. Original `next-env.d.ts` and `tsconfig.json` contents were restored byte-for-byte after Next's generated type-configuration updates, verified against their pre-build hashes. The serving production bundles were not replaced.

The running backend's authorized exam-health endpoint also confirmed zero configured modules and a disabled simulator. Final fingerprints matched for all application users, attempts, original browser logs, normalized alerts and audit logs. Both YuNet/SFace weights and the `0.363` threshold matched the captured baseline. No new production alert or review decision was created by evaluation.

Local evidence under the Git-ignored `artifacts/proctor-model-evaluation/`:

- `audit-summary.json`: actual model/configuration inventory, unmeasured metrics and preservation results.
- `backend-regressions-final.log`: the complete 204-case backend result.
- `browser-regressions.log` and `browser-results/`: 63 frontend cases and screenshots.
- `build.log`: successful production build and existing warnings.
- `diff-check.log`: whitespace verification.

Snapshot hashes for the preservation comparison are private and contain no exported student data.

## Files changed

- `docs/proctor-model-evaluation.md`: audit, readiness, blocked real-model measurements, evaluation protocol and actual regression evidence.
- `docs/proctor-model-integration.md`: links to the current audit/readiness report.
- `backend/tests/test_student_identity_profile.py`: adds the missing ID-only proctor-event FK target to its isolated SQLite notification fixture. Production identity/model code is unchanged.

## Readiness and required handoff

- Supported-event readiness: **DISABLED; no trained provider configured**.
- Overall integration status: **MODEL_PACKAGE_INCOMPLETE**, because the requested directory, real weights/runtime, supported labels and reproducible inference package are missing. Calibration data and real inference measurements also remain unavailable.
- New production fake events: **NONE**. No simulator fallback was enabled.
- Changes in this task are evaluation documentation and the SQLite regression fixture only. No calibration value, model configuration, Face Verification, scoring, OCR, AI Support, Online Classroom or recording behavior is changed.

To continue, supply the model/runtime location or actual private inference service contract, architecture/framework/version, dependencies/device requirements, preprocessing and confidence schema, raw labels, available team calibration/evaluation results, and permitted labeled positive/negative clips. Integrate that delivered runtime through the existing adapter, then execute the matrix and measurements above before assigning per-event readiness.
