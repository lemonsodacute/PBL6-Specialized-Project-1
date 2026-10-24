# Cài đặt và Trợ giúp

## Routes và giao diện

- `/student/settings`, `/student/help`
- `/teacher/settings`, `/teacher/help`
- `/admin/settings`, `/admin/help`

Các route dùng chung `components/settings/SettingsPage.tsx` và `HelpPage.tsx`,
nhận role và đối chiếu với tài khoản đã đăng nhập. Sidebar/layout hiện có được
giữ lại; các liên kết có active state theo pathname. Settings rộng tối đa
880px, hỗ trợ mobile và giao diện sáng/tối/theo hệ thống.

## Dữ liệu và quyền

Migration `0016_settings` tạo `user_settings` và bảng singleton
`system_settings`. Chạy `alembic upgrade head` từ thư mục backend trước khi
khởi động phiên bản này. Migration đã được áp dụng trên PostgreSQL local.

API dùng authentication hiện có:

| Endpoint | Quyền và dữ liệu |
| --- | --- |
| `GET /api/v1/settings/me` | Cài đặt của chính tài khoản đang đăng nhập |
| `PATCH /api/v1/settings/me` | Theme, các loại thông báo được phép; chỉ Teacher được lưu mặc định đề cá nhân |
| `GET /api/v1/settings/support` | Nội dung hỗ trợ chung; mọi tài khoản đã đăng nhập |
| `GET /api/v1/admin/settings` | Chỉ Admin |
| `PATCH /api/v1/admin/settings` | Chỉ Admin; mặc định đề và nội dung hỗ trợ |

Schema từ chối field lạ, giá trị sai kiểu và việc tắt thông báo bắt buộc.
Teacher/Student gọi endpoint Admin nhận 403. Không có API chỉnh threshold,
khóa AI, cấu hình OCR, secrets hoặc avatar trong phần này.

Mỗi section có trạng thái dirty, nút lưu disabled khi không thay đổi,
loading, lỗi và thử lại. Thành công chỉ hiển thị sau response PATCH.
Theme trong PostgreSQL là nguồn chính; cache localStorage theo user ID chỉ
giúp chọn màu trước khi API trả về. Theme theo hệ thống cập nhật theo OS.
Response cũ không được ghi đè theme vừa lưu hoặc theme của tài khoản mới.

## Mặc định đề thi

Ba giá trị thực sự được form tạo đề và API tạo đề sử dụng:
`exam_duration_minutes`, `exam_require_camera`, `exam_require_mic`.

Thứ tự: giá trị được chỉ định trong đề mới → mặc định cá nhân Teacher →
mặc định hệ thống. Mặc định ban đầu là 60 phút, camera và microphone bật,
giữ hành vi form tạo đề trước đây. Teacher có thể chọn kế thừa hệ thống;
PATCH các mặc định cá nhân bằng null để bỏ override. Đề đã tạo và điểm thi
không được cập nhật khi thay đổi cài đặt.

Admin cập nhật hệ thống tạo audit `SYSTEM_SETTINGS_UPDATED`, gồm actor,
timestamp và từng field có giá trị old/new. PATCH không thay đổi giá trị
không tạo thêm audit. Nội dung hỗ trợ đã lưu được trang Help của mọi role đọc.

## Thông báo

Chỉ hiển thị preference cho loại thông báo có producer thật:

- Teacher: cảnh báo giám sát và tổng kết kỳ thi.
- Admin: yêu cầu xác minh hồ sơ mới.
- Student: các thông báo hiện có về hồ sơ/thẻ là bắt buộc; không có toggle giả.

Preference được áp dụng đồng thời cho danh sách thông báo và số chưa đọc.
Thông báo tùy chọn bị tắt được ẩn, không xóa dữ liệu đã lưu; bật lại sẽ thấy
thông báo chưa đọc trước đó. Thông báo xác minh, thu hồi/yêu cầu cập nhật thẻ,
kết thúc bài thi và mọi thông báo mức độ high/critical luôn được giữ.

Không hiển thị email notification vì email service hiện chỉ giả lập ra
console; không hiển thị ngôn ngữ, device preference, nhắc lịch hoặc toggle
lớp học khi chưa có tính năng tiêu thụ preference đó. Không tạo setting
auto-submit vì cơ chế kết thúc bài hiện có không phải tùy chọn cá nhân.

## Trợ giúp

`lib/help-content.ts` chứa hướng dẫn và FAQ theo các route/flow hiện có,
không tạo dữ liệu người dùng giả. Tìm kiếm hỗ trợ từ khóa tiếng Việt không
dấu. Quick actions liên kết tới trang nghiệp vụ thật. Student Card Help mô
tả upload → preview OCR/face → xác nhận, không cho tự thay avatar đã xác thực.

Liên hệ hỗ trợ lấy từ PostgreSQL. Mặc định là “Liên hệ quản trị viên hệ thống
để được hỗ trợ.” Không thêm email giả, chatbot hoặc hệ thống ticket.

## Kiểm chứng

- `backend/tests/test_settings.py`: quyền, validation, lưu riêng từng user,
  partial update, kế thừa mặc định, form/API tạo đề, audit và lọc thông báo.
- `RUN_SETTINGS_POSTGRES_TESTS=1`: kiểm tra PATCH bằng session độc lập và đọc
  lại PostgreSQL thật trong schema test riêng, có cleanup; không sửa dữ liệu
  tài khoản/đề đang sử dụng.
- `tests/e2e/settings-help.spec.ts`: sidebar của ba role, lưu/reload theme,
  chờ API mới báo thành công, lỗi/retry, Teacher 90 phút → form đề mới,
  Admin defaults/support, tìm kiếm Help, mobile và dark theme.
- `tests/e2e/admin-navigation.spec.ts`: menu Admin đồng nhất và liên kết thật.
- Đã mở sáu route trên ứng dụng local bằng tài khoản thật với API không mock,
  kiểm tra nội dung hỗ trợ từ DB và chụp giao diện sáng/tối; không có lỗi trình
  duyệt. Kiểm tra này chỉ đọc, không đổi cài đặt người dùng thật.
