# ProctoOwl mascot placement audit

## Shared artwork and presentation

`components/brand/ProctoOwlMascot.tsx` owns the original Home owl artwork. Home renders that same artwork with its existing eye-origin and pupil refs; its spotlight and pointer behavior stay in `PublicHero`. Internal instances have no animation, pointer listeners, timers, or spotlight code.

Supported variants: `peek`, `corner`, `watermark`, `empty-state`, `compact`. Sizes: `sm`, `md`, `lg`. Eye direction: `left` or `right`. Decorative instances are `aria-hidden`, unfocusable, and ignore pointer events. The watermark is a silhouette at 0.06 opacity; no audited chart or data panel was an appropriate place to deploy it.

Admin uses a desaturated teal palette and smaller empty-state illustrations. Teacher uses medium illustrations. Student uses one greeting owl and friendly empty states. Dark mode changes the body palette while retaining the pale face, eye detail, and teal identity. No blink animation was added, so reduced motion is also static.

## Exam toolbar: measured available space

At 1440×900 the original Admin exam toolbar measured 191.59px high. Its action buttons occupied the bottom 44px, leaving 147.59px above them. The 104px peeking owl fits there with a 12px clearance above the buttons. Evidence: `artifacts/mascot/before-admin-exams-geometry.json` and the before/after screenshots.

`CollectionToolbar` exposes an opt-in `mascot` prop, enabled only for the exam collection. A ResizeObserver checks that filters and actions are side by side and that at least 80px is free above the actions. When actions wrap below filters, that region is occupied and the owl hides. At 1024px the expanded sidebar leaves insufficient room, so the owl hides. A collapsed sidebar can reveal it again if genuine space becomes available. Nonessential decorations also hide on mobile.

The illustration is absolutely positioned inside the existing actions region. It adds no height, padding, column, or minimum width. Tests compare filter, button, and table geometry with the owl shown and hidden, and exercise the existing Create action and extra filters.

## Page decisions

The audit follows the actual route aliases and shared components. “Empty only” means the existing successful no-results branch opts in; populated tables/cards and loading/error states keep their existing presentation.

| Role | Page | Decision and reason |
|---|---|---|
| Admin | Dashboard (`/admin`, `/dashboard`) | No new mascot. KPI, pending-card, exam, audit, and chart space is reserved for live data. |
| Admin | Quản lý lớp học | Small owl in the existing empty state only. Populated management table stays unchanged. |
| Admin | Quản lý người dùng | Small owl in the existing empty state only. No owl in rows or filters. |
| Admin | Xác thực thẻ sinh viên | Small owl in the existing empty state only; verification/error UI stays unchanged. |
| Admin | Quản lý đề thi | Desaturated peeking owl above the existing actions, only when measured free space allows. No second owl in the results panel. |
| Admin | AI Support | Navigation group for Knowledge Base and AI Activity; no extra group decoration. |
| Admin | AI Activity | No new mascot. Dense operational metrics, provider health, charts, and logs. |
| Admin | Knowledge Base | No new mascot. Article cards/forms and a compact no-results message; no large unused panel to fill. |
| Admin | Báo cáo | No new mascot. Chart and result-table space is reserved for data. |
| Admin | Nhật ký | No new mascot. Audit evidence and filters remain undecorated. |
| Admin | Settings | No new mascot. Settings fields, save feedback, and actions take priority. |
| Teacher | Dashboard | One medium owl in the existing “no open exams” state only. No mascot in analytics. |
| Teacher | Question Bank | One medium owl in the existing empty state only. Creation action stays unchanged. |
| Teacher | Exams | The same opt-in action-area peek, shown only when usable space exists. |
| Teacher | Monitoring | No new mascot. Dense monitoring controls and live data. |
| Teacher | Classes | Existing empty state only; populated class table stays unchanged. |
| Teacher | Live Class list | Existing empty state only; no decoration in a live room. |
| Teacher | Grading | No new mascot in answer/review controls. `/dashboard/oral-grading` already redirects to Exams; that route is unchanged. |
| Teacher | Document generation | No new mascot. Upload, source selection, generated content, and review controls reserve the available space. |
| Teacher | Reports | No new mascot. Analytics and result density take priority. |
| Student | Dashboard | One static owl in the unused greeting gap. Hides on narrower containers and when a long name/date needs the space. No second dashboard empty-state owl. |
| Student | Classes | One owl in the existing empty state only. No forced header decoration. |
| Student | Live Classes | One owl in the existing empty state only. Joining controls remain unchanged. |
| Student | Exams | One owl in the actual empty/no-match state only. Existing result link/filter-reset actions remain. |
| Student | History | One owl in the empty state only. Attempt rows stay unchanged. |
| Student | Results | One owl in the empty state only. Scores and result links stay unchanged. |
| Student | Profile | No new mascot. Profile photo, identity details, and editing fields already use the space. |
| Student | Settings | No new mascot. Preference and security controls take priority. |
| Student | Help | No new mascot. Search, quick links, guides, FAQ, and support content use the space. |
| Public | Home | Original appearance and interactions retained; now consumes the shared artwork source. |
| Public | Auth | Existing ProctoOwl mark retained. No extra illustration or form-space changes. |

## Responsive and interaction review

- Desktop: the Admin exam owl is 104px tall and the Student greeting owl is 96px tall. Empty-state owls are 64px for Admin and 80px for Teacher/Student.
- Tablet: decorations use actual available space; no extra room is created. Empty states retain one small owl.
- Mobile: toolbar and greeting decorations hide; empty-state owls reduce to 64px.
- Greeting: a lightweight ResizeObserver checks the gap between the greeting copy and date. Long content hides the decoration instead of overlapping it.
- Maximum one major illustration per chosen section; no automatic global insertion into every EmptyState or header.
- No data, API, filter, permission, route, table, or action logic changes.

## Changed files

Shared artwork and presentation:

- `components/brand/ProctoOwlMascot.tsx`
- `components/brand/ProctoOwlMascot.module.css`
- `components/public/PublicHero.tsx`
- `components/collections/CollectionToolbar.tsx`
- `components/collections/CollectionToolbar.module.css`
- `components/ui/Feedback.tsx`
- `components/ui/Feedback.module.css`
- `components/student/GreetingMascot.tsx`
- `app/student/StudentCalendar.tsx`
- `app/student/StudentCalendar.module.css`

Explicit page opt-ins:

- `app/dashboard/exams/page.tsx`
- `components/classes/ClassCollection.tsx`
- `app/dashboard/users/page.tsx`
- `app/admin/student-cards/page.tsx`
- `app/dashboard/question-banks/page.tsx`
- `app/dashboard/live-classes/page.tsx`
- `components/dashboard/Overview.tsx`
- `app/student/exams/page.tsx`
- `app/student/live-classes/page.tsx`
- `components/student/AttemptCollection.tsx`

Verification and audit:

- `tests/e2e/mascot-composition.spec.ts`
- `docs/mascot-placement-audit.md`

## Verification artifacts

Representative before/after screenshots are in `artifacts/mascot/`: Admin Exams, Student Dashboard, Teacher Question Bank, and Student Results at 1440px, 1024px, and mobile, including dark mode. These screenshots use synthetic UI fixtures rather than production data.

`mascot-composition.spec.ts` checks responsive visibility, geometry invariance, decorative semantics, pointer safety, lack of control overlap, horizontal overflow, working exam creation, extra filters, and populated question-bank exclusion. The existing `proctoowl.spec.ts` checks Home eye tracking, reduced motion, touch behavior, responsive light/dark Home layouts, role branding, and auth forms.

Results:

- All 8 mascot composition tests passed in the final run.
- All 14 existing Home/branding/auth checks passed.
- Production `next build` passed, including type checking and generation of all 42 static pages. Existing hook-dependency and image lint warnings remain; no build errors.
- Focused lint passed with no errors. Its one warning is in the unchanged pagination effect in `CollectionToolbar`.
