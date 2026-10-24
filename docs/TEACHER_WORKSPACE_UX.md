# Teacher profile and question selection

## Teacher profile

`/teacher/profile` is accessible through the existing header account menu and teacher navigation. It presents a profile summary, teacher information, contact information and account information in separate cards, and reuses the existing phone editor. All displayed data comes from `/auth/me`: name, email, avatar URL, role, account status, creation date and phone.

There are no teacher-code or department fields in the current user schema, and no existing avatar-upload endpoint. The page therefore shows neither invented academic fields nor an upload control. Existing avatar URLs are displayed, with an initials fallback.

`PATCH /auth/me` now permits active teachers as well as students to update their own phone. The existing phone-only request schema, validation, account lock, audit and rollback are retained. Role, name, identity fields, avatar URL and another user's ID cannot be assigned through this endpoint. Admin access remains unchanged.

## Shared selection UI

`QuestionFilters`, `QuestionSelector`, `QuestionSelectionSummary` and `RandomQuestionPicker` serve the question-bank page and both exam editor entry points. The former mock-only bank and exam-detail screens now use the existing APIs. Bank creation, question creation/editing, soft deletion and topic updates reuse existing endpoints.

- `/dashboard/question-banks` is a bank list with create/open/rename/archive actions. `/dashboard/question-banks/{id}` owns the question filters and selection; neither page has a redundant bank selector.
- Search accepts Vietnamese text with or without accents. Filters use question type, topic, difficulty and active status. The optional bank subject string does not represent a Subject/Course entity and is omitted from the teacher UI.
- Pagination displays 20 questions per page. Selection persists across pagination and filter changes.
- “Chọn tất cả trên trang” affects the current page; “Chọn tất cả N kết quả” affects all matching results. Disabled questions are excluded when authoring exams.
- Bank actions can transfer selection to a new exam preview or merge it into an existing draft without duplicates. New-exam transfer is scoped to the signed-in account and stored in the current browser tab.
- Bulk topic updates and deletion use existing per-question authorization. A partial failure leaves only unfinished IDs selected, allowing a retry without replaying successful operations.
- The summary shows selected count, difficulty counts and total points. New exam links retain the existing one-point convention; existing link points are preserved when editing. Bank summaries use the question's default points.
- Selected questions can be inspected, removed or replaced. Replacement stays within the original bank and selection filters, excludes every currently selected question, and changes the preview only after all replacement groups succeed.
- A nested question-details dialog handles its own Escape/Tab keys without closing the exam dialog.

The document wizard, private temporary drafts, server-only OpenAI-compatible generation and explicit import flow are documented in [question-bank-documents.md](question-bank-documents.md).

Exam authoring is arranged into four sections: information, questions, class assignment/settings, and review/save. The standalone detail page and list-page modal use the same `ExamEditor`.

## Random preview API

The existing `/exams/{id}/questions/random` endpoint commits questions immediately. It is retained unchanged. A new read-only selection operation supports preview:

```http
POST /api/v1/question-banks/{bank_id}/random-select
```

```json
{
  "count": 30,
  "difficulty_counts": { "easy": 10, "medium": 15, "hard": 5 },
  "exclude_ids": []
}
```

Alternatively use a uniform count with optional `question_type`, `difficulty`, `topic`, or use `topic_counts`. Difficulty and topic distributions are mutually exclusive, use non-negative integer counts, and must sum to the requested total. Counts range from 1 to 500, consistent with the existing random-selection limit.

The server checks bank ownership/admin access, bank status, question status and exclusions before sampling. It returns exactly N unique questions. Insufficient groups produce `NOT_ENOUGH_QUESTIONS` with each group's requested and available counts. No exam, question link or draw rule is written during preview.

Random selection adds N new questions to the preview. Existing selections are explicitly excluded. “Thay tất cả ngẫu nhiên” replaces the selected questions under their original rules; shortages leave the existing preview intact.

The basic 30-question preset and saved configurations require no migration. Saved configurations are scoped to account/bank in local storage and are available on that browser. They are configuration templates, not persisted exam selections.

## Persisting a draft selection

```http
PUT /api/v1/exams/{exam_id}/questions
```

```json
{ "question_ids": ["question-uuid-1", "question-uuid-2"] }
```

This narrowly scoped operation synchronizes additions, removals and order in one commit. It checks exam ownership, bank access, active questions, duplicate IDs, draft status and absence of attempts. Existing links keep their points. Published/closed exams and exams with attempts cannot change selection through this operation.

The editor saves a new exam as a draft, then its selection and class assignments, and publishes only after those steps succeed. A retry during that editor session reuses the created draft ID. Existing attempt execution, grading, face verification, OCR, identity flow and authentication architecture are unchanged.

## Verification

Backend API checks use an isolated SQLite database; browser checks use API fixtures against a production frontend build. These do not alter the development database. The running backend's OpenAPI schema also exposes both new selection operations.

- Backend: 29 checks passed with `backend/.venv/Scripts/python.exe -m unittest tests.test_question_selection tests.test_student_phone tests.test_student_identity_profile -q` (run from `backend`). They cover authorization, exact distributions, exclusions, inactive banks/questions, shortages, preview without writes, atomic draft synchronization, retained points, attempts and protected profile fields.
- Frontend: 85 distinct browser checks passed across the broad 84-check regression run and the final 15-check teacher run, which adds bank/question creation and correct-answer format conversion. The broad run also covers authentication, student phone, card OCR error/display semantics, identity-review flows, focus and responsive forms.
- Viewports: 320, 375, 768, 1024 and 1440px; manual selection, random preview and nested dialogs fit without page overflow.
- After the final question-editor change, all 15 teacher checks and all 5 teacher-form layout checks passed again against the rebuilt production preview. The latter result is in `final-question-layout/.last-run.json`.
- `npx tsc --noEmit` passed in the source workspace. `npm run build` passed in an isolated production preview using a copy of the current frontend, with mock mode disabled.
- Read-only probes confirmed HTTP 200 for the development exam page and both new operations in the running backend's OpenAPI schema. No browser fixture test writes to the development database.

Screenshots are stored in `artifacts/ui-review/teacher-workspace/`: `teacher-profile-{width}.png`, `bank-{width}.png`, `selector-{width}.png`. Browser pass records are in `broad-run-result.json` and `final-check/.last-run.json`. Screenshot names refer to viewport width; question-bank screenshots capture the full page with fixture data.

The existing backend lists a bank's questions as an array, so search/filter/pagination operate over that fetched array. Random selection and permission enforcement run on the server. Server pagination and cross-device template storage would need separate API work; this change keeps the existing schema and requires no migration.
