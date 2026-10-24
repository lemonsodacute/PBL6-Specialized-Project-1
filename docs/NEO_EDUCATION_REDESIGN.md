# NEO EDUCATION REDESIGN

Public Home structurally redesigned: **YES**  
Student Dashboard structurally redesigned: **YES**  
#006D77 preserved: **YES**  
Business logic changed: **NO**

Only `/` and `/student` receive the new visual direction. Teacher, Admin and other
Student routes retain their previous presentation. `WorkspaceShell` adds a scoped
CSS-module class only when both the role is student and pathname is `/student`.

## Composition

Public Home now has an outlined, rounded navigation frame; an expressive two-column
hero; an exam-card illustration with identity, live-class and result tiles; six
colored feature blocks; three staggered role panels; four numbered steps; an
integrated AI section; and a large final CTA. All illustration data is labeled as
illustration. There are no invented usage statistics or social links.

Student Dashboard now has a personalized welcome and current date, three useful
learning/navigation blocks, a compact calendar beside stacked upcoming events,
and real recent activity below. Mobile uses the existing agenda implementation.
The first two cards use available upcoming events; otherwise they provide useful
navigation. The result card is navigation, with no fabricated score or count.
Upcoming filtering, calendar date windows, status calculations, event links and
recent-activity fetching are preserved.

`ui-ux-pro-max` informed the bold typography, visible boundaries, contrast and
interaction guidance. The requested soft neo-brutalist direction takes precedence
over generic dataset palette/radius suggestions. Inter and Lucide are retained.

## Files modified

| File | Purpose |
| --- | --- |
| `components/public/LandingPage.tsx` | New hero composition and product illustration; revised section hierarchy |
| `components/public/PublicHome.module.css` | Scoped cream/pastel palette, navy outlines, hard shadows, tactile CTAs, responsive and dark styles |
| `components/public/PublicHeader.tsx` | Existing registration destination presented as “Bắt đầu” |
| `components/layout/AppShell.tsx` | Dashboard-only presentation class; no routing or authorization changes |
| `app/student/StudentCalendar.tsx` | Welcome, learning cards, calendar/upcoming columns and stacked upcoming presentation |
| `app/student/StudentCalendar.module.css` | Dashboard-only shell, calendar, agenda, card and dark-mode styles |
| `tests/e2e/neo-education.spec.ts` | New composition, real-data, theme, brand and role-isolation checks; requested screenshots |
| `tests/e2e/public-homepage.spec.ts` | Expected headline and feature heading updated to the requested content |
| `tests/e2e/student-dashboard.spec.ts` | Assert welcome/card/calendar order and compact calendar instead of the retired giant-calendar composition |
| `tests/e2e/responsive-ui.spec.ts` | Expect the new welcome heading on `/student` and assert the existing `/student/schedule` redirect reaches that canonical page |
| `tests/e2e/ui-consistency.spec.ts` | Dashboard-only heading and 22px mobile gutter expectations; other route expectations retained |
| `docs/NEO_EDUCATION_REDESIGN.md` | This report |

No API clients, database, backend, auth providers, exam state helpers, scoring,
identity, AI generation, live classroom or notification handlers were changed.
Test changes reflect explicitly requested composition changes. Error, overflow,
navigation and data-integrity assertions remain in place.

## Screenshots

Public was rendered and visually inspected before starting the Student redesign.
Both pages were then inspected at 1440px and 390px in light and dark themes.
Screenshots use test fixtures; the application contains no fixture data.

| Page | Desktop | Mobile | Dark |
| --- | --- | --- | --- |
| Public Home | [1440px](../artifacts/neo-education/home-1440-light.png) | [390px](../artifacts/neo-education/home-390-light.png) | [1440px](../artifacts/neo-education/home-1440-dark.png), [390px](../artifacts/neo-education/home-390-dark.png) |
| Student Dashboard | [1440px](../artifacts/neo-education/student-1440-light.png) | [390px](../artifacts/neo-education/student-390-light.png) | [1440px](../artifacts/neo-education/student-1440-dark.png), [390px](../artifacts/neo-education/student-390-dark.png) |

Viewport captures are also saved as `home-hero-*` and `student-overview-*` for
reviewing the composition without scaling a full-page image.

## Validation

TypeScript: **PASS**.  
Tests: **75 unique cases verified**, including six targeted rechecks.  
Production build: **PASS** (existing lint warnings retained).

The main run passed 70 cases. Four failures came from retired visual expectations
(three legacy schedule-alias heading checks and one old 16px mobile gutter check).
The updated assertions explicitly verify the new requested heading, canonical
redirect and 22px dashboard spacing; the four responsive and one spacing rechecks
all pass. One calendar-link navigation timed out during the long run; its original
test passed in isolation without changing any assertion or application code. Raw
logs are preserved; `checks/frontend-summary.json` reconciles the 75 unique cases
and confirms there are no unresolved cases.

Logs are in `artifacts/neo-education/checks`. The regression run covers both pages,
calendar ranges and popovers, actual event destinations, empty/error/retry states,
theme/keyboard behavior, responsive role routes and Teacher/Admin isolation.
Live backend OCR/Face/SFU integrations were outside this presentation-only change.
