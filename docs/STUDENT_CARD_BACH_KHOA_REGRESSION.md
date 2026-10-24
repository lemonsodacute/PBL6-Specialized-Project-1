# Bach Khoa card OCR regression

Diagnosed 2026-10-10 on the exact user-supplied JPEG in `ảnh thẻ/`, using the
production `LocalOCR` adapter, persistent Tesseract worker and provisioned models.
Private raw reports are saved under `backend/private/ocr-parser-debug/`.

## Root cause and affected stages

The global `vie+eng`, PSM 11 pass succeeds and returns 31 lines, including
`LE NGUYEN CHAU ANH` and `23T_NHAT2`. Replaying the previous symbol extraction
and strict adapter validation produces `OCR_FAILED`: line 7, word 1 contains a
symbol whose text is one space, confidence 0.9900346, bbox `(336, 415, 341, 443)`.
The adapter treats its trimmed-empty text as an invalid observation and rejects
the whole card. This happens before field parsing/required-field validation;
it is not a global engine recognition failure or a confidence threshold failure.

`bach-khoa-before-symbols.json` captures that replay. The replay restores the
previous symbol-reading logic on the same production worker/model settings;
it does not claim to reproduce an archived production binary.

Once that failure is removed, two further layout problems are visible:

- The full-name block incorrectly absorbs the independently detected DOB/class
  value rows. ROI OCR therefore recognizes multiple fields together.
- The class label/value are separate lines, despite being on the same visual
  row. The nearby faculty label below was incorrectly preferred as the value.
- The MSSV label is fragmented into `Sm` and `dent ID`; the global pass does not
  produce a usable nine-digit value. Thus no ordinary numeric candidate box
  reaches student-code ROI OCR.

## Targeted fixes

Optional symbol metadata is filtered/validated separately; a blank or unusable
symbol cannot erase valid word/line OCR. Optional field recognition/metadata
failures retain usable global observations. Core observation validation remains
strict, and an empty engine result still fails as `OCR_FAILED`.

Text blocks stop when a continuation value has its own label on the same visual
row. Text fields prefer their same-row value before a value below. Long bilingual
student-code labels also accept left-aligned values below them.

Numeric candidates use digits-only whitelist, PSM 7, separate value crop,
2x–3x grayscale/contrast/sharpening. Alphanumeric candidates retain the existing
alphabet/digits whitelist. Values stay strings, with no O/I substitutions.

The damaged-label fallback requires a student-ID anchor such as `Student ID`,
`Student 1D` or the observed truncated `dent ID`. With a detected numeric box,
it accepts only an exact nine-digit reading within the bounded label region.
When the digits were lost in global OCR, a narrow crop below the label is retried
and accepted only if a fresh nine-digit reading is obtained. For `dent ID`, its
partial box is extended left by six text heights to include the missing prefix
and numeric column. It does not scan arbitrary numbers or use the card corner
alone. Other labels, dates, bank/barcode anchors, conflicting candidates and
ambiguous geometry remain excluded. An image-only retry cannot crop through a
known neighboring field label. No profile data guides candidate selection.

Missing name candidates produce `NAME_UNREADABLE`; a usable name with low
confidence produces `NAME_LOW_CONFIDENCE`. Student codes still produce
`STUDENT_CODE_UNREADABLE` when missing or below the existing confidence gate, while retaining other
extracted values and returning a preview with confirmation disabled. Readable
but differing fields use `NAME_MISMATCH`/`STUDENT_CODE_MISMATCH` (the
PROFILE_MISMATCH family). `OCR_FAILED` is reserved for engine/pipeline failures
with no usable output. UI warnings and confirm endpoint messages preserve these
distinctions.

## Result on the original JPEG

| Field | Selected value | Value confidence | Selected pass |
| --- | --- | --- | --- |
| full_name | LE NGUYEN CHAU ANH | 0.960522 | global value words |
| student_code | 102230057 | 0.959679 | ROI eng, digits whitelist, PSM 7, 3x |
| class_name | 23T_NHAT2 | 0.904331 | global value word |

The code ROI is `(1573, 1076, 1977, 1140)` in the EXIF-oriented original image.
The global name/class readings are retained because they have higher confidence
than the optional ROI readings. Comparison against the supplied expected name
and code yields `can_confirm=true`, with no blocking errors. No authoritative
profile was updated during diagnostics.

`bach-khoa-after.json` contains global observations, field regions, ROI reads,
spatial rejection reasons, stage statuses, field confidence and final required
validation. These diagnostics are opt-in/private and are not HTTP payloads or
application logs.

## Validation and restart

Backend regression checks cover the blank-symbol failure, the actual global
geometry, missing-code partial previews, label/value layouts, strict nine-digit
fallback bounds, alphanumeric IDs, weak-label confidence, unchanged 0.90 gates,
and mismatch semantics. Production-worker tests cover the exact original JPEG
and synthetic lower-right layout. The real-card API test runs both production
OCR and production YuNet/SFace to assert a successful HTTP preview.

Validation completed: the 156-case backend suite passed with one optional,
expired non-Bach-Khoa fixture skipped (155 passed). The additional real-card API
and partial-preview checks passed. TypeScript checking passed. Both browser
cases (mismatch and missing student code with retained name/class) passed. New
browser assertions were scoped to the card section to avoid duplicate profile
name elements; a separate development-server loading failure was retried with
the same application code and assertion timeouts.

Run from `backend/`:

```powershell
$env:RUN_LOCAL_OCR_SMOKE = '1'
$env:BACH_KHOA_CARD_FIXTURE = '../ảnh thẻ/b4bb6791-c7bd-40bb-9cfa-d1538dfafc94.jpg'
.\.venv\Scripts\python.exe -m unittest tests.test_student_card_matching tests.test_student_card_field_ocr tests.test_student_card_ocr tests.test_student_card_api tests.test_student_card_previews tests.test_face_recognition tests.test_identity
.\.venv\Scripts\python.exe scripts/debug_student_card_ocr.py $env:BACH_KHOA_CARD_FIXTURE --full-name 'LE NGUYEN CHAU ANH' --student-code '102230057' --output private/ocr-parser-debug/bach-khoa-after.json
```

Restart the backend to replace its cached worker, and upload the card again.
Parser/matching versions are `student-card-roi-v4`/`student-card-match-v3` so
previous pending previews cannot be confirmed under stale semantics. Tesseract
engine/model files, YuNet, SFace, Face Verification, and threshold 0.363 are
unchanged by this regression fix.
