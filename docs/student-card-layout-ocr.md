# Student Card OCR — hai layout bổ sung

Parser `student-card-layout-roi-v7`; model Tesseract và matching threshold giữ nguyên.

## Failure và correction

| Ảnh | Nguyên nhân trước sửa | Kết quả OCR sau sửa trên ảnh gốc |
| --- | --- | --- |
| `34ed94b2-965b-4ae7-89c6-ac85ad9057aa.jpg` — 767 × 492 | OCR đã có giá trị nhưng đọc nhãn thành `Họ vờ tên` / `Mõ SV`; dấu `:` nằm trong dòng giá trị riêng nên parser không nhận MSSV | Cả họ tên và MSSV đều có; confidence tên 0,9249, MSSV 0,9149 |
| `e40ccf2a-2d12-4f16-9c18-5eab8a5860f0.jpg` — 966 × 626 | Tên không kèm nhãn; global OCR bỏ tiêu đề đỏ và dòng MSSV ở mép dưới | Gray/autocontrast 2x khôi phục tiêu đề/nhãn ID; name layout + ROI cho cả hai trường, confidence tên 0,9142, MSSV 0,9857 |

Ảnh thứ hai có lượt đọc tên đủ dấu nhưng confidence thấp hơn đáng kể; giữ lượt
global usable, không thêm dấu từ hồ sơ. Khi đối chiếu tên có dấu tương ứng, trạng
thái là `NORMALIZED`, với cảnh báo hiện có. Không đổi ngưỡng confidence 0,90,
không sửa `O/0`, leading zeros hoặc chữ/số trong MSSV. Số ngân hàng phía cuối
ảnh thứ nhất không được chọn làm MSSV.

Name/MSSV bbox dùng tọa độ gốc:

- Ảnh 1: name `[378,205,621,227]`, ID `[381,306,548,323]`.
- Ảnh 2: name `[402,256,858,298]`, ID `[143,571,282,595]`; detect trên ảnh 2x nhưng ROI crop trên ảnh gốc.

Ảnh `0fbcdae6-fdaa-45f9-8a2f-c2ff49f65a9f.jpg` vẫn đọc được họ tên và MSSV.
Chạy riêng qua `FaceEngine.prepare_card` → OCR cũng giữ cả hai trường trên cả
ba ảnh; flow preview thực tế hiện OCR `content` gốc, không lấy text từ ảnh face.
Không thay đổi FaceEngine, YuNet, SFace, cosine 0,363, avatar, quyền hay confirm.

## Kiểm tra local

- Regression parser/field OCR/adapter/API/preview/admin: 151 test, 145 passed và 6 optional environment tests skipped; local Tesseract smoke và ba ảnh thật được bật rõ ràng.
- `test_student_card_layout.py`: fuzzy label chỉ tác động nhãn, colon/token geometry, bounded unlabelled layout, reject organisation/missing anchor/ambiguous names, original-equivalent bbox và fallback giữ lượt OCR gốc khi retry lỗi.
- Real-card opt-in qua `STUDENT_CARD_NEW_FIXTURE_DIR`; expected names/IDs chỉ là assertions sau OCR, không truyền vào extraction. Kiểm tra exact ID, normalized name, confidence và reject khi profile ID sai.
- Browser `student-card.spec.ts`: 29 passed; preview giữ text OCR, normalized/exact/mismatch, low confidence và unreadable tách riêng, protected images, confirm/expiry và trạng thái verified/revoked.

Reports chứa OCR tokens/text/confidence/bbox/reject reasons chỉ lưu trong
`backend/private/ocr-parser-debug/new-card-*.json` (gitignored, không public).
Production không log identity text. Các ảnh private không được thêm vào tests/repo.
