# Audit Search / Filter / Pagination

Các danh sách dùng query hiện có và giữ nguyên authorization. Không thêm
trường mã giảng viên, mã lớp hoặc trạng thái lớp vì schema chưa có các field
này. Không thay scoring, identity, OCR, Face Verification hoặc trạng thái thẻ.

| Collection / route | Search | Filter có giá trị | Sort | Pagination |
| --- | --- | --- | --- | --- |
| Admin users `/dashboard/users` | Họ tên, email, MSSV | Role, active, xác minh hồ sơ | Tên, ngày tạo | Server |
| Admin classes `/admin/classes` | Tên/mô tả lớp | Giảng viên thật | Tên, ngày tạo | Server |
| Admin cards `/admin/student-cards` | Họ tên, MSSV, email | Management status hiện có | Tên ổn định | Server, đã có |
| Audit `/admin/action-logs`, alias dashboard | Actor, action, user liên quan, entity type | Action, role, từ/đến | Thời gian | Server |
| Question banks `/dashboard/question-banks` | Tên, môn, mô tả | Không thêm filter giả | Tên, ngày tạo | Server |
| Question bank detail collection | Nội dung | Type, difficulty, topic, active | Ngày tạo | Server; giữ lựa chọn khi đổi trang |
| Teacher/Admin exams | Tên, mô tả | Status, class, thiết bị; teacher cho Admin | Tên, start, created | Server |
| Teacher results / attempts / report aliases | MSSV, họ tên | Trạng thái, chờ chấm | Điểm, nộp lúc | Server |
| Teacher reports | MSSV, sinh viên, tên đề | Đề, trạng thái, risk thực tế | Điểm, nộp lúc | Server; CSV theo toàn bộ filter |
| Teacher classes | Tên/mô tả | Không có class status trong schema | Tên, ngày tạo | Server |
| Teacher/Admin class enrollments | MSSV, tên, email | Không cần filter giả | Tên / enrollment time | Server |
| Admin class exam assignments | Tên/mô tả đề | Lớp đang xem | Assignment time | Server |
| Monitoring index | Tên đề | Lớp/đề, đã có | Thời gian | Collection phù hợp |
| Monitoring attempts | MSSV, tên | Trạng thái, có cảnh báo | Thời gian / risk | Server |
| Student exams | Tên đề | Upcoming/open/ended | Start / created | Server |
| Student results/history | Tên đề | Status, khoảng thời gian | Submitted time | Server |
| Student classes | Tên/mô tả | Không có class status | Tên | Server |
| Student class detail: exam/live collections | Tên đề/buổi học nếu >10 item | Period/status, lớp hiện tại | Start/active | Server, hai danh sách độc lập |
| Student/Teacher online classes | Buổi học / tên lớp | Scheduled/ongoing/ended/cancelled | Lịch học | Server |
| Student calendar trên Trang chủ | Không thêm search | Khoảng ngày đang xem | Theo lịch | Query khoảng ngày, trang API 100 nếu cần; trang thời khóa biểu riêng đã bỏ |
| Notifications `/notifications` | API chưa hỗ trợ search | Read/unread, type thật | Mới nhất | Server; bell chỉ 8 mới nhất, không filter/pagination |
| Report detail: monitoring events | Không thêm search vào detail | Source/severity nếu >20 event | Thời gian | Server; count tổng giữ nguyên |

Không thêm search vào profile, settings, card detail, attempt grading detail,
form tạo/sửa, phòng học đang mở hoặc bài thi đang làm. Help search đã có từ
flow trước được giữ nguyên; không thêm hệ thống FAQ phức tạp.

Shared foundation: CollectionToolbar/SearchInput, CollectionPagination,
EmptySearchState, useCollectionState, useServerCollection. Backend có helper
search/ordered/page_query và tham số q/page/limit/sort. UI query giữ ở URL,
search debounce 350ms, reset page khi đổi bộ lọc, không reset filter khác.
Search PostgreSQL chuẩn hóa chữ hoa/thường và dấu tiếng Việt bằng translate;
không cần extension unaccent hoặc index mới. %, _ được escape như ký tự thật.

Remote selectors cho lớp/đề/giảng viên/thêm sinh viên tìm từ API với 20 kết quả,
không phụ thuộc lựa chọn có nằm trong trang đầu. Không thêm search chung vào
form; đây là tra cứu một lựa chọn thật khi cần.

Metadata ngân hàng không tải toàn bộ câu hỏi. Topics/has_difficulty lấy từ ngân
hàng đầy đủ để công cụ chọn ngẫu nhiên không mất chủ đề khi phân trang.
Lựa chọn câu hỏi được giữ qua nhiều trang. Chỉ khi người dùng yêu cầu “Chọn
tất cả kết quả” hoặc xuất CSV kết quả mới đọc tiếp các trang khớp bộ lọc.
CSV Reports stream từ API trên cùng scope/filter, không chỉ xuất trang hiện tại.
Summary/ranking/score vẫn dựa trên dữ liệu đã lưu và policy hiện có.

Response cũ không có meta không được suy đoán tổng số; UI chỉ báo số đã tải.
API lỗi có retry, không fallback mock. Các response trả về trễ không được ghi
đè query mới. Page được reset khi đổi filter và điều chỉnh về trang cuối nếu
số lượng giảm sau một thao tác. Notification popup không sửa URL của page.

UX Notification được tách thành bell xem nhanh và trang đầy đủ theo yêu cầu
mới; xem [notification-ux.md](notification-ux.md) để biết cấu trúc và kiểm chứng.

Dropdown thêm sinh viên lớp đã được đồng bộ với mutation và có xử lý race
duplicate; xem [class-membership-audit.md](class-membership-audit.md).

Chức năng vấn đáp đã được bỏ theo yêu cầu tiếp theo; xem
[retired-oral-exams.md](retired-oral-exams.md). Không còn collection chấm vấn đáp.

Student Exam List đã tách quyền bắt đầu lần đầu khỏi làm lại và dùng state của
đúng student/exam; xem [student-exam-state-audit.md](student-exam-state-audit.md).

## Kiểm chứng ngày 2026-10-12

- Backend: 68 kiểm thử trong các nhóm collections, Teacher Results/Reports,
  question selection, classroom, user profile và settings; 67 đạt, 1 kiểm thử
  PostgreSQL tùy chọn skip vì chưa bật environment riêng của test đó.
- Frontend: 44 case Playwright được kiểm chứng, gồm debounce/URL/filter AND,
  dữ liệu ngoài 100 record đầu, phản hồi trễ, lỗi/empty/retry, notification
  pagination, chọn câu hỏi qua nhiều trang, bulk update và mobile 320–1440px.
  37 case đạt ở lượt chính; 7 case đạt khi chạy lại sau cập nhật canonical URL,
  metadata fixture theo topic thật và thời gian chờ hydration của Next dev.
- TypeScript frontend đạt với config kiểm tra toàn frontend, loại trừ lỗi
  MediaStreamConstraints có sẵn ở exam-experience.spec.ts, không thuộc thay đổi.
- Read-only PostgreSQL/API: Admin q/MSSV count khớp DB; Teacher q/exam/page
  trả đúng score; Student chỉ thấy attempt của mình và không gọi được users.
- Browser không mock: Reports, Teacher Results và Student Result cùng `1/15`,
  7 event, risk 66; summary toàn scope khớp DB (4 completed, 40 event, 16,67%).
  CSV đúng filter và chi tiết đúng attempt. Không có lỗi JavaScript. Đây là
  snapshot dữ liệu local, không phải số được hard-code trong sản phẩm.
