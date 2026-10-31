# Final exam entry identity gate

The previous start endpoint accepted the latest generic verification for 15 minutes and returned an existing in-progress attempt before checking identity. The verification page also created a timed attempt before the final device dialog. A different person could therefore sit down during that dialog and enter using the earlier success.

The entry sequence is now device check → initial face verification → final device confirmation → a fresh live camera frame → final verification → attempt start. Camera/microphone selectors, preview, permission feedback, and the microphone meter use the existing device UI. The confirmed stream transfers once, in memory, to the same attempt route; unused transfers stop after 10 seconds or page exit. Reloading an active attempt requires a new recheck before dismissing its device dialog. Existing deadlines are preserved when resuming.

## Server authorization

- `POST /identity/exams/{exam_id}/verify-entry` runs the existing YuNet/SFace extraction and comparison against the current card template. The threshold configuration remains **0.363**; FaceEngine and model files are unchanged.
- Existing `IdentityVerification` rows carry a server-written `exam_entry` purpose, profile version, server receipt timestamp, frame hash, and consumption timestamp in their existing JSON metadata. No migration, column, storage key, or environment variable is added.
- Generic `/verify` successes remain useful for the initial verification display and never authorize attempt start.
- `POST /attempts` and its `/start` alias require `entry_verification_id` for camera exams, including resumed attempts. The record must belong to the authenticated student and exam, match the current active reference and profile version, be verified, be unused, and have a frame received within **20 seconds**, checked after acquiring locks.
- Lock order is exam → student → verification. Consumption and attempt creation/resumption commit together. Concurrent consumption of one proof permits exactly one transaction. A resume request can also include `resume_attempt_id`, preventing an expired or changed attempt from silently creating a new one.
- A new final check supersedes earlier final proofs. A byte-identical previously verified frame is rejected. Raw final images are not stored or logged.
- Face mismatch, missing face, multiple faces, missing proof, expired proof, stale reference, model failure, and replay block entry. The initial failure creates no attempt or exam deadline. Retry captures another frame; it does not reuse the preview image.
- Exams without a camera retain their existing entry behavior. Scoring, question ordering, submission, and automatic deadline handling are unchanged. No periodic identity sampling or automatic identity punishment is added.

## Validation

- Backend: **115 passed, 1 skipped** across `test_exam_entry`, `test_identity`, `test_face_recognition`, `test_face_embeddings`, and `test_student_exam_state` (116 discovered). The skipped test requires an explicitly supplied private card image.
- The new gate suite includes HTTP/DB tests for the A→B swap, correct-student entry, old generic proof, direct API/alias bypass, wrong student/exam/reference/profile, expired/future/consumed proof, missing/multiple faces, model failure, reused frame, changed reference during inference, resume, and camera-free exams.
- A PostgreSQL concurrency test **ran and passed**, using a uniquely named disposable database. The application's database was not migrated or used for its fixture writes.
- Browser: **30 passed**: 6 new entry tests plus 24 existing exam experience tests. The new tests decode the uploaded synthetic live-camera pixels, verify that final images differ from the initial snapshot, exercise failure/retry and repeat-click blocking, and confirm that the stream survives valid entry.
- TypeScript and production build passed. Existing unrelated React Hook/image warnings remain in the repository.
- Logs: `artifacts/exam-entry-identity/`.

The A/B authorization tests use controlled embeddings and synthetic browser camera frames. They do not establish biometric accuracy with two real people. That physical A/B acceptance check has **not** been performed. Existing liveness behavior remains unchanged (`liveness_checked: false`); client-side fresh capture and server frame replay detection do not attest camera hardware provenance or provide photo/video anti-spoofing.

## Files changed

- `app/student/exams/[examId]/verify/page.tsx`
- `app/student/attempts/[id]/page.tsx`
- `backend/app/api/v1/identity.py`
- `backend/app/api/v1/attempts.py`
- `backend/app/schemas/attempts.py`
- `backend/app/services/exam_entry.py`
- `components/identity/captureLiveFrame.ts`
- `components/proctoring/ExamDeviceSetup.tsx`
- `components/proctoring/useExamMedia.ts`
- `components/proctoring/examMediaTransfer.ts`
- `lib/api.ts`
- `lib/identity.ts`
- `backend/tests/test_exam_entry.py`
- `backend/tests/test_identity.py`
- `tests/e2e/exam-entry-identity.spec.ts`
- `tests/e2e/exam-experience.spec.ts`
- `docs/exam-entry-identity-gate.md`
