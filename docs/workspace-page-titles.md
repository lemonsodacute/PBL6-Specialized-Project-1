# Workspace page titles

Large redundant page-introduction titles are now screen-reader-only inside the Student, Teacher, and Admin workspace shells. They no longer occupy a row or leave a heading-sized gap. The topbar, role badge, notification/profile controls, descriptions, statistics, illustrations, filters, tabs, and actions keep their current content and behavior.

## Shared implementation

- `components/layout/WorkspacePageTitles.module.css`: one workspace-scoped presentation policy for standalone intro headings and the existing teacher collection/Question Bank hero title IDs. Removes obsolete paragraph margins and hero minimum-height reservations.
- `components/layout/AppShell.tsx`: applies that policy through the shared `WorkspaceShell`, covering all three roles.
- `components/student/StudentPageHeader.tsx`: renders the semantic title without an empty header wrapper or extra grid row.
- `components/chat/AdminInbox.tsx`: marks its custom introductory title for the same policy.
- `tests/e2e/settings-help.spec.ts`: uses `PLAYWRIGHT_BASE_URL` for fixture CORS/cookies so existing assertions run against a dedicated test server.

## Affected pages

- Student: online classes, exam list, grades/results list, profile, settings, and help. Shared Student headers on classroom/detail views receive the same treatment. History and the class collection already omitted their redundant visual title.
- Teacher: Question Bank, classes, online classes, and standalone monitoring/report page introductions. Other collection/profile pages already use the shared header's title-free mode.
- Admin: dashboard, reports, AI Activity, Knowledge Base, and support inbox. Pages already omitting standalone titles keep that behavior.

Compact contextual detail/wizard headers stay visible. Card/section headings, the Student overview greeting card, active exam/meeting headers, public homepage, login, and error-page headings retain their presentation. The shared `PageHeader` action and context modes are unchanged.

## Verification

- Production build and TypeScript: passed.
- Targeted lint: no errors; the existing AdminInbox effect-cleanup warning remains.
- Browser audit: 68 page/theme/viewport combinations across 17 routes at 1440/390px in light/dark, plus preservation checks for detail context, the overview greeting, and public headings. Topbar geometry, content section labels and controls remained unchanged; no horizontal overflow was found.
- Existing e2e: 11 relevant tests passed, covering settings/help for all three roles, class/live-class filters and actions, creation/confirmation flows, Knowledge Base filtering, and report export. The 768px light and 1024px dark collection layouts also passed.
- Logs, audit results, and screenshots: `artifacts/workspace-page-titles/`.

The original settings test's fixed `localhost:3000` CORS origin caused its first run on port 3107 to fail. The fixture now follows the configured base URL; all three role cases passed on rerun. No product API, routing, auth, data, or business logic changed.
