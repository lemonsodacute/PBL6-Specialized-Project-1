# Student Identity + Face Verification - implementation report

Updated: 2026-10-09 (Asia/Saigon).

## Identity profile

Implemented the approved flow: admin-verified profile -> student-card upload -> local OCR and face validation -> private preview -> student confirmation -> server recheck -> versioned SFace reference -> webcam verification -> exam entry.

`users` now has an admin-owned, unique `student_code`, separate `identity_profile_status` and `student_card_status`, `identity_profile_version`, `identity_verified_at` and `identity_verified_by`. New accounts remain ACTIVE/PENDING/NOT_SUBMITTED. Existing accounts were not automatically verified.

Admin User Management assigns MSSV and explicitly verifies the displayed profile version. Name, MSSV, role or availability changes increment the version, clear verification provenance, invalidate pending previews and active references, and require another card submission. Phone-only changes and no-op edits preserve trust. The same user-row lock serializes these operations with preview creation and confirmation.

Registration rejects authoritative fields. Students cannot edit their name/MSSV through card upload, OCR results or confirmation. Optional OCR class/major never update enrollments or profile information.

## Student-card flow

- `POST /api/v1/identity/student-card/preview` accepts only multipart `image`. Authenticated active students need a VERIFIED profile with authoritative name/MSSV. JPG/PNG MIME and decoded format must agree; existing 8 MB / 16 MP / 160 px limits apply.
- Existing FaceEngine/YuNet validates exactly one face, size, brightness and sharpness. Preview preparation uses the same alignment and quality rules without generating an embedding. Face quality thresholds are unchanged.
- Local OCR returns text/confidence and bounding boxes for lines and words; a separate parser produces labelled name/MSSV and optional class/major. Mismatches and low confidence yield a non-confirmable preview. No editable OCR override exists.
- Preview response includes UUID, expiry, protected card/face URLs, extracted fields, comparison, blocking errors and `can_confirm`, inside the existing `{data, meta}` envelope.
- `POST /api/v1/identity/student-card/confirm` accepts only `{preview_id: UUID}`. It reloads owner/status/TTL/profile version, verifies original image SHA-256 and server parser/model versions, reruns matching and production `FaceEngine.extract_embedding()`, then rechecks current state under the user lock before committing.
- Confirmation atomically supersedes the former reference, writes the existing embedding store, creates a new reference UUID, marks the card VERIFIED and the preview CONFIRMED. A duplicate confirm is rejected with 404; it never creates another active reference. Storage failure rolls back and preserves the old reference and pending preview.
- Replacement uploads preserve the current reference until successful confirmation. A preview expires after ten minutes even if cleanup has not run yet.

Student Profile displays the pending-profile gate, upload/loading, authenticated preview images, read-only OCR fields, matching results, retry, confirm, expiry, success timestamp and replacement action. Confirmation stays disabled when data mismatch, preview images are unavailable, or TTL expires.

## Private storage and retention

Temporary files: `backend/private/identity/previews/{uuidhex}/{original.bin,card.jpg,face.jpg}`. No static/public mount exposes these files; original uploads have no download endpoint. Preview image GET requires the same authenticated owner, current verified profile/version, PENDING state and unexpired TTL. All identity responses use `Cache-Control: no-store`.

The frontend fetches images with its per-tab Authorization header, uses blob URLs and revokes them on replacement, expiry or unmount. No tokens appear in URLs. Explicit Bearer credentials take precedence over shared cookies; invalid headers cannot fall back to another account's cookie. Refresh also prevents account substitution.

Successful confirmation retains only a sanitized face JPEG in the private database, the embedding and version metadata. Temporary card/original/face files are removed after commit. Superseded/invalidated references keep version history without their face bytes. Periodic cleanup every 60 seconds removes terminal/expired preview metadata and files, with orphan retries after TTL. Downtime can delay physical deletion but never extends access TTL. Manual cleanup: `python -m scripts.cleanup_student_card_previews`.

`DELETE /api/v1/identity` removes the current embedding, invalidates references/previews, deletes that student's legacy identity and verification records, then cleans files after commit. It preserves the admin-verified profile.

## OCR

Production backend audit: CPython 3.12.10, Windows AMD64, NumPy 2.5.3, opencv-python-headless 4.14.0.94 and Pillow 12.3.0. These production dependency choices were not replaced for OCR.

PaddleOCR 3.7.0 / PaddleX 3.7.2 was evaluated in `backend/.venv-ocr` because its NumPy <2.4 and opencv-contrib 4.10 requirements conflict with the application environment. PP-OCRv5 mobile detector and Latin recognizer were provisioned from pinned official sources, then tested offline. Both the official Latin archive and the inspected Hugging Face revision lacked Vietnamese vowels including `ọ`, `ễ`, `ệ`; the accented synthetic-name smoke test failed. This is consistent with the upstream [missing Vietnamese characters issue](https://github.com/PaddlePaddle/PaddleOCR/issues/16339). Matching was not weakened to accommodate that failure.

The selected local engine is **Tesseract 5.5.2**, through tesserocr 2.10.0, with official `tessdata_best` **vie+eng** LSTM data. Model revision is `e12c65a915945e4c28e237a9b52bc4a8f39a0cec`; both model SHA-256 values and the Windows CPython 3.12 wheel hash are pinned. Vietnamese model availability is documented by [Tesseract](https://github.com/tesseract-ocr/tessdoc/blob/main/Data-Files.md); its wrapper documents the [Windows build distribution](https://github.com/sirfz/tesserocr#windows).

The isolated worker starts once with FastAPI, caches its native OCR engine, disables adaptive learning, verifies model hashes and blocks Python socket connections. Images travel only through local stdin/stdout; no card upload reaches an external API, cloud OCR or LLM. Installation/model provisioning is an explicit setup command, never a student request. Missing/broken local models fail closed with MODEL_ERROR. Restart the backend after fixing provisioning; requests do not silently install or restart models.

Parser version: `student-card-spatial-v2`. Matching version: `student-card-match-v2`. OCR model ID: `tesseract-5.5.2-vie-eng-e12c65a`.

- MSSV: string trim + uppercase, exact equality, leading zeros preserved. No O/0 or I/1 substitution or fuzzy matching.
- Names: Unicode normalization, casefold, collapsed whitespace, accent-insensitive comparison and Vietnamese đ/d handling. A single edit is allowed only for one long token in a sufficiently long name; token count/order must match and short names remain exact.
- Required fields need confidence >=0.90. Missing or conflicting labelled fields cannot be invented or selected using the expected profile value. Optional fields never decide confirmation.

Labels are matched longest first, including Ngành học and bilingual Số thẻ SV/Student ID. Student-code aliases include MSSV, Mã sinh viên, Mã SV, Số thẻ SV, Số thẻ sinh viên, Student ID/No/Number and exact MS. A code must be a complete ASCII alphanumeric token of 6–32 characters containing a digit; date/year-range forms are rejected. MS cannot match inside another word. Inline values take priority; separate values must lie in a bounded right/below region when boxes exist. Only the next line is considered without geometry. Close conflicting candidates return null. Word confidence isolates the value from the label and the required-field threshold stays 0.90. A missing field emits OCR_FAILED, while an extracted differing code remains visible and emits STUDENT_CODE_MISMATCH.

Parser limitation: explicit labels are still required; unusual, rotated, blurry or complex card layouts may require another image or later parser work. No spelling/accent repair or profile-based code inference is performed. See [the MS parser regression report](STUDENT_CARD_OCR_PARSER_DEBUG.md) for real-image results, geometry limits and local diagnostic commands.

## Face reference

YuNet 2023mar -> SFace 2021dec -> 128D L2-normalized float32 -> cosine. Metadata remains `sface`, `2021dec`, `yunet-sface-v1`, dimension 128. There is no second embedding table.

`student_face_embeddings.reference_version` points to the current card reference UUID. `student_card_references` stores version/profile metadata and the private sanitized face, with one ACTIVE row per student. Prior versions become SUPERSEDED or INVALIDATED. Existing embeddings keep NULL reference versions and remain untrusted. Generic embedding writes clear the trusted reference binding; only the card-confirm transaction activates it.

## Exam verification

Old protocol: webcam compared with three self-enrolled selfie references, using median similarity.

New protocol: webcam embedding compared exactly once with the stored active card embedding, using the configured cosine threshold. Initial template/profile snapshot and final verification commit use short locks; DNN inference runs outside the transaction. A reference/profile change during inference rejects the result. Webcam images are not persisted by the new verify endpoint.

Each new `identity_verifications` record stores its `reference_version`. Exam status and new camera-required attempts accept only the latest successful verification, for the student's current active reference, within 15 minutes. Old NULL-version results cannot authorize attempts. The attempt gate holds the same user lock through creation, preventing a card replacement from racing past authorization. Existing in-progress attempts retain the prior resume policy; non-camera exams retain their existing behavior.

The UI blocks webcam setup until the profile and card reference are ready, links to Hồ sơ, and reports identity verification success. No client storage flag authorizes exam entry.

## Legacy migration

Completed dependency audit: identity API, attempt gate, profile/identity/verify pages, navigation, API client, shared identity helpers and tests.

- `/student/identity` remains as a redirect to `/student/profile`.
- `/api/v1/identity/enroll` and `/check` remain registered, OpenAPI-deprecated, and return 410 LEGACY_IDENTITY_DEPRECATED.
- `/identity/status` reports current card-reference availability, including compatibility `enrolled` field.
- New exam flows never call the legacy median helper or automatically convert old selfies into trusted references.
- Legacy tables/files and internal historical helpers are retained for a separate reviewed cleanup migration.
- Existing students must have their actual name/MSSV verified by admin and complete card confirmation. This cannot be fabricated or completed for them by migration.

## Database migrations

Initial repository HEAD was 0007, but local PostgreSQL `pbl6` had no alembic_version or embedding table and lacked notifications/identity_verifications. Historical 0001 loads a schema.sql already containing 0005/0006 tables, so naive baseline upgrade can duplicate tables.

The adoption script builds a uniquely named temporary reference database, proves historical schema equivalence, compares columns/constraints/indexes/enums/triggers/functions, rejects unknown drift before target DDL, and adopts only the recognized baseline in one transaction. Existing application row counts were preserved. Tests use disposable databases only.

Append-only revisions:

1. `0008_student_identity_profile`: authoritative profile/version/provenance and card status.
2. `0009_student_card_previews`: private preview metadata/TTL/one pending preview.
3. `0010_student_card_references`: reference metadata, embedding and verification reference UUIDs; no legacy trust backfill.

Local `pbl6` is at **0010_student_card_references**. Upgrade/downgrade/re-upgrade and legacy-data preservation passed on isolated PostgreSQL. Historical migrations and schema.sql were not edited. No claim is made about a remote production database.

## Checkpoints and backend tests

- A COMPLETE: 163 backend tests, migration validation, typecheck/build and 15 profile/admin browser checks; later auth regression also passed.
- B COMPLETE: 178 backend tests, private storage/TTL/concurrency/rollback and migration checks.
- C COMPLETE: 187 tests including actual offline Vietnamese OCR and PostgreSQL.
- D COMPLETE: 210 test executions including same-preview concurrent confirmation on PostgreSQL, rollback, hash/profile/matching rechecks and API restrictions.
- E COMPLETE: typecheck, production build and 18 browser tests.
- F COMPLETE: 213 tests including profile invalidation, replacement preservation and embedding trust binding.
- G COMPLETE: 213 regression tests (two opt-in tests run separately), actual PostgreSQL card -> verify -> attempt chain, build and five card/exam browser tests.
- H COMPLETE: 214 backend test executions passed with PostgreSQL and offline OCR enabled; 44 targeted tests passed after final storage/OCR hardening. All 63 browser tests passed (2.5 minutes), including auth, navigation, mobile/tablet layouts and the new identity flow. Earlier legacy-fixture failures were corrected to assert the new card/profile contract; no failing checks remain.

Meaningful PostgreSQL cases include concurrent preview creation/confirm, old-template preservation, unverified/missing-reference gates, legacy-only accounts denied, reference replacement during webcam inference rejected, stale verification denied and a valid new attempt created. Unit/API cases include role/auth, MIME/decode/size, face errors, MSSV/name normalization, OCR confidence/failure, ownership, no-store, expiry/supersession, unknown confirmation fields, image mutation, rollback and multi-tab auth.

## Frontend tests and typecheck/build

Production Next.js builds and `npx tsc --noEmit` passed for the changed phases. Browser tests use Edge against `next start` on localhost:3100. New card tests cover loading, protected images, matching failure, retry, expiry, confirm, replacement affordance, exam prerequisites, profile -> card -> webcam verification and legacy redirect.

Final frontend evidence: `artifacts/phase-h-playwright-final.txt` (63/63 passed), `artifacts/phase-h-build.txt` (production build passed). Actual FastAPI lifespan startup successfully loaded the offline OCR worker and shutdown closed it cleanly. Read-only database inspection confirmed local migration HEAD 0010. Both application and isolated OCR environments passed `pip check`; the pinned OCR requirements dry-run required no additional packages on this machine.

Final full backend rerun after storage/OCR hardening: **214/214 test executions passed**, including PostgreSQL and real local OCR, in 42.834 seconds. Evidence: `artifacts/identity-final-backend.txt`.

Browser APIs and camera use synthetic fixtures; they are not a real-card accuracy benchmark. A separate PostgreSQL integration test exercises actual backend routes/store/locks with synthetic model outputs. The local OCR smoke uses the real offline OCR models and synthetic Vietnamese text.

## Security review and limits

Server-owned identity/profile/matching decisions; no client-supplied authoritative MSSV, embeddings or paths. Owner/version/TTL/hash checks on previews. Same-account Bearer behavior across all identity endpoints. No public biometric storage, tokens in URLs, vector/API leakage, raw card logging or unnecessary OCR logging. Storage failures suppress SQL parameter details; programming errors are not broadly converted into MODEL_ERROR. Commit precedes cleanup; failure preserves earlier valid references.

OCR only checks whether text read from the image matches the authoritative profile. It does **not** prove the card is genuine, unedited or free of forgery. Face verification compares webcam appearance to the confirmed reference; it does **not** prove liveness. No model training, liveness, forgery detection, NFC/QR, gaze estimation or threshold recalibration was added.

## Files changed

- Schema/migrations: `backend/app/models/entities.py`, `backend/alembic/env.py`, new revisions 0008/0009/0010.
- API/auth: `backend/app/api/deps.py`, `api/v1/auth.py`, `users.py`, `identity.py`, `attempts.py`, `student_card.py`, `router.py`, `app/main.py`, user/auth schemas and config.
- Services: authoritative profile, previews/retention, OCR adapter, parser/matcher, card identity orchestration; shared face engine preview method and embedding trust binding.
- Operations: migration adoption, preview cleanup, OCR provisioning/worker, `requirements-ocr.txt`, `.gitignore`.
- Frontend: admin users, student profile, new StudentCardIdentity component/CSS/types, exam verification, legacy redirect, API client, AuthContext, student navigation and existing profile/type declarations.
- Tests: identity profile, previews, card APIs, matching/OCR, embedding/face/identity, PostgreSQL migrations and card/exam chain; browser profile/admin/card/exam/responsive tests.
- Documentation: this report, SETUP.md and API_CONTRACT.md. Evidence is under `artifacts/phase-*`.

## Remaining TODO

Operational follow-up, outside the implementation scope: onboard real students through admin verification and card confirmation; evaluate OCR/card-layout and card-to-webcam performance on consented representative data; review legacy-data retention and remove historical files/schema/helpers in a later migration. No real student identity data was invented for migration/testing. No accuracy or anti-spoofing guarantee is inferred from synthetic tests.

## Production threshold changed?

NO. Configured default remains 0.363.

## Face model changed?

NO. YuNet/SFace and their production preprocessing remain unchanged.

## Reproduce validation

From backend/:

```powershell
$env:STUDENT_CARD_OCR_AUTOSTART = 'false'
$env:IDENTITY_TEST_POSTGRES = '1'
$env:RUN_LOCAL_OCR_SMOKE = '1'
.\.venv\Scripts\python.exe -m unittest discover -s tests -q
```

PostgreSQL integration creates/drops only uniquely named test/reference databases and requires CREATEDB; it never migrates the configured application database. OCR smoke requires models provisioned beforehand and never downloads them.

From the repository root, run typecheck/build, start the production server in another terminal, then browser tests:

```powershell
npx tsc --noEmit
npm run build
npm run start -- -p 3100
```

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
$env:PLAYWRIGHT_BASE_URL = 'http://localhost:3100'
npx playwright test
```


## Subsequent profile-request feature (2026-10-09)

Local pbl6 subsequently advanced to `0011_profile_requests`. Student requests, admin review, and in-app notifications are documented in [PROFILE_VERIFICATION_REQUESTS.md](PROFILE_VERIFICATION_REQUESTS.md). The 0010 references above describe the original card-flow checkpoint; its OCR/face/reference/exam implementation remains unchanged by the request feature.
