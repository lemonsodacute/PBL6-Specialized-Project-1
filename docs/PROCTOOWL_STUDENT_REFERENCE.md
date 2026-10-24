# ProctoOwl Student reference adaptation

Reference: `D:/Download/proctoowl-student.html`. This is a visual prototype, not an application replacement or a source of production data.

## Mapping

| Reference | Existing source / route | Adaptation |
| --- | --- | --- |
| Sidebar and profile | `WorkspaceShell`, current auth user | Teal #006D77, real avatar/name, white active item; collapse, tooltips, submenu and drawer retained |
| Greeting | `/student`, `useAuth` | Actual full name and current date; existing main greeting retained |
| Next exam | Current calendar's exam data, existing exam status/action helpers | Large card; active attempt priority; actual open/close/duration/class; real resume or verification route |
| Preparation checklist | Existing auth identity/card statuses and exam requirements | Read-only real status links; unknown states explicitly direct to profile; devices/face checked in existing verification flow |
| Quick navigation | `/student/live-classes`, `/student/exams`, `/student/grades` | Three pastel icon cards; real destinations, no invented counts |
| Calendar + upcoming | Existing calendar queries, range/presentation helpers | Two columns on desktop; existing deterministic event colors, open/close markers, one same-day event and mobile agenda retained |
| Activity | Existing `RecentActivity` | Kept with original real attempts |
| Course cards | `/student/classes`, existing classes collection | Search/sort/pagination; actual name, description, teacher and enrollment count; no fake code or progress |
| Live rows | `/student/live-classes` | Existing server filters/lifecycle/room links, styled rows; no reminder action or fake SPA tabs |
| Actionable exams | `/student/exams` | Existing current/open/upcoming groups and real action logic retained |
| History/results | `/student/history`, `/student/grades` | Separate real attempt tables, final-score helper, waiting grading and real zero scores retained |
| Profile/identity | `/student/profile`, `/student/identity` redirect, `/student/exams/[examId]/verify` | Calm surfaces, typography; identity, OCR, camera and entry implementation unchanged |
| Settings/help | `/student/settings`, `/student/help` | Student page heading and scoped tokens; forms, explicit theme preference and behavior untouched |
| Support | Existing support drawer | Student-owned portal typography; cards opt into the existing `data-chat-avoid` positioning mechanism so the launcher stays clear of content. No support or positioning logic is rewritten |

The featured exam is explicitly described as within the calendar range currently being viewed. No new endpoint or global “next exam” claim is introduced.

## Fonts and themes

Fredoka 600–700 (display only) and Nunito 400–800 (navigation/body/forms/data/buttons) use `next/font/local`. Fonts are served locally; no new Google font links. The existing licensed upstream Fredoka font is compressed to WOFF2, with its OFL license. Nunito supplies missing Vietnamese glyphs after Fredoka. Public, Teacher and Admin typography remain unchanged.

Student tokens are scoped to `.app-shell[data-role='student']`; warm cream #fff8f3, white cards, navy text, pale sky/coral/mint accents. Dark tokens use the current `data-theme` mechanism, including explicit light/dark preferences. Brand primary stays #006D77.

No hard-coded prototype student, teacher, dates, course, score, counts, alerts, checkbox persistence or reference JavaScript datasets are introduced. Screenshot data lives only in browser test fixtures.

## Validation

Evidence, source snapshot/diff, audit and screenshots: `artifacts/proctoowl-student/`.

Existing visual tests are updated only for the requested Student composition: new featured-exam heading, new page headings, stable three-card destinations, scoped Student fonts, and cream topbar versus white cards. Behavioral, contrast, overflow, identity and exam lifecycle assertions remain in place.

## Frontend files

- `app/layout.tsx`: register local font variables and import Student styling.
- `app/student-visual.css`: scoped palette, typography, sidebar/header, cards, tables and responsive rules.
- `components/student/typography.ts`, `components/student/fonts/fredoka.woff2`, `components/student/fonts/fredoka-OFL.txt`: local fonts and license.
- `components/student/StudentPageHeader.tsx`: reusable Student page heading.
- `components/student/StudentHeroExam.tsx`, `components/student/StudentHeroExam.module.css`: real exam hero, static brand owl, real/unknown readiness states.
- `app/student/StudentCalendar.tsx`, `app/student/StudentCalendar.module.css`: dashboard composition, quick navigation, calendar/upcoming presentation and chat clearance.
- `components/classes/ClassCollection.tsx`: Student-only course grid and existing search toolbar.
- `components/student/StudentExamCard.tsx`: opt into existing chat collision avoidance.
- `components/student/AttemptCollection.tsx`: Student heading and chat clearance; attempt/result logic retained.
- `app/student/exams/page.tsx`, `app/student/live-classes/page.tsx`: Student headings and chat clearance.
- `app/student/profile/page.tsx`, `app/student/settings/page.tsx`, `app/student/help/page.tsx`: Student page headings.
- `components/layout/SidebarNavGroup.tsx`, `components/ui/AIChatbox.tsx`: mark Student-owned portals so their typography/theme stay consistent.

Tests: new `tests/e2e/proctoowl-student.spec.ts`; revised visual expectations in `student-dashboard.spec.ts`, `neo-education.spec.ts`, `proctoowl-ui-system.spec.ts`, `academic-design.spec.ts`, `responsive-ui.spec.ts`, `ui-consistency.spec.ts`. Mobile score selectors include visible field labels; content-card measurements skip the Student-only transparent toolbar wrapper. Existing functional tests are retained.

## Screenshot index

All under `artifacts/proctoowl-student/`:

- `dashboard-1440-light.png`, `classes-1440-light.png`, `live-classes-1440-light.png`, `exams-1440-light.png`, `history-1440-light.png`, `results-1440-light.png`.
- `dashboard-390-light.png`, `exams-390-light.png`.
- `dashboard-1440-dark.png`, `results-1440-dark.png`.
- Dark desktop viewport previews: `dashboard-1440-dark-viewport.png`, `results-1440-dark-viewport.png`; use these to inspect the fixed sidebar without Chromium full-page capture artifacts.
- Additional captures for every listed route at 390/768/1024/1440, light/dark; top-of-dashboard captures for each viewport/theme.

Screenshots use isolated browser fixtures, not inserted production records. Chrome's platform-font audit (`rendered-fonts.json`) confirms Fredoka SemiBold plus Nunito for the Vietnamese glyph missing in Fredoka.

## Final verification

- TypeScript: PASS (`typecheck-release.log`).
- Production build: PASS (`build-release.log`); existing lint warnings remain.
- Final acceptance run: 66/66 PASS, including chat clearance at every requested viewport and theme, sidebar/collapsed navigation, calendar interaction and scope checks for all roles.
- Across the related functional and visual runs: 219 unique tests PASS, 0 skipped, 0 unresolved failures (`validation-summary.json`). Earlier failures were outdated visual expectations or selectors and were rerun successfully; the entire 219-case set was not repeated wholesale after the final presentation attributes.
- Verified widths: 390, 768, 1024, 1440, plus existing 375 and landscape coverage. No horizontal overflow in tested routes.
- Basic accessibility checks: keyboard menus and navigation, focus visibility/return, collapsed tooltips, labeled controls, readable semantic contrast and reduced motion.
- Source audit: 51 protected files unchanged, with original collection handlers and calendar effects unchanged. Existing Face/OCR, API/auth, scoring, room and support-positioning implementations are retained.
