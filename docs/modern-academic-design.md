# AI PROCTO — Modern Academic

AI PROCTO is an examination and learning workspace. The visual language is calm, compact, academic and suitable for daily administration. Teal identifies the brand and primary action; neutral surfaces make data readable.

## Source of truth

- `app/tokens.css`: palette, semantic colors, spacing, typography, corners and legacy aliases.
- `app/design-system.css`: shared components and workspace shell.
- `app/ui-consistency.css`: responsive behavior, layering, shared tables and actions.
- `app/theme.css`: dark surface and semantic ink overrides.
- Feature CSS modules own feature layout and consume the same tokens.

The historical color overrides in `globals.css`, `overrides.css` and `reference-theme.css` have been migrated to tokens. Their remaining layout rules support existing pages; do not introduce a new competing palette there.

## Palette

| Purpose | Light | Dark |
| --- | --- | --- |
| Page | `#F6F7F9` | `#10171D` |
| Card / input / header | `#FFFFFF` | `#182129` |
| Secondary surface | `#F1F4F6` | `#202B34` |
| Border | `#DDE3E8` | `#31404B` |
| Main text | `#18212F` | `#EEF2F4` |
| Secondary text | `#5F6B7A` | `#AFBDC9` |
| Sidebar | `#006D77` | `#006D77` |

Brand teal is `#087F83`, blue `#356AE6`, indigo `#6256D9`, amber `#E9A23B`, orange `#E97837`, coral `#DD6B5D`, green `#2E9B66`, purple `#8757C5`, red `#D84C4C`.

Use `--color-*` for solid accents and `--info`, `--success`, `--warning`, `--error`, `--purple`, `--indigo` for readable semantic text. Pair each text token with its `*-soft` surface. Dark mode changes text tones independently from solid button fills.

## Role and shell

`WorkspaceShell` exposes `data-role`. Student uses a blue accent, teacher teal and admin indigo. Only selected navigation, a small header indicator and selected controls change by role. The logo stays teal on a white logo surface in both themes.

The sidebar retains the original brand teal (#006D77), as requested. Selection uses a subtle white tint and a 3px accent rule. The 64px header is sticky and shares the card surface. Below 1024px navigation becomes a dismissible drawer. Keyboard focus and existing focus restoration remain available.

## Components

- Buttons: primary teal; secondary slate; info blue; success green; warning amber with dark text; danger red; outline and ghost neutral. Default height 44px; small 40px, coarse pointer targets 44px. Corners 7px.
- Cards: 9px corners, neutral border, no resting shadow. Small top rules or icon accents identify meaningful categories. Lists use dividers instead of nested cards.
- Fields: white/dark card surface, neutral border, 44px height, teal focus ring. Textareas retain 128px minimum height. Labels use main text and helpers secondary text.
- Tables: neutral header, horizontal dividers, neutral hover, subtle selected-row tint. Shared tables retain readable mobile cards and overflow menus.
- Badges: small semantic labels. Submitted/graded/verified use green; active/open use blue; upcoming uses purple; updates and automated submission use amber; revoked/terminated use red; inactive uses gray. Always retain a text label.
- Modals: 520 / 720 / 960px widths, 12px corners, neutral surface, clear heading and action footer. Large existing workflows may use 1100px.
- Typography: Inter, with Vietnamese support. Page titles 28px, sections 20px, card titles 16–18px, body 14–15px, metadata 12–13px. Headings use 600, body 400–500.
- Spacing: 4, 8, 12, 16, 24, 32px. Keep related actions and filters together.
- Icons: Lucide React. Mark decorative icons `aria-hidden`; keep accessible labels on icon buttons. The existing brand SVG is a brand asset.

## Feature semantics

- Dashboard: blue for exams, green for activity, teal for classes, amber for warnings. Metrics continue to use server data.
- Calendar: blue exams, purple live classes, teal class events, orange deadlines. The existing calendar API's `class` events are live classes, so presentation adds `live_class` without changing its data model. Status remains visible in labels and event details. Today uses a subtle amber surface.
- Monitoring: active blue, submitted green, warnings amber, severe risks red. Media surfaces remain dark for camera readability.
- Question bank: MCQ blue, true/false purple, written answers teal. Difficulty text is green / amber / red. Keep metadata concise.
- Support: “AI PROCTO Support” and “Trợ lý hỗ trợ”; neutral assistant bubbles, subtle teal user bubbles and indigo admin bubbles. Bubble corners 10px. No decorative sparkle, orb or gradient.

## Boundaries

This refactor is presentation only. API clients, backend, database, scoring, face verification, OCR, WebSocket and exam state calculations remain unchanged. Keep routing and existing event handlers when changing markup.

Avoid neon, glass, decorative gradients, oversized icons, colored page backgrounds and capsule buttons. Conic gradients representing timer progress and the video label contrast scrim are functional graphics.

## Validation

`tests/e2e/academic-design.spec.ts` checks all three role shells in light/dark themes, 375/768/1024/1440px widths, keyboard drawer behavior, calendar category distinction, component contrast and modal focus restoration. Existing responsive, calendar, monitoring, document and support suites cover affected interactions. See `artifacts/modern-academic` for the source snapshot and review captures.
