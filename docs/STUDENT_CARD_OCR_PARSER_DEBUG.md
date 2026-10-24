# Student Card OCR parser: MS / 06031034

Date: 2026-10-09 (Asia/Saigon).

### Raw OCR for MS/06031034

Ran the production `LocalOCR` adapter and persistent Tesseract worker against both local files for the second real card: the uploaded `original.bin` and its existing sanitized `card.jpg`. Both return these separate lines and words:

```text
MS
06031034
```

Bounding boxes are `(left, top, right, bottom)` in the EXIF-oriented image, in pixels.

| Input | Token/line | Confidence | Bounding box |
| --- | --- | --- | --- |
| Original upload | MS | 0.9663357544 | (144, 539, 175, 555) |
| Original upload | 06031034 | 0.9674441528 | (90, 569, 230, 592) |
| Existing preview JPEG | MS | 0.9666619110 | (144, 539, 175, 555) |
| Existing preview JPEG | 06031034 | 0.9676098633 | (90, 569, 230, 592) |

The code is 14 pixels below MS, centered within its column. The selected candidate has relation `below`, normalized distance `0.6304347826`, and no rejection reason. The original's `2011-2014` is rejected as `invalid_code_format`, as is the labelled birth date. The parser sees no competing valid code in this region.

Full raw text, every line/word's confidence and bounding box, candidates and rejection reasons are available locally in:

- `backend/private/ocr-parser-debug/original-after.json`
- `backend/private/ocr-parser-debug/preview-after.json`
- `backend/private/ocr-parser-debug/before-after.json`

These files stay in the existing ignored private directory; no raw-card diagnostics are sent to HTTP responses or application logs. The debug script uses the production worker, not a separate OCR configuration.

### Root cause

Tesseract already reads the digits correctly. The old parser had no MS alias, so it skipped that label/value pair. Its major aliases contained `nganh` but not `nganh hoc`, causing `học:` to remain in the extracted value. Alias matching also depended on declaration order, with no longest-label rule.

The old worker/adapter only exposed line text and average confidence. Available Tesseract word boxes/confidence were discarded, and the parser only checked the immediately following raw-text line. A multiline label used `min(label confidence, value confidence)`, unnecessarily limiting a good value when the label was weak.

### Student-code parser fix

Added MSSV, Mã sinh viên, Mã SV, Số thẻ SV, Số thẻ sinh viên, Student ID, Student No, Student Number and MS, retaining previous aliases. Compound labels such as `Số thẻ SV/Student ID:` are consumed together. MS must be an exact normalized label at the start of the line with a token boundary; substrings, MS06031034, SMS, M5 and M S are not aliases.

Candidates must be complete ASCII alphanumeric values of 6–32 characters containing a digit. Strings are preserved verbatim, including leading zeros and OCR O/I characters. There are no O→0 or I→1 substitutions, fuzzy ID comparisons, or expected-profile inputs to parsing.

The adapter now validates and preserves line/word boxes and confidence. The worker still uses the same `vie+eng`, `PSM.SPARSE_TEXT`, `OEM.LSTM_ONLY`, EXIF transpose/RGB input, model files and hashes. This is a metadata change, not an OCR/preprocessing change.

For a separately detected value, its word confidence determines student-code confidence. Inline codes use only the value word(s), taking the minimum if multiple words contribute; a mixed single label/value token retains that token's confidence. Older observations without word data use the value line's confidence. Required-field confidence remains **0.90**, and a low-confidence extracted value is preserved for display while confirmation stays blocked.

### Spatial matching rule

Inline values have priority. If label geometry exists, raw line order cannot establish proximity: all candidate lines are checked against the box, including values emitted before the label.

For `h = max(label height, candidate height)`:

- Right: vertical center difference ≤ 0.6h; horizontal gap from label right to value left is 0–8h. Score is `(horizontal gap + vertical center difference) / h`.
- Below: vertical gap from label bottom to value top is 0–2.5h; the label center falls within the value's horizontal extent plus a 0.5h margin. Score is `(vertical gap + horizontal center difference) / h`.
- Choose the nearest eligible spatial candidate. This allows an immediate value below MS to beat a farther unrelated number on the right. Distinct candidates whose scores differ by ≤ 0.5 are ambiguous and yield null, irrespective of OCR order or relative OCR confidence.
- Recognized non-student labels can claim their nearby number; a candidate belonging at least as strongly to DOB, course years, validity, barcode, card number or another field is rejected.
- With no label geometry, only the immediately following line is considered. Two consecutive plausible numeric/alphanumeric values are ambiguous. A label with boxes cannot fall back to an unlocated candidate.

### Major parser fix

All field aliases are sorted by normalized length, globally, before matching. `Ngành học` precedes `Ngành`, and `Họ và tên` precedes `Tên`. NFC/whitespace normalization preserves Vietnamese value text. Regression input `Ngành học: Kế toán doanh nghiệp` now produces exactly `Kế toán doanh nghiệp`.

### False-positive protection

No unlabelled document-wide numeric fallback exists. Reject short years, separated dates/year ranges, valid compact DDMMYYYY/YYYYMMDD dates in 1900–2099, compact pairs of years, unrelated labelled numbers, remote/misaligned boxes, and conflicting labelled codes. A lone unrelated barcode with no distinguishing label inside the same tight region cannot be semantically distinguished from an ID by text/geometry alone; the parser makes no universal barcode-detection claim.

Profile comparison remains exactly `normalize_code(profile.student_code) == normalize_code(ocr.student_code)`, where normalization only trims and uppercases. A parsed differing code remains in `extracted.student_code` and emits `STUDENT_CODE_MISMATCH`; a missing code emits `OCR_FAILED` without adding a mismatch for that missing field.

UI regression checks that a mismatched read shows `06031034` and `✕ Mã sinh viên trên thẻ không khớp với hồ sơ.` A failed parse instead shows `Chưa đọc được` and `⚠ Chưa đọc rõ mã sinh viên.` Both keep confirmation disabled.

### Before

From the existing preview JPEG's actual OCR:

```text
student_code: null
major: học: Kế toán doanh nghiệp
```

### After

From that same preview JPEG's actual OCR:

```text
student_code: "06031034"
major: Kế toán doanh nghiệp
```

The production upload path processes the original bytes, which this local Tesseract run reads as `Nganh hoc: Ké toan doanh nghiép`. For the original, before/after major is `hoc: Ké toan doanh nghiép` → `Ké toan doanh nghiép`; student code changes from null to `"06031034"`. The parser fixes label removal but does not invent the missing/corrected Vietnamese accents. No preprocessing/ROI changes were needed to recover the digits.

### Tests added

- All six requested layouts A–F and all supported aliases, including bilingual labels.
- Longest-label matching and Vietnamese NFC/NFD major values.
- Exact MS boundaries; no OCR-character substitution or fuzzy code comparison.
- DOB, year, validity, barcode/card-number, unlabelled/random-number rejection.
- Actual observed MS/digit boxes; reordered OCR lines; nearby right/below values; distance/alignment bounds; other-label ownership; ambiguous candidates and conflicting labels.
- Weak label/strong value confidence and the unchanged 0.90 boundary; low values stay visible but block confirmation.
- Adapter word/line metadata propagation and malformed metadata rejection.
- Production-worker synthetic MS layout and an opt-in real-card smoke test.
- API persistence/confirmation distinguishing a read mismatch from a missing code.
- Browser assertions for visible mismatched code, clean major and the missing-code warning.

Validation completed: **72 backend tests passed**, including the original real-card OCR smoke; **7 browser tests passed** against the production build in Chrome; `tsc --noEmit` and `next build` passed. The 21 parser tests were rerun after adding confidence rejection details to diagnostics and passed. An initial browser run against the development server had 5 failures at page loading/navigation; the production run exercised all 7 tests successfully with no application or test-timeout changes to mask those failures. The application `backend/.venv` is required for API tests; the separate root `.venv` lacks the HTTP test-client dependency expected by its Starlette version.

Run the backend checks from `backend/` with its application environment:

```powershell
$env:RUN_LOCAL_OCR_SMOKE = '1'
$env:STUDENT_CARD_OCR_FIXTURE = 'private/identity/previews/b1fff0d10aa04250aeaef9b1f404aaff/original.bin'
.\.venv\Scripts\python.exe -m unittest tests.test_student_card_matching tests.test_student_card_ocr tests.test_student_card_api tests.test_student_card_previews
```

The local real image is optional and subject to existing preview retention. Without `STUDENT_CARD_OCR_FIXTURE`, only that opt-in real-image test is skipped. For a new image, run the diagnostic command:

```powershell
.\.venv\Scripts\python.exe scripts/debug_student_card_ocr.py path/to/card.jpg --output private/ocr-parser-debug/new-report.json
```

Frontend validation from the workspace root:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 -p 3100
# In another terminal:
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3100'
node node_modules/@playwright/test/cli.js test tests/e2e/student-card.spec.ts
```

Parser version is now `student-card-spatial-v2`; matching/error-semantics version is `student-card-match-v2`. Existing previews with old versions must be uploaded again before confirmation. Restart a running backend so its cached OCR worker exposes the new metadata.

### OCR model changed?

NO. Model ID remains `tesseract-5.5.2-vie-eng-e12c65a`. No training, engine replacement or threshold reduction.

### Face Verification changed?

NO. FaceEngine, YuNet, SFace, threshold 0.363, reference storage and the Face Verification protocol are unchanged. The FaceEngine implementation and identity API were also compared byte-for-byte with their pre-edit local snapshots.
