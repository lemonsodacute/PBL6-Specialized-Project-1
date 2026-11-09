# PBL6 — Repeated AI detection incident handling

## Why repeated phone use previously appeared undetected

The browser warning UI used a blanket **120-second suppression for each event type** after acknowledgement. The server also merged model events in a 15-second window. A new phone detection was therefore persisted or aggregated but did not reopen the student's warning, and the teacher feed could keep showing the timestamp of the original occurrence.

This patch fixes both the **UI suppression** and the **server's episode tracking**. It does not claim to improve YOLO's intrinsic accuracy or make the model a cheating verdict.

## New state machine (local YOLO)

- Only detections above the existing worker confidence floor (0.25) enter the temporal state machine.
- Each object class needs its existing minimum observation duration (450 ms for phone/book/watch; other classes follow their configured policies) before its first event.
- A single intermittent missing/weak frame **does not** end an incident. Default local object policy requires **500 ms of clean observations** to separate episodes.
- A visible, stationary phone generates **one incident**, even after 15 seconds. Increasing confidence can upgrade MEDIUM → HIGH without creating another incident.
- Once the phone disappears for at least 500 ms and then is continuously detected for the configured duration again, the worker/adapter emits a **new incident ID**.
- The Backend merges nearby incidents into a single open review row, but increments `occurrence_count` for each **distinct** incident ID. When the previous row has already been reviewed or dismissed, a fresh review row is created rather than swallowing the new event.
- Backend student and teacher APIs compute `type_occurrence_count` over **all records within the same attempt and event type** (independent of pagination, review status, and the 15-second aggregation window).
- Student popup acknowledgement is scoped to the **row ID + row occurrence count**. It stays closed on repeated polling and F5; a *newly recorded incident* (even the same event type) reopens it and shows the cumulative count. This reverses the former 120-second blanket suppression.
- Teacher feed sorts by `last_seen` and displays the per-type cumulative incident count.

No raw images/audio are stored for this counting logic. The incident ID is created in the trusted backend's temporal adapter, not accepted from the student browser. Normalized model events remain subject to the existing active-attempt, policy, confidence, rate, and idempotency checks.

## Testing

```powershell
cd "D:\ChauAnh\PBL6 new\backend"
python -m pytest tests/test_local_worker_policy.py tests/test_live_proctor_pipeline.py tests/test_proctor_alerts.py -q
cd ..
npx tsc --noEmit
npx playwright test tests/e2e/exam-experience.spec.ts
```

Test scenario (with a fresh active QA attempt and required models running):

1. Show a phone for about 1–2 seconds (longer on a slow CPU). Student sees the initial popup and teacher sees **1 lần ghi nhận**.
2. Acknowledge the student popup. Keep the phone in view for >15 seconds. No new incident should be counted for the same continuous presence.
3. Remove the phone fully for >500 ms of **actually processed** clean camera frames, then reintroduce it long enough to pass detection duration. Student should see the popup again with **2 lần ghi nhận**, teacher shows the same total.
4. Acknowledge and refresh. The same second incident should not reopen. A third separate reappearance should show **3 lần ghi nhận**.
5. Teacher dismisses one incident; a later reappearance must produce a new reviewable event.
6. Inspect the logs with `PROCTOR_DIAGNOSTICS=true` to identify camera frame gaps, worker unavailability, and processing cadence if the model still misses a phone.

## Limitations

The worker uses model confidence 0.25, 640px CPU inference and a configured frame rate/cadence; CPU backlog, shadows, camera placement, occlusion, image quality and YOLO class recall still affect detection. This patch does **not** lower confidence thresholds blindly or assert improved model precision/recall without labeled webcam evaluation. The 500-ms reset is a demonstrative anti-flicker setting, not a calibrated universal threshold. No automatic grade deduction, punishment, or termination is introduced.
