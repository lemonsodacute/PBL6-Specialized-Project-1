# Notification Bell / trang thông báo

Cập nhật ngày 2026-10-12. Chỉ sửa frontend; giữ nguyên API, quyền theo người
dùng, notification preferences và business logic hiện có.

## Giao diện

- Một NotificationBell dùng chung cho Student, Teacher và Admin, kể cả layout
  riêng `/admin` và `/teacher`.
- Popover lấy 8 thông báo mới nhất bằng `page=1&limit=8`. Không có search,
  filter, page size, pagination hoặc tổng kết kết quả trong popover.
- Desktop rộng 400px, cao tối đa 520px và giới hạn theo viewport. Mobile chừa
  16px mỗi bên. Chỉ danh sách cuộn; header và link cuối luôn hiện.
- Icon, title, message, thời gian lấy từ API. Chưa đọc có nền nhẹ, dot teal và
  title đậm hơn. Loading có 3 skeleton; empty/lỗi có thông báo ngắn và retry.
- Portal vào body, đặt dưới chuông và căn phải theo viewport. Escape trả focus
  về chuông; Tab đi qua các action và đóng khi rời popover; click ngoài đóng.
- `/notifications` dùng shell hiện có theo role, với trạng thái đọc, loại,
  pagination, page size và đánh dấu tất cả. Không thêm search vì API hiện tại
  không hỗ trợ query tìm kiếm và không thể tìm đúng toàn bộ dữ liệu bằng một
  trang đã tải.

## Nguồn dữ liệu và đồng bộ

Các endpoint hiện có trong `backend/app/api/v1/notifications.py`:

| Endpoint | Mục đích |
| --- | --- |
| GET `/notifications` | Danh sách mới nhất, filter `is_read`/`type`, page/limit và meta |
| GET `/notifications/unread-count` | Badge thật, 0 ẩn, trên 99 hiển thị `99+` |
| PATCH `/notifications/{id}/read` | Đánh dấu một thông báo thuộc người dùng |
| PATCH `/notifications/read-all` | Đánh dấu toàn bộ theo quyền hiện tại |

`NotificationsProvider` chia sẻ badge và các thay đổi đọc giữa bell/trang đầy
đủ. Chỉ cập nhật UI sau PATCH thành công, sau đó đối chiếu lại với API. Request
cũ bị vô hiệu hóa khi đọc hoặc đổi tài khoản; không ghi đè trạng thái mới. Poll
15 giây và event cập nhật preferences giữ dữ liệu theo cấu hình hiện hành.
Lỗi API không có dữ liệu mock thay thế.

`lib/notifications.ts` dùng type và metadata `related_*`, không đoán URL từ
title. Hồ sơ/thẻ sinh viên mở profile/identity; Student attempt mở kết quả của
sinh viên; Teacher/Admin attempt mở giám sát; exam metadata mở báo cáo đối với
Teacher/Admin. Student exam-only mở danh sách đề hiện có vì project chưa có
route chi tiết đề dành cho Student. Thông báo không có target chỉ được đọc.

Thành phần chính: `NotificationBell.tsx`, `NotificationsProvider.tsx`,
`NotificationItem.tsx`, `Notifications.module.css`, `app/notifications/page.tsx`
và `lib/notifications.ts`. Không tạo endpoint mới hoặc sửa backend.

## Kiểm chứng

- Full TypeScript: `npx tsc --noEmit --incremental false --pretty false` đạt.
- 20 Playwright case mới: ba role × mobile/tablet/desktop, 320px dark,
  scroll/portal/focus, badge, metadata navigation, loading/empty/error/retry,
  read-all, phản hồi trễ và full-page filter/pagination/page size.
- 9 Playwright case hồi quy đạt: viewport/keyboard, collections và các link
  xác minh hồ sơ/thẻ sinh viên.
- Browser dùng API/database thật: Student 2, Teacher 2, Admin 3 thông báo;
  badge 0 ở cả ba tài khoản trong snapshot này. Tiêu đề và tổng số khớp DB;
  không có lỗi JavaScript. Kiểm tra này chỉ đọc, không gửi PATCH notification.
  Các số này là snapshot local, không được hard-code trong sản phẩm.
- Đã xem ảnh chụp mobile dữ liệu thật và 320px dark. Log, script kiểm chứng và
  screenshot đặt trong thư mục TEMP, không đưa token/identity vào tài liệu.

Các kiểm thử dùng fixture chỉ để kiểm tra trạng thái lỗi/race/pagination; code
sản phẩm luôn gọi API hiện có.
