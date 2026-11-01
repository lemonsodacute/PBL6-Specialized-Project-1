# Student exam page and shared workspace topbar

The Student “Làm kiểm tra” page follows the supplied HTML's outlined cards, offset shadows, pastel chips and cartoon sidebar. The checkerboard is intentionally omitted. The existing exam API, grouping priorities, availability checks, refresh events, camera/microphone requirements and action targets are unchanged. No sample exam data, fonts or dependencies were added to the application.

## Exact Login background reuse

The original Login background was in `components/auth/LoginForm.module.css`: `--public-bg`, `--public-dot-pattern` and `--public-dot-spacing`. `PublicHome.module.css` maps these directly to `--procto-bg`, `--procto-dot-pattern` and `--procto-dot-spacing` in `app/proctoowl-theme.css`.

Both Login and every Student workspace now use **the same `DottedCanvas.module.css` class**. The Student canvas is painted on the outer AppShell so it also covers the gutters around the rounded sidebar; the inner workspace and footer are transparent. The three `--login-canvas-*` aliases resolve the existing tokens at the root. This prevents the Student theme from replacing the Login dots with its smaller cream dots. The shared class also resets the entire background paint so the dark AppShell glow cannot introduce a different layer. The sidebar and cards retain their own opaque backgrounds.

In light mode the existing Login values are `#eaf5f4`, dots `#cce5e7` with 1.7px radius fading to transparent at 2px, repeated every 26px. Dark values come from the existing dark Login tokens. There is no copied approximation in the exam stylesheet.

## Presentation and preserved behavior

- `StudentExamCard` has an optional `playful` presentation. Other callers retain their existing layout. The same button handlers and status helpers execute in either presentation.
- Current/open groups retain their order and use full-width cards; upcoming exams use two columns at desktop/tablet widths and one column on mobile.
- Counts, dates, class names, durations and device requirements come from the existing hooks/API. The decorative date uses the existing refresh clock.
- `WorkspaceTopbar.module.css` styles the existing shared header: mint role pill, yellow notification button, red unread count and outlined profile pill. The original `NotificationBell`, `AccountMenu` and `ProfileAvatar` behavior is retained.
- Below 640px the profile trigger shows avatar and arrow; full name and email remain available inside the existing menu.
- Tokens are shared across Student, Teacher and Admin. Role dots are teal, amber and purple respectively. Theme-specific surfaces support dark mode. Motion respects reduced-motion preferences.

## Files in the UI commit

- `app/proctoowl-theme.css` — Login canvas aliases and existing shared dark primitives required by the styles.
- `app/tokens.css` — shared topbar and exam tokens only; unrelated local token work is excluded from the commit.
- `app/proctoowl-ui.css` — delegates topbar presentation to the shared module.
- `app/student/exams/page.tsx` — heading/date/mascot and presentation wiring.
- `components/auth/LoginForm.tsx`, `components/auth/LoginForm.module.css` — reuse the extracted background.
- `components/layout/AppShell.tsx` — header class and shared canvas class for every Student workspace; unrelated local live-class changes are excluded from the commit.
- `components/layout/WorkspaceTopbar.module.css` — shared pastel header.
- `components/student/StudentExamCard.tsx`, `components/student/StudentExams.module.css` — optional outlined exam presentation and scoped sidebar styling.
- `components/ui/DottedCanvas.module.css` — one background implementation.
- `tests/e2e/student-exams-design.spec.ts`, `tests/e2e/workspace-topbar-design.spec.ts`, `tests/e2e/class-pages-design-fixture.ts` — presentation/interaction checks and their test fixture.
- This report.

Local integration also removes the former page-specific header overrides from `StudentLiveClasses.module.css` and updates the corresponding navigation assertion in `student-online-classes-design.spec.ts`. Those files belong to the preexisting uncommitted online-classroom redesign; they remain local with that work.

## Validation evidence

Validation uses synthetic session/API fixtures in browser tests; production components continue to use the real APIs. Real camera/microphone capture, exam scoring and backend integration were not changed or exercised by these UI tests.

- Topbar matrix: 24 cases (3 roles × 4 widths × 2 themes), plus 6 notification/account interaction cases. All 30 cases passed across the two recorded batches.
- Existing Student online-classroom suite: 10 cases passed.
- Final exam-page run: all 14 selected cases passed (`e2e-release.log`): 8 viewport/theme comparisons against Login, 1 filter/refresh/empty-state case and 5 existing exam-state/navigation cases. These verify start/resume/result targets and preserve grouping after submission updates.
- TypeScript `tsc --noEmit`: passed (`typecheck-release.log`). Targeted lint: passed without ESLint warnings/errors (`lint.log`).
- Production build: passed, 42 pages generated (`build-release.log`). Existing Hook/image warnings remain in unrelated files.
- Topbar interaction coverage includes marking notifications read, unread updates, menu keyboard navigation, Escape/focus restoration, outside click and mobile drawer operation. Tests check original profile/notification link targets; they do not perform a real logout.
- One intermediate browser run timed out while creating a context; the remaining 15 cases passed in a fresh Chrome run. An earlier Edge capture stalled after fonts loaded. These failed/interrupted runs are retained, not reported as passing runs.
- The initial exam checks caught inherited Student dots, the dark workspace glow and an old dark active-card shadow rule. All were fixed before the final 14-case run. A test-fixture union type was corrected before the final TypeScript check.

Logs and screenshots are under `artifacts/student-exams-redesign/` and `artifacts/workspace-topbar-redesign/` (ignored by Git).

## Student workspace background follow-up

The shared Login canvas now applies to every Student workspace, including the overview, classes, online classes, exams, history, grades, profile, settings and help. Sidebar, topbar and card presentation are preserved; the footer is transparent so the dots continue behind it.

The visual inspection verified all 36 combinations of those 9 routes, light/dark themes and 1440/390px widths. Background paint matched Login exactly, sidebars had no dot pattern, footers were transparent and no horizontal overflow occurred. Four screenshots and the measured values are saved under `artifacts/student-workspace-background/`.

Standalone TypeScript and targeted lint passed. The verified production build generated all 42 pages using the existing build cache. A fresh-cache attempt hit an error in the existing Google Fonts loader; font configuration and dependencies were not changed for this background update.
