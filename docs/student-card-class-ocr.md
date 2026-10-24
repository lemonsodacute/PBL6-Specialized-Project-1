# Student Card class extraction

The real local card traces showed three separate causes: a `Lép` misread of the
label, one OCR line combining the class code with `Khoa: ...`, and faint or
truncated labels omitted by sparse global OCR. A separate colon token could also
leak into the final class value. The raw lines, word/symbol boxes, confidence and
ROI reads were inspected before changing extraction.

Class extraction lives in `backend/app/services/student_card_class.py`. It uses
the class label and its geometry, prefers inline/right-hand values to values
below, and ranks candidates by position, distance, confidence and code shape.
Word/symbol boxes stop a class crop before another field on the same OCR line.
Name, major and student-ID values are excluded. Near-equal candidates at different
locations remain unreadable.
Named-class crops include a small trailing margin, clipped before other labels.
If a similarly confident ROI pass suggests that the global text lost a final
word, extraction remains unreadable rather than accepting a truncated value.

Missing class labels receive a bounded search immediately left of short code
rows, or around a truncated label. This requires an actual OCR class label before
accepting a value. Value crops use the existing cached Tesseract engines, 2x/3x
grayscale, mild contrast/sharpening and PSM 7. Class crops use no binary threshold.
Code whitelists include letters, digits, `-./_` and Vietnamese `Đ/đ`; named classes
use no whitelist and retain accents. No class value is repaired from profile data.

The preview's `extracted` object includes `class_name`, `class_confidence` and
`class_status`. Below 0.90 confidence, or without an unambiguous value, the display
value is null and status is `CLASS_UNREADABLE`. The UI displays `Không đọc được`.
This is metadata confidence only: confirmation still requires the existing name
checks and a readable student ID. An administrator-approved profile without an ID
can receive that ID only after successful card confirmation; an existing ID must
match. See [student-card-profile-flow.md](student-card-profile-flow.md).
YuNet, SFace, the face threshold 0.363, reference storage
and the webcam verification flow are unchanged.

From `backend`, inspect a local card with:

```powershell
.venv/Scripts/python.exe scripts/debug_student_card_ocr.py <card.jpg> --output <private-report.json>
```

The report includes original global observations, recovered labels, field ROIs,
`CLASS_LABEL`, `CLASS_CANDIDATE` and `CLASS_RESULT` events and display metadata.
It contains personal card data and should stay in local private storage.
Automatic text diagnostics run only when `ENVIRONMENT=development`; production
does not log class candidates, identity text or images.
