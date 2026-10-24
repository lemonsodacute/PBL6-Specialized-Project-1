# Quản trị xác thực thẻ sinh viên

Trang `/admin/student-cards` dùng API thật `/api/v1/admin/student-cards`.
Danh sách gồm sinh viên chưa có thẻ; hỗ trợ tìm họ tên/MSSV/email, phân trang,
lọc chưa gửi/chờ xác nhận/đã xác thực/yêu cầu cập nhật/đã thu hồi.

## Dữ liệu và quyền

Migration `0014_card_admin` bổ sung actor/source, metadata mô hình/parser và
thông tin thu hồi vào reference. Actor được ghi từ tài khoản thực hiện confirm,
không lấy người duyệt hồ sơ để suy ra người xác nhận thẻ. Reference cũ mang
`SYSTEM_MIGRATION` với actor null; không tạo lịch sử xác nhận giả. Phiên bản
mô hình cũ chỉ được sao chép từ embedding có liên kết đúng reference/student.
OCR/parser của dữ liệu cũ chưa lưu thì không hiển thị giá trị suy đoán.

Các endpoint danh sách, chi tiết, lịch sử, ảnh và thao tác đều kiểm tra Admin
đang hoạt động ở backend. Student vẫn chỉ dùng status/preview/confirm của mình.
Không có endpoint Admin confirm hay sửa raw OCR, embedding, score hoặc version.
Admin xem được ảnh khuôn mặt đã sanitized của reference hiện tại qua request
xác thực, `Cache-Control: no-store`; không cung cấp ảnh thẻ gốc, đường dẫn private
hoặc vector embedding. Ảnh reference hết hiệu lực được xóa giống policy thay thẻ/
thay thông tin hồ sơ hiện có; metadata reference và audit được giữ lại.

## Thu hồi và yêu cầu cập nhật

Payload yêu cầu lý do, profile version, card management version và reference ID
đang xem. Đây là snapshot để kiểm tra thay đổi, không phải trường có thể chỉnh sửa
reference. Thao tác khóa user như confirm/profile update, từ chối snapshot cũ.
`reference.status = INVALIDATED`, `user.student_card_status = NEEDS_REUPLOAD`.
Danh sách hiển thị “Đã thu hồi” từ action thu hồi gần nhất, không thay enum trust
hiện có. Thu hồi lưu `revoked_at`, `revoked_by`, `revoke_reason`; không ghi đè lần
thu hồi cũ. Cả yêu cầu cập nhật và thu hồi ngừng sử dụng reference cũ cho xác minh mới.

Pending preview bị invalidate. Card management version được chụp trước OCR,
lưu trên preview và kiểm tra lại trước commit confirm: OCR/inference đang chạy
khi Admin thu hồi không thể khôi phục trust bằng preview cũ. Profile version
và face verification vẫn dùng logic cũ. Verification cũ sai reference version
không thể dùng sau xác nhận thẻ mới. Sinh viên phải tải và confirm thẻ mới.

Thay authoritative fields qua User Management giữ logic tăng profile version/
invalidate trust, đồng thời tạo card audit và thông báo. Sửa phone không kích hoạt
yêu cầu xác minh lại. YuNet, SFace, chất lượng LIVE/CARD, embedding algorithm và
cosine threshold 0.363 không thay đổi.
Link cập nhật hồ sơ mở trực tiếp form chỉnh sửa đúng sinh viên ở User Management,
kể cả khi sinh viên không nằm trong trang đầu của danh sách tài khoản. Dữ liệu
form được đọc lại qua GET `/api/v1/users/{id}` chỉ dành cho Admin.

## Thông báo và audit

Thông báo in-app trong bảng `notifications`, không gửi email. Recipient luôn là
student đã kiểm tra từ path/record; payload không nhận recipient tùy ý. Notification,
card status và audit commit cùng transaction, rollback toàn bộ khi lưu thất bại.
Bell dùng DB thật, không fallback dữ liệu mock khi API thật lỗi; thông báo thẻ mở
`/student/profile#identity-heading`. Student thấy lý do, cảnh báo và nút tải thẻ mới.
Status được làm mới khi focus, bấm thông báo và định kỳ khi trang đang hiển thị.

Audit: `CARD_VERIFIED`, `CARD_REPLACED`, `CARD_REVOKED`,
`CARD_UPDATE_REQUESTED`, `CARD_NOTIFICATION_SENT`; lưu actual actor/role,
student/reference, reason và thời gian. Lịch sử có phân trang. Confirm mới ghi
source `STUDENT_SELF_CONFIRM` và snapshot phiên bản OCR/parser/face model;
không phụ thuộc metadata preview có TTL 10 phút. Original card preview vẫn được
xóa sau confirm và cleanup theo cơ chế hiện có.

## Kiểm tra

Backend: `python -m unittest tests.test_student_card_admin
tests.test_student_card_api tests.test_student_card_previews
tests.test_student_identity_profile tests.test_profile_requests -q`.
E2E: `npx playwright test tests/e2e/admin-student-cards.spec.ts
tests/e2e/student-card.spec.ts`.
Fixture là SQLite/private temp và browser interception; không thu hồi thẻ thật
hoặc gửi thông báo thử đến sinh viên trong DB đang chạy.
