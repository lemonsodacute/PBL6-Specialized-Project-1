# REALISTIC ACADEMIC DEMO SEED

Added a connected **Học kỳ 1 - 2026/2027** to the actual configured PostgreSQL database, using existing accounts exclusively.

| Requested result | Verified result |
| --- | --- |
| User accounts before / after | **20 / 20** |
| New accounts created | **0** |
| Existing Teachers / Students reused | **4 / 15** |
| Existing Admins retained | 1 |
| Classes | 8 semester-specific classes |
| Memberships | 60; four classes per Student |
| Question banks / questions | 16 / 160 |
| Exams | 12, with 240 question links and 12 class assignments |
| Past exams | 4 |
| Current/open exams | 4 |
| Upcoming exams | 4 |
| Live classes | 18: 8 ended, 8 upcoming and 2 scheduled in the current period |
| Attendance | 60 rows for enrolled Students, including late/early/absent cases |
| Historical attempts/results | 45 attempts, 900 answers |
| Notifications | 34; no email delivery |
| Fake AI production detections | NONE |
| Identity/biometric data changed | NO |
| Idempotent | YES: repeated actual runs created no records |
| PostgreSQL validation | PASS |
| Student UI | PASS against the real application |
| Teacher UI | PASS against the real application |
| Admin UI | PASS against the real application |

## Safety and consistency

The dedicated script never constructs or modifies a `User`. It fingerprints all account columns and stored face/card references, asserts the account count before/after, and rolls back on a preservation failure. It does not change passwords, emails, roles, codes, avatars, card status or face data.

The namespace `realistic-academic-demo-v1` produces deterministic UUIDs. Existing records and E2E fixture identifiers are preserved. Semester suffixes keep new class names distinct from older similarly named courses. An advisory transaction lock prevents concurrent seed runs. All inserts, relationship checks and score validation run in one transaction.

Each Student joins one Web cohort, Database, Software Engineering and one elective. Teachers own their classes, banks, exams and scheduled lessons consistently. Web cohorts contain past, open and future assessments so every enrolled Student has dashboard, history and calendar content. Each exam has 20 relevant questions worth 0.5 points each. Objective answers are scored through the existing grader; guided essays have explicit Teacher grading. Historical totals range from 5.5 to 9.0 out of 10, matching the stored answers.

The availability windows span longer periods than the 45/60-minute attempt durations. The initial date anchor is retained on reruns, preserving history rather than moving completed exams forward.

Past sessions have attendance using existing supported enums. Current-period sessions remain **scheduled until a Teacher actually starts the provider room**. No fake connected LiveKit room, MP4, recording metadata, uploaded document, AI-provider usage or health metric was created.

Existing historical browser signals were subsequently made available to the proctor review UI by the **separate monitoring-report migration**. That operation reuses real stored browser logs and does not create AI detections; it is independent of this academic seed.

## Run

From `D:\ChauAnh\PBL6 new\backend`:

```powershell
.\.venv\Scripts\python.exe -m scripts.seed_realistic_demo_data --dry-run
.\.venv\Scripts\python.exe -m scripts.seed_realistic_demo_data
```

Dry-run performs inserts and validation inside a transaction, then rolls back. The script rejects non-PostgreSQL configurations and uses the existing environment; no password is hardcoded. A normal rerun prints an empty `created` map.

## Files and evidence

- `backend/scripts/seed_realistic_demo_data.py`: transaction, stable IDs, existing-user guards, population and relationship/score checks.
- `backend/scripts/academic_demo_catalog.py`: manually authored academic questions and grading guidance.
- `tests/e2e/academic-demo-real.spec.ts`: existing-account role navigation and actual monitoring report acceptance.
- Private local logs: `backend/private/livekit-recording/seed-dry-run.log`, `seed-apply.log`, `seed-rerun.log`, `seed-rerun-final.log`, `seed-recheck-latest.log`.
- UI artifacts: `artifacts/academic-demo/final-results`; final browser log: `artifacts/class-recording/academic-final.log`.

The final **4 real-account browser scenarios passed**, reading 29 role-specific routes plus the requested monitoring flow: dashboards, classes, online classes, exams, history/results, calendar, profile, settings and help, with additional Teacher grading/banks/reports and Admin card verification/AI/audit/settings checks. No new login account is created for verification. Full-row account, attempt and original browser-log fingerprints remained unchanged after the monitoring migration and real human review.

The identical dataset request was rechecked on 26 October 2026. The seed was executed again against the configured PostgreSQL database: `USER_COUNT_BEFORE=20`, `USER_COUNT_AFTER=20`, `NEW_ACCOUNTS_CREATED=0`, `identity_changed=false`, and `created={}`. All seed-owned inventory counts above were retained. No additional dataset or core-logic change was needed for that rerun.
