# Vietnamese name OCR on Student Cards

Implemented 2026-10-10. Parser version: `student-card-roi-v5`.

The global `vie+eng` pass still locates the name label and value. The name ROI
has additional space above and below the value box, because global OCR may omit
detached Vietnamese tone marks from its bounding box. The supplied Transport
College card reproduces this: the old crop clipped the grave accent in `THÙY`.

Names now use only the existing `vie` engine with an empty character whitelist.
Single-line values use PSM 7; multiline values use PSM 6. At both 2x and 3x scale,
the worker tries the original crop, grayscale, mild contrast/sharpening, CLAHE
and a mild threshold variant. Thresholding blends grayscale with Otsu instead
of forcing a binary image. The whole reading with the highest minimum word
confidence wins; characters from different passes are never combined. A failed
variant does not discard other readings or usable global OCR.

CLAHE uses OpenCV's existing installation in the isolated OCR environment;
the OCR requirements now pin those existing NumPy/OpenCV versions. Nothing was
installed or changed in the face recognition environment. See the official
[OpenCV CLAHE explanation](https://docs.opencv.org/4.13.0/d5/daf/tutorial_py_histogram_equalization.html).
Tesseract, traineddata, YuNet, SFace and the face similarity threshold are unchanged.

## Display and matching

`extracted.ocr_display_name` contains the selected OCR text in Unicode NFC.
The compatible `extracted.full_name` contains the same text. The UI displays
this OCR value, even when accent-insensitive matching succeeds against a
differently accented profile name. The profile never supplies replacement text.

`normalize_name` separately produces a lowercase, accent-insensitive value and
maps `đ` to `d` for matching. That value is neither displayed nor returned in the
HTTP preview. The private debug report labels it `normalized_name` so recognition
and comparison can be inspected separately. Required-field confidence stays 0.90.

## Real image result

On the exact supplied `751fc747-92df-4e9b-8d08-af2e7837d071.jpg` bytes:

| Field | Before | After | Value confidence after |
| --- | --- | --- | --- |
| Name | ĐÔNG THỊ THUY LINH | ĐÔNG THỊ THÙY LINH | 0.930715 |
| Student code | 06031034 | 06031034 | 0.967444 |
| Major | Kế toán doanh nghiệp | Kế toán doanh nghiệp | 0.963554 |

The selected name reading uses `vie`, PSM 7, `name-contrast-sharpen-2x`.
The source image appears to print `ĐÔNG`, without a grave accent on the surname.
The implementation does not invent that accent to produce `ĐỒNG`. Adapter and
Unicode tests separately verify that a recognized `ĐỒNG THỊ THÙY LINH` passes
through unchanged, including decomposed Unicode input.

Recognition confidence is not a guarantee of correct accents on every font.
Additional synthetic Arial/Times images spelling `ĐỒNG` were still read as
`ĐÔNG` or `ĐÒNG` by the unchanged model. This remains a recognition limitation;
no replacement rule or profile hint was added to hide it. The exact supplied
real card's `THÙY` regression is covered by a production-worker test.

Private before/after reports and a source close-up are under
`backend/private/ocr-parser-debug/`. They are not included in public assets or
application logs.

## Verification and operation

Tests cover preserving marks outside the original value box, the ten variants,
vie-only configuration without an ASCII whitelist, complete-pass selection,
variant failures, Unicode NFC preservation, profile/display separation and
the real source image. The existing student-code/major and Bach Khoa production
fixtures are also exercised. A browser test checks that a matching name with
missing accents displays the OCR spelling and can still pass comparison.

Validation: 111 backend tests passed, including the real name/card and Bach Khoa
production fixtures. The browser test passed in Edge, and TypeScript `--noEmit`
passed. Run the backend suite from `backend/` with `RUN_LOCAL_OCR_SMOKE=1`,
`STUDENT_CARD_OCR_FIXTURE` pointing to the supplied Transport College card, and
`BACH_KHOA_CARD_FIXTURE` pointing to the supplied Bach Khoa card:

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_student_card_matching tests.test_student_card_field_ocr tests.test_student_card_ocr tests.test_student_card_api tests.test_student_card_previews
```

Restart the backend to load the updated worker and upload the card again;
previews created with previous parser versions need a fresh upload.
