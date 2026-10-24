# Education typography assets

Baloo 2 and Nunito are self-hosted through `next/font/local`. Their variables and
semantic tokens are attached only to Public Home and the Student Dashboard.
Inter continues to use the existing root `next/font/google` setup.

Both WOFF2 files retain variable weights and OpenType layout features. They are
subsets of the Google Fonts upstream files, covering Latin, Latin Extended,
Vietnamese, combining marks, punctuation and currency characters. The CSS uses
Baloo 2 at 800 and Nunito at 600–700; the original font weight axes are retained.
Combined asset size is approximately 115 KiB. No runtime font service is needed
for these two new fonts; the existing Inter setup is unchanged.

Sources (SIL Open Font License 1.1, included alongside each font):

- [Baloo 2](https://github.com/google/fonts/tree/main/ofl/baloo2)
- [Nunito](https://github.com/google/fonts/tree/main/ofl/nunito)

Reproduction and glyph audit: `artifacts/neo-education/typography/prepare-fonts.py`.
This optional maintenance script needs Python fontTools and Brotli; neither is
an application/build dependency. Upstream SHA-256 values are recorded in
`artifacts/neo-education/typography/glyph-coverage.json`.
