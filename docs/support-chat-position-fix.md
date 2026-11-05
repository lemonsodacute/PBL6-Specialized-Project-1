# Cố định launcher “Tin nhắn hỗ trợ”

## Nguyên nhân

Launcher đã có `position: fixed`, nhưng `useFloatingChatPosition` lắng nghe scroll và liên tục tính lại `--support-chat-obstacle-offset` để né các action trong trang. Khi các nút đi qua góc dưới bên phải trong lúc cuộn, hook đẩy launcher lên hoặc hạ xuống. Tooltip nằm trong launcher nên cũng di chuyển theo.

## Thay đổi

- `components/ui/AIChatbox.tsx`: đưa launcher và drawer vào một portal tới `document.body`, sau khi client mount; không để transform, contain hoặc vùng cuộn của AppShell làm containing block cho launcher. Giữ nguyên handler, route quản trị viên, số chưa đọc và focus khi đóng.
- `components/ui/SupportChatButton.module.css`: giữ `position: fixed`, khoảng cách phải/đáy 24px trên desktop, 16px trên mobile, cộng safe-area inset. Bỏ offset theo nội dung trang và chuyển động transform khi hover/nhấn launcher. Tooltip vẫn là con của nút; giữ z-index chung `--z-floating`, dưới menu, navigation drawer và dialog.
- Xóa `components/ui/useFloatingChatPosition.ts` vì không còn sử dụng. Không còn listener/observer đo các action để thay đổi vị trí launcher khi cuộn.
- `tests/e2e/support-chat-position.spec.ts`: thêm kiểm tra hồi quy cho Teacher, Student, Admin ở 1440, 390 và 320px.
- `tests/e2e/collapsible-sidebar.spec.ts`: cập nhật comment cũ về cơ chế né va chạm đã bỏ; không thay đổi assertion.

Không sửa chat provider, API, backend, unread logic hoặc dữ liệu thật. Các điều kiện ẩn launcher trên trang thi, xác minh, lớp học trực tuyến và hộp thư Admin được giữ nguyên.

## Kiểm chứng

- TypeScript `tsc --noEmit`: **PASS**, exit 0 (`artifacts/support-chat-position-fix/typecheck-final.log`).
- Lint các file TS/TSX sửa trong nhiệm vụ: **PASS**, không có lỗi/cảnh báo ESLint (`lint-final.log`). Có thông báo deprecation của lệnh `next lint`.
- Production build: **PASS**, exit 0 (`build.log`). Vẫn có các cảnh báo React Hook hiện có trong file ngoài phạm vi sửa. Build dùng `.next-recovery-support-chat-position`; khôi phục nguyên byte `tsconfig.json` và `next-env.d.ts` sau khi Next chạy.
- Playwright trên bản production, Edge: **9/9 PASS**, exit 0, khoảng 1,3 phút (`e2e.log`). Ma trận Teacher / Student / Admin × 1440 / 390 / 320px, dùng normal motion để kiểm tra cả trạng thái hover. Không có lỗi JavaScript trên các trang được kiểm tra.

Kiểm tra trình duyệt dùng fixture UI: đưa một action đi qua vị trí launcher khi scroll; cuộn ngược, cuộn vùng con, thêm transform/contain vào AppShell; so sánh chính xác bounding box, khoảng cách đáy/phải, vị trí tooltip, tràn ngang và vị trí sau chuyển route. Trên desktop còn kiểm tra badge chưa đọc, mở/đóng, Escape, focus trả về launcher và điều hướng Admin tới hộp thư.

Các route đại diện: `/teacher/help`, `/dashboard/classes`, `/student/help`, `/student/classes`, `/admin/help`, `/dashboard/users` và điều hướng tới `/admin/messages`. Kiểm tra vùng nội dung không đổi kích thước/vị trí khi hiện tooltip. Ảnh viewport cho cả 9 cấu hình lưu dưới `artifacts/support-chat-position-fix/e2e/`; đã xem trực quan ảnh Teacher 1440px sau khi scroll.

Lệnh E2E:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://localhost:3107'
$env:PLAYWRIGHT_CHANNEL='msedge'
node node_modules/@playwright/test/cli.js test tests/e2e/support-chat-position.spec.ts --max-failures=1 --output=artifacts/support-chat-position-fix/e2e
```

Server production kiểm tra ở cổng 3107 đã được dừng sau khi test xong; server dev ở cổng 3000 không bị thay thế.

Không chạy bài tích hợp support chat với PostgreSQL/WebSocket thật vì nhiệm vụ chỉ thay đổi vị trí hiển thị.
