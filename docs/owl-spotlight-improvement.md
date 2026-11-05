# OWL SPOTLIGHT IMPROVEMENT

The homepage now has a visible idle spotlight, a brighter teal core, and a wider ambient layer. Cursor tracking and both pupils use the same smoothed target. The change is limited to the decorative effect and its tests.

## Root cause of weak beam

The SVG and animation state started at opacity **0**, and pointer leave returned to **0**. Reduced-motion and touch CSS hid the entire effect. During tracking, both eyes used a single layer with muted `#65BFB8`, gradient alpha `.14` at 30% and `.08` at 80%, and an 8px blur. This looked faint against the warm `#fff8f3` hero background.

The audit found correct full-hero geometry and stacking already in place. The light is an absolutely positioned sibling of the copy and illustration: background z-index 0, beam 1, owl 2, text/card 3. The card has `overflow:hidden`, but does not contain the beam; the owl wrapper is visible-overflow. The overlay clips only at hero bounds. There was no parent-opacity multiplier, mask, or blend mode causing the loss. Eye anchors are measured through the owl SVG transform into hero coordinates, rather than using a CSS transform origin or the small image box.

## Changes

| Item | Result | Detail |
|---|---|---|
| Beam opacity | UPDATED | Desktop overlay `.78` idle / `1` active; per-eye core alpha peaks at `.24`, ambient at `.12` |
| Beam width | UPDATED | Core half-width grows with distance at `.30`, capped at 210px; ambient `.46`, capped at 290px |
| Beam length | UPDATED | New idle target reaches into the left headline area; existing cursor-distance geometry remains full-hero |
| Gradient | UPDATED | `#5EE7DF`, `#64D8D1`, `#7DE3DD`; both layers fade to transparent, with no uniform opaque fill |
| Blur | UPDATED | 5px readable core, 14px ambient falloff; blur values are fixed, not animated |
| Clipping | NOT APPLICABLE | No internal clipping defect; full-hero overlay preserved and filter regions cover it |
| Cursor tracking | PASS | Existing elapsed-time requestAnimationFrame smoothing; no pointer-driven React state |
| Pupil synchronization | PASS | Both layers begin at the translated pupils; measured origin error below 0.1px in interaction checks |
| Idle beam visible | PASS | Visible before pointer movement and after pointer leave |
| Mobile | PASS | Smaller static light; local idle target, capped spread; no horizontal overflow |
| Reduced motion | PASS | Visible static spotlight; pointer motion does not alter it; live preference changes tested |
| Layout regression | PASS | Hero, headline, description, CTA group, owl and card bounding boxes identical at all four requested widths |
| Build | PASS | `npm.cmd run build` completed, including compilation, lint/type checks and page generation |

Tablet idle opacity is `.68`, active `.84` when a fine pointer is present. Mobile idle opacity is `.58`; tracking is disabled on viewports up to 600px and on coarse pointers. The static target stays near the owl in the stacked layout. These overlay multipliers combine with the per-layer gradient alpha; they are not the final composited pixel opacity.

No GSAP dependency is installed, so the existing rAF implementation was retained. Frames stop when settled, offscreen or in a hidden document. Geometry is measured on resize/scroll, not on every pointer event. The overlay remains noninteractive, and the CTA and card links were checked for clickability.

## Screenshots and comparison

| Width | Before | After |
|---|---|---|
| 1440 | [Idle](../artifacts/owl-spotlight/before/1440-idle.png), [active](../artifacts/owl-spotlight/before/1440-active.png) | [Idle](../artifacts/owl-spotlight/after/1440-idle.png), [active](../artifacts/owl-spotlight/after/1440-active.png) |
| 1920 | [Idle](../artifacts/owl-spotlight/before/1920-idle.png), [active](../artifacts/owl-spotlight/before/1920-active.png) | [Idle](../artifacts/owl-spotlight/after/1920-idle.png), [active](../artifacts/owl-spotlight/after/1920-active.png) |
| 768 | [Static](../artifacts/owl-spotlight/before/768-idle.png) | [Static](../artifacts/owl-spotlight/after/768-idle.png) |
| 390 | [Static](../artifacts/owl-spotlight/before/390-idle.png) | [Static](../artifacts/owl-spotlight/after/390-idle.png) |

Also captured: [reduced motion](../artifacts/owl-spotlight/after/1440-reduced-motion.png) and [dark appearance](../artifacts/owl-spotlight/after/1440-dark.png). Existing theme colors are preserved; the dark theme's teal emphasized headline remains a pre-existing contrast limitation, and the automated theme checks do not certify that nested accent's composited contrast.

The same unobstructed background sample at both desktop widths shows approximately **1.62× the previous active beam's average RGB deviation from the unlit background**. This is a local pixel comparison, not a perceptual brightness score. See [visibility-comparison.json](../artifacts/owl-spotlight/visibility-comparison.json). Visual inspection confirms a stronger light with transparent falloff and unchanged readable light-theme content.

## Verification

- Six spotlight tests passed: 1440/1920/1024 tracking and boundary checks, 768/390 touch containment, and reduced-motion preference changes. These include actual rendered-pixel comparisons outside the owl/card, pupil alignment, scrolling coordinates, stable idle painting and foreground clickability.
- Ten existing homepage regression tests passed: pointer tracking, registration CTA navigation, and responsive light/dark layout checks.
- Production build passed. Log: [build.log](../artifacts/owl-spotlight/build.log).
- Before/after layout measurements: [before](../artifacts/owl-spotlight/before/layout.json), [after](../artifacts/owl-spotlight/after/layout.json).
- Hero content and the monitoring-card/artwork markup after `{children}` are byte-identical to the pre-change copy. Page layout, navigation, text, buttons, typography and spacing are unchanged.

Commands used:

```powershell
$env:PLAYWRIGHT_CHANNEL='msedge'
$env:PLAYWRIGHT_BASE_URL='http://localhost:3000'
npx.cmd playwright test tests/e2e/eye-spotlight.spec.ts --output=artifacts/owl-spotlight/playwright
npx.cmd playwright test tests/e2e/proctoowl.spec.ts --grep 'owl pupils|touch has|ProctoOwl hero' --output=artifacts/owl-spotlight/regression
npm.cmd run build
```

## Files changed for this task

- `components/public/PublicHero.tsx`: two light layers, persistent idle/static behavior, synchronized pupil/beam targeting.
- `components/public/PublicHome.module.css`: nonzero overlay default and visible static effect for reduced-motion/touch users.
- `tests/e2e/eye-spotlight.spec.ts`: spotlight acceptance checks.
- `tests/e2e/proctoowl.spec.ts`: update previous hidden-on-leave/touch/reduced-motion expectations to the requested visible static state.
- `docs/owl-spotlight-improvement.md`: this report.

Screenshots, capture utility, measurements and pre-change source copies are in the ignored `artifacts/owl-spotlight/` directory. No backend, database, auth, exam, AI Support, face verification, proctoring or LiveKit changes were made for this task.
