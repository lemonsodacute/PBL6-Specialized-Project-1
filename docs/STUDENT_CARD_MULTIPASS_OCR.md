# Student Card: multi-pass OCR

Implemented 2026-10-10 (Asia/Saigon). Tesseract/model hashes remain unchanged.

The persistent offline worker first reads the oriented full card using `vie+eng`,
PSM 11. It retains raw line, word and symbol boxes/confidence. Value boxes are
located using the existing longest-label parser and bounded spatial matching;
there is no document-wide search for arbitrary numbers and no profile hint.

Student-code ROIs run first, using `eng`, PSM 7 and a separate engine with code
dictionaries disabled. `STUDENT_CARD_CODE_CHARSET=alphanumeric` is the default
because this project supports codes such as `001IT123`. Its whitelist is
`ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`. Deployments accepting only numeric IDs
can set `STUDENT_CARD_CODE_CHARSET=numeric`, whose whitelist is `0123456789`.
Neither mode converts IDs to integers or replaces O/I characters in OCR text.

Supported labels include MSSV, Mã sinh viên, Mã SV, Số thẻ SV, Số thẻ sinh viên,
Student ID, Student No, Student Number and MS. Compound bilingual labels are
consumed completely. A mixed token such as `SV:11247707` is cropped using the
actual symbol boxes after the colon. Label confidence cannot dilute the value's
confidence. Inline values take priority; other values are ranked within tight
right/below regions, with below-right as a bounded fallback. Existing protections
for ambiguity, dates, other labels and conflicting IDs remain in place.

For major and class_name, the worker compares `vie` and `vie+eng` ROI
readings. Single lines use PSM 7, tight multiline blocks use PSM 6; a low-quality
single-line text ROI also tries PSM 6. Each crop is enlarged 2x and 3x, converted
to grayscale, mildly contrast enhanced and sharpened. An Otsu variant is tried
only if ordinary crops remain below 0.90, and retained only when its value
confidence improves. There is no morphological erosion or accent replacement.
These segmentation and crop choices follow the
[Tesseract image-quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html).

`LocalOCR.recognize` returns a list-compatible `OCRResult` with separate
`raw_global_ocr` and `field_ocr` observations. Final parsing selects the higher
value confidence for the same labelled candidate. A higher-confidence ROI cannot
resolve ambiguous geometry or contradict another student-code label silently.
Required identity fields still need 0.90 confidence; codes still compare exactly
after trim/uppercase. Major/class never influence confirmation or update the
authoritative profile. No major canonical dictionary exists in the current
backend, so no optional fuzzy post-correction was introduced.

Full names now use dedicated `vie` ROI recognition with extra accent padding
and ten preprocessing variants. See the [Vietnamese name fix](STUDENT_CARD_NAME_OCR.md)
for display/matching separation and actual source-image results.

The UI already distinguishes a missing value (`Chưa đọc được`) from a read code
that differs from the profile (visible code plus `STUDENT_CODE_MISMATCH`). Its
existing semantics remain in effect. Face Verification, YuNet and SFace are
untouched.

## Observed result on the existing real card

On the original upload bytes, global OCR reads `Ké toan doanh nghiép`. The `vie`
ROI, PSM 7 and 2x preprocessing read `Kế toán doanh nghiệp`, with value confidence
0.963554. Final student_code remains the string `06031034`, confidence 0.967444
from the stronger global value reading. On the preview JPEG, the correct global
major reading already has higher value confidence, so the parser retains it.
Private reports stay under `backend/private/ocr-parser-debug/`; they are not
returned by HTTP or recorded in application logs.

## Verification and operation

From `backend/`:

```powershell
$env:RUN_LOCAL_OCR_SMOKE = '1'
# Optional, when a real-card fixture remains available in private storage:
$env:STUDENT_CARD_OCR_FIXTURE = 'private/identity/previews/<id>/original.bin'
.\.venv\Scripts\python.exe -m unittest tests.test_student_card_matching tests.test_student_card_field_ocr tests.test_student_card_ocr tests.test_student_card_api tests.test_student_card_previews
```

Synthetic production-worker tests exercise all three requested numeric layouts,
leading zeros, alphanumeric codes and Vietnamese major/class values. Additional
tests cover mixed-token symbol cropping, blocks/PSM, competing ROI/global reads,
weak labels, threshold selection, failed field passes and unchanged identity
gates. Adapter tests validate field/word/symbol metadata. Existing API/browser
tests distinguish mismatched and unreadable codes.

Validation: 93 backend tests passed, including the opt-in original-card smoke;
2 browser tests passed for mismatch and unreadable-code semantics.

The subsequent [Bach Khoa regression fix](STUDENT_CARD_BACH_KHOA_REGRESSION.md)
updated the parser to `student-card-roi-v4` and error semantics to
`student-card-match-v3`. Restart the backend to load the updated cached worker;
pending previews from previous versions require a fresh upload. OCR model
version remains unchanged.

The subsequent name fix advances the parser to `student-card-roi-v5`.
