# Đồng bộ màu Khu vực giảng dạy với Tổng quan

## Nguyên nhân và thay đổi

Hai CSS module của Ngân hàng câu hỏi và danh sách Lớp học / Lớp học trực tuyến dùng `:has(.page)` để đổi màu sidebar của toàn bộ AppShell. Chúng ghi đè màu teal chung `#006D77` bằng `#0A3E47` hoặc `#083E48`, khiến sidebar đổi màu khi chuyển trang.

Đã bỏ các khai báo sidebar riêng trong cả light và dark mode. Sidebar lấy màu từ AppShell như Tổng quan: `--color-primary` ở light mode, `--dark-sidebar` ở dark mode. Không thêm màu ghi đè mới cho từng route.

Nền trang, surface, border và chữ tiếp tục dùng hệ token Teacher hiện có: nền `#F2F7F6`, card `#FFFFFF`, border `#D3E5E2`, chữ chính `#17343C` trong light mode. Giữ nguyên màu trạng thái, hình minh họa, bố cục, nội dung và chức năng.

## File thay đổi trong nhiệm vụ này

- `app/dashboard/question-banks/QuestionBanks.module.css`: bỏ hai ghi đè màu sidebar.
- `components/teacher/TeachingCollection.module.css`: bỏ hai ghi đè màu sidebar.
- `tests/e2e/teacher-color-consistency.spec.ts`: đối chiếu sidebar, chữ navigation, topbar và token nền / surface / border / chữ của từng route với Tổng quan; cô lập WebSocket của phiên test và chờ DOM thay vì network idle.
- Báo cáo này; ảnh và log tại `artifacts/teacher-theme-unification/`.

## Kiểm chứng

- TypeScript: `tsc --noEmit` **PASS**, exit 0; log `typecheck-final.log`.
- Lint file test đã sửa: **PASS**, không có lỗi/cảnh báo ESLint; log `lint-final.log`. Next có thông báo lệnh `next lint` sẽ bị loại bỏ trong phiên bản sau.
- Production build: **PASS**, exit 0; log `build.log`. Build vẫn có các cảnh báo React Hook trong những file không sửa ở nhiệm vụ này. Build dùng thư mục `.next-recovery-teacher-theme-unification`; khôi phục nguyên byte `tsconfig.json` và `next-env.d.ts` sau khi Next chạy.
- Playwright trên bản production tại cổng 3107: **3/3 PASS**, 15 route × 3 cấu hình = 45 lượt kiểm tra trang; log `e2e-production.log`. Gồm 390px light, 1440px light, 1440px dark; kiểm tra palette so với Tổng quan, contrast, tràn ngang, CTA và hero.
- Lượt chạy dev đầu bị dừng khi chờ network idle. Sau khi chỉnh cách chờ, mobile đạt nhưng desktop light vượt timeout khi còn ở trạng thái “Đang tải”; đã dừng lượt dev còn lại và chạy lại cả ba bài trên production. Không coi các lượt dev bị dừng/timeout là PASS.

Các bài kiểm tra trình duyệt dùng dữ liệu fixture, không sửa dữ liệu thật. Lệnh chạy cuối:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://localhost:3107'
$env:PLAYWRIGHT_CHANNEL='msedge'
node node_modules/@playwright/test/cli.js test tests/e2e/teacher-color-consistency.spec.ts --grep 'teacher surfaces (1440px (light|dark)|390px light)' --output=artifacts/teacher-theme-unification/e2e-production
```

Ảnh đối chiếu sidebar light mode 1440 đã có cho Tổng quan, Ngân hàng câu hỏi, Lớp học và Lớp học trực tuyến, với tiền tố `before-` / `after-`. Đã xem trực quan ảnh sau sửa của Tổng quan và Lớp học. Lượt chụp ban đầu chưa hoàn tất dark mode; một số ảnh trước sửa không vẽ đầy đủ phần nội dung chính, nên không xem đây là một ma trận ảnh trước/sau đầy đủ.

Không chạy lại các cấu hình 768px, 1024px, 390px dark, hai bài chức năng khác trong cùng file, hay toàn bộ bộ test backend trong nhiệm vụ chỉ sửa CSS này. Không thay đổi backend, route, dữ liệu, auth, business logic hoặc sidebar của Student/Admin bằng quy tắc mới.
