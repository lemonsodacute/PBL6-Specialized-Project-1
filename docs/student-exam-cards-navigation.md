# Rounded workspace navigation and soft exam cards

The shared sidebar and topbar now have rounded outer corners and compact outer spacing for Student, Teacher and Admin. Their colors, logos, menu items, user/session data and interaction handlers are preserved. The sidebar still supports collapse, saved preferences, keyboard flyouts and the mobile drawer. The topbar retains its existing notification/account controls and dropdowns.

On `/student/exams`, only **Đang diễn ra** and **Sắp diễn ra** cards receive the reference styling: subtle borders/shadows, teal or amber left accents, soft status/metadata chips, rounded schedule panels and borderless teal actions. Upcoming status badges sit beside the metadata; their schedule panels stack vertically. Existing in-progress and other exam presentations retain their previous treatment.

Page background/pattern, logo artwork, typography, API requests, filtering, refresh events, status calculation, device requirements, action targets and disabled states are unchanged. No packages/fonts were added. Dark surfaces use shared theme tokens.

## Files

- `app/tokens.css`: shared navigation geometry and soft exam-card tokens.
- `components/layout/Sidebar.module.css`: rounded desktop rail/mobile drawer, preserving existing navigation behavior.
- `components/layout/WorkspaceTopbar.module.css`: rounded header; `width: auto` accounts for outer margins instead of overflowing the legacy Student `width: 100%` rule.
- `components/student/StudentExamCard.tsx`: presentation selection and inline upcoming status; original action handlers and data remain in place.
- `components/student/StudentExams.module.css`: scoped open/upcoming card styling.
- `tests/e2e/student-exams-design.spec.ts`: updated visual assertions; existing data, background and action checks retained.
- `tests/e2e/workspace-topbar-design.spec.ts`: rounded header/drawer checks alongside existing three-role interaction coverage.
- `tests/e2e/collapsible-sidebar.spec.ts`: relative geometry assertions for the new navigation spacing.
- This report.

Browser checks use existing synthetic API/session fixtures, not replacement application data. Actual camera capture, scoring and backend integration are outside these UI checks. Logs and images are stored locally under `artifacts/student-exams-soft-navbar/`.

## Validation

- Production build passed with 42 pages generated (`build-final.log`); existing warnings remain in unrelated files.
- Standalone TypeScript and targeted lint passed (`typecheck.log`, `lint.log`).
- All 54 selected checks passed across three batches: 19 sidebar/exam-page checks, 18 light-header/notification/account checks, and 17 dark-header/existing exam-state checks.
- The checks cover Student/Teacher/Admin, 1440/1024/768/390px, light/dark themes, sidebar collapse and saved preferences, drawer/keyboard behavior, notifications, profile menus, filtering, background equality with Login and original exam/attempt navigation.
- An intermediate run detected 24px of horizontal overflow from the legacy Student topbar's `width: 100%` plus its new margins. Setting the shared header width to `auto` resolved it before the final passing runs. The preview script's injected style was only for diagnosis; final tests ran against the rebuilt application without that injection.

The commit includes only the new navigation/card tokens and relevant UI/test files. Unrelated local token additions, navigation-label edits, backend work and other pending changes are excluded.
