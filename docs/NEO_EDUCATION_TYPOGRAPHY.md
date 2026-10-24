# AI PROCTO — Education typography refinement

Display font: **Baloo 2, 800**  
Heading font: **Nunito, 700** (navigation 600–700)  
Body font: **Inter, 400–500**  
Vietnamese glyph test: **PASS**  
Public Home updated: **YES**  
Student Dashboard updated: **YES**  
Layout changed: **NO**  
Brand #006D77 preserved: **YES**

The rounded display font is limited to the public hero, major educational landing
headings, Student Dashboard greeting and dashboard empty-state titles. Sections,
card titles and actions use Nunito. Reading text, metadata, calendar data and form
controls retain Inter. Teacher, Admin and other Student routes retain their
existing fonts; browser checks confirmed Inter on representative text there.

## Vietnamese coverage

Fredoka was examined first, as requested. Its upstream font lacks 73 code points
in the audit set, including Vietnamese letters and tone marks. Baloo 2 is the
requested Vietnamese-compatible fallback. All three selected fonts pass the
character-map check, including uppercase variants and decomposed combining marks.
Both packaged WOFF2 subsets were checked again after subsetting.

The browser proof contains all seven requested glyph rows and all four requested
phrases in Baloo 2 800, Nunito 700 and Inter 400. Chrome's actual platform-font
inspection confirms all 33 samples use the intended custom font, with no mixed
fallback glyphs. The proof image was visually inspected for accent placement.

- [Glyph proof](../artifacts/neo-education/typography/vietnamese-glyphs.png)
- [Character-map audit](../artifacts/neo-education/typography/glyph-coverage.json)
- [Browser font audit](../artifacts/neo-education/typography/browser-audit.json)
- Primary font metadata: [Fredoka](https://github.com/google/fonts/blob/main/ofl/fredoka/METADATA.pb), [Baloo 2](https://github.com/google/fonts/blob/main/ofl/baloo2/METADATA.pb), [Nunito](https://github.com/google/fonts/blob/main/ofl/nunito/METADATA.pb).

## Implementation scope

`components/education/typography.ts` loads the two local variable WOFF2 assets
through `next/font/local`, with swap, preloading and an adjusted Arial fallback.
The shared CSS module defines `--font-display`, `--font-heading`, `--font-body`.
Only the Public Home root and the existing `/student` shell condition opt into
the class. The existing Inter loading architecture is unchanged. Both added fonts
are bundled with their SIL Open Font License; no runtime font service is added.

CSS audit confirms all **1,025 non-typography declarations** match the pre-change
source: composition, grids, spacing, sizing, palette, borders, shadows, responsive
rules and interactions. Heading letter spacing and the dashboard heading's line
height are typography changes. Font metrics can naturally change text wrapping;
no layout declarations were changed. Root layout and global design tokens are
byte-for-byte unchanged. The two TSX changes only attach the scoped font class.
No API, backend, database, business, authentication or routing logic was edited.

- [Scope audit](../artifacts/neo-education/typography/scope-audit.json)
- [Source diff](../artifacts/neo-education/typography/source-review.patch)

## Visual review

Both pages were rendered and inspected at **1440px** and **390px**, in light and
dark modes. There is no horizontal overflow. The rounded 800 display faces visibly
change the personality of the hero and greeting while Nunito keeps card and
section titles quieter. The original neo education composition is preserved.

- [Interactive before/after comparison](../artifacts/neo-education/typography/comparison.html)
- [Public Home — 1440px](../artifacts/neo-education/typography/home-1440-light.png)
- [Student Dashboard — 1440px](../artifacts/neo-education/typography/student-1440-light.png)
- Original screenshots and edited-source backups are under `artifacts/neo-education/typography/before/`.

## Validation

Browser font/scope audit: **PASS** — 8 views, 33 Vietnamese rendering checks,
3 route isolation checks. CSS scope audit: **PASS**.

Production build (`npm run build`): **PASS**. Fresh TypeScript check
(`npx tsc --noEmit --incremental false`): **PASS**. The build retains existing
repository Hook/image lint warnings; there are no new typography build errors.

The 35-case existing neo/public/student suite initially produced **33 passes and
2 failures**. The Admin workspace test timed out during the run and then passed
unchanged in isolation (5.9s). The auth CTA test reached registration but did not
switch back to login within its assertion window in development; it failed again
in a targeted dev check. The same unchanged test **passed against the completed
production build** (4.8s). Thus every selected case has a passing execution, with
the auth case's passing result coming from production. The development auth test
remains an observed timing limitation; no auth logic or test assertions were
changed to force a pass.

Evidence: `regression.log`, `recheck.log`, `production-auth-check.log`,
`production-build.log`, `typescript.log`, `validation-summary.json` under
`artifacts/neo-education/typography/`. UI checks use API/media fixtures and do not
claim to exercise live OCR, Face or SFU services.
