# Student Calendar — availability and event identity

Calendar color strategy: **deterministic ID hash → pastel HSL tokens**. Exams use
their exam ID; live sessions use the existing `class_id` (course ID). Sessions
without a course ID retain a stable color from their session ID. Color never
depends on render order, current month, attempt status or randomness. Calendar,
agenda, upcoming cards and popovers share the same appearance function. Light
and dark use paired shades of the same hue.

Multi-day representation: **filled circle + MỞ + opening time** at the opening
date; **outlined square + ĐÓNG + closing time** at the closing date. The closing
card uses an outlined surface in the same identity color. Ongoing windows are
also discoverable under today and at the first visible date when their opening
falls outside the view. Intermediate range bars are omitted to keep the grid
clear.

Single-day representation: **one event**, with `08:00–10:00` in the compact grid
and `08:00 → 10:00` in agenda/upcoming. Opening and closing are never split into
two same-day entries. A single-day upcoming card shows the date once.

Open/close time source: exam availability **`start_time` / `end_time`** from the
existing exams response. Live sessions retain the existing
`start_time ?? scheduled_start` / `end_time ?? scheduled_end` mapping.

Duration source: **`duration_minutes`**, shown separately from availability.
Closing time is never calculated from duration. A missing/invalid closing time
remains “Chưa có thông tin”; an invalid opening date is omitted by the existing
mapping.

Source tracing: `backend/app/api/v1/exams.py::_exam_summary` already returns both
availability fields, duration and `classes: [{ id, name }]`.
`backend/app/api/v1/live_classes.py::_serialize` already returns `class_id`,
`class_name`, `scheduled_start` and `scheduled_end`. These existing fields supply
the course names in the UI. No API contract or backend changes were needed.

## Interaction and responsive behavior

The grid and agenda show at most **three entries per date**. `+N sự kiện khác`
opens a scrollable day detail with every entry, its complete title, course,
availability, duration, status and actual destination link. Event hover/focus
previews details; click/tap pins the popover. Escape and the close button return
focus to the trigger. Scrolling inside day details preserves the popover.

The legend explains marker shape rather than assigning colors to opening and
closing. The teal today circle and a subtle warm cell remain independent of
event colors. Event text and filled markers are checked for contrast in both
themes. Calendar/upcoming borders and shadows are lighter, including dark mode.

Desktop retains the month grid. Mobile uses agenda. A narrow calendar container
(480px or less) also switches to agenda, allowing tablets to retain the grid when
there is enough room. Month, week, day and agenda modes keep the existing bounded
API requests, pagination and date navigation.

## Files changed

Application:

- `app/student/StudentCalendar.tsx` — daily entries, popovers, day overflow, compact upcoming times.
- `app/student/StudentCalendar.module.css` — scoped event colors, marker styles and responsive calendar presentation.
- `lib/student-calendar.ts` — consume existing course metadata; remove the superseded spanning-bar layout helper. Availability validation and status calculations remain unchanged.
- `lib/student-calendar-presentation.ts` — shared deterministic colors and date/endpoint presentation mapping.

Tests:

- `tests/e2e/student-calendar-presentation.spec.ts` — acceptance cases, contrast, actual time fit, identity stability, course colors and overflow details.
- `tests/e2e/student-calendar-range.spec.ts` — endpoint/ongoing UI while retaining availability, completion, pagination and navigation checks.
- `tests/e2e/student-dashboard.spec.ts` — event buttons open details; narrow containers may show agenda.
- `tests/e2e/neo-education.spec.ts` — calendar uses the requested lighter 1px border.

The greeting, learning cards, recent activity, quick links, sidebar and other
Dashboard areas retain their existing structure and styles. Scheduling,
attempt/duration rules, filtering, backend and database are unchanged. Source
checks for protected areas and status/fetch logic are in
[scope-audit.json](../artifacts/student-calendar-refactor/scope-audit.json).

## Validation and screenshots

Final check results are recorded in
[validation-summary.json](../artifacts/student-calendar-refactor/validation-summary.json).
**35 unique tests passed** across the complete scoped run and final targeted
checks: 32 neo/calendar/dashboard cases plus 3 accessibility/responsive cases.
The final ten-case acceptance suite passed after the course-color update, and
two event/focus scenarios passed again after stabilizing the dismiss callback.
Production build, fresh TypeScript and targeted ESLint checks also passed. The
build retains pre-existing repository warnings outside the changed calendar.
The acceptance suite covers multi-day/single-day cases, overlapping entries,
cross-week/month windows, today, missing closing times, completed attempts,
refresh/API ordering, keyboard use and the existing verify destination.

Screenshots were visually inspected in light and dark at 1440px and 390px:

- [1440px — full Dashboard](../artifacts/student-calendar-refactor/student-1440-light.png)
- [390px — full Dashboard](../artifacts/student-calendar-refactor/student-390-light.png)
- [1440px — Calendar](../artifacts/student-calendar-refactor/calendar-1440-light.png)
- [390px — Agenda, dark](../artifacts/student-calendar-refactor/calendar-390-dark.png)
- [390px — Complete event popover](../artifacts/student-calendar-refactor/popover-390-light.png)
- [390px — Day details](../artifacts/student-calendar-refactor/day-detail-390.png)

UI screenshots use isolated API test fixtures for the acceptance cases. The
application continues to render data from the existing APIs. Live backend/OCR/
Face/SFU integrations are outside these UI checks.
