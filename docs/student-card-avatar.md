# Avatar từ thẻ sinh viên đã xác thực

Sau confirm, hệ thống dùng **đúng JPEG sanitized_face đang lưu trên reference**,
không crop lại, không dùng ảnh thẻ gốc/preview/webcam, không sao chép embedding.
Không tạo thêm file/avatar derivative nên không có file avatar orphan cần cleanup.

## Source và vòng đời

Tái sử dụng `users.avatar_url`; migration `0015_student_card_avatar` bổ sung
`avatar_source`, `avatar_reference_id` (FK SET NULL khi reference bị xóa),
`avatar_updated_at`. URL chỉ là endpoint private có reference version:
`/api/v1/users/{student_id}/avatar/{reference_id}`.

Metadata avatar được đồng bộ trong transaction riêng **sau identity commit**.
Đồng bộ lỗi không rollback reference và không báo confirm thất bại. Đọc profile
luôn kiểm tra reference ACTIVE, đúng profile version, trạng thái VERIFIED,
embedding trỏ đúng version và có sanitized face. Pointer avatar chỉ là metadata
presentation; profile có thể dựng lại URL từ reference hợp lệ nếu sync trước đó lỗi.
Sync trễ của reference cũ không được ghi đè avatar của reference mới.

Preview không đặt avatar. Confirm thẻ mới thay URL sang reference mới; endpoint
reference cũ không còn phục vụ ảnh. Thu hồi/yêu cầu cập nhật, thay authoritative
identity fields và privacy DELETE identity clear pointer cùng transaction trust.
Khi reference/face không còn khả dụng, serializer và media endpoint ngừng hiển thị
avatar, kể cả pointer cũ chưa được cleanup. Avatar không thay đổi reference version,
profile version, FaceEngine, OCR, embedding, YuNet/SFace hoặc cosine 0.363.

Migration chỉ backfill những reference đã xác nhận, đang ACTIVE, đúng version,
có embedding tương ứng và sanitized face; không nâng trust của thẻ chưa xác nhận.
Hai sinh viên đã có reference hợp lệ trong DB hiện tại dùng được avatar ngay.
Avatar legacy/public của sinh viên không được coi là identity-derived avatar;
Teacher/Admin giữ cách hiển thị avatar hiện có.

## Privacy và UI

Endpoint chỉ cho chính sinh viên hoặc Admin đang hoạt động; Teacher/sinh viên khác
bị từ chối. Trả JPEG, `Cache-Control: no-store`, `Pragma: no-cache`, `nosniff`, cả
response lỗi. Không có token trong URL, filesystem path, raw card/OCR hay embedding.
Protected image fetch gửi Bearer của tab hiện tại cùng credentials hiện có.

`ProfileAvatar` dùng chung cho Student Profile, sidebar/account menu và Admin
student profile/card details. Blob URL bị revoke khi thay reference hoặc unmount;
avatar cũ được ẩn ngay khi source/version đổi. Confirm refetch `/auth/me` và cập nhật
metadata avatar trong context hiện có, không thay auth/role/session behavior.
Theo dõi focus, thông báo thẻ và interval khi trang đang hiển thị để phản ánh thu hồi.
Lỗi lấy profile/avatar dùng initials, không ảnh hưởng kết quả identity confirmation.

Student không có upload/edit/delete avatar. API self-update và User Management
không nhận arbitrary avatar URL/source/reference/file.

Trong section Xác minh danh tính, thẻ VERIFIED có reference ACTIVE chỉ hiển thị
trạng thái đã xác thực và thời gian xác nhận từ `updated_at` của reference; không
render nút hoặc input chọn ảnh. Không phụ thuộc vào việc avatar đã tải được hay
chưa: lỗi ảnh hoặc refetch avatar vẫn không mở action thay ảnh.

Action thẻ hiển thị theo trạng thái thực tế:

- NOT_SUBMITTED: `Tải thẻ sinh viên`.
- Admin yêu cầu cập nhật / NEEDS_REUPLOAD (trạng thái hiện có) / REQUIRES_UPDATE:
  `Cập nhật thẻ sinh viên`, kèm lý do nếu có.
- Thu hồi hoặc reference INVALIDATED mà không phải yêu cầu cập nhật:
  `Tải thẻ sinh viên mới`.
- Chưa lấy được trạng thái: tải lại trạng thái, không mở upload.

API status bổ sung `reference_status` và `update_requested` từ dữ liệu thật để
phân biệt yêu cầu cập nhật với thu hồi; không đổi trạng thái lưu trong DB hoặc
logic preview/confirm. Sau yêu cầu Admin, preview/confirm giữ nguyên và avatar
tự cập nhật từ sanitized face của reference mới. Privacy DELETE identity vẫn là
flow xóa dữ liệu sinh trắc riêng, không phải API xóa avatar.

## Kiểm tra

- Backend: `python -m unittest tests.test_profile_avatar tests.test_student_card_api tests.test_student_card_admin tests.test_student_phone tests.test_user_profile -q`.
- PostgreSQL migration isolation: `$env:AVATAR_TEST_POSTGRES='1'; python -m unittest tests.test_profile_avatar.AvatarMigrationTests -q`. Chỉ dùng TEMP tables với `search_path=pg_temp`, không sửa bảng thật.
- E2E: `npx playwright test tests/e2e/profile-avatar.spec.ts tests/e2e/student-profile.spec.ts tests/e2e/student-card.spec.ts tests/e2e/admin-student-cards.spec.ts`.
- API thật đã kiểm tra hai JPEG 112×112, bytes giống sanitized reference, Admin dùng cùng URL, cross-student 403, cache no-store. Không xác nhận/thu hồi thẻ thật để kiểm thử.
