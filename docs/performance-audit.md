# Performance audit — 21 October 2026

Next.js **15.5.28**, React 18, FastAPI/SQLAlchemy/PostgreSQL. No dependency upgrade, schema migration, index, theme redesign, or change to grading, permissions, AI provider/model, or face thresholds.

## Evidence and method

Measurements ran on the local Windows machine (about 8 GB RAM), with headless Chrome and real FastAPI/PostgreSQL. This machine was memory constrained; these are local observations, not production capacity guarantees. All mutations used the isolated release QA database. Existing application data was only counted, never modified by the performance fixture.

Before editing, first-party source and hashes were saved to `artifacts/performance/before-source.zip` and `before-hashes.json`. For the controlled API comparison, the original backend was extracted from that snapshot and given the same passive timing instrumentation as the optimized backend. Each ran separately on port 8001, against the same QA database, with one warm-up and **five measured requests per endpoint**. Browser and dev compilation were stopped during this comparison. The source snapshot, fixture, timing JSON and logs are local ignored artifacts.

The QA fixture contains 20 named performance classes and 20 banks. Before adding it, the existing application database had 20 users, 5 classes, 23 enrollments, 7 exams, 7 attempts, 29 notifications, 5 banks, 55 questions, 4 support sessions and 6 support messages. This is a modest dataset; no scale/load-test claim is made.

Usable source files:

- `before-controlled-api.json` / `after-controlled-api.json`: controlled API comparison.
- `baseline-production-valid-browser.json`: original production browser baseline, all three roles.
- `after-production-final-browser.json` and `after-production-warm-browser.json`: optimized production; the latter also repeats four Teacher navigation flows three times.
- `dev-before-stdout.log` / `dev-after-stdout.log`: actual cold route compilation logs.
- `source-scan-automatic.json` / `source-scan-bounded.json`, `layout-imports.json`, `bundle-before.json` / `bundle-after.json`.

Earlier exploratory browser captures with incorrect cookie setup or selectors matching the previous route were discarded. One broad file search contaminated an early sample and was stopped; that sample is excluded. The original cold dev browser run did not complete Admin navigation within its timeout, so it is not presented as a successful full benchmark. Timings below only use valid observations and actual server compile logs.

## Dev versus production

| Observation | Original Webpack dev | Scoped-source Turbopack dev |
| --- | ---: | ---: |
| Cold dashboard compilation | 53.9 s | 11.7 s |
| Original cold class detail compilation | 39.1 s | — |
| Original cold Teacher profile compilation | 80.6 s | — |
| Browser bank-list first navigation | 15,065 ms | 2,184 ms |
| Browser bank-detail first navigation | 13,103 ms | 2,595 ms |
| Browser Student exam-list first navigation | 5,936 ms | 3,356 ms |

These are cold observations, not medians of repeated clean builds. Turbopack still compiles cold routes in seconds. The original production browser flows were already below one second; the tens-of-seconds delay was reproduced in **dev compilation**, not in a warm production click. Production remains the appropriate way to assess the deployed experience.

`npm run dev` now uses the installed Next.js version's Turbopack. `npm run dev:webpack` retains the previous bundler for diagnosis. `npm run build` / `npm run start` retain production behavior. `AI_PROCTO_DIST_DIR` can isolate audit build output; its default is unchanged.

Tailwind previously discovered **1,041 files / 24,977 candidates** across application source, backend, tests, docs, `.agents`, and generated artifacts. Explicit `app`, `components`, and `lib` sources discover **199 files / 3,269 candidates**. The scanner itself measured 389.46 → 100.83 ms. The larger benefit is avoiding unrelated source discovery/watch invalidation; **389 ms does not explain an 80-second compilation by itself**. Explicit sources use Tailwind's documented [`source(none)` and `@source`](https://tailwindcss.com/docs/detecting-classes-in-source-files).

## Controlled API results

Median end-to-end HTTP time includes reading and parsing the JSON response. SQL counts include authorization queries. DB time is the cumulative cursor execution time, not connection-pool wait or the full ORM/serialization cost.

| Flow | HTTP before → after | SQL count before → after | DB time before → after |
| --- | ---: | ---: | ---: |
| Teacher classes, page of 20 | 105.66 → **29.39 ms** | 43 → **6** | 68.40 → 11.24 ms |
| Teacher banks, page of 20 | 85.57 → **26.87 ms** | 23 → **4** | 50.34 → 8.17 ms |
| Teacher exams | 83.14 → **35.88 ms** | 31 → **6** | 56.47 → 13.60 ms |
| Student exams | 96.70 → **32.83 ms** | 34 → **7** | 54.96 → 12.44 ms |
| Student history, 5 attempts | 102.29 → **66.48 ms** | 44 → **17** | 62.47 → 32.90 ms |

Afterward, all 90 measured normal API requests across 18 role/endpoint combinations were below 500 ms; the slowest was 216.35 ms. Profile, class detail, available students, notifications, support inbox/count and Admin users/cards were also sampled. Several unchanged small endpoints varied in either direction; no blanket improvement claim is made for them.

The database bottleneck was **repeated small queries while serializing each row**, not a demonstrated single missing-index query. Classes batch teacher/member/assignment counts; banks group counts for the authorized page; exams batch questions, classes, attempts and student result metadata; attempt history batches answers, sessions, student metadata and violation counts. Filtering, ownership and pagination still run in SQL before these page-scoped summaries. Expiration finalization and per-attempt locks remain in place. No index was added without query-plan evidence.

## Browser results and request behavior

The browser metric named `handler_to_paint_ms` is actually captured **DOM click/input event → expected visible element + two animation frames**. The event listener runs in capture phase, before the React handler. It is a conservative automated readiness observation, not direct instrumentation of every React handler or physical display presentation. Exam-list readiness means the route/search UI is available; it does not assert every API result row has finished rendering. API durations are measured separately above.

| Production flow | Before, first observed flow | After, first observed flow |
| --- | ---: | ---: |
| Teacher bank list | 244.7 ms | 245.6 ms |
| Bank detail | 161.1 ms | 174.3 ms |
| Bank search, including debounce | 856.0 ms | 853.4 ms |
| Teacher exam route/search UI | 99.7 ms | 40.3 ms |
| Teacher classes | 243.0 ms | 126.7 ms |
| Remove student | 262.2 ms | 127.9 ms |
| Add student | 142.9 ms | 130.3 ms |
| Save Teacher profile | 143.7 ms | 241.1 ms |
| Student exam list | 144.1 ms | 160.5 ms |
| Notifications open | 59.7 ms | 57.6 ms |
| Support opens its session | 138.8 ms | 139.2 ms |
| Admin users route/search UI | 108.0 ms | 95.5 ms |

The after column uses `after-production-warm-browser.json` first-flow records, before its repeat loop. These single observations show ordinary run-to-run variation, including slower profile save and Student navigation; they do not prove a universal frontend speedup.

In the after repeat loop (**n=3** per flow), median readiness was banks **131 ms**, detail **142.3 ms**, classes **142.1 ms**, exams **60.5 ms**. Median visible pending feedback was **10.9 / 28.5 / 11 / 8.1 ms**, respectively. Account-menu observations were below 100 ms after event capture. Pending sidebar feedback uses Next's [`useLinkStatus`](https://nextjs.org/docs/15/app/api-reference/functions/use-link-status), with route loading boundaries using the existing skeleton. No fake delay was introduced.

One bank-detail trace, relative to event capture (rounded; independent browser/server clocks can differ slightly):

| Phase | Bank metadata | Questions |
| --- | ---: | ---: |
| Browser fetch starts | +22.8 ms | +23.7 ms |
| Backend receives | +23.4 ms | +24.4 ms |
| First DB query begins | +35.7 ms | +35.5 ms |
| Last DB query ends | +47.9 ms | +53.5 ms |
| Backend response headers ready | +48.9 ms | +54.1 ms |
| Browser fetch receives headers | +50.7 ms | +56.6 ms |

Pending feedback appeared at +28.5 ms; the expected detail heading plus two frames was observed at +145.4 ms. The data requests overlap. Mutation refresh for bank metadata/questions was also made concurrent; dependent writes still finish before refresh.

Initial unread endpoints previously ran **twice each per role** (`chat/unread-count`, `notifications/unread-count`); now **once each**. Each initial role load has one chat WebSocket, one `/auth/me`, and one token refresh. Two `/exams` calls on Teacher/Admin overview intentionally request **different statuses** (ongoing and published); sanitized timing captures omit query parameters, so pathname equality alone is not evidence of duplication. RSC link prefetch requests are also distinct from API refetches.

Chat subscribes before taking its initial snapshot, with a 500 ms fallback when the socket is unavailable. A socket-ready event no longer triggers an unrelated notification refetch. Polling pauses while hidden; fallback chat polling ends when WebSocket is ready. Focus/visibility events in one activation frame coalesce, with listener/timer cleanup. Explicit mutations still refresh affected data; there is no generic authorization cache or stale-response deduplication across mutations. Add/remove student measures show the mutation plus the relevant class/member refresh, not a whole-app reload.

Auth restoration unlocks the workspace after `/me` validates the session, allowing token rotation to finish in the background. Generation guards prevent late restoration/refresh from resurrecting a logged-out or replaced session. Unchanged profile objects retain their reference, and chat context values are stable between actual state changes. Backend authorization remains authoritative.

Search already uses a 350 ms debounce and stale-result guards in the shared collection hook. The measured search issues one request for the filled query. Its automated 853 ms readiness figure includes debounce and selector/animation-frame observation; the browser capture shows the request starting about 364 ms after input. No new search delay was added.

## Bundle and expensive work

The conservative static shared-layout graph contains 49 first-party modules. Its external imports are React, ReactDOM, Next font/link/navigation and lucide-react: **no LiveKit, Gemini, PDF/DOCX parser, OCR, ONNX or chart SDK was found in that shared static graph**. Route-local heavy features remain scoped to their feature routes. No speculative lazy-loading or blanket memoization was added.

Shared-layout asset union (gzip): CSS **43,428 → 42,318 bytes**, JS **144,525 → 144,827 bytes**. This is a small CSS reduction and a slight JS increase for pending/navigation behavior, not a major bundle-size optimization.

AI/OCR/face operations remain separately scoped and retain their loading/progress and error states. Source inspection confirms Gemini generation/regeneration and support commands use synchronous FastAPI endpoints (threadpool execution); async document upload delegates extraction to `run_in_threadpool`, face verification delegates model loading/inference to `run_in_threadpool`, and card preview delegates its work while OCR uses its existing subprocess worker. They do not introduce a global frontend pending gate. This is not a threadpool saturation/load test and does not claim lower Gemini/OCR/inference latency. Provider/model, OCR pipeline, face matching thresholds and grading implementation were not changed. Existing tests cover these boundaries; paid external AI calls are not part of the normal-API benchmark.

## Development timing and reproduction

`backend/app/core/performance.py` is enabled only outside `ENVIRONMENT=production`. It adds `Server-Timing` (application duration, cumulative DB duration, query count) and `X-Development-Timing` (receive timestamp, first/last DB offsets, non-DB duration). Requests over 500 ms emit method, **route template**, status, total, DB sum/count/max, and non-DB time. It records no SQL text, query parameters, request/response bodies, credentials or user identifiers. Production installs neither these timing headers nor SQL listeners. Response timing stops when headers are ready; streamed payload completion is outside that backend duration.

Normal local development:

```powershell
npm run dev
# Optional diagnostic fallback:
npm run dev:webpack
# Compare with a warmed production build:
npm run build
npm run start
```

The benchmark helpers are deliberately restricted to an existing release QA runtime, not general application credentials. They read private fixture credentials without printing them. With that isolated runtime provisioned:

```powershell
# From backend/, terminal 1:
.\.venv\Scripts\python.exe scripts/release_qa_runtime.py run -- python -m scripts.performance_backend
# From repository root, terminal 2:
node scripts/performance-audit.mjs --mode=api --label=after-controlled
node scripts/performance-audit.mjs --mode=browser --base=http://localhost:3100 --label=after-production-warm
node scripts/performance-source-scan.mjs
node scripts/performance-source-scan.mjs --bounded
node scripts/performance-imports.cjs
```

For a backend A/B reproduction, stop the QA API first and add `--snapshot` after `scripts.performance_backend` to use the saved original source. The snapshot and private runtime are ignored local evidence, not distributable application files. Do not run before and after simultaneously against the same port. Browser benchmarking rewrites only its own fetch/WebSocket URLs to the real isolated API; it does not fake responses. The server on 3100 must already be running. `scripts/stop-performance-services.ps1` only stops services whose saved PID, creation time and command match this audit.

## Validation

- Production build, lint and TypeScript: exit 0. TypeScript was rerun after removing audit-only Next type-directory entries. Existing lint warnings remain; no new dependency versions were installed.
- Backend full discovery: **603 tests, 590 passed, 13 skipped**, 192.238 s. PostgreSQL opt-ins for identity, avatar, settings, support lifecycle, card profile, quality ratings and release acceptance were enabled. An initial full run exposed migration logging state leaking into the new timing assertion; the test now isolates its logger's `disabled` flag, and the full suite was rerun successfully. This did not require an application behavior change.
- New focused browser checks: **3 passed** (pending navigation with a held destination response, initial unread/focus coalescing, early validated workspace plus late-refresh/logout isolation).
- Source/browser production chunk secret scan: **671 files, zero findings**. This is the existing redacted heuristic/configured-value scan, not a history audit.
- Hash comparison: package-lock, design-system CSS, grading, face recognition and face config unchanged; the body of globals CSS is identical after the new Tailwind source directives.
- Selected production browser regression: **237 passed, zero failed/skipped**, 18.6 minutes, one Chrome worker. Includes all three roles, auth/role boundaries, enrollment, collections/debounce/pagination, profile/avatar, notifications, pending navigation, exam entry/save/submit, question-document workflows, monitor collections and responsive/light/dark layouts. This is the selected 21-file regression, not a claim that every repository browser test was run again.
- Real service coverage within those 237 tests: **4 PostgreSQL/FastAPI release acceptance cases** (three-role login/refresh/logout/permission boundaries, answer persistence and Student/Teacher result agreement), **6 LiveKit cases** (including real audio/video tracks, room chat, attendance, refresh, cleanup and failure handling), and **1 three-session real REST/WebSocket support chat case** (unread/read, isolation, retry, history, refresh and mobile). Browser media tracks are deterministic test canvas/audio streams; this does not certify every physical camera/microphone device. Other UI cases use their existing API fixtures. Paid Gemini calls and private face probes were not rerun for this optimization.
- An initial browser attempt on port 3100 was interrupted because a legacy class-membership fixture hardcodes CORS origin 3000; the complete successful run used port 3000 and the same production build. This fixture issue does not affect the separately measured real-API benchmarks. Full evidence: `regression-final.log`.
- Audit-owned QA API/frontend services were stopped after verification. The existing SFU and the application's original business database were preserved.

## Files changed

Application:

- `package.json`, `next.config.mjs`, `.gitignore`: dev bundler, isolated audit output and ignored artifacts. `package-lock.json` is unchanged.
- `app/globals.css`: frontend-only Tailwind source discovery; existing visual CSS unchanged.
- `components/layout/AppShell.tsx`; `app/{dashboard,student,admin,teacher}/loading.tsx`: immediate pending/skeleton feedback.
- `components/auth/AuthContext.tsx`, `lib/visible-refresh.ts`: validated-session readiness, stale-session guards, stable profile references and activation coalescing.
- `components/chat/SupportChatProvider.tsx`, `components/notifications/NotificationsProvider.tsx`: initial snapshot, polling and listener behavior.
- `app/dashboard/question-banks/[bankId]/page.tsx`: concurrent independent refresh reads.
- `backend/app/core/performance.py`, `backend/app/main.py`: development request/DB timing.
- `backend/app/api/v1/{classes,question_banks,exams,attempts}.py`, `backend/app/services/student_exam_state.py`: batched page summaries with existing access/result policies.

Verification and documentation:

- `backend/tests/test_performance.py`, `tests/e2e/performance.spec.ts`.
- `scripts/performance-audit.mjs`, `scripts/performance-source-scan.mjs`, `scripts/performance-imports.cjs`, `scripts/stop-performance-services.ps1`.
- `backend/scripts/performance_backend.py`, `backend/scripts/performance_fixture.py`.
- `README.md`, `docs/performance-audit.md`.
