# AI PROCTO — Trang chủ public

Đã thêm trang chủ tại `/` cho người chưa đăng nhập, theo Modern Academic và brand xanh ngọc **#006D77**.

## Nội dung và giao diện

- Header sticky: logo hiện có, điều hướng trong trang, CTA đăng nhập/đăng ký và menu mobile hỗ trợ bàn phím.
- Hero ngắn gọn với minh họa quy trình thi bằng HTML/CSS. Minh họa được ghi nhãn rõ ràng, không chứa số liệu người dùng, kết quả hoặc phiên thi giả.
- Sáu nhóm chức năng thực tế, ba vai trò, bốn bước sử dụng, AI hỗ trợ, phân quyền/xác minh/nhật ký, FAQ public, CTA cuối và footer.
- CSS riêng cho trang public, dùng token của giao diện hiện tại; hỗ trợ light/dark, mobile và tablet.
- Metadata riêng: **AI PROCTO - Hệ thống thi trực tuyến**, cùng mô tả theo yêu cầu.
- Nội dung chính được render ở server và vẫn đọc được khi tắt JavaScript.

## Routing

| Trạng thái khi mở `/` | Kết quả |
| --- | --- |
| Chưa đăng nhập | Hiện trang chủ public |
| Student đã đăng nhập | `/student` |
| Teacher đã đăng nhập | `/dashboard` |
| Admin đã đăng nhập | `/admin` |
| Phiên đã lưu hết hiệu lực | AuthProvider xử lý như hiện có, sau đó hiện trang chủ public |

CTA đăng nhập dùng `/login`. CTA đăng ký dùng `/login?mode=register`, chỉ chọn biểu mẫu đăng ký sẵn có. Không thêm auth flow hoặc truyền role từ homepage. Footer “Trợ giúp” dẫn đến FAQ public `#ho-tro`; không tạo link tới trang yêu cầu đăng nhập dưới tên trang trợ giúp public.

Khi khôi phục phiên đăng nhập có sẵn, trang public được ẩn trước khi hiển thị để tránh lóe landing page. Việc xác thực/khôi phục phiên vẫn do AuthProvider hiện tại xử lý.

## Phạm vi thay đổi

Ba file hiện có được chỉnh:

- `app/page.tsx`: nội dung và metadata trang public.
- `components/layout/AppShell.tsx`: xem `/` là route độc lập, không ép khách về login hoặc bọc bằng workspace.
- `app/login/page.tsx`: chọn mode đăng ký ban đầu theo URL.

Các component mới nằm trong `components/public`. Không đổi AuthContext, API client, middleware, dashboard, scoring, face verification, OCR, AI Support, question generation hoặc live class. Không thêm dependency.

## Kiểm tra

**46 ca kiểm tra đã đạt** trên Chrome:

| Nhóm | Số ca |
| --- | ---: |
| Trang chủ public: 320/360/390/430/768/1024/1440px × light/dark; không tràn ngang; menu/anchor/sticky/FAQ; metadata/SSR; CTA; ba vai trò; phiên hết hạn; bàn phím và tương phản CTA | 21 |
| Hồi quy đăng nhập, đăng ký, quên/reset mật khẩu, xử lý lỗi và shell/theme hiện có | 25 |

- Public homepage của khách không phát sinh request API, WebSocket hoặc yêu cầu camera/microphone trong các ca kiểm tra.
- CTA chính có nền `rgb(0, 109, 119)` và tương phản chữ tối thiểu 4.5:1 ở cả hai theme.
- `npm run build` và `npx tsc --noEmit` thành công.
- Log: `artifacts/public-homepage/build.log`, `typecheck.log`, `review.log`, `regression.log`.

Kiểm tra redirect/auth dùng API fixture, không phải kiểm thử tích hợp backend. Các ảnh được chụp từ production build local bằng Chrome. Bản xem trước nhúng IAB không khả dụng trong phiên này; ảnh local và kiểm tra trình duyệt tự động đã hoàn tất.

## Ảnh xem trước

- [Desktop](../artifacts/public-homepage/preview-desktop.png)
- [Mobile](../artifacts/public-homepage/preview-mobile.png)
- [Tablet](../artifacts/public-homepage/preview-tablet.png)
- [Dark mode](../artifacts/public-homepage/preview-dark.png)

Bản sao trước chỉnh sửa: `artifacts/public-homepage/before-public-homepage.zip`. Danh sách file và đối chiếu hash: `artifacts/public-homepage/changed-files.json`.
