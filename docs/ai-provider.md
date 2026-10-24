# Shared AI provider

Question Generation and Support Assistant share `backend/app/services/ai_provider.py`:
one OpenAI-compatible Chat Completions transport, base URL, API key, configuration
validation, error classification and bounded retry policy. Their prompts, services,
source material, role checks and output schemas remain separate. Support receives
only role-scoped support KB articles, never Question Bank/exam questions or answers.

## Exact backend configuration

Place these in **backend/.env**, not a frontend env file:

```dotenv
QUESTION_GENERATION_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
QUESTION_GENERATION_API_KEY=
QUESTION_GENERATION_MODEL=gemini-3.8-flash
SUPPORT_ASSISTANT_MODEL=gemini-3.5-flash-lite
QUESTION_GENERATION_SUPPORTS_VISION=true
QUESTION_GENERATION_TIMEOUT=90
SUPPORT_AI_TIMEOUT=25
SUPPORT_AI_PER_MINUTE=6
SUPPORT_AI_PER_DAY=100
```

Fill the empty API key locally. No key is supplied by the repository. `.env` files
are gitignored, including backend/.env; `.env.example` contains no credentials.
Do not commit a key or introduce any `NEXT_PUBLIC_*` AI secret.

No `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL` or `AI_MODEL` aliases are needed:
the existing `QUESTION_GENERATION_*` convention is the shared source of truth.
The protocol stays OpenAI-compatible; diagnostics identify Google's endpoint as
`gemini-openai-compatible`. Question Generation uses
`QUESTION_GENERATION_MODEL`. Support uses `SUPPORT_ASSISTANT_MODEL`, or
`QUESTION_GENERATION_MODEL` when its override is empty/whitespace.
The application has no hard-coded model ID or credential. Models above are
configuration recommendations, not provider access guarantees.

The selected models are Gemini 3.8 Flash for document questions and Gemini 3.5
Flash-Lite for Support. Both support structured output; the question model accepts
image input. Google's [compatibility API](https://ai.google.dev/gemini-api/docs/openai)
supports the existing `response_format: json_schema` and multimodal `image_url`
data URLs. The shared adapter omits the OpenAI-only `store` field for Google's
endpoint; prompts and feature schemas stay vendor independent.

Create a key at [Google AI Studio](https://aistudio.google.com/api-keys), using a
project on **Free Tier**. Follow Google's [API key guide](https://ai.google.dev/gemini-api/docs/api-key).
Model availability and free quotas are managed by Google; check the project's tier
in AI Studio and the [pricing page](https://ai.google.dev/gemini-api/docs/pricing).
The application does not enable billing or enforce a provider billing tier.
No API key is included in these docs or the example file.

Only course documents and sanitized support KB context belong in this integration.
No biometric/card/embedding data is fetched by either provider service. Support
allowlists article fields and redacts email, labelled student IDs, credentials and
connection strings before sending text. Question text uses the same redactor;
source validation still rejects citations that do not match the original document.
This is not image-content classification: do not upload identity cards, face photos
or confidential documents to this course-document feature. Free Tier data usage
is governed by Google's published terms and pricing table.

`QUESTION_GENERATION_SUPPORTS_VISION` explicitly declares the question model's
capability; update it when changing models. It is not an automatic live capability
probe. Support only sends text even if its model can accept images.

## Configuration and runtime errors

Both public feature statuses use the same `provider_configured()` function. A model
override never introduces a second endpoint or key requirement. Configured means
the required non-placeholder configuration and URL are valid locally, **not** that
credentials, billing or model access have been verified remotely.

| Code | Meaning |
| --- | --- |
| `AI_NOT_CONFIGURED` | Missing/placeholder base URL, API key or default model |
| `AI_AUTH_FAILED` | Invalid/expired API key or denied API permissions |
| `AI_RATE_LIMITED` | Provider rate limit or exhausted quota |
| `AI_PROVIDER_UNAVAILABLE` | Network timeout/connection failure or provider outage |
| `AI_INVALID_RESPONSE` | Malformed, refused, truncated or schema-invalid provider output |
| `AI_REQUEST_FAILED` | Invalid URL, redirect or other rejected request |
| `AI_MODEL_UNSUPPORTED` | Provider reports unknown/inaccessible model or unsupported model capability |

Quota errors display “Đã đạt giới hạn AI tạm thời. Vui lòng thử lại sau.” in both
Question Generation and Support, with retry and escalation still available.

Provider error bodies are never returned to the browser. The client never follows
redirects or logs credentials/prompts/model output. Each call has at most one retry
for connection failures, timeouts or HTTP 408/429/500/502/503/504, with a small
bounded backoff (300 ms for the single retry). A Retry-After exceeding two seconds
is returned to the caller instead of sleeping through it. Auth/model/schema errors
are not retried. Feature-specific timeout settings are shared across attempts as
a remaining-time budget; the first attempt reserves time for the possible retry.

Question Generation validates structured output, exact source citations, answer
structure, image mapping and duplicate content before exposing drafts. No question
is imported until the teacher reviews and explicitly confirms import. Existing
valid drafts survive an incomplete/failed batch. Document errors such as
`UNGROUNDED_GENERATION` remain distinct from connection/configuration errors.

Requested counts are upper limits. An insufficient source can yield fewer or zero
questions without fabricating material; completed batches include the actual
generated count and a warning. Source excerpts are capped at 600 characters.
Independent failed batches do not discard successful drafts. The UI shows actual
batch/question counts, allows review of partial results, and retries only unfinished
batches. Import remains blocked until all planned batches finish. Regeneration
uses only the selected question's source/configuration and preserves other drafts;
an empty replacement keeps the original draft.

The dedicated retry action always uses the persisted original plan, even if the
configuration form has been edited. Within the open review, edits, removed drafts
and unchecked selections survive retry; newly generated valid drafts are selected.
These local review edits are not saved across a browser reload before import.

Text generation does not require vision. For text-only models, image bytes are
excluded and the prompt forbids claims about unseen images. Questions with retained
source pictures carry `IMAGE_REQUIRES_VISION` for manual review. A model claiming
to use an unseen image is rejected. With vision enabled, associated actual images
and text are sent together; returned image IDs are checked against source IDs.
An explicit image-input rejection triggers one text-only fallback within the same
time budget, with `IMAGE_REQUIRES_VISION` on affected drafts. Auth/quota/model errors
never silently switch to text. No fallback fabricates an image interpretation.

## Safe diagnostics and restart

From the project root, this makes **no network request**:

```powershell
.\backend\.venv\Scripts\python.exe backend/scripts/check_ai_provider.py
```

Output includes provider/configured, actual question/support model IDs, override
usage, supports_text, vision_enabled (also vision_supported for compatibility),
and `connection_tested: false`. It never prints keys, base URL or raw replies.
Credential-like model values are redacted. Expected configured diagnostics:

```json
{"provider":"gemini-openai-compatible","configured":true,"question_model":"gemini-3.8-flash","support_model":"gemini-3.5-flash-lite","vision_enabled":true}
```

Exit code 2 means configuration
is incomplete/invalid. DEV Admins can also GET
`/api/v1/admin/ai-provider/diagnostics`; this requires authentication and is 404
outside development/dev/local/test. Responses are not cached.

DEV diagnostics also include `last_calls.question` and `last_calls.support`, with
`checked_at`, `http_status` and `error_code` only. `runtime_scope: current_process`
means this history is local to the serving worker and resets on restart. An empty
entry means this process has not recorded a call; it is not a provider failure.

The env file path is anchored to backend/.env independently of the launch folder.
Settings are cached per process. After changing **any** env value, stop the current
backend with Ctrl+C in its terminal and start it again (editing `.env` alone does
not reliably trigger Uvicorn reload):

```powershell
cd "D:\ChauAnh\PBL6 new\backend"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Start only one backend and one frontend process; existing listeners should be
stopped in their own terminal before restarting. Frontend needs no AI env variables.

## Real provider verification after adding a key

This makes real requests and consumes the project's available quota; it uses no mock adapter:

```powershell
.\backend\.venv\Scripts\python.exe backend/scripts/check_ai_provider.py --probe
```

It creates a small text DOCX in memory, runs the real extraction/chunking and
Question Generation service, validates one structured draft, then calls the real
Support provider with retrieved support articles. It prints only counts and safe
error codes, never imports content, and does not write to the application's DB.
Successful output has `validated_drafts: 1` and a successful support selection.

To verify the full API upload → drafts → review → explicit import plus persisted
Support session with **real models**, use the opt-in integration script. Its local
database and document storage are isolated and disposable:

```powershell
$env:RUN_REAL_AI_TESTS='1'
.\backend\.venv\Scripts\python.exe backend/scripts/test_ai_live.py
```

Browser acceptance (use a teacher account):

1. Upload a text DOCX to Question Bank → Tạo câu hỏi từ tài liệu. Verify “Tạo câu hỏi
   từ nội dung bằng AI” is enabled. Start with one question. Check source excerpt,
   options, answer, explanation, edit/review and explicitly import only when correct.
2. Open AI PROCTO Support, select Camera/microphone, and **type** a support question.
   Quick topic buttons intentionally use curated KB guidance without a model call.
   The turn response must have `used_provider: true`, source articles and no AI error.
   Selecting no articles/escalation is a legitimate provider decision, not proof of a
   configuration failure.
3. In Network, requests go to the application's backend, never directly to Gemini.
   `Authorization` is the application's user token. No provider key should appear in
   request/response bodies, headers, diagnostics, static JS or local/session storage.
4. Restart backend and repeat diagnostics plus both flows. A configured flag alone
   is not a successful live test. Record actual provider failures by the codes above.

Offline contract tests use HTTP test transports only inside tests; production has
no simulated generator. Without a real API key, live steps are pending and must not
be reported as passed.

## Gemini migration files and verification

Configuration: `backend/.env` (local, ignored), `backend/.env.example`,
`backend/app/core/config.py` (comment only).

Provider and feature integration:
- `backend/app/services/ai_provider.py`
- `backend/app/services/ai_privacy.py` (new text-redaction helper)
- `backend/app/services/question_generation.py`
- `backend/app/services/support_assistant_provider.py`
- `backend/app/services/support_knowledge.py`
- `backend/app/api/v1/question_documents.py`
- `lib/ai-provider.ts`

Diagnostics, live checks and documentation:
- `backend/scripts/check_ai_provider.py`
- `backend/scripts/test_ai_live.py`
- `docs/ai-provider.md`

Regression checks:
- `backend/tests/test_ai_provider.py`
- `backend/tests/test_gemini_provider.py` (new)
- `backend/tests/test_question_documents.py`
- `backend/tests/test_support_assistant.py`
- `tests/e2e/question-documents.spec.ts`
- `tests/e2e/ai-support-provider.spec.ts`

Initial migration validation (before a key was supplied): 57 backend suite tests passed, followed by six targeted
tests (including two new tests, 59 distinct backend cases in total); 11 browser
tests and `tsc --noEmit` passed. The configured key was empty, so both opt-in live
scripts stopped at `AI_NOT_CONFIGURED` before making network calls. Real Gemini
generation, real support selection and browser Network inspection with the actual
key remain acceptance steps after the owner supplies a key.

## Runtime audit (2026-10-17)

Both configured models now passed direct real requests for `OK` and the minimal
`questions[{content, correct_answer}]` structured schema with HTTP 200. An earlier
question-model request returned HTTP 503 with Google's high-demand response in a
JSON list; the adapter now also normalizes list-wrapped errors. Do not treat this
temporary provider failure as a missing configuration or schema failure.

The production question schema passed unchanged: a real DOCX produced three
parsed, source-validated and persisted drafts. The isolated API test confirmed
review reads and explicit import; it never wrote to the application database.
Teacher `giám sát` retrieved one article (`teacher-6`) and the real Support model
selected it with HTTP 200. Greeting `alo` returns category buttons without calling
the provider. No-match retrieval is reported as `SUPPORT_KNOWLEDGE_NOT_FOUND`,
separate from provider errors, and offers clarification or escalation.

Reproduce minimal requests (these consume provider quota):

```powershell
.\backend\.venv\Scripts\python.exe backend/scripts/probe_ai_runtime.py --mode plain
.\backend\.venv\Scripts\python.exe backend/scripts/probe_ai_runtime.py --mode structured
$env:RUN_REAL_AI_TESTS='1'
.\backend\.venv\Scripts\python.exe backend/scripts/test_ai_live.py
```

In DEV, `ai_trace` records extraction/chunk counts, request attempts, HTTP status,
JSON/Pydantic validation, retrieval count and draft persistence using Uvicorn's
logger. No raw exception/provider message, source text, response text or key is
logged. Error descriptions come from local normalized messages. Schema rejection,
parse errors, auth failures and unsupported models are not retried. The remaining
time budget and one-retry cap still apply to transient failures.

UI tests use API fixtures for greetings and error rendering; the real-provider API
tests above separately verify generation and Support. HTTP errors without an AI
code (429, connection failure, 5xx) now also produce a specific user-facing cause.

## End-to-end completion checks (2026-10-17)

The provider, credentials and both configured model IDs were retained. Real model
checks passed for text DOCX generation, regeneration of one draft while preserving
the others, explicit import, and the Support monitoring KB flow. Support escalation
created an actual persisted inbox case with summary; an Admin reply emitted a real
WebSocket event and the refreshed session remained `ADMIN_ACTIVE`. These live API
checks use disposable local databases/storage, not the application's live records.

Real vision checks passed separately for DOCX and PDF containing text, table content
and a network topology image. Both returned the correct three-PC answer, an
explanation and a short source excerpt. The PDF retained page 2. Image attachments
remained accessible through the protected image endpoint after explicit import.
The vision check targets the extracted image-associated source directly through
the real generation service, then verifies review/import through the API.

Reproducible documents are [DOCX](../backend/tests/fixtures/ai-review-topology.docx)
and [PDF](../backend/tests/fixtures/ai-review-topology.pdf), generated by
`backend/scripts/create_ai_review_fixture.py`. Run `backend/scripts/test_ai_live.py`
to repeat real calls. Provider quota and availability still apply.

DOCX headings are preserved as sections, but Word does not provide reliable rendered
page numbers through this extractor. The UI explicitly shows “Trang chưa xác định”
instead of inventing a page. PDF page numbers are preserved. Draft review retains
source text; imported image metadata retains page/section/nearby context. Full
document text is not duplicated into Question Bank after the temporary draft expires.

Deterministic browser tests separately cover mobile/desktop review and protected
image rendering, KB clarification, normalized errors and five batches with two
failures: 12 drafts survive and only the failed batches are retried. Test fixtures
simulate failures only in tests; production generation always calls the provider.


## Managed knowledge and evaluation

See [AI evaluation and Knowledge Base management](ai-evaluation.md) for Admin pages,
persisted metadata, Teacher feedback, exact metric denominators, CSV exports,
privacy restrictions and opt-in live evaluation commands. No model/provider
configuration changes are required for this phase. Apply migration `0020_ai_evaluation`
on other installations.
