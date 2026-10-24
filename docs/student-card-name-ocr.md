# Student Card: trích xuất họ tên

Parser hỗ trợ nhãn Việt/Anh, nhãn không dấu, khoảng trắng quanh dấu `/`, thiếu dấu `:` và biến thể OCR nhãn `Ho tên, Full nome:`, `Họ vờ tên`, `Mõ SV`. Không sửa hay suy đoán ký tự trong giá trị họ tên/MSSV. Dấu `:` ở đầu một dòng giá trị tách riêng được bỏ như dấu phân cách; bbox/confidence chỉ lấy từ token giá trị.

OCR toàn ảnh vẫn dùng `vie+eng`. Nếu mất trường bắt buộc, worker thử grayscale/autocontrast nhẹ và upscale 2x (giới hạn 4 triệu pixel). Chọn một lượt đọc đầy đủ theo dữ liệu ảnh; không nối các lượt khác nhau. Mọi bbox line/word/symbol được quy đổi về ảnh gốc trước spatial parsing và ROI.

Khi nhãn tên bị bỏ sót, worker vẫn tìm vùng nhãn bên trái và đọc PSM 7 ở 2x/3x. Với thẻ in tên riêng không có nhãn, parser v7 cho phép ROI theo bố cục: phải có tiêu đề thẻ sinh viên, nhãn MSSV thật, tên nổi bật bên dưới tiêu đề và một trường thông tin gần bên dưới. Không có đủ anchor/bbox thì không suy ra tên; hai candidate khác nhau vẫn bị coi là mơ hồ. Tên trường/cơ quan bị loại. Log phân biệt `detected_label` và `layout_anchor`, không tạo nhãn tên giả.

Parser ưu tiên giá trị bên phải nhãn cùng dòng, sau đó dòng ngay dưới. Loại ngày sinh, lớp, số thẻ và nhãn trường khác. Khi global OCR không có giá trị usable, worker thử ROI bên phải và ngay dưới nhãn. ROI tên dùng `vie`, không whitelist ASCII, upscale 2x/3x, grayscale, contrast/sharpen nhẹ, CLAHE tùy chọn và threshold pha nhẹ. Giữ khoảng đệm phía trên để bảo toàn dấu rời.

Chọn một lượt OCR hoàn chỉnh theo completeness/confidence/dấu tiếng Việt; không ghép các chữ từ nhiều lượt. Khi các lượt có cùng dạng chuẩn hóa và confidence chênh tối đa 0,05, ưu tiên lượt đủ tên và giữ được dấu. Confidence tên là trung bình word confidence của lượt đọc; ngưỡng xác nhận vẫn 0,90. MSSV giữ nguyên cách đánh giá confidence, định dạng và đối chiếu chính xác.

`full_name` và `ocr_display_name` luôn từ OCR, không lấy tên hồ sơ làm fallback. Đối chiếu sau extraction trả `EXACT`, `NORMALIZED`, `MISMATCH` hoặc `UNREADABLE`. Tên đã đọc nhưng confidence thấp vẫn có preview, với `NAME_LOW_CONFIDENCE`; chỉ thiếu candidate usable mới trả `NAME_UNREADABLE`. Tên lỗi không xóa kết quả MSSV và không biến thành `OCR_FAILED` toàn thẻ.

Trong `ENVIRONMENT=development`, log `NAME_LABEL`, `NAME_CANDIDATE`, `NAME_RESULT` chứa text, confidence, bbox, tokens và lý do chọn/loại. Bbox trường ở tọa độ ảnh gốc; token của lượt ROI có `token_coordinate_system=upscaled_roi`. Các môi trường khác không gửi name-debug cho worker và không log identity text, kể cả khi bật mức DEBUG.

Chạy chẩn đoán cục bộ từ `backend`:

```powershell
.venv/Scripts/python.exe scripts/debug_student_card_ocr.py 'path/to/card.jpg' --output private/ocr-parser-debug/name.json
```

Report chứa dữ liệu thẻ, chỉ lưu ở private storage. Có thể truyền `--full-name` và `--student-code` để kiểm tra kết quả đối chiếu cuối; các tham số này không được truyền vào extraction hoặc dùng để chọn OCR candidate.

Không thay đổi FaceEngine, YuNet, SFace, cosine 0,363 hoặc kiến trúc identity.
