# Bỏ chức năng vấn đáp

Cập nhật ngày 2026-10-12 theo yêu cầu bỏ vấn đáp trong khu vực giảng dạy và
không dùng thi vấn đáp nữa.

## Chức năng hiện hành

- Teacher navigation dùng chung không còn mục Vấn đáp, kể cả profile/settings.
- Chỉ tạo/chọn/lọc câu hỏi trắc nghiệm một đáp án, nhiều đáp án và tự luận.
  Áp dụng cả sửa câu, chọn thủ công/ngẫu nhiên và tạo/import từ tài liệu.
- Bỏ form thời gian chuẩn bị/trả lời, trang ghi hình vấn đáp và các form chấm
  vấn đáp. Link grading cũ chuyển về `/dashboard/exams`; link ghi hình cũ về
  bài làm tương ứng. Không mở camera hoặc tạo transcript/mock answer ở link cũ.
- Gỡ client `oralGrading`, backend router và module/schema chấm vấn đáp;
  GET/PATCH `/oral-grading` không còn được phục vụ (404).
- Schema ghi QuestionCreate/Update, RandomSelectionRequest/RandomQuestionRequest,
  DraftConfiguration/DraftQuestion không nhận `oral`. Schema ghi không có timer
  vấn đáp. Prompt AI chỉ mô tả các hình thức đang hỗ trợ.
- Ngân hàng câu hỏi, metadata/count/topic và pool random loại câu cũ thuộc
  hình thức ngừng hỗ trợ trước khi phân trang/chọn ngẫu nhiên.
- Backend chặn gắn câu vấn đáp vào đề qua cả POST một câu và PUT nhiều câu;
  chặn publish/start/resume bài còn câu vấn đáp, với `ORAL_EXAMS_DISABLED`.
  Frontend cũng chặn mở bài đang làm chứa loại không hỗ trợ.
- Student list không giới thiệu đề chứa câu vấn đáp như đề có thể làm.
  API lưu đáp án và chấm thủ công không nhận câu vấn đáp. Tự luận vẫn có form
  và API chấm điểm hiện có.
- Help không còn hướng dẫn vấn đáp. Sửa nhỏ trong picker: nút xuống hàng đúng
  ở không gian hẹp, row chọn câu giữ label/checkbox/actions trong viewport.

## Dữ liệu cũ

Không xóa bảng, enum, câu hỏi, liên kết đề hoặc điểm đã lưu. Database local
còn 2 câu vấn đáp, 3 liên kết đề, không có oral answer/grading tại thời điểm
audit. Đây là snapshot kiểm tra, không phải dữ liệu hard-code.

Enum/model và kiểu đọc legacy còn để giải mã lịch sử; không còn là lựa chọn
tạo câu/thi/chấm. Đề nháp cũ có thể bỏ câu ngừng hỗ trợ trước khi xuất bản.
Chi tiết kết quả cũ chỉ hiển thị dữ liệu/điểm đã lưu và badge “Hình thức đã
ngừng hỗ trợ”; không có action chấm vấn đáp. Không tự đổi câu cũ thành tự luận,
không thay điểm hoặc tổng điểm lịch sử.

Giữ nguyên trắc nghiệm/tự luận, scoring hiện có, quyền, xác minh danh tính,
Student Card/YuNet/SFace và camera/microphone phục vụ giám sát thông thường.
Không tạo migration hoặc thay đổi dữ liệu production/local trong kiểm chứng.

## Kiểm chứng

- 54 backend unittest đạt: 8 mới cho bỏ vấn đáp cùng các nhóm selection,
  documents, Teacher Results và collections. Sau khi bỏ timer khỏi write schema,
  8 test mới được chạy lại và đều đạt.
- Full TypeScript đạt.
- API thật: OpenAPI không có oral-grading; schema ghi chỉ có 3 loại đang hỗ
  trợ; endpoint cũ trả 404; ngân hàng không trả câu vấn đáp. DB giữ nguyên 2 câu
  và 3 liên kết legacy. Các kiểm tra này chỉ đọc, không sửa dữ liệu.
- Playwright xác nhận sidebar mobile/desktop, redirect link cũ, editor và
  random picker của Teacher/Admin, không mở media tại link ghi hình cũ, document
  review/import/generation, bài thi và chấm tự luận. Log/trace đặt trong TEMP.
  16 case được kiểm chứng đạt: 13 tại lượt chính, case media readiness đạt khi
  chạy lại riêng, 2 case 320px đạt sau sửa toolbar/row picker và cập nhật assertion
  modal theo giới hạn viewport. Test editor dùng route bank detail hiện có.

Các fixture trong test không được dùng làm fallback trong sản phẩm.
