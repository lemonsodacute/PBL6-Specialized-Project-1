# Kịch bản bảo vệ AI PROCTO — 10–15 phút

Kiểm tra [checklist](release-checklist.md) trước buổi demo; Question Generation và Support đã qua integration Gemini thật sau sửa timeout. Vẫn probe lại provider trước buổi bảo vệ và không trình bày draft mẫu như kết quả AI vừa tạo.

## Chuẩn bị

- Dùng database QA riêng qua `scripts/release_qa_runtime.py`, migration tới head và `scripts.seed_release_demo` theo README. Backend dùng cùng QA runtime khi demo; frontend trỏ tới API này.
- Mở ba browser profile/context riêng, đăng nhập các account DEMO Admin/Teacher/Student. Email và password sinh tự động nằm trong `backend/private/release-qa/demo-accounts.json`; không chiếu password/token lên màn hình.
- Mở SFU local và kiểm tra webhook/ports. Với demo thẻ thật, provision OCR rồi đặt `RELEASE_QA_OCR_AUTOSTART=true` trước khi chạy QA API. Chuẩn bị camera/mic thật nếu demo thiết bị; browser automation dùng thiết bị tổng hợp không thay thế kiểm tra phần cứng.
- Chuẩn bị DOCX/PDF có quyền sử dụng, khoảng một trang nội dung web + một sơ đồ; kiểm tra Gemini trước khi bắt đầu. Với identity, chỉ dùng thẻ và webcam của người đồng ý; không dùng ảnh test OpenCV làm thẻ sinh viên.
- Account DEMO chưa có thẻ/profile VERIFIED. Admin xác nhận thông tin thật theo policy, Student upload/confirm thật. Đề Practice now không yêu cầu camera để có thể trình bày luồng bài thi riêng. Nếu demo face gate, cấu hình một đề yêu cầu camera qua UI.

| Thời gian | Account / route | Thao tác | Kết quả cần thấy |
| --- | --- | --- | --- |
| 0:00–0:45 | Chưa đăng nhập, `/` | Giới thiệu public home, feature/role sections; mở đăng ký rồi quay lại login | Không có dữ liệu riêng; CTA đăng nhập/đăng ký hoạt động |
| 0:45–1:45 | Admin, `/dashboard/users`, `/admin/student-cards` | Tìm DEMO Student, xem trạng thái/profile và card management | Thông tin từ DB; Admin có action đúng trạng thái; Student không đọc API Admin |
| 1:45–3:30 | Teacher, `/dashboard/question-banks` | Mở DEMO HTTP and Web; xem/sửa câu hỏi; upload DOCX/PDF tại trang tài liệu | Extraction/source/ảnh đúng; gọi Gemini thật; draft chưa tự thêm vào bank |
| 3:30–4:15 | Teacher, trang document review | Sửa một draft, rating/review, regenerate một câu nếu provider đang đáp ứng; chọn import | Chỉ các câu đã chọn được lưu; số lượng bank cập nhật không F5. Nếu lỗi provider: thông báo và retry thật, không tuyên bố thành công |
| 4:15–5:15 | Teacher, `/dashboard/exams` | Xem/tạo đề, chọn câu hỏi, duration/start/end, gán lớp, camera/mic; publish | Preview selection trước save; đề published xuất hiện cho đúng Student |
| 5:15–6:30 | Student, `/student/profile` | Xem phone/profile; upload thẻ → OCR preview → confirm nếu dữ liệu hợp lệ | Preview chưa ghi profile; confirm lưu MSSV/class/avatar sanitize; refresh còn dữ liệu. Face chỉ dùng latest active reference |
| 6:30–8:30 | Student, `/student/exams` → DEMO Practice now | Setup thiết bị theo yêu cầu đề, bắt đầu, trả lời MCQ/essay, chờ autosave rồi refresh | Câu trả lời/timer lấy lại từ server; camera widget và chat không che submit/navigation |
| 7:00–8:30 song song | Teacher, `/dashboard/monitor` | Chọn đề Student đang làm | Trạng thái online/event từ phiên thật; không hiện camera/video giả |
| 8:30–9:15 | Student, trang attempt | Submit một lần, xác nhận; mở Result | Ngừng media/timer/autosave; đề đã nộp rời Làm kiểm tra và nằm ở Lịch sử/Kết quả |
| 9:15–10:30 | Teacher, `/dashboard/exams` → xem kết quả của đề; `/dashboard/reports` | Mở đề → attempt → chấm essay trong thang điểm; Student mở lại Result | Điểm tổng cùng một attempt khớp DB/Student/Teacher/Report. Bộ seed có Completed example 3.5/4 để đối chiếu |
| 10:30–12:00 | Teacher hoặc Student, AI Support; Admin `/admin/messages` | Hỏi một nội dung hướng dẫn; xác nhận chưa giải quyết rồi escalate; Admin trả lời | Nguồn KB đúng role, summary thật, notification/unread cập nhật và tin nhắn tới browser còn lại không F5 |
| 12:00–14:00 tùy thời gian | Teacher `/dashboard/live-classes`; Student `/student/live-classes` | Start DEMO Web review session, hai context tham gia, bật/tắt media, gửi chat, Teacher end | Cùng phòng SFU, remote video/audio/participant thật; end đóng room/tracks và ghi attendance |
| 14:00–15:00 | Các vai trò | Mobile/dark mode, logout rồi Back; nhắc limitations | Navbar/sidebar vẫn #006D77; private workspace không mở lại sau logout |

Trước khi thoát buổi demo: kết thúc phòng đang chạy, submit/đóng các attempt rehearsal còn mở, không xóa dữ liệu thật. Không chiếu logs chứa credential, ảnh thẻ hoặc embedding.
