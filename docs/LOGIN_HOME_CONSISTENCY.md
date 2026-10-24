# Login / Home visual consistency

The authentication screen now shares the public Home identity. No authentication behavior or technical identifiers changed.

- Reuses `publicTypography`: Nunito 700 for title, wordmark and CTA; Be Vietnam Pro 400–500 for descriptions, labels, fields and links. This is the actual Home stack, including its Vietnamese-safe Nunito fallback.
- Reuses `PublicBrand` directly, including the same owl SVG, wordmark, responsive sizing and accessible Home link.
- Exposes the existing Home palette as `PublicHome.module.css`'s `theme` class. Home and Login share its light/dark colors, card radius/shadow and exact radial dot pattern (1.7px dots, transparent at 2px, 26px spacing). Home's computed appearance is unchanged.
- Adds a Next.js `Link` with Lucide `ArrowLeft`, labelled “Quay lại trang chủ”, outside the card/form. It has a 44px target, teal hover tint and keyboard focus ring.
- Reuses Home's button classes for the #006D77 primary CTA. Inputs retain their structure and controls, with shared border/surface/font tokens and teal focus styling.
- Styles are scoped to the auth component. Its existing register, recovery and reset modes inherit the same visual wrapper; their fields, transitions, validation and API calls are intact. Student/Teacher/Admin styles are untouched.

## Source changes

- `components/auth/LoginForm.tsx`: visual wrapper, Home link, shared logo/type/theme and CTA classes only.
- `components/auth/LoginForm.module.css`: scoped responsive auth styling.
- `components/public/PublicHome.module.css`: expose existing tokens for reuse, without changing Home's appearance.
- `components/public/LandingPage.tsx`: opt into that same shared theme class.
- `components/public/typography.ts`: clarify the shared scope in its comment; font setup unchanged.
- `tests/e2e/proctoowl.spec.ts`: expect the reused accessible brand link instead of the old background-image brand.
- `tests/e2e/login-home-consistency.spec.ts`: verify actual Home/Login fonts, pattern, logo, CTA and keyboard Home navigation in light/dark at desktop/mobile widths.

## Evidence

`artifacts/login-home-consistency/` contains before/after screenshots, theme/font/overflow metrics and a source scope audit. The scope audit compares authentication logic and form controls against the before snapshot; the CTA's style classes are the only form markup difference. It also checks unchanged Home computed styles and no horizontal overflow at 1440, 768, 390 and 320px, in both color schemes.

Run `python artifacts/login-home-consistency/audit-scope.py` after capturing screenshots with `node artifacts/login-home-consistency/capture.cjs after`.

Build/lint and Playwright validation logs are stored alongside the evidence. Auth regression tests use API fixtures, not live credentials or backend writes.

Validation completed: production build PASS; lint PASS with existing unrelated Hook warnings; 56 unique E2E cases PASS across two batches (52 existing regressions, 4 Home/Login consistency cases). Initial consistency assertions selected a navigation link instead of the hero CTA and compared a repeated `sans-serif` fallback literally; the tests were corrected, with no further application changes required. `accessibility.json` records 16 combinations of login/register/forgot/reset, desktop/320px and light/dark: no unlabeled text inputs, no horizontal overflow, and checked text contrast at least 4.5:1. Keyboard focus, Home navigation and password controls are covered by E2E tests. This is a focused accessibility check, not a full WCAG certification.

Clean production previews: `production-light-1440-login.png`, `production-light-390-login.png` and corresponding dark screenshots.
