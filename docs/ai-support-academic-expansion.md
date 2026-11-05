# AI SUPPORT ACADEMIC DATA EXPANSION

Validated on 28 October 2026 (Asia/Saigon). Extends the existing AI Support router, scoped student resolver, conversation state and system-data renderer.

| Capability | Result |
| --- | --- |
| Existing STUDENT_SCORE_LOOKUP | PASS |
| STUDENT_ATTEMPT_HISTORY | PASS |
| STUDENTS_NOT_ATTEMPTED | PASS |
| STUDENTS_BELOW_SCORE | PASS |
| EXAM_SUBMISSION_SUMMARY | PASS |
| OPEN_EXAMS_LOOKUP | PASS |
| STUDENT_PROCTOR_ALERT_SUMMARY | PASS |
| CLASS_SCORE_SUMMARY | PASS |
| EXAM_RESULT_SUMMARY | PASS |
| Entity resolution / ambiguity / no match | PASS |
| Conversational student/class/exam follow-up | PASS |
| Teacher authorization | PASS |
| Student privacy / own data only | PASS |
| Real DB only in application responses | PASS |
| Hallucinated academic data | NONE |
| HOW-TO still uses RAG | PASS |
| Structured source label | Dữ liệu hệ thống |
| Documentation source label | Tài liệu hỗ trợ |
| Proctor alert wording | PASS |
| Actual result / monitor deep links | PASS |
| Business logic changed | NO |
| Existing scores modified | NO |
| New persistent accounts created | 0 |

## Behavior and service reuse

The path is question → intent/entity extraction → authorization → narrow read-only service → persisted facts → constrained LLM presentation → existing chat renderer. No model receives a database connection, SQL tool, arbitrary query execution, internal review notes or passwords.

Intent recognition uses compositional Vietnamese patterns with accent-insensitive entity resolution, rather than exact sample-question matching. Supported entities include name/MSSV, class, exam, point/percentage threshold, submission status, severity, review state and today/week/month. HOW-TO detection runs first. Exam/course tokens such as “giữa kỳ Web” are matched against exam titles and assigned class names within the actor's scope; ambiguous matches require selection instead of choosing the latest record.

History uses the existing `saved_attempt` and `student_result_metadata_many` projections. It includes exam/class, persisted status, start/submission time, authorized score and exact total attempts/exams, with at most 20 detail rows. Students cannot see pending manual grades or draft-exam results. The current schema has no separate score-publication flag; existing terminal-attempt and final-grade visibility rules are retained.

Unattempted rosters use current direct/class assignments, deduplicate overlapping assignments and exclude historical outsiders. “Chưa làm” means no non-placeholder attempt. “Chưa nộp” uses the latest attempt's actual state. Submission statistics distinguish `submitted`, `auto_submitted`, `terminated`, `in_progress` and `not_started`; `graded` is not invented as an attempt enum.

Score filtering and statistics reuse the canonical `reports.roster_query` grading/latest-attempt policy. Persisted scores are never recalculated. Exam result statistics retain historical participants, as existing reports do; class statistics restrict current membership. A 5-point threshold compares raw points; a 50% threshold uses score/max score and excludes absent/zero denominators. Mixed scales use percentages for averages/median/ranges. The latest attempt per student/exam is used, not the best attempt. Pass/fail is shown only when a real stored passing threshold exists for the single resolved exam. Percentage distribution buckets are computed from persisted final grades.

Open exams require backend `now`, a published/ongoing status and `start_time <= now < end_time`. Student results additionally enforce assignment, supported question formats, existing completion/attempt-limit rules and active-attempt availability. Today/week/month use Vietnam calendar boundaries. History filters start/creation timestamps, proctor summaries filter event timestamps, and exam lists/statistics filter overlapping scheduled exam windows.

Proctor summaries extend the existing `monitoring_reports` service and share its severity/review-state aggregate expressions. They read real (`is_simulated=false`) persisted events only. Totals count persisted alert records, matching the monitor report, rather than multiplying cooldown occurrence counts. Ranking includes ties; high severity includes critical. Results include actual review states, up to three recent alert-bearing attempts per student and optional event-type distribution. Review notes/evidence are excluded. The answer always states that alerts require review and the teacher remains the final reviewer. Existing ingestion, dedup/cooldown, WebSockets and Confirm/Dismiss are unchanged.

Some existing reporting endpoints lazily finalize expired attempts. Chat deliberately reuses their pure query/projection helpers instead of calling those mutating endpoints. An expired in-progress attempt therefore remains unchanged after a chat query.

## Presentation, context and access controls

The existing provider transport and AI quotas are reused. After a successful lookup, the LLM can order trusted fact blocks and choose compact/separated spacing. Student identifiers and names/titles are replaced with placeholders before transmission. The response schema accepts only block indices and spacing, and requires every block exactly once. The server inserts the original facts, fixed interpretation/review notes and authorized links. Generated prose, extra numbers, missing/duplicate blocks or invented URLs cannot enter the answer. Provider failure, missing configuration or exhausted presentation quota falls back to the same grounded facts. A database service failure instead returns an explicit unavailable response and never invokes the LLM to guess.

Context contains only resolved IDs in the current support session. New chats and HOW-TO/category switches do not inherit academic identities. Explicit new entities take precedence; failed identity lookups clear earlier context. Every subsequent query reauthorizes IDs. Restored messages also recheck class/exam/student scopes and hide content after access is revoked. Student support remains blocked during an active exam. Admin policy is unchanged: Admin does not gain academic-query access through this feature.

Results are bounded to 20 records, eight disambiguation choices and 50 exams per aggregate. Larger scopes require narrowing. Proctor attempt details and rendered links are separately capped. Existing per-session and per-user protections remain in place. Generic bulk private exports are rejected. Audit events include actor, role, intent, target IDs where resolved and outcome, without names, grades, raw prompts or provider payloads.

The chat design is preserved. The only UI addition is a compact list of server-generated detail links using existing routes:

- `/dashboard/exams/[id]/report`
- `/dashboard/reports/attempts/[attemptId]`
- `/dashboard/monitor/[examId]`
- `/dashboard/monitor/[examId]/[attemptId]`
- `/dashboard/classes/[id]`
- `/student/attempts/[id]/result`, `/student/history`, `/student/exams`

## Verification

Backend: 73 distinct tests passed across academic lookup/expansion, support assistant/lifecycle, teacher results and monitoring report suites, including the additional restored-roster revocation case. Application lifespan workers were disabled for isolated fixture tests so they cannot connect to the developer's real PostgreSQL/LiveKit services. New tests reuse the existing isolated account fixtures; no live users were seeded.

Real PostgreSQL validation executed all nine intents with existing authorized accounts, independently checked stored scores, assignment totals, real-event totals and foreign-teacher/student denials. Academic attempt fields and total user count were fingerprinted before and after browser validation. The example name “Châu Anh” does not match this teacher's authorized records, so the UI correctly reports no match; an existing authorized MSSV returns its actual persisted score.

TypeScript `tsc --noEmit --incremental false`: PASS. Focused ESLint: zero errors, three pre-existing React Hook warnings in `SupportAssistant.tsx`. Next.js production build: PASS, using `.next-recovery-support-expansion`; temporary generated TypeScript configuration changes were restored. Existing unrelated project lint warnings remain.

Frontend browser validation: 11 distinct tests PASS (nine mocked UI cases and two real PostgreSQL/API/browser cases). Final results are recorded in `artifacts/support-academic-expansion/browser-tests.log` and `browser-recheck.log`. Coverage includes mobile rendering, percentages, source labels, proctor language/attempt links, exam selection/follow-up, provider error/RAG behavior, real expanded queries and existing real score lookup. One initial real-score test used an expired private fixture token and landed on the login page; both real-account cases passed after refreshing the token for the same existing account.

Local artifacts contain the build/backend/browser logs, screenshots and sanitized real-DB validation summary. Existing-account tokens and expected private records stay in ignored `backend/private` fixtures and are not included in this report.

## Files changed for this expansion

- `backend/app/services/support_academic.py`
- `backend/app/services/support_academic_intents.py` (new)
- `backend/app/services/support_academic_queries.py` (new)
- `backend/app/services/support_academic_presentation.py` (new)
- `backend/app/services/monitoring_reports.py` (read-only projection/shared aggregates)
- `backend/app/api/v1/support_assistant.py`
- `backend/tests/test_support_academic.py`
- `backend/tests/test_support_academic_expansion.py` (new)
- `components/chat/SupportAssistant.tsx`
- `lib/support-assistant.ts`
- `tests/e2e/support-academic.spec.ts`
- `tests/e2e/support-academic-expansion.spec.ts` (new)
- `docs/ai-support-academic-expansion.md` (new)

No scoring, stored grades, Face Verification/SFace threshold, proctor model, LiveKit/recording, question generation, student identity or password logic was changed.
