# API contract

`GET /openapi.json` trên API server là contract OpenAPI hiện hành. File `openapi.json` trong repository là snapshot thiết kế ban đầu; các endpoint Student Identity hiện hành được mô tả dưới đây và trên Swagger `/docs`.

## Quy ước chung

- REST prefix: `/api/v1`.
- Thành công luôn có dạng `{ "data": ..., "meta": { "total": ... } }`.
- Lỗi luôn có dạng `{ "error": { "code": "...", "message": "...", "details": ... } }`.
- Danh sách nhận `?page=1&limit=20`, giới hạn tối đa `100`, và trả `meta.total`.
- Tên field và enum của các entity dùng đúng `schema.sql`.
- Auth ưu tiên Bearer tường minh của từng tab, dùng cookie `auth_token` khi không có header. Bearer không hợp lệ không fallback sang cookie; refresh cookie khác tài khoản bị từ chối. `password` chỉ là credential truyền vào auth request, database lưu `users.password_hash`.

## Student identity checkpoints

Chi tiết schema, migration, kiểm thử và lựa chọn OCR local: [STUDENT_IDENTITY_IMPLEMENTATION.md](STUDENT_IDENTITY_IMPLEMENTATION.md).

- `GET /auth/me`: `{user: ...}` gồm MSSV, identity profile status/version/verified_at và student card status; không có embedding hoặc private image keys. Auth giữ envelope riêng hiện hữu.
- Admin `POST /users/{id}/identity-profile/verify`: chỉ nhận `{identity_profile_version: number}`; cần sinh viên active có tên/MSSV và version hiện hành. Thành công dùng `{data, meta}`.
- `GET /identity/student-card/previews/{id}/{card|face}`: JPEG được bảo vệ, chỉ sinh viên sở hữu, profile đã VERIFIED và version khớp, preview còn PENDING/chưa hết TTL; mọi response có `Cache-Control: no-store`. Dùng Authorization header khi fetch blob; không đưa token vào URL.
- `GET /identity/student-card/status`: `{data: {identity_profile_status, student_card_status, has_reference, reference_version, updated_at}}`.
- `POST /identity/student-card/preview`: multipart chỉ có `image` (JPG/PNG, tối đa 8 MB, 160 px–16 MP); role student, account active, profile VERIFIED. Trả `{data: {preview_id, expires_at, card_preview_url, face_preview_url, extracted, comparison, can_confirm, blocking_errors, warnings}}`. `extracted` gồm họ tên/MSSV và optional lớp/ngành; không cập nhật profile. Upload chưa tạo embedding/reference active.
- `POST /identity/student-card/confirm`: chỉ `{preview_id: UUID}`, reject unknown fields. Server kiểm tra owner/TTL/status/profile version/hash, chạy lại matching và FaceEngine trước khi commit reference UUID mới. Preview hết hạn: 410; bị thay thế/profile thay đổi: 409; mismatch: 422; đã confirm hoặc không thuộc user: 404. Khi lỗi, reference trước đó được giữ nguyên.
- `POST /identity/exams/{id}/verify`: multipart `image`, `consent=true`; so sánh webcam với một embedding thẻ active. Trả trạng thái, cosine score, configured threshold, `liveness_checked=false`, `reference_version`; không trả embedding hoặc đường dẫn ảnh. Webcam không được lưu xuống file trong luồng mới.
- `GET /identity/exams/{id}/status`: kết quả mới nhất phải VERIFIED, còn hạn 15 phút và trùng reference hiện tại. `POST /attempts` áp dụng cùng gate khi `require_camera=true`, kể cả client bỏ qua trang xác minh.
- `POST /identity/enroll` và `/identity/check`: giữ route, OpenAPI `deprecated=true`, trả 410 `LEGACY_IDENTITY_DEPRECATED`. Không fallback sang ba selfie.
- `GET /identity/status` giữ trường compatibility `enrolled` nhưng chỉ phản ánh reference thẻ hiện hành. `DELETE /identity` xóa embedding, vô hiệu hóa reference/previews, xóa legacy identity và các verification của người đang đăng nhập; cleanup file sau commit.
- Mọi response identity có `Cache-Control: no-store`. Không nhận MSSV, OCR result, embedding, student ID hoặc image keys do client gửi để xác nhận.

## Quyền

### Student phone update

`PATCH /auth/me` accepts only `{phone: string | null}` for the current active student, returning `{user: UserProfile}` like `GET /auth/me`. The phone field is required; unknown fields are rejected. Trim outer whitespace, allow 8–15 ASCII digits with an optional leading `+`; preserve leading zeros/prefix. Empty string or null clears the optional phone. Invalid input: 422; anonymous/disabled: 401; wrong role: 403; save failure: sanitized 503. Phone-only edits leave identity profile version/status, card reference, embedding and current exam verification unchanged. No database migration. See [STUDENT_PHONE_EDITING.md](STUDENT_PHONE_EDITING.md).

- `admin`: quản lý users, exams, reports và monitor.
- `teacher`: quản lý exams do mình phụ trách, xem attempts/reports và monitor được gán.
- `student`: bắt đầu attempt, đọc câu hỏi, autosave answer, submit, gửi violation và khởi tạo proctoring.

## WebSocket monitor

URL:

```text
wss://<host>/api/v1/ws/monitor/{exam_id}
```

Giám thị dùng endpoint này để nhận realtime event của phòng thi. Message JSON dùng `type` và `data`:

```json
{
  "type": "violation",
  "data": {
    "id": "uuid",
    "attempt_id": "uuid",
    "type": "tab_switch",
    "severity": "medium",
    "metadata_json": {},
    "occurred_at": "2026-09-16T08:00:00Z",
    "created_at": "2026-09-16T08:00:00Z"
  }
}
```

```json
{
  "type": "detection_event",
  "data": {
    "id": "uuid",
    "proctoring_session_id": "uuid",
    "attempt_id": "uuid",
    "event_type": "face_not_detected",
    "confidence_score": 0.91,
    "severity": "medium",
    "snapshot_url": null,
    "metadata_json": {},
    "occurred_at": "2026-09-16T08:00:00Z"
  }
}
```

Client có thể gửi `{ "type": "ping" }`. Server có thể gửi `presence` hoặc lỗi chuẩn `{ "type": "error", "error": { "code", "message", "details" } }`.

`schema.sql` không định nghĩa bảng riêng cho WebSocket message/presence, vì vậy `presence` được để mở rộng; violation và detection event dùng đúng field của `violation_logs` và `detection_events`.


## Profile verification requests (0011)

- `GET /identity/profile-verification/status`: student active, trả `{data: {identity_profile_status, verification_request_status, verification_requested_at, verification_rejection_reason}}` của chính user. Request status: NOT_REQUESTED/PENDING/REJECTED; profile status: PENDING/VERIFIED.
- `POST /identity/profile-verification/request`: student active, profile PENDING; body rỗng hoặc không body. Không nhận student_id. Gửi lặp khi đang chờ trả trạng thái cũ, không tạo request/thông báo mới.
- `GET /users/profile-verification/requests`: admin, query `status` mặc định PENDING (cũng hỗ trợ REJECTED/COMPLETED/CANCELLED), `student_id`, `page`, `limit` 1–100. Trả danh sách request kèm student profile và meta.total/page/limit.
- `POST /users/{id}/identity-profile/verify`: endpoint admin hiện có, vẫn nhận `{identity_profile_version}`; hoàn tất request đang chờ và tạo thông báo cho student cùng transaction.
- `POST /users/profile-verification/requests/{request_id}/reject`: admin, body `{identity_profile_version, rejection_reason}`. Reason 1–500 ký tự sau trim, không control characters. Stale version hoặc request đã xử lý: 409. Giữ profile PENDING.
- API notifications đọc/read/read-all/unread-count cho admin, teacher, student; luôn giới hạn recipient là authenticated user. Thêm type `profile_verification_request`, `profile_verification_result` và `related_student_id` nullable.

Chi tiết trạng thái, schema và kiểm thử: [PROFILE_VERIFICATION_REQUESTS.md](PROFILE_VERIFICATION_REQUESTS.md).
