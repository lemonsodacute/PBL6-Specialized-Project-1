# Khôi phục frontend khi cache Next.js bị mất

Thông báo `missing required error components, refreshing...` có thể xuất hiện khi dev server đang chạy nhưng các bundle/manifest trên ổ đĩa đã bị xóa hoặc thay thế. Trong lần kiểm tra này, cả manifest App Router và Pages Router đều rỗng; server báo thiếu `.next/server/app/student/page.js`, các asset `/_next/` trả 404. Các file `app/error.tsx`, `app/global-error.tsx` và `app/not-found.tsx` vẫn tồn tại.

`next.config.mjs` tách thư mục đầu ra theo chế độ:

- `npm run dev`: `.next-dev/`.
- `npm run build` và `npm run start`: `.next/`.

Không xóa hoặc di chuyển `.next-dev/` khi dev server đang chạy. Nếu cần làm mới cache, dừng đúng frontend process trước, kiểm tra đường dẫn cache nằm trong workspace, rồi đổi tên thư mục cache và chạy lại `npm run dev`. Không cần thay đổi backend hay dữ liệu tài khoản.

Cache lỗi trong lần khôi phục này được giữ lại ở `.next-recovery-20261012-005110/`. Các thư mục đầu ra và bản cache khôi phục được bỏ qua trong `.gitignore`.
