# DARK MODE POLISH

ProctoOwl now uses a shared dark hierarchy: a calm blue-teal page, a darker sidebar, three distinguishable surfaces, and restrained teal edges. Light-theme rules remain intact. Important exam cards retain a soft glow; normal cards have quiet structural borders and an inner highlight.

| Requested result | Status |
| --- | --- |
| Shared dark tokens | UPDATED |
| Card border hierarchy | DONE: structural / interactive / active |
| Soft glow | DONE: important cards, selected navigation, focus and modal elevation |
| Nested card contrast | DONE: exam surface, preparation panel and individual rows have separate surfaces |
| Sidebar active state | DONE: brighter surface, left accent and readable text |
| Forms | DONE: distinct field surface, visible borders and 2px keyboard focus |
| Tables | DONE: differentiated headers, separators and quiet row hover |
| Student | PASS in browser viewport checks and actual-data navigation |
| Teacher | PASS in browser viewport checks and actual-data navigation |
| Admin | PASS in browser viewport checks and actual-data navigation |
| Mobile | PASS at 390px; no horizontal page overflow |
| Light mode regression | PASS |
| Business logic changed by dark-mode work | NO |

## Shared system

The existing `data-theme` architecture and per-account theme preferences are retained. Primitive tokens live in `app/proctoowl-theme.css`; semantic roles remain in `app/theme.css`. Student presentation aliases consume the same dark primitives.

| Role | Value |
| --- | --- |
| Page | `#0D1B22` |
| Sidebar | `#0B181F` |
| Surface 1 | `#162A31` |
| Surface 2 | `#1C343B` |
| Nested surface | `#213D44` |
| Primary text | `#EDF6F7` |
| Secondary text | `#B5CBD0` |
| Tertiary text | `#9DB5BE` |
| Borders | Teal at 16%, 30%, 45% opacity |

Primary, secondary and tertiary text have minimum calculated contrast ratios of **10.53:1**, **6.84:1** and **5.39:1** across these surfaces. White CTA text measures **5.16:1**, or **4.65:1** on hover. Focus uses a visible 2px outline, independently of glow.

Semantic green, amber, red and blue remain distinct. Charts keep their existing series palette with a subdued shared grid. There are no continuously animated shadows or large decorative blur effects. Mobile reduces elevation; reduced-motion preferences remove card movement.

The Student hero has a separate preparation surface and individual readiness rows. Success/warning icons retain semantic colors. The owl keeps its existing artwork and light face; only a small desktop separation shadow is added. Public-home structure and imagery are retained.

## Validation

- Student, Teacher and Admin dashboard screenshots in light/dark at **1440, 768 and 390px**.
- Login and registration forms at the same sizes, without submitting or creating an account.
- Monitoring report tables and event modals in both themes and all three sizes. Proctor detail/timeline dialogs fill the mobile viewport.
- Existing Student dashboard, monitoring collection and academic-report regression suite: **18 passed**.
- **36 viewport scenarios passed** in one final production-browser run: 18 role/dashboard combinations, 6 login forms, 6 registration forms and 6 monitoring table/modal flows. The mobile detail dialog bounds are explicitly checked against the 390×960 viewport.
- **4 real PostgreSQL-backed browser scenarios passed**, covering 29 role-specific routes plus the requested exam's report/review flow. Student profile/settings/help, Teacher grading/results and Admin card verification/AI activity/audit/settings are included.
- **Production build passed** (`npm run build`), including lint/type checks. Final browser checks ran against `next start`.
- **Final whole-project TypeScript check passed** (`npx tsc --noEmit`), including the added browser test files.
- Representative screenshots were visually reviewed, including the Student desktop/mobile hero, Teacher charts, Admin dashboard, login form and mobile event detail.

Viewport screenshots use explicit UI fixtures; they do not insert analytics or model detections into the application database. Separate real-data UI checks use existing accounts and the actual seeded academic data.

Local evidence: `artifacts/class-recording/dark-final.log`, `artifacts/class-recording/academic-final.log`, `artifacts/class-recording/build-release.log` and `artifacts/dark-polish/final-results`.

Reviewed examples: [Student dashboard](../artifacts/dark-polish/final-results/dark-polish-student-dashboard-hierarchy-dark-at-1440px/student-dark-1440.png), [mobile registration](../artifacts/dark-polish/final-results/dark-polish-register-form-dark-at-390px/register-dark-390.png), [mobile event detail](../artifacts/dark-polish/modal-review/monitoring-report-exam-specific-monitoring-report-390px-dark/monitor-evidence-dark-390.png). Desktop Chrome and mobile viewport emulation were used; physical Safari/iOS was not tested.

## Files

- `app/proctoowl-theme.css`: centralized dark primitives.
- `app/theme.css`: semantic text, borders, sidebar and overlay aliases.
- `app/dark-polish.css`: shared cards, navigation, fields, buttons, tables, charts and overlays.
- `app/student-visual.css`: Student aliases.
- `components/student/StudentHeroExam.module.css`: hero/preparation depth and readiness colors.
- `app/student/StudentCalendar.module.css`: quick-action card interaction.
- `app/layout.tsx`: imports the shared polish after existing presentation layers.
- `tests/e2e/dark-polish.spec.ts`: dashboards and authentication-form viewport coverage.

The separate monitoring-report and academic-seed requests have their own code and reports. Their API/database changes are not part of the visual theme work.
