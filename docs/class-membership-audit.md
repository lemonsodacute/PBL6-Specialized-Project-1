# Đồng bộ thành viên lớp và sinh viên có thể thêm

Kiểm tra ngày 2026-10-12, áp dụng cho Teacher `/dashboard/classes/[id]` và
Admin `/admin/classes/[id]`. Phạm vi chỉ là class membership.

## Nguyên nhân

Bảng thành viên lấy từ GET `/classes/{id}/enrollments`, có search/pagination.
Dropdown `RemoteFilterSelect` lấy từ endpoint riêng GET
`/classes/{id}/enrollments/available` với `q`, `page=1`, `limit=20`, `sort=name`.
Backend đã loại toàn bộ thành viên của lớp bằng subquery trước khi phân trang;
không tải tất cả users hoặc lọc theo trang thành viên ở frontend.

Sau POST/DELETE, hai page trước đây chỉ gọi `load()` cho bảng thành viên và
metadata lớp. Dropdown không có tín hiệu làm mới nên giữ option cũ, kể cả
sau khi đã clear lựa chọn.

## Thay đổi

- Thành công hoặc conflict duplicate: clear lựa chọn, tăng `availableRevision`
  để dropdown loại cache cũ ngay và query lại, đồng thời tải bảng/count lớp.
- Thêm hàng loạt Admin cũng làm mới hai nguồn sau khi xử lý, báo từng dòng
  không thêm được và không gửi request lặp cho cùng sinh viên.
- Request dropdown cũ bị bỏ qua khi query/class/revision thay đổi. Search vẫn
  chỉ dùng available endpoint, theo họ tên, MSSV hoặc email.
- Option rỗng của student picker là “Chọn sinh viên”, không phải “Tất cả”. Khi
  không còn candidate: “Không còn sinh viên để thêm.” và disable select/action.
  Search không khớp có thông báo riêng; lỗi API có retry, không đưa option cũ
  trở lại.
- Khóa thao tác thêm/xóa/bulk trong khi đang xử lý, hiển thị “Đang thêm...”.
  Mutation error tách khỏi lỗi tải bảng để bảng thành viên vẫn được xem khi
  request thêm thất bại. Thành công có thông báo; không hard reload.
- POST duplicate trả 409 `STUDENT_ALREADY_ENROLLED`, UI hiện “Sinh viên này đã
  thuộc lớp.” và sửa lại dropdown/bảng. Frontend cũng hiểu mã legacy
  `ALREADY_ENROLLED` trong quá trình cập nhật server.
- Backend bắt race khi unique constraint reject commit, rollback transaction,
  kiểm tra membership thực sự tồn tại rồi trả cùng 409. Lỗi integrity khác
  không bị đổi thành lỗi duplicate.

`ClassEnrollment`, `schema.sql` và database PostgreSQL thật đều đã có UNIQUE
`(class_id, student_id)`. Không tạo migration. Không đổi quyền, policy tài
khoản active, exam/scoring, identity, Student Card hoặc Question Bank.

## Kiểm chứng

- 23 backend unittest đạt: 8 test mới class membership + 15 collections.
  Bao gồm loại cả roster trước pagination/search, tên/MSSV/email, active và
  class scope, thêm/xóa, conflict Teacher/Admin, unique constraint, mô phỏng
  race với unique violation thực tại commit, rollback/session recovery và quyền.
- 9 Playwright test mới đạt: Teacher/Admin, thành viên ở trang 2, add/remove,
  duplicate race, loading, phản hồi cũ, empty/retry, failed-add giữ selection
  và bảng, bulk, mobile 375px. Fixture chỉ được dùng trong test.
- 11 Playwright hồi quy collections/Teacher Reports đạt, gồm remote exam
  selector, filters, phản hồi trễ, retry và pagination.
- Full TypeScript (`npx tsc --noEmit --incremental false --pretty false`) đạt.
- Read-only database/API thật: unique constraint tồn tại, 0 nhóm duplicate;
  Teacher/Admin đều nhận 1 candidate cho lớp có 10 thành viên trong snapshot
  local. Candidate không giao với roster và total API khớp DB. Không thay
  đổi dữ liệu lớp khi kiểm chứng này; các số trên không hard-code vào sản phẩm.

Log và script kiểm chứng đặt trong TEMP, không lưu token hoặc thông tin cá
nhân vào tài liệu.
