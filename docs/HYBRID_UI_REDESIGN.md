# AI PROCTO hybrid UI refinement

## Phase 1 — audit and boundaries

The existing Next.js frontend already has a shared shell, semantic buttons and badges,
responsive tables, focus-managed dialogs, a categorized calendar and practical support
chat. Preserve these implementations and their handlers. No API, auth, routing,
backend, scoring, OCR, camera or live classroom changes are needed.

Findings:

- Primary buttons use `#087F83`, while navigation uses the required `#006D77`.
- Role accents make student selection blue and admin selection indigo. Selection
  should carry one brand identity; secondary colors should describe content/status.
- All roles inherit nearly identical card spacing and corner treatment.
- Collections have working search/filter/pagination but little visual grouping.
- Public pages already have useful educational content and an explicitly labeled
  illustration. Keep their content and destinations, refine surfaces and hierarchy.
- Existing calendar categories, semantic statuses and real dashboard metrics are
  useful foundations. Do not invent analytics or change the data model.
- Many collection page introductions were deliberately removed in an earlier pass.
  Preserve that decision and the existing contextual headings.

## Presentation mapping

| Area | Direction | Treatment |
| --- | --- | --- |
| Public homepage | Educational | Readable hero, friendly feature/role panels, calm section rhythm |
| Student dashboard, exams, classes, results, identity, profile, help | Educational | 12px panels, 24px spacing, clear exam metadata and actions |
| Teacher dashboard, classes, live class, exam editor, AI review, profile, help | Educational | Same readable foundation, structured form sections |
| Teacher question bank and grading | Productivity | 10px panels, 20px spacing, grouped filters and readable forms |
| Teacher monitoring, reports, exam analytics | Analytics | 8px panels, 16px spacing, compact metrics and tables |
| Admin dashboard, users, verification, logs, AI activity, inbox, knowledge, settings | Analytics | Operational density with readable controls and consistent statuses |

`WorkspaceShell` exposes a presentation-only `data-experience` attribute based on
the existing role/path. It does not alter routes or access decisions. Shared CSS
variables define panel padding, radius, table density and layout gaps.

## Skill guidance applied

Used `ui-ux-pro-max` system searches for educational and analytics interfaces.
The minimal educational style and data-dense dashboard style fit this app. Generic
generated palette/font suggestions are intentionally superseded by the user's
locked brand and existing Inter/Lucide system. Next.js search results about server
actions and environment variables are outside this visual task and are not applied.

## Validation log

Each phase runs TypeScript, relevant existing Playwright frontend suites and a
production build. Logs and before-edit source copies live in `artifacts/hybrid-ui`.
The final phase covers light/dark themes, mobile/tablet/desktop, keyboard navigation,
dialogs, student schedules, teacher workflows and admin collections.

| Phase | Changed files | TypeScript / frontend / production build |
| --- | --- | --- |
| 1 Audit | This document | Passed / 8 design tests passed / passed |
| 2 Shared system | `app/tokens.css`, `app/design-system.css`, `app/ui-consistency.css`, `app/theme.css`, `components/layout/AppShell.tsx`, `components/collections/CollectionToolbar.module.css`, `DESIGN.md` | Passed / 20 tests passed / passed |
| 3 Public and student | `components/public/PublicHome.module.css`, `components/student/StudentExamCard.tsx`, `app/student/StudentCalendar.module.css`, `components/settings/SettingsHelp.module.css`, shared design/consistency CSS, `tests/e2e/public-homepage.spec.ts` | Passed / 45 unique tests passed after development-harness correction / passed |
| 4 Teacher workflows | `components/layout/AppShell.tsx`, `app/teacher-workspace.css`, `tests/e2e/form-layout.spec.ts` | Passed / 70 tests passed / passed |
| 5 Admin and analytics | `app/ui-consistency.css`, `components/teacher/TeacherResults.module.css`, `components/teacher/MonitorCollection.module.css`, `app/admin/student-cards/student-cards.module.css`, `components/admin/AuditLogList.module.css`, `components/chat/SupportChat.module.css` | Passed / 36 tests passed / passed |
| 6 Dark mode, responsive and accessibility | `app/tokens.css`, `app/theme.css`, `app/design-system.css`, `app/ui-consistency.css`, `components/layout/AppShell.tsx`, `components/public/PublicHome.module.css`, `app/student/StudentCalendar.module.css`, `components/ui/Tabs.tsx`, `components/ui/SupportChatButton.module.css`, monitoring/admin/chat CSS modules, `tests/e2e/academic-design.spec.ts`, `DESIGN.md` | Passed / 89 tests passed plus 9 focused rechecks / passed |

The installed Chrome channel is used because the matching Playwright bundled
Chromium is not present. A homepage overflow test originally included Next.js's
development-tools shadow UI (a 40px icon inside a 32px button). The scan now targets
product landmarks, retaining checks for homepage controls at all seven widths.
The public-resource audit also excludes only Next.js's own hot-reload socket;
application sockets, private API requests and media access remain checked.

The form-layout helper now waits for its first real control before measuring.
Previously, a visible main region could still contain a loading skeleton, creating
a false zero-control failure during navigation. No application loading behavior
was changed to accommodate tests.

## Review and validation scope

- Primary fill and sidebar base are exactly `#006D77` in both themes; white primary
  button text measures 6.08:1. Selected sidebar text measures at least 4.5:1.
- Learning, productivity and analytics share Inter, Lucide icons, semantic colors,
  44px default controls, one header/sidebar and common focus/dialog behavior.
- Existing API metrics, question review/import, grading, verification and chat
  handlers are retained. New TSX changes are presentation attributes, active-link
  presentation and accessible button state/type declarations.
- The existing frontend suites use API and media fixtures. Live backend OCR,
  face recognition and SFU integration were outside this presentation-only change.
- Production builds retain the pre-existing hook-dependency and image-element lint
  warnings. No lint rules were disabled.

`artifacts/hybrid-ui/changed-files.txt` lists modified source, test and documentation
files. `artifacts/hybrid-ui/changes.patch` contains their review diff. Phase folders
contain screenshots and retained failure traces from the checks.

Representative review captures are available in `artifacts/hybrid-ui/review`:
homepage, student dashboard and mobile agenda, teacher profile, question review,
monitoring, admin dark mode and student landscape navigation.

All six phases are complete. The final production build succeeds, with the same
existing lint warnings described above. The final focused checks also confirm a
visible 2px keyboard focus outline on form fields.
