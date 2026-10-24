# ProctoOwl UI system

The approved public Home and Login now supply the visual system for the whole frontend. The implementation updates shared styling and typography, with role-specific density; it does not rebuild pages or replace their data/workflows.

## Shared foundation

`app/proctoowl-theme.css` centralizes the existing Home/Login ink, mint background, paper surface, border, tint, dotted pattern, card radius and shadow. `PublicHome.module.css` consumes these same primitives, rather than maintaining a separate light/dark palette. `tokens.css` maps the established semantic aliases to them; `theme.css` maps dark surfaces to the approved dark palette.

The root layout reuses `publicTypography` from `components/public/typography.ts`, with self-hosted Nunito and Be Vietnam Pro. It replaces the old active Inter/Baloo combinations. Existing consumers of `--font-inter` receive a compatibility alias to the official body font, without renaming their identifiers.

| Use | Font |
| --- | --- |
| Home headline / Student greeting | Nunito 800, the existing Vietnamese-safe Home fallback |
| Section/card/dialog headings, wordmark, primary buttons | Nunito 700 |
| Paragraphs, labels, fields, tables, logs, metadata | Be Vietnam Pro 400–500 |
| Raw technical disclosures | Existing monospace, retained for technical details only |

Brand primary stays exactly `#006D77`. Info remains blue, success green, warning amber, danger red and secondary accents indigo/lavender. Solid primary actions use teal in both themes; semantic text colors adapt for readable contrast in dark mode.

`app/proctoowl-ui.css` applies shared controls, heading hierarchy, readable table text, modal radius, lighter borders/shadows, sidebar mark/wordmark, active navigation and role header treatment. Primary buttons follow Home's pill shape and typography. Icon controls retain compact rounded-square hit areas. Navigation arrays, permissions, URLs and sidebar persistence logic are unchanged.

Detail-page context titles stay compact at 16px in every density mode. The collapsed sidebar mark has an explicit centered, non-repeating background on its logo surface; visual review caught and corrected the inherited background repeat/position reset.

## Role coverage

The shared system is inherited by every existing route, including detail and modal workflows. Page components keep their content and data bindings.

| Area | Pages/workflows covered |
| --- | --- |
| Student | Dashboard, calendar/schedule, classes and class detail, live classes, exams, pre-exam verification, attempt workspace, results, history, profile, identity/student card, settings, help, notifications and support |
| Teacher | Dashboard, question banks and question detail, question/document generation/review/import, exam creation/editing, classes and class detail, live classes, monitoring and attempt monitoring, grading, reports, profile, settings, help, notifications and support |
| Admin | Dashboard, users, student card verification, classes and class detail, exams, reports, audit/action logs, AI activity, knowledge base, support inbox, settings, help and notifications |
| Auth | Existing login, registration, recovery and reset modes inherit the shared typography/theme; form behavior is untouched |
| Standalone | Exam, identity/security and classroom views inherit body/control tokens while retaining their operational layouts and media surfaces |

Student cards are softer (22px panel radius); Teacher uses balanced panels (18px, or 16px for productivity contexts); analytics/Admin uses compact 14px panels and existing table density. All share the same brand, borders and surface family.

The Student dashboard retains its calendar, actual event mapping, upcoming list, recent activity and learning navigation. Its old heavy outlines/hard offset shadows were replaced with the approved softer visual treatment. The dotted motif appears in the greeting only. Calendar event colors, open/close markers and course identity colors are retained. Exam cards use blue/amber/green/red accents according to their existing status attributes, without changing status calculations. Results emphasize the existing score cell; the mobile card presentation remains intact.

Dense Teacher/Admin tables, logs, monitoring, grading and forms use solid surfaces, with no decorative dot layer. Help/settings, notification panels, sidebar flyouts and support chat inherit the same tokens and fonts. Chat keeps its existing ProctoOwl Support name, neutral assistant bubbles and indigo admin distinction. Timestamp/helper sizes were improved for readability.

## UI interaction fix found during review

The mobile calendar's pinned day-detail panel could immediately close when the browser delivered an older scroll-into-view event after opening it. The panel now records the document's scroll position at opening and ignores an unchanged-position document scroll event. Actual page movement, outside click, Escape and existing cleanup still dismiss it. A regression checks both behaviors; the original seven-event mobile test remains intact.

This is a popover interaction fix. Calendar date calculations, event mapping, API calls, exam status, exam actions, refresh rules and navigation are unchanged.

## Source scope and integrity

`artifacts/proctoowl-ui/source-before.zip` and `source-before.json` preserve the frontend source before this task. `audit-source.py` verifies that changes to existing TypeScript consist only of root font/style setup, removal of the obsolete education font classes, the described popover interaction fix and a typography comment. All other frontend logic, API helpers, auth, routing files and types are byte-identical. CSS changes are listed in `source-audit.json`.

New source files:

- `app/proctoowl-theme.css`
- `app/proctoowl-ui.css`

Changed source files:

- `app/layout.tsx`
- `app/tokens.css`
- `app/theme.css`
- `components/public/PublicHome.module.css`
- `components/public/typography.ts` (comment only)
- `components/layout/AppShell.tsx` (remove old font opt-in only)
- `components/layout/Sidebar.module.css`
- `app/student/StudentCalendar.tsx`
- `app/student/StudentCalendar.module.css`
- `app/admin/student-cards/student-cards.module.css`
- `components/teacher/MonitorCollection.module.css`
- `components/settings/SettingsHelp.module.css`
- `components/chat/SupportChat.module.css`
- `components/notifications/Notifications.module.css`

Tests:

- New `tests/e2e/proctoowl-ui-system.spec.ts`: three representative pages per role at 390/768/1024/1440px, light and dark, plus font/token/overflow checks and screenshots.
- `academic-design.spec.ts`: verify the new actual owl mark plus text wordmark, replacing the old background-SVG logo assertion. Contrast, layout and interaction expectations remain.
- `student-calendar-presentation.spec.ts`: added the delayed-scroll regression; existing behavior tests are unchanged.
- `collapsible-sidebar.spec.ts`: retain existing behavior checks and add centered/non-repeating logo assertions. Position measurements now wait for initial data/fonts and their layout frames; the existing exact chat position assertions are retained.

No fake production content, users, statistics, alerts or reports were added. Screenshot data comes from isolated browser API fixtures, explicitly for QA; it is not backend/live data. Internal identifiers were not renamed. Backend and database were not edited.

## Validation and screenshots

Phase logs, production build output, source integrity evidence and final frontend test results are under `artifacts/proctoowl-ui/`. Desktop (1440px), mobile (390px) and dark representative screenshots use filenames such as:

- `student-_student-1440-light.png`
- `student-_student_exams-390-light.png`
- `student-_student_grades-1440-dark.png`
- `teacher-_dashboard-1440-light.png`
- `teacher-_dashboard_question-banks-390-light.png`
- `teacher-_dashboard_monitor-1440-dark.png`
- `admin-_admin-1440-light.png`
- `admin-_dashboard_users-390-light.png`
- `admin-_admin_student-cards-1440-dark.png`

The final full frontend suite uses Chrome against the production build with mocked API fixtures. The repository's explicitly opt-in live PostgreSQL/FastAPI, support integration and LiveKit/SFU tests remain opt-in; this UI change does not seed or modify a live database. Test corrections and any unresolved limitations are recorded in the final validation summary.

Validation completed:

- Final production build and TypeScript: PASS. Build lint has existing unrelated Hook warnings.
- Full suite: 525 cases run, initially 508 passed / 11 opt-in integration cases skipped / 6 compact-context size failures.
- Those six failures were fixed in CSS without changing their assertions. Final verification of all six plus the ten sidebar cases: **16/16 PASS** against the final production build. This includes the new logo checks and stable initial layout measurement.
- Across the full run and final verification: **514 unique cases passed, 11 intentionally skipped, 0 unresolved failures**. The full 525-case suite was not repeated wholesale after the final two CSS fixes. Machine-readable evidence: `frontend-tests.json`, `final-verification.json`, `validation-summary.json`.
- Role review: 24 visual cases cover three pages per role, four required widths and both themes. Representative screenshots were inspected for Student, Teacher and Admin. The final collapsed logo is shown in `sidebar-collapsed-dark.png`.
- Sidebar persistence/drawer/keyboard behavior, primary/semantic contrast, notification focus, dialogs, Home eye effect, real data presentation, auth, exam, verification, question/document and support flows were covered by the existing frontend regressions.

The only test expectation updated for a changed visual asset was the old background logo check. Other test changes add checks or synchronize initial layout; no functional assertion was removed to conceal a visual bug.
