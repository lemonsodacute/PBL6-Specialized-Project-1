# Support chat

Student and teacher accounts start with the persistent AI Support Assistant.
Only an explicit, server-authorized escalation creates a human conversation for
that session. Accounts may have several archived threads, with at most one active
support session enforced by the database. Administrators share the escalated inbox.
AI-only and AI-resolved sessions never become inbox entries or unread messages.
Every human message stores the authenticated sender. There is no peer messaging API.

`0018_support_chat` adds `support_conversations`, `support_messages`, notification
links and the `support_message` notification category. Run from `backend`:

```powershell
.venv/Scripts/python.exe -m alembic upgrade head
```

`0019_support_assistant` adds support sessions/turns and converts existing
nonempty human threads into active support cases, preserving their messages.
The local database was upgraded as part of implementation. Other installations
must apply the migration before starting this version of the backend.

`0022_support_session_lifecycle` adds nullable `closed_at`, `closed_by` and a
per-user unique start retry key. It removes the old unique-owner human-thread
constraint. Legacy shared threads are split at session escalation timestamps,
preserving message IDs, notifications and read state. Existing CLOSED sessions
get a closure timestamp without inventing a closing actor. This migration was
applied locally; message and unread counts were verified unchanged.

## Session lifecycle

The compact header menu offers New conversation, End conversation and History.
The X only dismisses the drawer. Ending and replacing an active conversation use
the shared ConfirmDialog; cancelling does not change server state. Human-active
sessions expose End and History, while terminal sessions expose New and History.
The history list groups by Vietnamese calendar day and uses category/topic titles.
Opening a closed session is read-only; an active session can be resumed separately.

Existing `/api/v1/support-assistant` routes handle the lifecycle:

| Route | Behavior |
| --- | --- |
| `POST /sessions` | Resume the active session; when none remains, create an empty welcome session. `{new:true,client_id}` atomically closes the active session and creates a clean one; repeated client IDs return the same result. |
| `GET /sessions?cursor=&limit=` | Owner/role-scoped, paginated history metadata |
| `GET /sessions/{id}` | Owner-scoped AI history and status; Admin may inspect escalated cases, including closed cases |
| `POST /sessions/{id}/turns` | Existing commands; `close` now supports the owner as well as Admin. Terminal sessions reject new commands with 409 `SUPPORT_SESSION_CLOSED`; retries of already committed commands remain idempotent. |

New sessions reset category, topic, retrieval summary and escalation; they never
reuse an old human conversation or reopen a closed session. `reopen` no longer
changes a terminal session. “Vẫn còn vấn đề” starts a new session instead.
AI resolution stays `RESOLVED_BY_AI` and hides the composer. Manual owner closure
sets `CLOSED`, records the actor/time and preserves all messages. Admin resolution
also records a persisted system message informing the owner. Closed sessions move
out of the default Admin active list into the “Đã đóng” filter.

Closure never calls the read endpoint or modifies read watermarks/notifications.
Unread counts include archived threads; system lifecycle messages do not count as
unread. Viewing a thread marks only received messages actually loaded and viewed
at the bottom, independently of lifecycle. A confirmation dialog suspends read
updates in the underlying drawer. Closure emits an authenticated resync event;
AI-only events go only to the owner, human-case events also reach Admins.

## API and permissions

All REST routes below are relative to `/api/v1/chat` and use the existing bearer
or cookie authentication. Client-provided roles and participant IDs do not grant
access. Inaccessible conversations return 404 for read, history, send and read
updates. A conversation whose owner becomes an administrator is no longer
available as a student/teacher support thread.

| Route | Behavior |
| --- | --- |
| `POST /support` | Retrieve an already escalated active thread; otherwise 409 `SUPPORT_ASSISTANT_REQUIRED` (cannot bypass AI support) |
| `GET /conversations?q=&filter=&cursor=&limit=` | Scoped list; admin search by name, email, student code; active filters `all`, `unread`, `student`, `teacher`; archived filter `closed` |
| `GET /conversations/{id}` | Scoped conversation details |
| `GET /conversations/{id}/messages?before=&limit=` | Latest 40 messages, ascending for display; opaque message UUID cursor for older messages |
| `POST /conversations/{id}/messages` | `{body, client_id}`; trimmed plain text, 1–4000 characters; client UUID deduplicates retries; terminal sessions reject new sends with `SUPPORT_SESSION_CLOSED` |
| `POST /conversations/{id}/read` | `{through_message_id}`; marks received messages through the loaded watermark |
| `GET /unread-count` | Persisted incoming unread message count |
| `WS /ws` | Authenticated account change stream |

Admin read state is shared across the support team. Reading a student's message
in one admin tab updates other admin tabs and their notifications. Reading an
admin reply updates the student's/teacher's count. Outgoing messages are never
counted as unread for their sender's side. Newer messages beyond the submitted
read watermark stay unread.

The user schema currently has no teacher code field. Teacher context and search
therefore use the real name/email; student context also includes the student code.
The profile link opens the existing user detail dialog.

## Realtime and reconnect

The socket first receives `{type:"auth", token:"<access token>"}` within five
seconds. This preserves per-tab credentials and avoids putting tokens in URLs.
An explicitly invalid token never falls back to another account's cookie.
The server derives the account from the token and database, checks activity and
expiry on heartbeat, and rejects arbitrary subscription frames. Browser origins
must be included in the existing backend `CORS_ORIGINS` configuration.

PostgreSQL `LISTEN/NOTIFY` distributes committed message/read changes to all
backend workers. The existing connection manager delivers only change type and
conversation ID to the relevant account sockets. Message bodies are fetched
through permission-checked REST. Writes persist independently of any socket.
Reconnect/focus resynchronizes from REST, without generating notifications.
After repeated failed connections only, a 15-second polling fallback is enabled
until the WebSocket reconnects. The UI shows its disconnected state.

The chat entry point is hidden on attempt, verification and live-class screens.
Student sends are also rejected by the backend while an unexpired exam attempt
is in progress. Scoring, proctoring, identity and classroom media rules are unchanged.

## Verification

Backend tests cover ownership, forbidden peer access, actual admin sender,
shared read counts, precise watermarks, duplicate retries/notifications, validation,
history/search pagination, exam restrictions and WebSocket authentication.

```powershell
cd backend
.venv/Scripts/python.exe -m unittest tests.test_support_chat tests.test_settings tests.test_profile_requests -v
```

The browser suite uses three independent browser contexts, real PostgreSQL,
real REST and real WebSockets. It creates disposable actors and cleans up their
threads/notifications afterwards. It additionally simulates a lost HTTP response
after persistence to check idempotent retry. Screenshots go to `artifacts/`.
Start backend on port 8000 and frontend on port 3000, then run from the root:

```powershell
$env:SUPPORT_CHAT_LIVE_E2E='1'
$env:PLAYWRIGHT_CHANNEL='chrome'
$env:PLAYWRIGHT_BASE_URL='http://localhost:3000'
./node_modules/.bin/playwright.cmd test tests/e2e/support-chat.spec.ts
```

This version supports text only. Conversation and message history are persisted
in the database; local storage is not used as the source of unread/read state.

## AI support lifecycle

`POST /api/v1/support-assistant/sessions` with `{new:false}` resumes the active
session or creates a clean greeting/category screen. `{new:true,client_id}` starts
a separate session and archives the prior active one. `GET /sessions/{id}`
restores its visible history. Owners can read their own sessions; Admin can read
only escalated/human cases, not private AI-only sessions.

`POST /sessions/{id}/turns` accepts `client_id` (UUID) and `action`: `category`,
`topic`, `message`, `clarify`, `retry`, `resolved`, `unresolved`, `escalate`, `close`, `reopen`.
Selections use `value`; messages use `text` (max 2,000 characters). Optional
`route` is stripped of query/fragment and checked against role-specific KB routes;
`error_code` is a small allowlist. Client role/owner/prompt fields are rejected.
Retries with the same ID and request do not duplicate messages, cases or notices.

States: `AI_ACTIVE` → `RESOLVED_BY_AI`, or `ESCALATED` → `ADMIN_ACTIVE` → `CLOSED`.
Owners can close their AI or human case; Admin can resolve human cases. Terminal
sessions remain read-only and continued support starts a new session. Admin
replies and close transitions use the same
authenticated WebSocket resynchronization as chat.

Notification `?chat={conversation_id}` links explicitly open that permission-checked
thread, including a closed thread, so archived unread replies remain reachable.
The target is consumed and removed from the URL; subsequent X/reopen resumes the
current active session instead of repeatedly navigating to an old notification.

Escalation is allowed only after explicit unsuccessful feedback, an unsupported
or administrative issue, or provider unavailability. It atomically stores a
server-built summary (name/role/student code when present, category/subcategory,
issue, retrieved article titles/IDs, exact visible guidance, actual outcome),
creates the inbox message and notifications. Summaries never contain hidden
prompts, model reasoning or internal provider errors. Admin sees a collapsible
summary and only active escalated cases in the list; closed history remains
accessible to its participants.

## Knowledge and provider

`support_articles` is the managed, server-side support KB. Migration
`0020_ai_evaluation` seeds it from `backend/app/support/knowledge.json`.
Admin → AI Support → Knowledge Base manages article content, role, category,
keywords, related route, active status and updated-by/time. Changes are read from
the DB on the next query without a process restart. Disabled articles are excluded
from retrieval and their existing quick-topic buttons. Historical guidance remains
unchanged. Admin changes log metadata only, never article content or prompts.

`backend/app/support/knowledge.json` remains the reviewed seed and category menu.
It contains 27 role-specific articles and two-level category/topic menus, built
from current Help content plus reviewed troubleshooting. To update after checking
features/routes, edit `backend/scripts/build_support_knowledge.cjs` and run:

```powershell
node backend/scripts/build_support_knowledge.cjs
```

Rebuilding the seed does not overwrite articles already edited in the database.

Quick actions render the selected reviewed article directly, labeled as support
documentation. They work without an external model and do not pretend that a
model call occurred. Free-text uses role/category-scoped lexical retrieval first.
No sufficiently relevant source returns `SUPPORT_KNOWLEDGE_NOT_FOUND` and
“Tôi chưa tìm thấy hướng dẫn phù hợp cho vấn đề này.” The owner may choose
“Thử mô tả chi tiết hơn” (`clarify`, returning to DETAIL without creating a case)
or “Liên hệ System Admin”. Clarification is accepted only for a knowledge miss.
Greetings return the category choices without retrieval or a provider call.
Known privileged cases (locked account, authoritative profile, revoked card,
incorrect scores/permissions) are routed to Admin without attempting mutations.

`SupportAssistantProvider` and question generation both use the same
`OpenAICompatibleClient` in `app/services/ai_provider.py`, configured exclusively
by `QUESTION_GENERATION_BASE_URL`, `QUESTION_GENERATION_API_KEY`, and
`QUESTION_GENERATION_MODEL` in `backend/.env`. There is one provider/client, one
API key and one default model. `SUPPORT_ASSISTANT_MODEL` optionally overrides
only the Support model; empty falls back to `QUESTION_GENERATION_MODEL`.
Support has no separate endpoint or key. See [AI provider configuration](ai-provider.md).
The Support feature service does **not**
import question generation, query a question bank, index exam content, or get
tools/database access. Only role, selected category, redacted question, allowlisted
route/error code and up to three retrieved articles enter provider context.

The answer is constrained extractive RAG: the provider returns schema-validated
article IDs and an escalation flag; the server composes the answer from those
articles' exact steps and verified links. Unknown IDs or malformed output are
rejected. This deliberately prevents invented buttons, policies, routes, actions
or leaked model prose rather than relying solely on a prompt to avoid hallucination.
Treat all user text as untrusted. Password/token/API-key patterns are redacted;
the UI also tells users not to send secrets.

Credentials are never forwarded across redirects. No `NEXT_PUBLIC_*` secret is
used. Support has a model-only override and operational timeout/quota settings;
timeout defaults to 25 seconds. Failures show Retry and Contact System Admin.
When shared provider configuration is missing, the drawer says “Trợ lý AI hiện chưa được cấu
hình” and permits immediate Admin escalation while keeping curated topic guidance
available. This is the explicit service-unavailable exception to the initial
escalation gate. No demo response replaces the model.

Defaults allow six provider attempts/minute and 100/day per authenticated owner
(`SUPPORT_AI_PER_MINUTE`, `SUPPORT_AI_PER_DAY`). Failed calls count too. PostgreSQL
owner/session locks serialize state transitions and quotas across workers. Sessions
are capped at 100 guided turns and 30 new sessions/day; escalation/resolution
remains possible at limits. AI history persists in the database until user deletion;
no new retention policy or automatic destructive cleanup is assumed.

The existing exam-page hiding remains. Backend AI reads/actions also check active
exam attempts, including another-tab API requests; generation checks again after
the provider returns. The assistant cannot perform Admin actions or submit exams.

Additional checks:

```powershell
cd backend
.venv/Scripts/python.exe -m unittest tests.test_support_assistant tests.test_support_chat tests.test_support_lifecycle -v
```

The live browser suite now also checks category guidance, AI resolution without
an inbox case, escalation summary, real Admin replies, persisted refresh and
Admin close/new conversation, owner closure, read-only history and clean context.
The menu tests cover both roles at 375px, cancellation and a rapid double click.
The PostgreSQL migration test uses only temporary tables and verifies that legacy
thread splitting preserves message IDs, notifications and unread state.
Provider protocol/grounding/failure tests use isolated
test transports; production has no mock provider.
