# Thao tác trong danh sách đề thi

Trang `/dashboard/exams` dùng `components/teacher/ExamActions.tsx` cho từng
row. Desktop có một action chính và menu ⋯; mobile dưới 768px chỉ giữ menu.
Cột rộng 180px trên desktop, 64px trên mobile; button cao 38px, không wrap.

Action chính dùng dữ liệu thực tế:

- Có attempt hoàn tất → **Xem kết quả**.
- Đề published/ongoing, trong khoảng thời gian làm bài, yêu cầu camera và chưa
  có bài hoàn tất → **Giám sát**.
- Còn lại → **Xem / Sửa** hoặc **Xem chi tiết** theo trạng thái/attempt.

Tình trạng bài làm lấy từ attempt_count/completed_attempt_count trong
API danh sách đề thi hiện có. Count được query từ attempt thực tế,
không tải toàn bộ Reports để quyết định action. Không hard-code theo title.
Menu chỉ có các action phù hợp: draft có Xuất bản; published/ongoing có
Kết quả, Giám sát, Đóng đề; closed có Chi tiết, Kết quả, Giám sát.
Xóa đặt cuối, màu đỏ, có separator.

Backend hiện chặn PATCH và DELETE khi đề có bất kỳ attempt nào, kể cả đang
làm hoặc chưa có điểm. UI vô hiệu hóa các action đổi trạng thái/xóa và hiển
thị lý do tương ứng. Nếu không đọc được tình trạng bài làm, các action này
cũng chưa khả dụng; Tải lại danh sách có thể thử lại. Quyền và rule phía server
vẫn quyết định cuối cùng, bao gồm race phát sinh attempt sau khi tải danh sách.

Đóng/Xóa mở modal xác nhận, có Hủy, trạng thái chờ API và lỗi an toàn. Khi
đang gửi request, modal không đóng bằng Escape và không gửi request lặp.
Xuất bản vẫn gọi PATCH hiện có, không thêm rule trạng thái mới. ExamEditor,
chấm điểm, Results và luồng giám sát được giữ nguyên.

Menu render bằng portal dưới `document.body`, dùng vị trí fixed căn phải
(mở sang trái từ nút), tự chọn phía trên/dưới và giới hạn trong viewport.
Menu ở trên chat floating nhưng dưới modal; không bị overflow của bảng cắt.
Có aria-haspopup/expanded/controls, focus menu khi mở, Arrow Up/Down,
Home/End, Tab, Escape và trả focus; click ngoài hoặc cuộn trang/bảng đóng menu.

`tests/e2e/exam-actions.spec.ts` kiểm tra action theo trạng thái, monitoring
theo thời gian thật, disabled theo attempt, confirm/PATCH/DELETE, backend 409,
loading, retry, keyboard và viewport 375/768/1440px. Kiểm tra hồi quy Settings
Teacher xác nhận form tạo đề mới vẫn đọc thời lượng mặc định đã lưu.

Kiểm chứng local trên đề thật `04a98dd6-17da-4e29-9d6c-f3e4a27f40e8`
(Kiểm tra giữa kì CNW): API không mock, primary Xem kết quả, đúng 2 control
trên row, cột rộng 180px, Xóa bị disable vì đã có attempt. Menu render ngoài
bảng, nằm trong viewport desktop/mobile và mobile ẩn primary. Không có lỗi
JavaScript hoặc request mutation đề trong kiểm tra chỉ đọc này.
9 test ExamActions và 1 test hồi quy tạo đề đạt. TypeScript frontend đạt với
config loại lỗi MediaStreamConstraints đã có sẵn trong test exam-experience.
