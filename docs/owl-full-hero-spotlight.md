# Owl spotlight outside the centered hero wrapper

The hero section itself previously carried both `.container` (max-width 1200px) and the grid layout. Although the light SVG was a direct child of that section, its 100% width still meant the centered content width. Its own `overflow: hidden` and the public page's `overflow: clip` also cut painted light. Extending cone length alone could not fix the rectangular boundary.

The section now spans the full available page width. Its direct SVG child uses that same full width, while a separate `.container.heroContent` child preserves the existing centered grid and all responsive layout rules. The dotted background also uses the outer section's width instead of a 100vw breakout. Neither the SVG nor its ancestors clips the light, applies a mask, paint containment or a rounded clipping boundary.

Eye positions still come from the owl SVG's screen transform, including its responsive scale. Both neutral eye positions and pointer positions are expressed relative to the outer section, then the existing smoothed pupil offset supplies the exact beam apex. The overlay viewBox is measured from this outer section. No hardcoded offsets were added.

Existing longitudinal gradients fade to transparent beyond the pointer, and the existing 5px/14px blur values soften cone edges. Filter regions now follow the actual cone bounds plus a 48px blur margin, calculated from the same path/control-point coordinates. They no longer introduce a second hero-sized rectangular cutoff. These SVG paint bounds are updated together with the paths; they require no DOM geometry reads and do not change layout dimensions. SVG ink can extend past the section without creating horizontal layout overflow.

The scoped `useGSAP()` hook, refs, three reusable `gsap.quickTo()` tweens, cached resize/scroll geometry, reduced-motion behavior and offscreen/hidden-tab cleanup are retained. Pointer events update the shared gaze without React state changes or new tweens. Painting stops after settling.

## Validation

- Ten spotlight browser tests passed, including full-width geometry at 1024/1440/1920px and actual illuminated pixels at both far viewport edges of a 1920px page, outside the centered content wrapper.
- Every light ancestor was checked for clipping overflow, paint containment, masks, clip paths and rounded boundaries; none remain in the spotlight ancestry.
- Beam apices stay within 0.1px of the moving pupil centers across tested directions. Pointer aim, resizing, scrolling, idle suspension, cached geometry, CTA clickability and foreground stacking pass.
- No horizontal scrollbar at desktop target positions or the tested 390/768px touch layouts. Touch/reduced motion retain static decorative lighting, including live preference changes.
- Light/dark headline and CTA illumination pass. Far-left/far-right screenshots were visually reviewed for an internal boxed cutoff.
- Before/after bounds and text of the copy, headline, description, buttons, trust text, figure, owl and monitoring card are exactly equal at 390/768/1024/1440/1920px. Only the outer hero section becomes wider.
- Four existing homepage-motion regressions passed: equal settled layouts across motion preferences at 390/768/1440px, plus offscreen suspension and tracking resumption.
- Focused ESLint and `tsc --noEmit --incremental false` pass.
- Production build passes (42 static pages) in isolated `.next-recovery-owl-outerhero` output. The build's temporary TypeScript route-path additions were restored; existing unrelated lint warnings remain.

Artifacts: `artifacts/owl-outer-hero/` contains layout measurements, edge screenshots and browser/build logs.

Product files changed: `components/public/PublicHero.tsx` and `components/public/PublicHome.module.css`. Regression coverage: `tests/e2e/eye-spotlight.spec.ts`. The owl artwork, content, buttons, monitoring-card markup, backend and business logic were preserved.
