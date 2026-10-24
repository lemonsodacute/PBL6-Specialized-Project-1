# Connecting a trained in-exam monitoring model

The teacher UI consumes normalized alerts, never a particular model’s predictions. Add the delivered runtime/model files, an adapter, label mapping and calibrated server configuration. Keep the existing Face Verification package and its `0.363` identity threshold separate.

## 1. Adapter boundary

`backend/app/proctoring/adapters.py` defines:

```python
class ProctorModelAdapter(Protocol):
    async def start(self, context: AdapterContext) -> None: ...
    async def process_frame(self, frame: MonitoringFrame) -> Sequence[RawPrediction]: ...
    async def stop(self) -> None: ...
```

`AdapterContext` contains exam/attempt/student UUIDs for backend context. `MonitoringFrame` contains encoded image bytes, MIME type and a backend capture timestamp. Do not persist or log these bytes. `start` loads resources; `stop` must release clients/model resources even after a partial start. CPU/GPU blocking work must run outside the asyncio event loop (a worker/thread/process as appropriate) and obey cancellation/timeout boundaries.

Return **actual** `RawPrediction` objects: `label`, `active`, real nullable `confidence`, timezone-aware `occurred_at`, optional safe metadata and evidence summary. Missing labels/negative predictions reset temporal continuity. Do not return a positive prediction because the model failed. Exceptions lead to safe health degradation and no detection.

Register a local adapter from application-owned startup code, for example importing a registration module from `app/proctoring/__init__.py`:

```python
from app.proctoring.adapters import register_model
from .team_gaze import TeamGazeAdapter

register_model('team_gaze', lambda config: TeamGazeAdapter(config))
```

The referenced adapter must wrap the supplied real runtime; it is not provided/faked by this infrastructure. Registration accepts code only at startup, never uploaded code or request-controlled import paths. Use a lowercase provider name matching `[a-z][a-z0-9_-]{0,63}`; `legacy`, `browser_signals` and `test_simulator` are reserved. Restart every worker after registration/configuration changes.

## 2. Normalized contract

`backend/app/proctoring/contracts.py::NormalizedProctorEvent` is the authoritative Pydantic contract. On ingestion `id`, received/review fields, aggregation and simulation state are assigned by the server.

| Input field | Rules |
| --- | --- |
| `external_id` | UUID for a meaningful emission; reuse exactly on retry |
| `provider` | Registered/configured lowercase module identifier |
| `exam_id`, `attempt_id`, `student_id` | UUIDs must match an active attempt and actual student |
| `source` | Configured uppercase extensible string, e.g. `GAZE`, `FACE`, `MULTI_PERSON`, `HEAD_POSE`, `AUDIO`, `BODY`, `OTHER` |
| `event_type` | Validated lowercase descriptive string, e.g. `multiple_faces`, `gaze_away`, `face_not_detected`, `head_turned`, `person_left_frame`, `object_phone` |
| `severity` | `info`, `low`, `medium`, `high`, `critical`; must match server policy |
| `confidence` | Actual normalized `[0,1]` value, or `null` |
| `occurred_at` | Timezone-aware timestamp within the active attempt window and bounded clock skew |
| `first_seen`, `last_seen` | Optional aware timestamps; first ≤ occurred ≤ last; support temporal duration |
| `message` | Optional ≤500-character safe description; built-in types have Vietnamese labels |
| `metadata` | Allowlisted summaries only: version, label, inference time, frame count, browser reference fields |
| `evidence` | Optional `{kind:"metadata",timestamp,bounding_boxes}`; at most 20 normalized x1,y1,x2,y2 boxes |

Unknown input fields, non-finite values, invalid confidence, naive/future/stale timestamps, mismatched links, unsupported source/type/severity and arbitrary evidence URLs are rejected. Current intake permits an occurrence at most five minutes old and last observation at most 30 seconds ahead, within the attempt bounds. Keep service clocks synchronized. Reserve `BROWSER`/`TAB_SWITCH` for actual self-reported browser signals and `TEST_SIMULATOR` for the guarded test path. A model cannot choose a human review state.

The storage entity remains `DetectionEvent`. Existing names `confidence_score`/`metadata_json` map to API `confidence`/`metadata`. Event sources/types are strings to support future modules without database enum churn; their enabled values still come from validated server configuration, not arbitrary incoming labels.

## 3. Disabled configuration template

Set backend-only `PROCTOR_MODELS` to a JSON object keyed by provider. This intentionally disabled example is **not calibration**:

```json
{
  "team_gaze": {
    "enabled": false,
    "source": "GAZE",
    "label": "Giám sát hướng nhìn",
    "label_map": {"model_away_label": "gaze_away"},
    "policies": {
      "gaze_away": {
        "minimum_duration_ms": null,
        "maximum_gap_ms": null,
        "cooldown_ms": null,
        "confidence_threshold": null,
        "severity": "low"
      }
    },
    "endpoint": null,
    "frame_interval_ms": null
  }
}
```

Before enabling, the model team must supply minimum continuous duration, permitted observation gap, cooldown, sampling cadence, confidence interpretation and reviewed severity policy. Required temporal `null` values disable emissions. A `null` confidence threshold deliberately means no confidence cutoff; a configured cutoff requires a real confidence value. No UI threshold or guessed production duration exists. After calibration set the module `enabled=true` and global `PROCTOR_MODEL_ENABLED=true`.

Map each delivered raw label to **what happened**. Configure policies only for supported normalized types. Missing/unknown labels never trigger an event. Future types can use a safe model-provided message without changing the feed/review database; add localized labels when desired. Config limits module/label/prediction counts and reserves browser/simulator sources.

## 4. Confidence, severity and temporal behavior

Convert confidence according to the delivered model’s documented output (e.g. a calibrated percentage divided by 100). Do not interpret an arbitrary distance/logit as a probability or fill an absent value. The server validates normalized range and stores the highest actual confidence among merged meaningful emissions; it does not manufacture a certainty score.

The temporal layer maintains continuous observations per event type, requires the calibrated minimum duration, resets on negative/missing/low-confidence predictions or excessive gaps, and emits at the configured cooldown. Server intake independently checks duration/confidence and aggregates same attempt/provider/source/type episodes under an attempt lock. Supply a stable `external_id` on transport retries; assign a new UUID only for a new meaningful emission. Do not send every raw frame as an event.

Severity is a server-reviewed triage mapping. It cannot automatically change scores, terminate attempts or produce a cheating probability. Human `CONFIRMED` is also not an automatic penalty. Adding a trained model must not call the legacy risk/grade/violation-lock services.

## 5. Optional HTTP adapter / external service

An explicitly configured server `endpoint` selects `HTTPModelAdapter` if no local factory exists. It sends in-memory `image_base64`, MIME type and capture time over POST. It does not send student identity, follow redirects, use environment proxy settings or persist images. The response is:

```text
{"predictions":[{"label":"<actual model label>","active":true,
  "confidence":null,"occurred_at":"<aware input timestamp>"}]}
```

Return an empty list for an actual negative observation. Never return sample predictions on failure. Use a private inference network/TLS as appropriate. Endpoint addresses and any custom adapter credentials belong only on the backend. Implement a custom adapter when the inference service needs a particular authentication protocol; do not embed secrets in an endpoint URL. There is no request-controlled endpoint and redirects/userinfo are rejected. Responses are limited to 16 KiB and 32 predictions, and model calls are timed out by `PROCTOR_MODEL_TIMEOUT`.

For a dedicated worker/service that already performs calibrated temporal inference, use `POST /api/v1/proctoring/events` with a unique ≥32-character backend `PROCTOR_INGEST_KEY` in `X-Proctor-Service-Key`. Restrict the route at the network boundary as well. Do not place this key in Next public variables, student code, URLs or logs. Key unset means all ingestion is rejected. In-process adapters call the same domain validation without a network round trip.

For service health send authenticated `POST /api/v1/proctoring/modules/{provider}/heartbeat` with `status=ACTIVE|DEGRADED|UNAVAILABLE` and an optional safe `MODEL_TIMEOUT|MODEL_UNAVAILABLE|INVALID_MODEL_OUTPUT` code. Never include stack traces/model internals. Heartbeat at less than `PROCTOR_MODEL_HEALTH_TIMEOUT_SECONDS`; expired/missing health becomes unavailable. A successful valid inference updates health even when it detects nothing. Technical codes remain admin-only.

## 6. Input and worker deployment

The student hook samples only an already-enabled shared camera after the existing exam gate. No trained/configured module means no frame upload. Backend image limits, one in-flight request, global worker concurrency limits, timeouts and exponential browser backoff protect exam usability. Students get transport acknowledgment only; no event list, confidence or review state is returned.

For local/HTTP frame inference use one frame worker or route each attempt consistently to one worker. Temporal state is in-process; arbitrary routing resets observation continuity. For horizontally distributed deployments, run temporal processing in a dedicated inference service and ingest normalized events. Database aggregation/idempotency, persisted health, human decisions and transaction-backed PostgreSQL WebSocket invalidations already support multiple API workers. Restarted temporal state waits for fresh real observations instead of inventing a prior duration.

## 7. Evidence and security

New adapters are metadata-only: sanitized timestamp, model version/label, real inference timing/frame count and normalized box summary. Images/audio/video, embeddings, arbitrary JSON, public URLs, filesystem paths and raw base64 are not valid event evidence. Do not add snapshots until consent, private storage/access, retention, deletion and backups are defined. The existing exam recording feature and protected legacy media are independent and unchanged.

Never authorize based on student-supplied event severity or ID alone. Active attempt/student/exam linkage, safe timestamps, allowed provider/type/source and calibrated severity are revalidated after processing. Browser signs are low/info self-reports, not authoritative model detections. Teachers only access their existing exam permissions; admins have the established broader access. Review audit stores actor/time/note without raw biometrics. Do not import or alter pre-exam Face Verification services from these adapters.

## 8. Test and disable

Run `tests.test_proctor_adapters` for lifecycle, nullable confidence, continuity/gaps/negative observations, cadence, no-module behavior, timeout/crash/invalid predictions, response bounds, backpressure, stop races and resource cleanup. Add a test for each delivered raw-label mapping, confidence normalization and calibrated temporal boundary using known model fixtures. A transport simulator is not evidence that a model detects cheating accurately.

Run `tests.test_proctor_alerts` for trust, permissions, links/time/confidence, disabled configuration, exact retries, aggregation, review conflicts/audit, notifications, reports, browser separation and score isolation. Use the explicit DEV simulator and live QA suite described in `proctoring-alerts.md` to validate the existing DB/WebSocket/UI workflow without fake production inference. Evaluate model quality separately with the model team’s labeled dataset before enabling it.

To disable one module set `PROCTOR_MODELS.<provider>.enabled=false`; to disable all in-exam models set `PROCTOR_MODEL_ENABLED=false`, then restart workers. Capabilities stop sampling, health reports disabled, trusted intake rejects the disabled provider, and no fallback model or simulated event is generated. Existing alerts/review history remain readable. No grading or Face Verification configuration change is required.
