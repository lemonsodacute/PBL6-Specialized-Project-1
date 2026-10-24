# ProctoOwl typography

Home and Student share `components/public/typography.ts`, loaded once by the root
layout using `next/font/google`. Latin and Vietnamese subsets are preloaded.

- Display: Baloo 2 700/800 for hero, page and major section headings.
- Body: Nunito 400/500/600/700/800 for text, navigation, cards, buttons and forms.
- Wordmark: Baloo 2 700.
- Fallback: Nunito (the hero retains weight 800). Never use Fredoka.

The Home hero uses `clamp(52px, 5.3vw, 72px)`, weight 800, line height 1.08 and
tracking -0.02em. Smaller breakpoints retain the existing responsive sizes.
Next.js self-hosts the fonts; no external stylesheet or runtime Google request.

Older Be Vietnam Pro WOFF2 assets in this directory are retained as historical
assets and are no longer loaded by the public typography module.

Visual review and screenshots: `artifacts/baloo2-typography/`.
