# Student exam result detail layout fix

## Root cause

`app/globals.css` allocated a fixed 220px column to the question navigator. After card padding and borders, its interior was only 170px wide. The nested `repeat(5, 1fr)` grid retained the buttons' automatic minimum widths: with two-digit question numbers, the five columns and gaps needed 222px. The grid overflowed instead of wrapping or shrinking its tracks.

A reproduction with 15 questions measured button 5 at x=505–543, while its card ended at x=516 and the detail card began at x=540. This put the button 27px outside its card and 3px into the detail card. Questions 10 and 15 overflowed too. The old mobile rule forced eight columns, and the old stacking breakpoint of 760px left 768px squeezed into desktop columns.

## Fix

Only result-specific CSS changed in the product:

- Desktop keeps two columns: a 264px navigator, a `minmax(0, 1fr)` answer column and a 24px gap.
- Navigator padding is 20px. Its desktop grid uses four `minmax(0, 1fr)` columns; buttons fit their tracks and retain at least 44px touch dimensions at the tested widths.
- The layout and both cards explicitly allow shrinking with `min-width: 0`. Long question text, answers and explanations wrap in the detail card. The points label retains its natural width.
- At 900px and below, the navigator stacks above the detail card. Its grid uses auto-fit with a 44px minimum that also respects the available width, replacing the fixed eight-column mobile rule.
- Cards align at their top edges. No clipping, hidden overflow or overlapping-position workaround was added.

Scores, correct/wrong colors, selected state rules, question-selection handlers, answer visibility, explanations, routes, API, auth and backend/scoring code are unchanged. The React result page was not edited.

## Validation

- **9 E2E tests PASS**, `artifacts/student-result-layout/e2e.log`.
- Checked 1440, 1024, 768 and 390px light mode; also 1440 and 390px dark mode. Every question button fits inside the navigator's padded content. No grid/card/page horizontal overflow or left/right overlap. The gap is 24px in both desktop and stacked layouts.
- Mouse and keyboard question selection preserve active/correct/wrong classes, displayed answers, explanation and score summary.
- Stress tests: 120 questions, three-digit labels and long unbroken text at desktop/mobile widths.
- Pending essay scores and unpublished correct answers keep their existing display.
- **TypeScript PASS**, `tsc --noEmit` (`typecheck.log`).
- **Lint PASS**, no warnings/errors in the new test (`lint.log`).
- **Production build PASS**, Next.js 15.5.28, 42/42 static pages (`build.log`). Output is isolated in `.next-recovery-student-result-layout`; `tsconfig.json` and `next-env.d.ts` were restored byte-for-byte after building. Existing unrelated hook warnings remain; no new build errors.

The before test intentionally failed on real DOM overflow, confirming the reproduction (`before.log`). Tests use isolated API fixtures and do not modify real student attempts. This is a frontend layout verification, not a rerun of backend scoring or the complete exam/proctoring suite.

## Files and evidence

- `app/globals.css` — repair the existing result layout rules at their source.
- `tests/e2e/student-result-layout.spec.ts` — regression and overflow checks.
- `docs/student-result-layout-fix.md` — this report.

Geometry: [layout-summary.json](../artifacts/student-result-layout/layout-summary.json). Screenshots: [before desktop](../artifacts/student-result-layout/before-1440-light.png), [after desktop](../artifacts/student-result-layout/after-1440-light.png), [1024px](../artifacts/student-result-layout/after-1024-light.png), [768px](../artifacts/student-result-layout/after-768-light.png), [390px](../artifacts/student-result-layout/after-390-light.png). Other dirty files in the shared workspace were preserved.
