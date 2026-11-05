# ONLINE CLASSROOM UPGRADE

Validated on 24 October 2026 (Asia/Saigon).

Realtime provider: **LiveKit SFU**, retained from the existing implementation. Existing routes, authentication, class membership, session lifecycle, attendance and notifications were extended. No second classroom system was created.

PASS below means implemented and checked at the level described in the evidence column; it does not imply physical-device or WAN certification.

| Feature | Result | Evidence |
| --- | --- | --- |
| Camera | PASS | Remote video frames, camera toggles and denied-device paths verified. |
| Microphone | PASS | Remote audio subscription, self-mute and host mute verified. |
| Device switching | PASS | Microphone and camera switched through the SDK without leaving. |
| Video grid | PASS | One and three participants verified; responsive layouts inspected. |
| Active speaker | PASS | LiveKit active-speaker events drive the highlight; speaker view verified. Speech detection was not separately asserted. |
| Screen sharing | PASS | Teacher and permitted student sharing received by other browsers; revocation stops sharing. |
| Participants | PASS | Real SFU identities, host ordering and media states. |
| Class chat | PASS | Server-authenticated messages delivered over LiveKit; disabled chat enforced server-side. |
| Raise hand | PASS | Server timestamps and participant metadata; host lowers a hand. |
| Reactions | PASS | Ephemeral LiveKit packets; received on remote participant tiles. |
| Teacher mute controls | PASS | Mute and mute-all; unmute request requires student confirmation. |
| Waiting room | PASS | No room token until admission; admit-all tested with two students. |
| Lock room | PASS | Server token/join enforcement; stale vs current leave tested. |
| Remove participant | PASS | Confirmation, provider disconnect and rejoin denial verified. |
| End for all | PASS | Room deletion, ENDED state, old-token rejection and persisted attendance. |
| Attendance | PASS | Actual SFU SID, join/leave intervals, duration, roster and MSSV. |
| Reconnect | PASS | SDK reconnect states, same-room refresh and fresh-token retries. Hard WAN interruption was not separately tested. |
| Mobile | PASS | 390px and 1024px layouts, bottom sheets, keyboard dismissal and no horizontal overflow verified. |

**Fake data: NONE in the application.** Automated browser tests use isolated test accounts and synthetic camera/microphone/screen sources; API, authorization, SFU, media transport, data channels and PostgreSQL are real.

## Validation

- Backend classroom tests: **31 passed** (`tests.test_live_classroom`).
- PostgreSQL concurrency regressions: **2 passed** (`tests.test_classroom_postgres`): close retries skip busy rows; end-for-all stays responsive while a leave webhook holds the session row.
- Browser/provider integration tests: **8 passed**, production Next.js frontend, Chrome, real FastAPI + LiveKit + isolated PostgreSQL. Teacher, Student A and Student B run in separate browser contexts.
- TypeScript: **PASS**, `tsc --noEmit`.
- Production build: **PASS**, Next.js 15.5.28; all 42 static pages generated. Nonblocking lint warnings remain.
- Migration `0024_classroom_controls`: **applied** to the local development database and the isolated QA database.

The browser suite covers media, chat, refresh/reconnect, attendance, admission, host policy, reactions, raised hands, screen sharing, removal, end-for-all, device changes, speaker preference, fullscreen dialogs, duplicate tabs, mobile/tablet panels, permission failures, publish failures, provider/WebSocket retries and cleanup of late media captures.

Two concurrency problems were fixed during real integration checks: closure retries waiting behind busy sessions, and the end-class result update blocking the event loop behind a leave webhook. Row locking now runs outside the event loop; the retry worker skips busy rows and tries again.

## Known limitations

- Physical webcams/microphones, multiple physical computers, production TURN/firewall configuration, WAN outages and large-class capacity need deployment testing.
- Output-device selection is shown only where the browser supports it. Fullscreen uses the browser API.
- Waiting-room admission outside the SFU uses the existing session refresh, with up to approximately five seconds of UI delay. Connected participants, media, chat, reactions, hand state and policy updates use LiveKit events.
- Chat is ephemeral, capped at 200 messages per client and cleared on refresh. Reactions are temporary and never written to the database.
- Recording, breakout rooms, captions and polls remain outside this core upgrade. No inert controls were added for them.
- Automatic approval review blocked recursive deletion of the ignored `.next-classroom-upgrade` test build cache, with only "blocked by policy" supplied as the reason. It remains on disk. Isolated test accounts, class data and SFU rooms were cleaned up.
- Earlier exploratory runs failed or stalled; the final eight-case production browser suite passed after the fixes.

## Files changed

- [app/classroom.css](../app/classroom.css)
- [app/dashboard/live-classes/page.tsx](../app/dashboard/live-classes/page.tsx)
- [app/live-class/[id]/page.tsx](../app/live-class/[id]/page.tsx)
- [app/student/live-classes/page.tsx](../app/student/live-classes/page.tsx)
- [backend/alembic/versions/0024_classroom_controls.py](../backend/alembic/versions/0024_classroom_controls.py)
- [backend/app/api/v1/live_classes.py](../backend/app/api/v1/live_classes.py)
- [backend/app/models/entities.py](../backend/app/models/entities.py)
- [backend/app/schemas/live_classes.py](../backend/app/schemas/live_classes.py)
- [backend/app/services/classroom_controls.py](../backend/app/services/classroom_controls.py)
- [backend/app/services/classroom_lifecycle.py](../backend/app/services/classroom_lifecycle.py)
- [backend/app/services/classroom_provider.py](../backend/app/services/classroom_provider.py)
- [backend/tests/test_classroom_postgres.py](../backend/tests/test_classroom_postgres.py)
- [backend/tests/test_live_classroom.py](../backend/tests/test_live_classroom.py)
- [components/layout/AppShell.tsx](../components/layout/AppShell.tsx)
- [components/live-class/DeviceSettings.tsx](../components/live-class/DeviceSettings.tsx)
- [components/live-class/DeviceSetup.tsx](../components/live-class/DeviceSetup.tsx)
- [components/live-class/MeetingRoom.tsx](../components/live-class/MeetingRoom.tsx)
- [components/live-class/ParticipantTile.tsx](../components/live-class/ParticipantTile.tsx)
- [docs/online-classroom-upgrade-report.md](../docs/online-classroom-upgrade-report.md)
- [docs/online-classroom.md](../docs/online-classroom.md)
- [lib/api.ts](../lib/api.ts)
- [lib/classroom-errors.ts](../lib/classroom-errors.ts)
- [lib/classroom-livekit.ts](../lib/classroom-livekit.ts)
- [lib/classroom.ts](../lib/classroom.ts)
- [lib/notifications.ts](../lib/notifications.ts)
- [tests/e2e/live-classroom.spec.ts](../tests/e2e/live-classroom.spec.ts)
- [types/index.ts](../types/index.ts)

## Review images

- [Three participants](../artifacts/classroom-upgrade/three-participants.png)
- [Screen sharing](../artifacts/classroom-upgrade/screen-sharing.png)
- [Mobile classroom](../artifacts/classroom-upgrade/student-room-mobile.png)
- [Mobile chat sheet](../artifacts/classroom-upgrade/mobile-chat-sheet.png)

Operation and reproducible test setup: [online-classroom.md](online-classroom.md).
