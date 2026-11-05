# Homepage GSAP animation

The public homepage uses the existing `gsap` and `@gsap/react` dependencies. Animation is confined to `PublicHero` and the `PublicHomeMotion` client boundary. `LandingPage` still supplies server-rendered content; layout, copy, navigation, authentication, and backend behavior are unchanged.

- `PublicHero` uses scoped `useGSAP()` and three reusable `gsap.quickTo()` tweens for a ref-backed gaze target and spotlight opacity. The pupils and both beam layers use the same interpolated coordinates. Pointer events update numeric targets without React state, layout measurements, or new tweens.
- One temporary GSAP ticker callback paints the SVG after the tweens update. It detaches when the gaze settles, when the hero leaves the viewport, and while the document is hidden. Resize/scroll measurements are coalesced into a single requested frame; there is no independent smoothing loop.
- Separate once-only ScrollTrigger timelines introduce the hero copy and illustration when each enters view. This keeps the stacked mobile illustration from finishing before it is reached. Copy moves 14px with a 55ms stagger; the owl and preview fade in place to preserve spotlight alignment and caption spacing.
- `PublicHomeMotion` uses `ScrollTrigger.batch()` for feature cards, grouping up to three cards entering together with a 45ms stagger, 16px travel, and a 550ms fade. Cards farther down a mobile screen wait until they enter view. The batch callback belongs to the media-query context so a live reduced-motion change also cancels delayed or active batches.
- Section headings have a restrained 12px reveal. Support and final CTA blocks use a 16px, 600ms reveal. Secondary cards, steps, FAQ answers, and body content remain still. Motion uses transform/opacity, runs once, clears inline styles afterward, and preserves native scrolling.
- A scoped ResizeObserver coalesces ScrollTrigger refreshes when fonts, FAQ expansion, or responsive reflow change the page height. It does not run on transform/opacity updates.
- `gsap.matchMedia()` responds to live `prefers-reduced-motion` changes. Reduced motion restores visible content and keeps a static, visible spotlight. Touch and narrow screens also keep the static owl interaction. Existing CSS already disables button motion for reduced motion.
- Focus immediately completes the relevant entrance/reveal. All animations are progressive enhancements: content remains visible without JavaScript. `useGSAP()` and media-query contexts revert animations/ScrollTriggers, and explicit cleanup removes listeners, observers, measurement frames, and ticker callbacks on navigation.

Regression coverage lives in `tests/e2e/eye-spotlight.spec.ts`, `tests/e2e/public-homepage.spec.ts`, and `tests/e2e/homepage-motion.spec.ts`. The motion tests cover once-only reveals, mobile viewport entry, CTA positioning after FAQ expansion, keyboard focus, live motion preferences during a card batch, identical settled hero geometry across motion modes, and suspended painting while offscreen with resumed tracking on return.

## Validation

- All eight motion tests passed in Edge, including a short 390×520 mobile viewport, live reduced-motion changes during a card batch, FAQ layout changes, keyboard focus, once-only playback, and identical settled hero geometry at 390/768/1440px.
- Nine existing regression checks also passed: desktop spotlight alignment, static reduced-motion spotlight, light/dark layouts at 390/1440px, content without JavaScript, keyboard access, and auth CTA navigation. The auth CTA test required one rerun before passing; no authentication code was changed.
- Focused ESLint and `tsc --noEmit --incremental false` passed. The scroll refinement used the existing development server and did not change package dependencies or project configuration.
- Desktop light and mobile dark screenshots were visually inspected. Current test artifacts are under the ignored `artifacts/gsap-scroll/` directory; the earlier GSAP integration's build and regression record remains under `artifacts/gsap-home/` and `.next-recovery-gsap-build/`.
