# AI PROCTO — main content without redundant introductions

Scope: frontend presentation only. Global header, area label, logo, sidebar,
notification bell, account menu and avatar remain intact. No API, backend,
database, permissions, exam, scoring, identity, OCR or Face Verification change.

## Shared presentation

- Collection, profile, settings, help and dashboard pages no longer mount
  introductory `PageHeader` blocks. Menu titles, area eyebrows and generic
  descriptions are removed from main content, not hidden with CSS.
- `PageHeader` defaults to no introduction. Details that need context explicitly
  use `mode="context"`: a 16px title, optional small context prefix and existing
  actions. Compatibility properties cannot render old introductory text.
- `CollectionToolbar.actions` keeps search/filter and create/refresh/export
  controls together. Original handlers and disabled states are preserved;
  actions remain outside the filter fieldset.
- Main content starts with 28px top padding on desktop and 16px on mobile.
  Existing nested workspace padding reset prevents double padding.
- Dashboard metrics come first. Student shortcuts follow the metrics. Teacher
  and Admin shortcuts remain in the relevant dashboard content card.
- Profile summary names, photos/fallbacks, email and all actual section headings
  stay visible. Meaningful class descriptions, timestamps and teacher names stay
  as compact metadata.

## Route audit

| Routes | Presentation |
| --- | --- |
| `/dashboard`, `/teacher`, `/admin` | Shared overview, metrics first; aliases retained |
| `/student` | Metrics, shortcuts, upcoming events, activity and calendar |
| `/dashboard/users` | Search/filter/create first; account table and verification requests preserved |
| `/admin/classes`, `/dashboard/classes`, `/student/classes` | Shared class collection; Admin create action in filter card |
| `/dashboard/exams` | Filter/refresh/create toolbar, existing table and action menus |
| `/dashboard/question-banks` | Filter/create toolbar and bank cards |
| `/dashboard/live-classes`, `/student/live-classes` | Filter/action toolbar and actual session list |
| `/dashboard/reports` | Filter/refresh/CSV toolbar, actual metrics and results |
| `/dashboard/monitor` | Filters and actual monitored exams |
| `/admin/student-cards` | Filters/refresh toolbar and verification records |
| `/dashboard/action-logs`, `/admin/action-logs` | Shared audit collection, no repeated introduction |
| `/student/exams`, `/student/grades`, `/student/history` | Actual exam/result/history content |
| `/student/profile`, `/teacher/profile` | Profile summary first; identity/contact/account sections retained |
| `/student/settings`, `/teacher/settings`, `/admin/settings` | Actual settings groups/forms |
| `/student/help`, `/teacher/help`, `/admin/help` | Guide search first; actual guide/FAQ/support sections |
| `/notifications` | Filters and mark-all action in one card; shared global bell unchanged |
| `/admin/classes/[id]`, `/dashboard/classes/[id]`, `/student/classes/[id]` | Compact class context and back control, actual fields/membership/content |
| `/dashboard/question-banks/[bankId]` | Existing breadcrumb; question actions in content card; no duplicate title |
| `/dashboard/question-banks/[bankId]/documents` | Existing breadcrumb, wizard steps and current step heading; no duplicate introduction |
| `/dashboard/exams/[id]` | Compact edit context; existing editor/cancel/save flow |
| `/dashboard/exams/[id]/attempts`, `/dashboard/exams/[id]/report` | Shared results toolbar, actual exam summary and student results |
| `/dashboard/exams/[id]/grade/[attemptId]` | Compact actual exam title and existing result/grading content |
| `/dashboard/reports/attempts/[attemptId]` | Compact report context, back/refresh and actual data |
| `/dashboard/monitor/[examId]`, `/dashboard/monitor/[examId]/[attemptId]` | Shared compact monitoring context and actual monitoring content |
| `/student/exams/[examId]/verify` | Compact exam/verification context and step badge; verification flow unchanged |
| `/student/attempts/[id]/result` | Compact actual exam title, timestamp, score and answers |
| `/student/attempts/[id]` | Actual exam title, sticky timer/device/submit controls retained; area eyebrow removed |
| `/live-class/[id]` | Compact session/class context; participants and room controls retained |
| `/ui-kit` | Compact component-demo context and existing sections |

`/student/identity` and `/student/schedule` retain their existing redirects.
Retired oral grading/student oral URLs retain their existing redirects: no oral
menu, feature or endpoint is restored. `/` retains its existing redirect.
Login, not-found and error titles remain because they describe actual task/error
content, rather than repeating a workspace menu item.

## Validation

- TypeScript: `npx tsc --noEmit` passed.
- 74 distinct Playwright cases passed after the affected development/fixture
  cases were rerun. Coverage includes the cross-role audit, compact details,
  exam actions, documents, settings/help, Teacher results, profile states,
  question creation/selection and full-inbox actions.
- Cross-role browser audit: 30 collection/profile/dashboard/settings/help/inbox
  role-route combinations at 375px, 768px and 1440px; no introductory H1/block,
  expected top padding, account/bell controls and no horizontal overflow.
- Detail tests at 375px and 1440px preserve class names/back navigation, result
  content, verification steps, question actions, document breadcrumbs/steps and
  Admin class fields/create navigation.
- Existing exam action, question-document, settings/help and Teacher results
  regressions passed, including confirmations, CSV and private image previews.
- Image preview revealed mobile column wrapping in the document toolbar. Scoped
  row wrapping fixes this layout overflow; text/image extraction and persistence
  logic are unchanged.
- Browser checks use isolated API fixtures, including long names/emails and
  actual API-shaped fields. Screenshots/logs are kept in the OS temp directory;
  production screens contain no fixture data and testing performs no real writes.

Initial development runs hit hydration/loading interruptions while files were
being edited. A new bank-detail fixture also initially missed the API query
string; its route matcher was corrected. Those affected cases were rerun after
the implementation stabilized.
