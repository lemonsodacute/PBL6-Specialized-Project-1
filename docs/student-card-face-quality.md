# Student Card face quality regression

The supplied card is 720 × 454 pixels after EXIF orientation. The decoder does
not resize this image. YuNet returns exactly one face with these measurements:

| Measurement | Native detection | CARD detection at 2× |
| --- | --- | --- |
| Detector image size | 720 × 454 | 1440 × 908 |
| Bbox `[x, y, width, height]` | `[583.3821, 207.9935, 69.2169, 90.2781]` | `[1170.1437, 417.4962, 139.9240, 177.5538]` |
| Original-equivalent bbox | `[583.3821, 207.9935, 69.2169, 90.2781]` | `[585.0718, 208.7481, 69.9620, 88.7769]` |
| Face width / image width | 9.6135% | 9.7169% |
| Face height / image height | 19.8850% | 19.5544% |
| Detection score | 0.929911 | 0.934837 |
| Aligned grayscale mean | 127.6260 | 127.1865 |
| Aligned Laplacian variance | 10.9233 | 13.4214 |

Before this fix, preview used `prepare_card(..., mode='card')` internally, and
confirmation used `extract_embedding(content, mode='card')`. Both already used
CARD's 45px gate; there was no LIVE/legacy 80px gate in these operations. The
actual rejection was `FACE_TOO_BLURRY`, because the shared blur threshold was
15. Its CARD message incorrectly reused the text about a face being too small.
Upscaling alone would still fail that shared threshold (13.4214 < 15).

Quality policies now live in `backend/app/core/face_config.py`:

| Policy | LIVE | CARD |
| --- | --- | --- |
| Minimum face dimension | 80px in decoded frame | 36px in original image |
| Ratio fallback | None | 32px when width ratio ≥ 4% and height ratio ≥ 6% |
| Minimum retained data | Existing LIVE rule | 32px in decoded frame before upscaling |
| Minimum grayscale mean | 35 | 30 |
| Minimum Laplacian variance | 15 | 8 |
| Detection scale | 1× | 2×, cubic interpolation |
| Face count | Exactly one | Exactly one |

CARD's ratios relax only the 32–36px interval. They never reject an otherwise
usable face of at least 36px just because a card has large margins. The 32px
floor prevents accepting tiny portraits solely because an image was enlarged.
Blur/brightness values are separate initial CARD settings based on this
regression; this single image is not an accuracy calibration dataset.

The decoder records the original EXIF-oriented dimensions before its existing
1280px thumbnail. For CARD, `scale_x = detection_width / original_width` and
`scale_y = detection_height / original_height`. Divide bbox x/width by scale_x
and y/height by scale_y before comparing against original-image thresholds.
This includes both thumbnailing and upscaling; anisotropic rounding is handled.
The separate decoded-data floor prevents thumbnailing followed by upscaling
from inventing missing source data. Alignment uses the detected pixels and all
YuNet landmarks in their detector coordinates.

This card passes preview and confirmation with a finite, normalized float32
SFace embedding of 128 dimensions. No later 80px gate is applied to the aligned
CARD crop or the reference embedding. Webcam extraction continues to use LIVE;
the supplied card itself still fails that LIVE size gate. YuNet, SFace, landmark
order and cosine threshold 0.363 are unchanged. Face-size, blur, brightness,
missing-face and model failures retain separate error codes and messages.

## Local diagnostics

From `backend` in PowerShell:

```powershell
.\.venv\Scripts\python.exe scripts/debug_student_card_face.py '..\ảnh thẻ\0fbcdae6-fdaa-45f9-8a2f-c2ff49f65a9f.jpg'
```

The command prints native measurements followed by actual CARD preview and
embedding extraction diagnostics. `CARD_FACE_DEBUG` includes `image_size`,
`scale`, `bbox`, `original_equivalent_bbox`, `min_required`, `reject_reason`,
ratios and scalar brightness/blur. It prints embedding validity/dimension/norm,
never embedding values, images or OCR fields. It writes no card files.

For local server logs, set `CARD_FACE_DEBUG=true` and enable INFO logging.
The flag defaults to false. Diagnostic logging additionally requires
`ENVIRONMENT` to be `development`, `local` or `test`; production/staging do not
emit these logs even if the flag is true.

Tests use synthetic pixels unless this private image is explicitly supplied:

```powershell
$env:STUDENT_CARD_TEST_IMAGE = 'D:\ChauAnh\PBL6 new\ảnh thẻ\0fbcdae6-fdaa-45f9-8a2f-c2ff49f65a9f.jpg'
.\.venv\Scripts\python.exe -m unittest tests.test_face_recognition tests.test_student_card_api tests.test_identity tests.test_identity_migrations tests.test_face_dataset_collection -q
```

The optional API regression exercises real YuNet/SFace through preview,
confirmation and embedding persistence in a temporary test database. OCR and
profile fields are synthetic, so this check establishes the face-flow fix,
not OCR/name matching for the private card. No private image is committed as
a fixture.

Validation: the command above ran 119 tests: 116 passed, 3 skipped (two
optional OCR smoke tests and the opt-in PostgreSQL test). Both private-image
regressions ran successfully, including the preview/confirm HTTP flow with
real face models and the unchanged LIVE size rejection.
