# Teacher Reports: dữ liệu thật

## Nguồn và quyền truy cập

`/dashboard/reports` đọc `GET /api/v1/teacher/reports?exam_id=...&page=...&limit=...`.
Không chọn exam_id sẽ tổng hợp trong tất cả đề được quyền quản lý, còn rows
được phân trang từ SQL. Dropdown tìm đề từ API exams theo scope hiện có.
Không lấy fixture hoặc tên đề hard-code. Q/status/risk kết hợp trong cùng
query; tổng thống kê tính trên toàn bộ scope đã lọc, không chỉ trang hiện tại.
Xuất CSV dùng `format=csv` của endpoint này để stream tất cả rows khớp filter.

Teacher phải là `Exam.created_by`; truy cập trực tiếp đề hoặc attempt của
Teacher khác trả 403. Admin giữ quyền xem báo cáo như endpoint Results hiện có.
Student không được gọi Reports. Đề đã xóa không xuất hiện và không thể mở chi tiết.
Quyền giao lớp của luồng hiện có yêu cầu `Class.homeroom_teacher_id` là Teacher
đang quản lý; giao trực tiếp cho sinh viên vẫn được hỗ trợ. Báo cáo giữ các
attempt lịch sử của đề khi enrollment thay đổi, giống Teacher Results.

`backend/app/services/reports.py` dùng chung cho Reports và Teacher Results:

| Dữ liệu | Nguồn thực tế |
| --- | --- |
| Đề thi | `exams` |
| Lớp được giao / sinh viên trực tiếp | `exam_assignments`, `classes` |
| Roster và sinh viên chưa làm | `class_enrollments`, `users`; endpoint Results |
| MSSV, họ tên | `users.student_code`, `users.full_name` |
| Từng lần thi và điểm | `exam_attempts` |
| Đáp án đã lưu / đúng sai | `answers`; endpoint Student/Teacher Result hiện có |
| Sự kiện trình duyệt | `violation_logs` |
| Cảnh báo phát hiện | `detection_events` |
| Risk score | `exam_attempts.risk_score`, được risk service hiện có persist |

Reports không chấm lại bài đã nộp. Quy tắc xử lý bài đang làm hết hạn dùng
finalizer hiện có, đồng nhất với Results/Student; không thay công thức điểm.
Ảnh thẻ, khuôn mặt, OCR và các threshold không bị thay đổi.

## Tổng hợp và hiển thị

- Attempt hoàn tất dùng enum thực tế: `submitted`, `auto_submitted`, `terminated`.
- “Bài đã nộp” đếm từng attempt hoàn tất, kể cả khi score chưa được lưu.
  Teacher Results vẫn đếm sinh viên ở trạng thái hiện tại trong roster;
  lịch sử của từng sinh viên và bảng Reports giữ tất cả lần thi.
- Score đọc trực tiếp từ attempt. `in_progress`, `not_started` luôn trả score
  và percentage null; UI hiển thị —. Không lấy điểm tạm vào trung bình.
- Tất cả đề: trung bình các tỷ lệ `score / max_score * 100`, không AVG điểm
  thô của các thang điểm khác nhau. Một đề có cùng thang điểm đã lưu hiển thị
  AVG(score) / max_score; nếu lịch sử có nhiều thang điểm, dùng phần trăm.
- Score null hoặc max_score null/không dương không được tạo thành điểm 0.
  Số bài chưa đủ score/max_score để tổng hợp được thông báo trên UI.
- Tổng vi phạm là COUNT các bản ghi `violation_logs` + `detection_events` trong
  phạm vi đang chọn. Hai thành phần có số riêng trên UI/API. Không dùng bộ
  đếm cache `exam_attempts.violation_count`, không thêm record từ frontend.
  Các sự kiện là cảnh báo cần được xem xét, không tự kết luận gian lận.
- Risk score dùng giá trị persist của thuật toán hiện có trong
  `app/services/risk.py`, không tính lại hoặc đặt số mặc định ở frontend.
  Giá trị null hiển thị —; trung bình chỉ tính các attempt có risk score.

Trang có loading, empty state, lỗi và retry. Khi refetch/filter, bảng và nút
xuất không dùng response cũ; response bị vượt qua bởi request mới được bỏ qua.
Nếu API lỗi, không có dữ liệu demo thay thế.

## Chi tiết và CSV

`Xem` mở `/dashboard/reports/attempts/{attempt_id}` và đọc
`GET /api/v1/reports/attempts/{attempt_id}` với kiểm tra ownership phía server.
Trang hiển thị sinh viên, MSSV, đề, điểm, trạng thái, thời gian bắt đầu/nộp,
risk score và timeline sự kiện từ hai bảng giám sát. Không serialize storage
path, snapshot hoặc metadata nội bộ vào report này.

Bài hoàn tất có link tới trang bài làm/đáp án hiện có, tiếp tục dùng cùng
Student Result endpoint và điểm persist. Luồng chấm bài không bị thay đổi.

CSV được stream từ cùng query API với toàn bộ rows khớp filter, có Exam, MSSV, Student Name,
Status, Attempt Number, Score, Max Score, Percentage, Submitted At,
Violation Count, Risk Score. Lọc một đề chỉ xuất các attempt của đề đó.
Giá trị null để trống, score 0 được giữ; chuỗi được escape chống công thức
spreadsheet. Không dùng array fixture hoặc ghi file report public mới.

## Kiểm tra

- `backend/tests/test_teacher_reports.py`: điểm khác thang, terminal/null/zero,
  count từng attempt, count event thật khi cache sai, risk persist, đồng nhất
  Results, ownership, deleted/missing records và empty state.
- `backend/tests/test_teacher_results.py`: hồi quy roster, giao trực tiếp,
  enrollment lịch sử, real submit và chính sách công bố đáp án.
- `tests/e2e/teacher-reports.spec.ts`: filter bằng UUID thật từ response, CSV
  theo filter, chi tiết event, lỗi/retry, empty và response về sai thứ tự.
- `tests/e2e/teacher-results.spec.ts`: hồi quy các URL Results và bài làm.
- Script kiểm chứng local chỉ đọc PostgreSQL/API và dùng browser không mock
  để đối chiếu một bài đã nộp, danh sách toàn bộ đề, CSV và chi tiết.
  Tài khoản test tổng hợp chỉ nằm trong test fixture, không seed dữ liệu demo.

## Trace PostgreSQL → API → UI (2026-10-12)

Kiểm chứng trên tài khoản Teacher sở hữu đề, qua API và browser không mock:

| Trường | Giá trị đã đối chiếu |
| --- | --- |
| Exam | Kiểm tra giữa kì CNW |
| Exam ID | `04a98dd6-17da-4e29-9d6c-f3e4a27f40e8` |
| Attempt ID | `08a50924-ccd3-46b2-a882-761d9cd8d793` |
| MSSV | `102230057` |
| Sinh viên | Lê Nguyễn Châu Anh |
| Status | `submitted` |
| PostgreSQL score / max_score | `1.00 / 15.00` |
| Reports API / UI | `1 / 15` |
| Violation + detection records / detail events | 7 |
| Persisted risk score / API | 66 |
| Giao đề | Enrollment thật trong 2 lớp được giao đề, không gán trực tiếp |

Điểm API Reports được so sánh với cả Teacher Results và Student Result.
Dropdown lọc đúng exam_id, row có đúng MSSV/họ tên/điểm, CSV chứa đề và sinh
viên đang lọc, link Xem mở đúng attempt với đủ 7 event. Không có lỗi JavaScript.

Phạm vi tất cả đề của Teacher cũng được query độc lập lại từ PostgreSQL:
4 attempt hoàn tất, 40 event, trung bình phần trăm 16,67%; ba giá trị đều
khớp response tổng hợp. Đây là ảnh chụp dữ liệu tại thời điểm kiểm tra, không
phải giá trị được hard-code trong API/UI. Dữ liệu có thể thay đổi khi sinh viên
nộp thêm bài hoặc giảng viên chấm bài.

Kết quả kiểm tra: 13 backend integration tests và 14 Playwright tests đạt.
TypeScript frontend đạt với config bỏ qua lỗi MediaStreamConstraints có sẵn
trong test E2E `exam-experience.spec.ts`, không liên quan Reports.
