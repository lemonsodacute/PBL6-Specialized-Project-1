# LIVE CLASS STUDENT SHELL FIX

Verified 26 October 2026, Asia/Saigon.

## Root cause

`/live-class/[id]` is outside the `/student` route tree. More importantly, the root `AppShell` explicitly returned a bare `<main className="classroom-shell">` for every `/live-class/*` route, bypassing the existing `WorkspaceShell` regardless of authenticated role or classroom state. That removed the Student sidebar, header, notifications, account menu, typography and spacing even for ended classes.

The route now uses the same existing `WorkspaceShell` as the rest of the application, selected by the authenticated user. The online-class navigation link also recognizes the detail route. No second Student shell was introduced.

## Results

| Requirement | Result | Evidence |
| --- | --- | --- |
| Student shell | FIXED | Shared sidebar, topbar, account menu, bell and Student theme in detail/setup/history/waiting states. |
| Ended state | FIXED | Shared Student page header, linked class context, small existing owl and structured information card. No camera/microphone, admission request, token request or provider connection on opening an ended class. |
| Upcoming state | FIXED | Student list opens the detail route inside the shell. Join/device capture stays unavailable until the existing lifecycle allows it. |
| Waiting state | FIXED | Information card, admission message, Student navigation and explicit return control. Existing admission polling is retained; no token is requested before admission. |
| Active classroom | PASS | Existing meeting implementation occupies the full viewport and retains ProctoOwl, authenticated role, account menu and leave control. Presentation changes through scoped CSS without remounting the room or adding a second media implementation. |
| Student sidebar active state | PASS | `Lớp học trực tuyến` is active on `/live-class/[id]`; Dashboard is not active. |
| Teacher regression | PASS | Teacher details retain the Teacher shell and attendance. Real Teacher/Student meeting contexts, media and admission controls pass. Admin detail also retains its existing role shell. |
| Mobile | PASS | 390px light/dark, existing sidebar drawer and keyboard dismissal, stacked actions, readable dates, no horizontal overflow, compact full-width active room. |
| Business logic changed | NO | Provider, token handling, attendance, lifecycle, permissions, enrollment and backend authorization are unchanged by this fix. |

Scheduled dates and actual end dates are shown separately with full years and the explicit Vietnam time zone. The inconsistent dates in the presentation fixture remain visible; no stored schedule/end values were rewritten.

## Files changed by this fix

- [components/layout/AppShell.tsx](../components/layout/AppShell.tsx): reuse the role-based shell and activate the online-class navigation item.
- [app/live-class/[id]/page.tsx](../app/live-class/%5Bid%5D/page.tsx): Student page header, breadcrumbs and state-card integration.
- [components/live-class/ClassroomSessionCard.tsx](../components/live-class/ClassroomSessionCard.tsx): shared ended/upcoming/cancelled/waiting information card, dates and real route actions.
- [components/live-class/MeetingRoom.tsx](../components/live-class/MeetingRoom.tsx): visible ProctoOwl and authenticated role context in the existing meeting header.
- [app/classroom.css](../app/classroom.css): summary-card styling and immersive presentation only for an active meeting.
- [tests/e2e/live-class-shell.spec.ts](../tests/e2e/live-class-shell.spec.ts): 10 shell/UI regressions.
- [tests/e2e/live-classroom.spec.ts](../tests/e2e/live-classroom.spec.ts): active room geometry/context, real waiting-shell and leave/return assertions.
- This report.

## Tests and build

- **10/10 production Chrome UI tests passed**: 1440/1024/390px in light/dark, ended-state dates and no media/token/provider activity, notification/account controls, real return route, mobile drawer, list-to-upcoming navigation, admission waiting, Teacher/Admin shells.
- **3/3 real FastAPI + LiveKit integration tests passed**: Student mobile scheduled/access/preview/join/leave cleanup; actual audio/video, participants, chat, refresh/reconnect, end and attendance; admission, screen sharing, host policy, mute and removal. These tests use existing private E2E accounts and synthetic media tracks with real backend/SFU connections.
- **Production build: PASS** (`npm run build`, 42 static pages generated). Existing nonblocking lint warnings remain.
- **TypeScript: PASS** (`npx tsc --noEmit`).
- **Targeted ESLint: PASS**, zero errors; five pre-existing effect/image warnings in the classroom implementation.
- **Whitespace validation: PASS** (`git diff --check` for changed source/test files).

The final browser checks ran against the production build on a temporary local server. Earlier development-server runs included test-harness assertion failures and timeouts while the build was running; the corrected final production runs above passed. The original development server and generated development type reference were preserved.

Logs: [UI](../artifacts/live-class-shell/ui-production.log), [mobile real room](../artifacts/live-class-shell/real-production.log), [multi-participant real rooms](../artifacts/live-class-shell/real-multi.log), [build](../artifacts/live-class-shell/build.log).

Screenshots: [Student ended desktop](../artifacts/live-class-shell/student-ended-desktop.png), [Student ended mobile](../artifacts/live-class-shell/student-ended-mobile.png), [active mobile room](../artifacts/live-class-shell/real-room/student-room-mobile.png).
