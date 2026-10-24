# Student self-service phone editing

## Phone field

DB field: existing nullable `users.phone` (`varchar(20)`). No new column or migration; HEAD remains `0011_profile_requests`.

API: new `PATCH /api/v1/auth/me`, paired with existing `GET /auth/me`. Body requires only `phone: string | null`; response uses the existing `{user: UserProfile}` convention. Backend determines the student from authentication, locks that user, updates only phone and writes an audit entry containing the field name, not the phone value.

Validation: trim outer whitespace, accept 8–15 ASCII digits with an optional leading `+`. Examples: `0901234567`, `+84901234567`. Keep leading zeros and country prefix exactly as supplied; do not convert `0` to `+84`. Embedded spaces, punctuation, letters, numeric JSON values and excessive lengths are rejected. Empty/whitespace strings and explicit null clear the value. This is format validation, not proof that the number exists or belongs to the student. Existing admin phone rules are unchanged.

## Student UI

Add: “Thêm số điện thoại” beside “Chưa cập nhật”. Edit: “Chỉnh sửa” opens an inline phone form only; other profile sections stay mounted. Clear: leave input empty and save. Cancel discards the draft without making a request. Save disables input/actions, shows “Đang lưu...”, then updates the displayed phone from the server response and shows “Số điện thoại đã được cập nhật.” Errors stay inline, hide internal server messages and allow retry.

Input has a label, type/inputMode/autocomplete `tel`, validation hint, aria-invalid and linked error text. Opening focuses the input; cancel/save restores focus to the edit/add button. Actions wrap at narrow widths and support keyboard submission.

## Security

Allowed fields: phone only, for the currently authenticated active student. Unknown fields are rejected with 422, including user_id, student_id, full_name, student_code, role, identity_profile_status/version, identity_verified_at/by, and student_card_status. Anonymous/disabled requests are denied; admin/teacher cannot use this student-only endpoint. Existing arbitrary-user admin update routes remain admin-only. Failure during save rolls back and returns a sanitized error.

## Identity regression

The phone update does not call profile invalidation or biometric services. Profile status/version/provenance, student_card_status, active reference UUID, embedding bytes and verification records remain unchanged. PostgreSQL integration tests snapshot all columns of student_card_references, student_face_embeddings and identity_verifications before phone add/update/clear, assert equality after each operation, and verify that the current exam verification stays valid.

No OCR, Student Card flow, YuNet, SFace, threshold, exam verification or admin identity verification implementation was changed.

## Files changed

- Backend: `app/schemas/auth.py`, `app/api/v1/auth.py`.
- Frontend: `lib/api.ts`, `app/student/profile/page.tsx`, new `components/student/PhoneEditor.tsx`.
- Tests: new `backend/tests/test_student_phone.py`, `tests/e2e/student-phone.spec.ts`; updated `backend/tests/test_student_identity_profile.py` for the newly supported PATCH method and `backend/tests/test_identity_migrations.py` for PostgreSQL trust-state regression.
- Documentation: this report and `docs/API_CONTRACT.md`.

## Tests

Backend full suite with `IDENTITY_TEST_POSTGRES=1`, `RUN_LOCAL_OCR_SMOKE=1`, `STUDENT_CARD_OCR_AUTOSTART=false`: 255 tests, 254 passed, 1 skipped (requires a separately supplied real card image). PostgreSQL tests use a disposable database. Evidence: `artifacts/student-phone-backend.txt`.

Frontend suite covers add/edit/clear, persistence after reload, cancel/focus, invalid input, loading/error/retry and mobile keyboard behavior, plus existing profile/card/request/exam UI regressions. Evidence: `artifacts/student-phone-playwright.txt`.

## Typecheck/build

Run `npx tsc --noEmit` and `npm run build`. Build evidence: `artifacts/student-phone-build.txt`.
