# Confirmed Student Card profile metadata

`users.class_name` is the nullable administrative class printed on a student
card. It is separate from `Class` and `ClassEnrollment`; card confirmation never
creates course membership. Migration `0017_card_profile_metadata` adds this field
and permits an administrator to approve a named student before their student code
is available. Admin approval remains required before uploading a card.

Preview stores only private, expiring preview data. It does not change any user
field. Closing the preview, replacing it or letting it expire leaves the profile
unchanged. The card status endpoint derives `PENDING_CONFIRMATION` from a valid
preview without persisting that status on the user.

Confirmation verifies ownership, TTL, profile/admin/parser/model versions and
the original image hash. It runs OCR again and validates the face before acquiring
the user lock, then rechecks the preview and fresh identity fields under the lock.
Only the following transaction can activate the reference, bind the face embedding,
set the card to `VERIFIED`, update profile metadata and write audit records:

- A missing student code is filled from valid, confident card OCR. Leading zeroes
  are retained. The code must be unique and the profile version increments; the
  new reference binds to that incremented version.
- An existing matching code is preserved. A mismatch returns
  `STUDENT_CODE_MISMATCH` and directs the student to an administrator.
- A confidently readable class replaces the previous administrative class.
  An unreadable class leaves the stored value intact.

Failure rolls back profile, reference, embedding and audit changes together.
Concurrent confirmations are serialized per user; a database uniqueness check
also prevents two different students from claiming one code. Revoking a card
invalidates its reference/avatar but preserves student code and administrative class.

`GET /api/v1/auth/me` and admin user responses include `class_name`. The profile
summary displays code and class alongside the existing avatar and status. After
confirmation, the frontend reloads the current user and card status immediately.
Older in-flight profile responses cannot overwrite newer confirmation data.
If profile refetch fails after successful confirmation, the UI retains the success
and provides a profile retry. Browser reload reads the persisted profile again.
Admin user details and Student Card management display the same stored metadata.

Audit actions include `STUDENT_CARD_CONFIRMED` and, only when metadata changes,
`PROFILE_UPDATED_FROM_STUDENT_CARD`. The latter records changed field names and
the reference ID, without raw OCR text or card images.

Tesseract/tesserocr, YuNet, SFace, the 128-dimensional embedding, threshold 0.363,
protected card storage and sanitized face avatars retain their existing behavior.
Class extraction is described in [student-card-class-ocr.md](student-card-class-ocr.md).

## Validation

Backend regression coverage includes preview isolation, re-OCR, ID conflicts,
replacement cards, unreadable classes, rollback, API persistence, admin visibility
and revoke. Opt-in PostgreSQL tests use a temporary table for the new migration
and a disposable test database for concurrent confirmations:

```powershell
Set-Location backend
$env:ENVIRONMENT='test'
$env:CARD_PROFILE_TEST_POSTGRES='1'
.venv/Scripts/python.exe -m unittest tests.test_student_card_profile tests.test_card_profile_postgres tests.test_card_profile_migration
```

The local development database was upgraded to `0017_card_profile_metadata`.
Deployments must also run `alembic upgrade head` before starting the new backend.

Playwright coverage in `tests/e2e/student-card-profile.spec.ts` verifies immediate
profile/avatar updates at 375px and 1440px, reload persistence, replacement cards,
failed confirmation, unreadable class, stale responses and admin profile details.
The original whole-history identity migration suite encounters an existing
`provider_close_pending` duplicate-column issue in historical schema setup;
the new migration was separately verified on PostgreSQL and applied successfully.
