# AI PROCTO — Frontend UI/UX

Latest cross-role UI audit (2026-10-12): [shared UI audit](ui-consistency-audit.md).
This covers responsive cards, action menus, confirmations, layers, and the latest validation.

Latest presentation follow-up: [page introduction audit](page-intro-audit.md).
Collections/profiles/dashboards begin with actual content; details retain compact
context and existing actions.

Follow-up: the subsequent auth/account completion is documented in [AUTH_ACCOUNT_REVIEW.md](AUTH_ACCOUNT_REVIEW.md). It adds server-side disabled-account rejection, case-insensitive login lookup, trimmed-name validation, explicit rejection of extra registration fields, and form focus improvements. The original UI verification results below are retained as the record of that implementation.

## Scope and architecture

The application uses Next.js 14 App Router, React 18, Tailwind 4, custom components in `components/ui`, and Inter. The existing logo at `public/ai-proctor-logo.svg`, teal palette, left sidebar, top header, and route structure are retained. No dependency was added.

Implementation is grouped into six parts: shared tokens/components; shell/navigation; authentication forms; student pages/profile; teacher/admin presentation; responsive/accessibility verification.

## Design system

`app/design-system.css` is the authoritative shared stylesheet, imported after the existing page styles. Old variable names remain aliases so existing screens continue to work.

| Token | Value |
| --- | --- |
| Primary / hover | `#006D77` / `#005761` |
| Secondary | `#83C5BE` |
| Background / surface | `#EDF6F9` / `#FFFFFF` |
| Border | `#C5E0E2` |
| Primary / secondary / muted text | `#203D47` / `#506B75` / `#607981` |
| Success / warning / error | `#216347` / `#825B14` / `#A43139` |
| Spacing | 4, 8, 12, 16, 24, 32, 48 px |
| Radius | 6, 9, 12 px |
| Shadows | subtle card, medium panel, overlay |
| Typography | Inter; page 30 px (26 mobile), section 20 px, body 15 px, label 14 px, helper 13 px |

Measured contrast: primary on white 6.08:1; main text on page background 10.52:1; secondary/muted text on white 5.67:1 / 4.62:1; active sidebar text 4.99:1. This checks these token pairs, not every legacy page-specific color.

## Shared components created/updated

- `Button`: primary, secondary, outline, ghost and danger; sm/md/lg; disabled/loading. Existing variant names remain compatible.
- `Field`: preserve base input classes when adding a custom class; shared input, select, textarea, checkbox, helper and error text.
- `PasswordInput`: separate keyboard-accessible visibility toggles; password strength is informational.
- `Badge`: neutral, info, success, warning and error tones; no decorative hover movement.
- `Modal` and `useDialogFocus`: named dialog, initial focus, Tab containment, Escape close, focus restoration, body scroll lock and viewport-limited scrolling.
- `Table`: keyboard-focusable horizontal scroll region, consistent header/row spacing.
- `Feedback`: announced loading state and compact empty states.
- `AccountMenu`: one account trigger and one logout action; optional student profile link, outside-pointer dismissal, arrow/Home/End/Tab/Escape navigation.
- `WorkspaceShell`: shared presentation for student, dashboard, admin and teacher areas; skip link, active route state, responsive drawer.
- `friendlyError`: localized UI messages without showing raw API/database errors; request and response behavior is unchanged.

## Header changes

The student's name/email and initials form one trigger. The menu contains **Hồ sơ sinh viên** and **Đăng xuất**. The separate logout button was removed. Other roles use the same account menu without links to unsupported profile/password routes. Logout still clears the current tab's session through the existing AuthContext.

The sidebar keeps the student navigation and group structure. Tablet/mobile use a drawer with a backdrop and close button. Existing teacher navigation in `/dashboard` is retained; legacy `/teacher` links now point to existing pages instead of missing routes.

## Authentication

All four modes remain at `/login`: login, registration, forgot password and reset password. The centered composition, logo and role redirects are retained.

### Registration

- Fields: full name, email, the existing student registration role, password, password confirmation.
- No student code, teacher code, major, course, class or photo field is fabricated.
- Name validation: 2–255 characters after trimming. Email syntax is checked locally and still validated by the backend.
- Password validation matches the backend: 8–128 characters. Uppercase, digits and symbols are not required by the frontend. Confirmation must match.
- Duplicate email errors are localized and linked to the email input. Pending requests disable fields/actions, and a synchronous guard blocks duplicate submission.
- Registration still signs in automatically using the server response.

### Login and recovery

- Login sends only email/password. It uses the authenticated response role: student → `/student`; teacher/admin → `/dashboard`.
- Wrong credentials share one message; network, rate limit, inactive-account response and general API failures have friendly messages.
- Forgot/reset use the existing API. When a development token is returned it is used as issued; no token is hard-coded in product code. Without a token, the UI acknowledges the request without claiming an email was sent. An existing reset code can also be entered manually.
- Password reset returns to login with a success message, matching the previous flow.
- “Remember me” is omitted: sessionStorage deliberately isolates tabs, while cookies are shared. Persistence requires an explicit auth design decision, not a cosmetic checkbox.

### Existing backend behavior retained

- Endpoints: `/api/v1/auth/login`, `/register`, `/me`, `/refresh`, `/logout`, `/forgot-password`, `/reset-password`.
- Passwords use bcrypt; the backend issues JWT access/refresh cookies with HttpOnly. The frontend also keeps access tokens in sessionStorage for separate tab accounts.
- Public registration always creates `UserRole.student`; the request schema has no role field. Teacher/admin self-registration is not enabled.
- The original UI pass did not change auth requests or session handling. The subsequent auth completion tightens `RegisterRequest` validation and disabled-account login behavior; see the follow-up report. Password rules, token format and DB schema remain unchanged.

## Student profile and pages

`/student/profile` calls the existing authenticated `/auth/me` and student-filtered `/classes`; it never submits another student's ID. The photo/personal card is followed by separate academic and account cards. Missing/failed images use the same initials helper as the header. Photo copy remains **Ảnh hồ sơ của sinh viên.** The avatar is not asserted to be a trusted biometric reference.

The only backend addition, announced for the profile task before implementation, is a separate `UserProfile` response schema exposing the already stored `phone`, `avatar_url`, `is_active` and `created_at` fields from `/auth/me`. Login and refresh still serialize the original four-field `UserPublic`. There is no migration, upload or enrollment change.

Student home now adds a welcome block, quick navigation, counts and upcoming items derived from the same exam/live-class responses already loaded by its calendar. The schedule keeps its dedicated calendar view. Calendar week/day navigation follows the chosen period; a horizontal scroll region keeps the seven-column view usable on narrow screens.

Profile, class lists, history, grades, calendar and teacher class lists have consistent spacing and loading/error/empty presentation. History filters have visible labels. Retry actions reuse existing read requests. Teacher/dashboard cards, tables and forms share the same visual language. Face/camera presentation inherits shared styles; its logic and enrollment controls are retained.

## Responsive and accessibility

- Desktop: left sidebar, compact header, bounded content width, photo beside details.
- At 1024 px and below: sidebar drawer; account control stays available.
- Narrow screens: stacked cards/forms, hidden long header identity text, account details inside the menu, local horizontal scrolling for tables/calendar.
- Named controls, form error associations, visible focus, dialog focus containment, skip link, 44 px standard controls and reduced-motion support.
- Browser checks cover 1440, 1024, 768 and 375 px, with an additional 320 px profile/menu check and touch interaction.

## Verification

Commands, from the project root unless noted:

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
$env:PLAYWRIGHT_CHANNEL = 'msedge'
$env:PLAYWRIGHT_BASE_URL = 'http://localhost:3000'
node node_modules/@playwright/test/cli.js test
# From backend:
.\.venv\Scripts\python.exe -m unittest discover -s tests -q
```

Playwright uses the already installed package and system Edge. Network responses in browser tests are synthetic fixtures; product pages always use their existing data sources. Tests do not create accounts or modify real student data. Test traces use `test-results`; the final 12 reviewed screenshots are in `artifacts/ui-review` (1440 and 375 px).

Final results:

- TypeScript: passed (`--noEmit --incremental false`).
- Production build of the final source: passed; 28 static pages generated, with dynamic routes compiled successfully.
- Browser cases: all 35 verified. The full run passed 34; one touch test targeted a heading underneath the open dropdown. Its outside-tap target was corrected and that case passed on rerun; no product change was needed for it.
- Backend: 80 unittest cases passed, including 5 new profile tests for public fields, null values, authenticated identity and unchanged login serialization.
- Snapshot comparison: 47 protected files unchanged, including AuthContext, middleware, face models/services/config, enrollment/verification pages, camera/proctoring components, exam attempt logic and dependency manifests. No whitespace issues were found in modified existing files.

Screenshots: [student dashboard](../artifacts/ui-review/student-1440.png), [teacher dashboard](../artifacts/ui-review/teacher-1440.png), [mobile registration](../artifacts/ui-review/register-375.png), [student profile](../artifacts/ui-review/profile-1440.png), [mobile camera layout](../artifacts/ui-review/identity-375.png).

Production builds are run against a temporary source copy on the same drive, sharing installed dependencies, so the running development server's `.next` directory is not replaced. A cross-drive junction was rejected by webpack's Windows path resolution; building on the same drive resolves it.

`npm run lint -- --no-cache` currently exits at Next's ESLint setup prompt: this repository has no ESLint configuration/dependencies. No lint pass is claimed and no packages were installed.

## Remaining UI / integration debt

- Configure ESLint in a separate tooling change. Legacy page CSS still contains duplicated selectors; the shared tokens/overrides centralize new work without a broad rewrite of exam/monitoring CSS.
- Some existing teacher/admin overview and legacy pages use mock/static data. This task does not replace their data sources or invent new statistics.
- Backend email delivery is not configured for production reset requests. Account persistence and a real change-password feature need corresponding backend decisions.
- Student/teacher codes, major and course are absent from the model. Trusted student photos/upload and future reference-image verification remain separate work.
- Disabled-account login was corrected in the subsequent auth completion. The remaining role middleware issue is that it decodes the cookie payload without verifying its signature, while backend endpoints use their own authentication; this is recorded for a separate permission review.
- FaceEngine, YuNet, SFace, thresholds, enrollment/verification logic, face embedding persistence and exam attempt rules are unchanged.

## Files changed

The manifest below groups code touched by these profile/auth/UI requests. Browser output files are generated artifacts.

- `app/admin/action-logs/page.tsx`
- `app/admin/classes/[id]/page.tsx`
- `app/admin/classes/page.tsx`
- `app/admin/layout.tsx`
- `app/dashboard/classes/[id]/page.tsx`
- `app/dashboard/classes/page.tsx`
- `app/dashboard/exams/[id]/page.tsx`
- `app/dashboard/exams/page.tsx`
- `app/dashboard/live-classes/page.tsx`
- `app/dashboard/monitor/[examId]/page.tsx`
- `app/dashboard/monitor/page.tsx`
- `app/dashboard/oral-grading/[oralAnswerId]/page.tsx`
- `app/dashboard/oral-grading/page.tsx`
- `app/dashboard/page.tsx`
- `app/dashboard/users/page.tsx`
- `app/design-system.css`
- `app/layout.tsx`
- `app/login/page.tsx`
- `app/student/StudentCalendar.tsx`
- `app/student/classes/page.tsx`
- `app/student/grades/page.tsx`
- `app/student/history/page.tsx`
- `app/student/page.tsx`
- `app/student/profile/page.tsx`
- `app/student/profile/profile.module.css`
- `app/teacher/layout.tsx`
- `backend/app/api/v1/auth.py`
- `backend/app/schemas/auth.py`
- `backend/tests/test_user_profile.py`
- `components/layout/AccountMenu.module.css`
- `components/layout/AccountMenu.tsx`
- `components/layout/AppShell.tsx`
- `components/ui/Badge.tsx`
- `components/ui/Button.tsx`
- `components/ui/Feedback.tsx`
- `components/ui/Field.tsx`
- `components/ui/Modal.tsx`
- `components/ui/PasswordInput.tsx`
- `components/ui/Table.tsx`
- `components/ui/index.ts`
- `components/ui/useDialogFocus.ts`
- `docs/FRONTEND_UI_REVIEW.md`
- `lib/api.ts`
- `lib/profile.ts`
- `lib/uiErrors.ts`
- `playwright.config.ts`
- `tests/e2e/auth-ui.spec.ts`
- `tests/e2e/responsive-ui.spec.ts`
- `tests/e2e/student-profile.spec.ts`
- `tests/e2e/ui-fixtures.ts`
# Cập nhật chức năng vấn đáp

Các trang vấn đáp được liệt kê trong audit trước đã ngừng phục vụ chức năng;
URL cũ chỉ redirect. Chi tiết tại [retired-oral-exams.md](retired-oral-exams.md).

