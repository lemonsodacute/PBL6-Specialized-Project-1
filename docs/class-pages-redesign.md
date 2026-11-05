# Thiết kế trang Lớp học và Lớp học trực tuyến

Ngày thực hiện: 28/10/2026.

## Phạm vi và giao diện

Áp dụng hai HTML tham chiếu người dùng cung cấp cho `/dashboard/classes` và `/dashboard/live-classes`: banner teal, minh họa cú, thẻ thống kê, bộ lọc và danh sách thẻ ngang. Đã mở hai HTML bằng trình duyệt và lưu ảnh tham chiếu trong `artifacts/class-pages-redesign/`.

- Giữ cấu trúc AppShell/topbar/sidebar. CSS chỉ đổi nền sidebar và vùng nội dung khi hai trang này hiện diện.
- Tách SVG tĩnh từ mẫu thành sáu asset local; không thêm dependency/font. Dùng Nunito đã có qua cấu hình `next/font` của dự án.
- Card lớp có minh họa theo tên chủ đề, thông tin giảng viên, sĩ số và liên kết mở lớp cũ.
- Card buổi học có ngày, tên lớp, thời gian, giảng viên, trạng thái bằng chữ và nút tương ứng. Giữ đủ scheduled/ongoing/ended/cancelled.
- Responsive 320–1440px, light/dark, focus-visible, hỗ trợ reduced motion. Minh họa trang trí có alt rỗng.

## Dữ liệu và hành vi

Không đổi API, auth, route, backend, database, bộ lọc server, khóa storage hoặc nghiệp vụ. `ClassCollection` chỉ rẽ nhánh trình bày cho teacher; giữ JSX admin/student. Trang trực tuyến giữ nguyên polling 10 giây, khóa chống thao tác lặp, tạo buổi học, kiểm tra thời gian, chuyển vào phòng, bắt đầu/kết thúc và hộp xác nhận.

Số liệu banner lấy từ response hiện có. Tổng sinh viên là tổng **lượt ghi danh trong các lớp**, không tuyên bố là số người duy nhất. Khi response có nhiều trang, số liệu cộng từ trang hiện tại được ghi rõ “trên trang”. Không thêm request thống kê. Không đưa số liệu hoặc học kỳ mẫu vào sản phẩm: chip học kỳ chỉ hiện nếu có chuỗi HK trong tên lớp thật. Dữ liệu minh họa e2e nằm riêng trong test fixture.

## File thay đổi trong lượt này

| File | Thay đổi |
|---|---|
| `components/classes/ClassCollection.tsx` | Dùng giao diện mới cho teacher; export kiểu dữ liệu có sẵn. |
| `components/classes/TeacherClassList.tsx` | Banner, tìm kiếm/sắp xếp, thẻ lớp và số liệu. |
| `app/dashboard/live-classes/page.tsx` | Thay bảng bằng thẻ lịch học và thêm banner. |
| `components/teacher/TeachingCollectionHeader.tsx` | Header, nhận diện giảng viên và chọn minh họa dùng chung. |
| `components/teacher/TeachingCollection.module.css` | Màu, spacing, bố cục responsive/light/dark/focus/reduced motion. |
| `public/illustrations/classes/{classes-hero,live-hero,software,web,code,ai}.svg` | Sáu minh họa tĩnh lấy từ mẫu. |
| `tests/e2e/class-pages-design-fixture.ts` | API/session giả lập riêng cho kiểm chứng UI. |
| `tests/e2e/class-pages-design.spec.ts` | 15 ca e2e kiểm chứng giao diện và hành vi. |
| `docs/class-pages-redesign.md` | Báo cáo này. |

Các thay đổi khác vốn có trong workspace không thuộc lượt này. Bản sao hai source cũ được lưu trong thư mục artifact để đối chiếu, đặc biệt trang live-classes đã có thay đổi trước lượt này.

## Kiểm chứng đã chạy

- `tsc --noEmit`: exit 0; log `typecheck.log`.
- `next lint` toàn dự án: exit 0, còn các warning có sẵn; log `lint.log`.
- Lint các file TS/TSX của lượt này: exit 0; warning `useEffect` thiếu dependency `load` nằm ở polling cũ không sửa; log `lint-focused.log`.
- `class-pages-design.spec.ts`: **15/15 PASS**, Edge, API giả lập; log `e2e.log`.
  - Cả hai trang ở 320/390/768/1024/1440px × light/dark: số liệu, SVG tải được, liên kết lớp, nút theo trạng thái, giảm chuyển động, không tràn ngang; form tạo buổi học vừa màn hình mobile.
  - Từ khóa/sắp xếp lớp; lọc từ khóa/trạng thái/lớp/sắp xếp buổi học; tham số API; trạng thái rỗng và lỗi/tải lại.
  - Bắt đầu, hủy xác nhận kết thúc, xử lý lỗi rồi thử lại; validation tạo buổi học và payload thời gian theo logic hiện có.
- Test hiện có `collections.spec.ts --grep "admin class table"`: **1/1 PASS**, không sửa test; log `e2e-admin-regression.log`.
- Build production: **PASS** ở lần chạy lại không đổi code/cấu hình font; log `build.log`. Lần đầu lỗi tạm thời khi bộ nạp `next/font` xử lý phản hồi Google Fonts, giữ log `build-first-attempt.log`. Dùng output riêng `.next-recovery-class-pages-redesign` để không ảnh hưởng dev server.

## Ảnh và giới hạn kiểm chứng

Trong `artifacts/class-pages-redesign/` có 8 ảnh trước và 8 ảnh sau:

`{before,after}-{classes,live}-{1440,390}-{light,dark}.png`

Có thêm `reference-{classes,live}.html/.png`, template đã tách và script tái chụp `capture.cjs`. Ảnh/test dùng dữ liệu giả lập; sản phẩm vẫn đọc API hiện có. Đã xem trực tiếp ảnh desktop light của cả hai trang và mobile dark của trang trực tuyến.

Không thực hiện thao tác tạo/bắt đầu/kết thúc trên dữ liệu thật và không kiểm thử media/WebRTC trong lượt UI này. Không chạy toàn bộ e2e/backend suite; chưa có ca e2e riêng cho nhánh student hoặc bộ đếm ở danh sách nhiều trang. Các đoạn nghiệp vụ live-class và JSX nhánh student được giữ nguyên.
