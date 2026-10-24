# AI evaluation and managed support knowledge

Migration `0020_ai_evaluation` adds `support_articles`, `ai_activities` and
`ai_draft_reviews`. It was applied to the local database. Other installations run:

```powershell
cd backend
.\.venv\Scripts\python.exe -m alembic upgrade head
```

Migration `0021_draft_quality_rating` adds nullable `quality_rating` (integer,
database CHECK 1–5) and `reason_note` (up to 2,000 characters) to the existing
`ai_draft_reviews` table. It reuses `decision` and `reason`; existing reviews retain
their decisions/reasons and have no inferred star rating. The migration was also
applied locally. The PostgreSQL migration test uses only a temporary table.

The existing Gemini provider/client, key and model configuration are unchanged.
Question Generation and Support still own separate prompts/context/permissions.
Only the managed SupportArticle table enters Support retrieval; question banks,
exam answers and biometric tables never enter its provider context.

## Admin and Teacher entry points

- `/admin/ai-support/knowledge`: create/edit/deactivate articles, search title/content,
  filter role/category/status, inspect updated-at/by. Content is plain-text guidance;
  each nonempty line is a step. Related routes use the existing role-specific route
  allowlist. API-key/token/private-key patterns and system-prompt fields are rejected.
- `/admin/ai-support/activity`: UTC calendar-date filters (today, 7/30 days, custom
  up to 367 days), aggregates, provider health and CSV export. Backend Admin guards
  apply to every management/report/export route. Missing samples render as empty
  or unavailable, never as a fabricated percentage or zero cost.
- Question document review: Teacher explicitly records **Đạt**, **Cần sửa**, or
  **Loại bỏ**, independently of a 1–5-star quality rating. The form places stars
  first, an optional reason directly below, then a separate decision group and
  edit/regenerate/remove actions. Star meanings are Rất kém, Kém, Trung bình, Tốt,
  Rất tốt. Stars use inline SVG consistent with existing project icons, native
  keyboard-accessible radio inputs, and a single row even on mobile.
  Rating, reason and decisions autosave through partial PUT updates to the existing
  feedback endpoint; omitted fields remain unchanged. An Other reason reveals a
  note that saves after 600 ms of inactivity or on blur. Changing away from Other
  clears that note. Failed updates show a retry action and never apply a rejected
  decision to the import selection before the server confirms it. Import and
  actions that would unmount a saving form wait for pending saves.
  These persist independently
  of the temporary document and do not auto-import, remove a draft, train a model,
  or infer a quality label from editing/import. The existing selection/import actions
  remain explicit. Source images have a protected enlarged view.

Quality feedback survives refresh and draft expiration/import. Teacher feedback is
accepted only for an owned bank/document and a generated draft. Each generation
revision has its own sample; regenerating preserves historical reviews and gives
the replacement an unreviewed sample. Repeated feedback updates the same sample
rather than increasing the denominator. Historical pre-migration drafts have no
evaluation sample and require a new generation before quality feedback can be saved.

## Metric definitions and denominators

Question activity rows represent a batch or one-question regeneration, including
failed attempts. Re-reading a completed batch does not create another activity.
Provider retries happen within that row; manually retrying a failed batch creates
a new observed request. Requested/generated totals therefore measure request
volume, not unique documents or imported questions.

| Metric | Source and interpretation |
| --- | --- |
| structured_parse_success_rate | Successful JSON/schema parses / generation invocations, including failed requests in the denominator |
| requested_questions / generated_questions | Requested per-source upper bounds / validated drafts actually returned |
| grounded_questions | Source chunk exists, excerpt is at least 10 normalized characters and occurs in source context, attached image IDs belong to that source |
| questions_with_source | Returned drafts have chunk ID and excerpt; PDF page retained, DOCX page may be unknown |
| image_questions | Drafts retaining associated source pictures; this alone is not proof of image understanding |
| image_analysis_success | CLI topology fixtures: actual output must identify exactly 3 PCs, retain image and have no vision warning; production aggregate is unavailable without a reviewed answer key |
| provider_failure_count | HTTP failures and transport/timeouts, including failures later recovered by retry |
| retry_count | Actual second provider attempts; text fallback is a separate capability request, not disguised as retry |
| average_latency_ms | Measured wall time for the feature call including retries, excluding DB/report rendering |
| acceptance / edit / reject rate | Explicit accepted / edited / rejected feedback divided by reviewed revisions; “edited” means Teacher selected “Cần sửa” |
| average_teacher_rating / teacher_rating_count | Mean and count of non-null teacher star ratings within the same activity-date cohort; unrated drafts and decision-only feedback do not enter the denominator. Empty mean is null and count is 0. Updating an existing rating does not add another sample. |

Source mapping is an automatic provenance check, **not a semantic correctness
score**. It does not establish that a question is unambiguous or its answer is true.
These aspects require Teacher review. Every rate includes numerator/denominator;
under 30 reviewed samples displays `Insufficient reviewed samples`. Thirty is a
display threshold, not a claim of statistical confidence.

Support session totals use sessions **created within the selected UTC dates**.
Resolution derives only from an explicit persisted `resolved` action. Escalated
sessions have an actual `escalated_at` timestamp (including subsequently closed
cases). `unresolved` offers escalation and counts as negative guidance feedback;
it does not falsely count an Admin case until the user actually transfers it.
Helpful rate uses resolved / (resolved + unresolved) feedback turns, not sentiment.
Outcomes are current outcomes of the cohort and can change after the reporting
period as users finish their sessions.

Retrieval hit rate is nonempty retrieval / retrieval attempts. Greeting turns do
not enter its denominator. KB miss means a turn has `SUPPORT_KNOWLEDGE_NOT_FOUND`,
including cases where a model selected no relevant article. Response latency and
provider-failure totals use activity turns occurring within the selected dates;
these can include sessions started earlier. Quick KB topics do not call a model.
CLI scenarios separately test whether a known expected article was retrieved and
selected; this stricter fixture metric is not mixed into production hit rate.

## Privacy, diagnostics and audit

Activity stores timestamps, IDs, role/category, numeric counts, status/error codes,
and retrieved/selected article IDs with lexical scores. No raw queries, prompts,
model response, API keys, JWTs, card/face images or embeddings are stored there.
No analytics endpoint exposes full conversations by default. Existing scoped
Support history continues separately for providing support.

Provider health reports configuration booleans and the last observed success/error
from persisted activities. It starts collecting after this migration; old calls
are not guessed or backfilled. Provider tier is configured externally; cost is
unknown because no trustworthy billing source is integrated. Rate-limit counts
are observed errors, not a claim about remaining Google quota.

DEV Admins can POST `/api/v1/admin/ai-support/retrieval-debug` with
`{role, category, query}` to inspect top IDs and lexical relevance scores without
calling the model or storing the query. GET `/retrieval-debug/recent` under the same
prefix shows recent actual retrieved/selected IDs without messages. Both are 404
outside development/dev/local/test and forbidden to normal users.

System Action Log records `SUPPORT_ARTICLE_CREATED`, `SUPPORT_ARTICLE_UPDATED`,
`SUPPORT_ARTICLE_DISABLED`, `AI_QUESTION_GENERATION_COMPLETED`,
`AI_QUESTION_IMPORTED`, and `AI_SUPPORT_ESCALATED`: IDs/counts/category only.
AI-specific numeric technical observations live in AI Activity separately.

## Evaluation CLI and artifacts

No network/model calls by default:

```powershell
.\backend\.venv\Scripts\python.exe backend/scripts/evaluate_ai_features.py
```

This evaluates 11 Student/Teacher retrieval scenarios against the **managed DB KB**
and reports observed application data from the last 7 days. Fixture generation
and Support model selection remain NOT RUN. Explicit real evaluation:

```powershell
$env:RUN_REAL_AI_TESTS='1'
.\backend\.venv\Scripts\python.exe backend/scripts/evaluate_ai_features.py --live --output artifacts/ai-evaluation-live
```

The fixture set includes DOCX text, DOCX table, DOCX topology, PDF text and PDF
topology. The CLI writes the five documents under `documents/`, validated drafts
for manual review in `teacher-review.json`, observations in `evaluation.json`, and
`question.csv` / `support.csv`. Review JSON contains public synthetic course
fixtures, not raw provider responses. It has no automatic teacher labels.
The report keeps fixture results separate from actual application aggregates;
fixture AI calls do not populate production activity or fake resolution feedback.

The live run on 2026-10-17 observed:

| Check | Result |
| --- | --- |
| Documents / feature requests | 5 / 5 |
| Structured parse | 5/5 |
| Requested / generated | 11 / 11 |
| Source mapping valid | 11/11 (not a semantic score) |
| Topology answer-key checks | 2/2 |
| Provider failures / retries | 1 / 1; recovered |
| Mean question latency | 9,732.518 ms |
| Support expected retrieval / selection | 11/11 and 11/11 |
| Support provider failures | 0 |
| Mean Support latency | 1,244.814 ms |
| Real Teacher reviewed samples | 0 — insufficient |

These are small, controlled fixtures and one run; do not present them as general
accuracy, real-world resolution rate, or representative latency. No LLM judges
its own correctness. Actual Teacher acceptance and real user resolution remain
unmeasured until people provide feedback.

Admin CSV exports reflect persisted application rows, not fixture scores. Question
CSV includes timestamp/type/requested/generated/accepted/edited/rejected/latency/
provider status. Support CSV includes session timestamp/role/category/retrieval hit/
explicit resolution/escalation/provider status. Neither exports conversation text.

## Verification

Unit/API tests use isolated databases and mock only the provider boundary:

```powershell
cd backend
.\.venv\Scripts\python.exe -m unittest tests.test_ai_management tests.test_ai_provider tests.test_support_assistant tests.test_question_documents -v
```

The 7 accepted / 2 needs-edit / 1 rejected and 6 resolved / 4 escalated acceptance
examples are exercised through APIs in isolated test DBs. They are test fixtures,
never seeded into application analytics or reported as real human feedback.
Tests also cover KB immediate update/deactivation, ownership/Admin access, 503
persistence with successful drafts retained, empty denominators and CSV values.

Real API integration remains opt-in:

```powershell
$env:RUN_REAL_AI_TESTS='1'
.\backend\.venv\Scripts\python.exe backend/scripts/test_ai_live.py
```

Normal unit suites never call Gemini. The report generator without `--live` also
makes no provider calls. No biometric, OCR, scoring, student-card or classroom-media
implementation is changed by this phase.
