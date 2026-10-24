# Gửi yêu cầu xác minh hồ sơ — 2026-10-09

## Request flow

Student active với hồ sơ PENDING gửi yêu cầu → lưu request PENDING → thông báo cho các admin active → admin xem hồ sơ hiện tại rồi xác nhận hoặc từ chối. Gửi yêu cầu không xác nhận hồ sơ, không tạo ảnh thẻ/reference/embedding.

Request có trạng thái riêng: PENDING, COMPLETED, REJECTED, CANCELLED. Student nhận NOT_REQUESTED nếu chưa gửi hoặc lịch sử đã hoàn tất/hủy. `identity_profile_status` chỉ dùng PENDING/VERIFIED và tiếp tục là nguồn xác định quyền upload thẻ.

Admin sửa họ tên/MSSV khi request đang chờ: giữ ý định xin xác minh, tăng version theo logic hiện có; thao tác duyệt/từ chối từ dữ liệu cũ bị từ chối 409. Sửa hồ sơ đã được duyệt: hồ sơ trở lại PENDING, lịch sử COMPLETED không tự xác minh lại. Khóa tài khoản/chuyển khỏi vai trò student hủy request đang chờ.

## Student UI

`/student/profile` hiển thị nút gửi, trạng thái đang gửi, đã gửi và nút disabled; tải lại trang đọc trạng thái từ backend. Trường hợp bị từ chối hiển thị lý do, hướng dẫn liên hệ admin sửa hồ sơ và nút gửi lại. Khi được xác nhận, chuyển sang component Student Card hiện có. Làm mới trạng thái khi cửa sổ nhận focus hoặc mở thông báo kết quả. Student không được chỉnh MSSV, kết quả duyệt hay thông tin authoritative.

## Admin UI

`/dashboard/users` có danh sách yêu cầu chờ, phân trang 20 mục và bộ lọc student khi mở từ thông báo. Mỗi dòng hiển thị họ tên, email, MSSV, thời điểm gửi. “Xem hồ sơ” mở chi tiết tên/email/MSSV/điện thoại/tài khoản và các nút chỉnh sửa, xác nhận, từ chối. Thiếu MSSV hoặc tài khoản bị khóa không thể xác nhận. Từ chối cần lý do. Lỗi version hiển thị inline với thao tác tải lại.

## API

Tất cả đường dẫn dưới `/api/v1`; dùng envelope `{data, meta}` hiện có.

| Method/path | Quyền | Hành vi |
|---|---|---|
| `GET /identity/profile-verification/status` | Student active | Chỉ trạng thái của tài khoản đăng nhập |
| `POST /identity/profile-verification/request` | Student active, profile PENDING | Không body hoặc `{}`; lặp khi PENDING trả trạng thái hiện tại |
| `GET /users/profile-verification/requests` | Admin | `status` mặc định PENDING; `student_id`, `page`, `limit` (tối đa 100) |
| `POST /users/{id}/identity-profile/verify` | Admin | **Endpoint hiện có**, body `{identity_profile_version}`; xác nhận và hoàn tất request trong cùng transaction |
| `POST /users/profile-verification/requests/{request_id}/reject` | Admin | `{identity_profile_version, rejection_reason}`; lý do trim, 1–500 ký tự, không control characters |

Status trả `identity_profile_status`, `verification_request_status`, `verification_requested_at`, `verification_rejection_reason`. Không trả reviewed_by hay thông tin admin cho student. Trường ngoài schema bị từ chối 422, tài khoản chưa đăng nhập/bị khóa 401, sai vai trò 403, profile/version/trạng thái request không hợp lệ 409, lỗi lưu request 503 với thông báo công khai.

## Database changes

HEAD kiểm tra trước thay đổi: `0010_student_card_references`. Migration append-only mới `0011_profile_requests` tạo `profile_verification_requests` (id, student_id, status, requested_at, reviewed_at, reviewed_by, rejection_reason), các check constraint và unique partial index cho một PENDING/student. Khóa dòng User tuần tự hóa gửi, duyệt, từ chối và sửa hồ sơ. Gửi lại sau từ chối tạo dòng mới, giữ lịch sử.

Mở rộng enum `notification_type` thêm `profile_verification_request`/`profile_verification_result`, thêm nullable `notifications.related_student_id`. Không chỉnh schema.sql hoặc migration 0008/0009/0010. PostgreSQL local `pbl6` đã nâng từ 0010 lên 0011. Downgrade 0011 loại bỏ dữ liệu riêng của tính năng này, giữ thông báo loại cũ; đã kiểm tra trên database tạm.

## Notifications

Tái sử dụng bảng notifications, `create_notification`, API đọc/đánh dấu đã đọc và NotificationBell hiện có. Request gửi tới mọi admin active; duyệt/từ chối gửi tới student. Request trùng hoặc xác nhận lặp không tạo thông báo trùng. Thông báo và chuyển trạng thái được commit cùng transaction. Tính năng này chỉ tạo thông báo trong ứng dụng, không gửi email. Bell cho student được bật; deep link kết quả tới profile, yêu cầu tới danh sách admin lọc theo student.

## Security

User lấy từ authentication backend; không nhận arbitrary student_id ở API student. Student không được dùng endpoint admin, tự đặt MSSV, tự xác nhận hoặc sửa rejection result. API notifications cho cả ba vai trò nhưng luôn lọc recipient hiện tại, bao gồm read/read-all. Rejection reason chỉ là nội dung admin nhập có validation, hiển thị bằng React text escaping; không dùng exception/stack trace làm lý do. Dữ liệu lỗi validation không trả input hoặc exception context. Unique index là lớp chống trùng cuối cùng ngoài row lock.

## Files changed

Backend mới: `alembic/versions/0011_profile_requests.py`, `app/api/v1/profile_requests.py`, `app/services/profile_requests.py`, `app/schemas/profile_requests.py`, `tests/test_profile_requests.py`.

Backend cập nhật: `app/models/entities.py`, `app/services/notifications.py`, `app/api/v1/notifications.py`, `app/api/v1/users.py`, `app/api/v1/router.py`, `tests/test_student_identity_profile.py`, `tests/test_identity_migrations.py`.

Frontend mới: `lib/profile-requests.ts`, `components/student/ProfileIdentitySection.tsx`, `components/admin/ProfileVerificationRequests.tsx`, `tests/e2e/profile-verification-requests.spec.ts`.

Frontend cập nhật: `lib/api.ts`, `types/index.ts`, `app/student/profile/page.tsx`, `app/dashboard/users/page.tsx`, `components/layout/AppShell.tsx`, `components/layout/NotificationBell.tsx`, `tests/e2e/ui-fixtures.ts`, `tests/e2e/student-identity-profile.spec.ts`.

Tài liệu: báo cáo này, `API_CONTRACT.md`, `SETUP.md`, ghi chú checkpoint trong `STUDENT_IDENTITY_IMPLEMENTATION.md`.

## Tests

Backend: `STUDENT_CARD_OCR_AUTOSTART=false IDENTITY_TEST_POSTGRES=1 RUN_LOCAL_OCR_SMOKE=1 .venv/Scripts/python.exe -m unittest discover -s tests -q` trong backend. Kết quả: 249 bài, OK, 1 bài yêu cầu ảnh thẻ thật được cung cấp riêng bị skip. Có 12 bài mới cho request, bổ sung PostgreSQL race/unique index và round trip migration. Database integration dùng database tạm riêng, không ghi test data vào pbl6. Log: `artifacts/profile-requests-backend.txt`.

Frontend: Playwright trên Edge với production server cổng 3100. Bao gồm gửi/loading/pending/reload, rejection/resend, lỗi gửi, chuyển sang card, admin approve/reject/stale version và deep links thông báo. **73/73 passed** (9 bài mới). Kết quả lưu tại `artifacts/profile-requests-playwright.txt`.

## Typecheck/build

`npx tsc --noEmit` và `npm run build` đều PASS; log build: `artifacts/profile-requests-build.txt`.

## Existing Identity/Card flow regression

Chạy lại toàn bộ backend/frontend suite, gồm profile authoritative, preview/confirm thẻ, stale version/reference, gate trước vào thi và OCR worker offline. Không thay Student Card OCR, Tesseract, YuNet, SFace, embedding, reference UUID, exam verification hoặc threshold 0.363. Không thay đổi Face Verification.
