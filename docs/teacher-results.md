# Teacher results: PostgreSQL → API → UI

## Root cause and scope

The Teacher report hub, exam attempts/report pages and attempt grading page imported runtime fixtures. Unknown route IDs silently fell back to the first fixture exam/attempt. The grading page only changed local state. Real student submission already persists `ExamAttempt.score`, `max_score`, `status`, `submitted_at` and answer grading in one database commit, so the scoring formula and submission implementation were preserved.

All four Teacher result pages now use real API responses with loading, error and retry states. The exam list includes a **Kết quả** action. There is no fixture, fallback exam, browser score calculation, or demo export in these result flows.

## Contract and ownership

- Reused `GET /api/v1/exams/{exam_id}/report`, including its legacy alias. Teacher access requires `Exam.created_by == current_user.id`; another teacher receives 403. Admin retains access. Students cannot call reports.
- `results` includes class enrollments and direct student assignments, deduplicated, plus historical participants. Students without attempts receive `attempt_id=null`, `status=not_started`, `score=null`.
- User is authoritative for `full_name`/`student_code`. No OCR/profile snapshot is substituted.
- Terminal enums are `submitted`, `auto_submitted`, `terminated`. Active scores and correct counts are masked, even if an active attempt contains an intermediate stored score.
- Scores come from persisted `ExamAttempt.score` and `max_score`. The exam's planned maximum is the sum of actual `ExamQuestion.points`.
- Correct count uses persisted `Answer.is_correct` for MCQ questions. Mixed exams label the denominator as MCQ questions and show answered essay/oral questions awaiting manual grading separately.
- `summary` counts students' current states; existing `attempts`/`statistics` remain compatible and count individual attempts.
- The current row uses the highest `attempt_number`, matching the existing Student exam summary. This is not a newly invented final-score policy. Every attempt remains accessible in history and CSV; a lower later score never causes an earlier higher score to be silently selected.
- Expired attempts still use the existing server expiry finalizer. Reports do not regrade already submitted attempts.

## Detail and refresh

Teacher detail reuses `GET /api/v1/attempts/{attempt_id}/result`, the same endpoint as Student Result. It returns the same persisted score/answers and existing saved question order. Teacher/Admin can see answer keys; Student's explicit `show_answers` setting / closed-exam policy stays unchanged. The detail rejects mismatched exam/attempt route IDs. Protected question images use the existing image component/storage API.

Manual grading calls the existing `PATCH /api/v1/answers/{answer_id}/grade`, then reloads the persisted result. Student answer contents cannot be edited in this view. CSV downloads contain real returned values, preserve zero scores and all attempt history, and escape spreadsheet formula prefixes.

Results requests use `cache: no-store`, clear stale tables during reload/errors, and discard responses superseded by a later request or route change. Reload and **Tải lại kết quả** query current database state.

The Reports hub now also provides a filtered, per-attempt report with real
aggregates, proctoring timelines and filtered CSV. It retains links to the
student roster/results pages. Both endpoints share the report service and
persisted score mapping. See [teacher-reports.md](teacher-reports.md) for the
aggregation rules and event-count definition.

## Real database acceptance evidence (2026-10-12)

Read-only trace and authenticated browser verification used an existing submitted attempt, without adding or changing any production answer, attempt or grade:

| Field | Actual value |
| --- | --- |
| Exam | Kiểm tra giữa kì CNW |
| Exam ID | `04a98dd6-17da-4e29-9d6c-f3e4a27f40e8` |
| Attempt ID | `08a50924-ccd3-46b2-a882-761d9cd8d793` |
| Student | Lê Nguyễn Châu Anh |
| Student code | `102230057` |
| Persisted status | `submitted` |
| PostgreSQL score / max_score | `1.00 / 15.00` |
| Teacher API score / rendered UI | `1 / 15` |
| Saved answers / exam questions | `8 / 15` |
| Correct MCQ / MCQ questions | `1 / 9` |
| Roster summary | 9 students: 1 submitted, 0 active, 8 not started |

The browser made actual requests to the report endpoint, followed **Xem chi tiết** to the exact attempt, checked student identity/score and all 15 question details, then opened the alternate report URL and refetched. Teacher score also matched Student Result API. No browser JavaScript errors occurred. This mixed exam has an answered manual question awaiting grading; the UI preserves its current stored score and labels the pending question.

For a read-only PostgreSQL recheck:

```sql
SELECT a.id, a.exam_id, u.full_name, u.student_code, a.status,
       a.score, a.max_score, a.started_at, a.submitted_at
FROM exam_attempts a JOIN users u ON u.id = a.student_id
WHERE a.id = '08a50924-ccd3-46b2-a882-761d9cd8d793';

SELECT question_id, answer_content, is_correct, points_awarded
FROM answers WHERE attempt_id = '08a50924-ccd3-46b2-a882-761d9cd8d793';
```

Open `/dashboard/exams/04a98dd6-17da-4e29-9d6c-f3e4a27f40e8/attempts` as the owning teacher to repeat the UI check. Future legitimate grading can change this recorded score; the page always reads the new persisted value.

## Regression validation

- `backend/tests/test_teacher_results.py`: isolated database integration tests cover roster/direct assignment/deduplication, real submit persistence and subsequent report reads, latest attempt/history/zero score, role and ownership checks, terminal statuses, manual pending counts and Student answer-key policy.
- `tests/e2e/teacher-results.spec.ts`: browser tests cover report navigation/detail, existing result URLs, reload/refetch, 401/403/404/500 without fallback data, history and CSV zero scores. These synthetic network fixtures exist only in tests; they are not the real PostgreSQL acceptance evidence above.
- Scoped TypeScript check passes. The unrestricted check still reports pre-existing optional `MediaStreamConstraints` errors in `tests/e2e/exam-experience.spec.ts` (lines 50–56).
