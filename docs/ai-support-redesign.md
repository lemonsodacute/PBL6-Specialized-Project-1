# AI Support: giao diện hai tab theo tham chiếu

Ngày thực hiện: 28/10/2026. Báo cáo này ghi nhận lượt cập nhật sau `ai-support-interface.md`.

## Tham chiếu và phạm vi

`artifacts/ai-support-redesign/reference.html` chưa tồn tại lúc bắt đầu. Đã phục hồi nguyên HTML từ tệp người dùng đính kèm ở yêu cầu trước (`527b2b71-0c5f-4012-9474-9ce788dd1fc1/Pasted text.txt`), thông báo trong phiên làm việc, mở file bằng Edge/Playwright và kiểm tra ảnh render. Không đưa dữ liệu minh họa của HTML vào component sản phẩm.

Chỉ thay đổi lớp hiển thị. Route hai tab, bộ lọc và giá trị query, debounce tìm kiếm, API, cấu trúc POST/PUT, CSV, công thức chỉ số, auth và các lựa chọn vai trò hiện có được giữ nguyên. Không sửa backend, database, storage key, env, package/dependency hoặc font. Sidebar, topbar và AppShell không được sửa trong lượt này.

## Giao diện

- Token light/dark trong `app/tokens.css`: nền, thẻ, chữ, focus và bảng màu tag. Banner dùng ba điểm màu #006D77 → #0A9396 → #5B5BD6.
- Hoạt động AI: bốn KPI với icon và vạch màu, nhãn “Lượt tạo câu hỏi” hiển thị số lượt thực; giữ các chi tiết tỷ lệ, tình trạng dịch vụ, lỗi/thử lại và xuất CSV. Các hàng kết quả hỗ trợ có màu riêng và nhãn/số liệu.
- Nguồn hoạt động hiện chỉ có số liệu tổng hợp. Theo lựa chọn rõ ràng của người dùng, khu vực theo ngày hiển thị thông báo thiếu dữ liệu cùng mốc ngày của khoảng đã áp dụng. Không tự tạo chuỗi ngày, cột hay giá trị 0. Phân bố tổng hợp hiện có vẫn xem được trong phần mở rộng.
- Kho tri thức: nút tạo ở hàng tiêu đề dưới tab, nhãn bộ lọc tiếng Việt, thẻ có viền/icon theo danh mục, chip vai trò/danh mục/trạng thái và dòng cập nhật từ dữ liệu hiện có.
- `lib/tagColors.ts` là nguồn ánh xạ chung. Student/tím, Teacher/teal, Admin/đỏ; Thẻ sinh viên/cam; Active/xanh lá, Inactive/xám. Tag khác được chuẩn hóa tên và hash ổn định vào năm màu. Không phụ thuộc ID/thứ tự bài. Chú giải có chữ; màu chữ chip dùng biến ink để bảo đảm tương phản trên nền nhạt/tối. Admin trong chú giải là nhãn màu, không thêm vai trò vào API hoặc bộ lọc.
- Tab có `tablist`/`tab`/`tabpanel`, `aria-selected`, liên kết panel và focus rõ. Mũi tên/Home/End chuyển focus; Enter/Space mở route hiện có. Vùng chạm chính tối thiểu 44px; KPI 4 → 2 → 1 cột, trường nhập và chip xuống hàng trên màn hình hẹp. Tôn trọng reduced motion.

## File của lượt cập nhật

File sản phẩm:

1. `app/tokens.css`
2. `app/admin/ai-support/knowledge/page.tsx`
3. `components/admin/AIActivityDashboard.tsx`
4. `components/admin/AIActivityDashboard.module.css`
5. `components/admin/AISupportPage.module.css`
6. `components/admin/AISupportTabs.tsx`
7. `components/admin/AISupportTabs.module.css`
8. `components/admin/KnowledgePage.module.css`
9. `lib/tagColors.ts` (mới)

Kiểm thử: `tests/e2e/ai-activity.spec.ts`, `tests/e2e/ai-support-design.spec.ts`. Không thay đổi hành vi kiểm thử CRUD, lỗi, CSV hay phân quyền để phù hợp với giao diện.

`AISupportHeader.tsx` đã được kiểm tra và tái sử dụng, không cần sửa trong lượt này. Các thay đổi khác đang có sẵn trong working tree thuộc công việc trước đó.

## Ảnh và dữ liệu kiểm chứng

Thư mục `artifacts/ai-support-redesign/` chứa:

- `reference.html`, ảnh `reference-{1440,390}-{light,dark}.png`: HTML tham chiếu được mở trong trình duyệt. Bản tham chiếu là HTML tĩnh, không có theme tối riêng.
- `before-{activity,knowledge}-{1440,390}-{light,dark}.png`: 8 ảnh trước khi sửa.
- `after-{activity,knowledge}-{1440,390}-{light,dark}.png`: 8 ảnh sau khi sửa.
- `capture.cjs`: công cụ chụp lại; dùng fixture API của bộ e2e cho dữ liệu nhất quán, không ghi fixture vào sản phẩm. Ảnh light/dark của sản phẩm dùng theme thật và font local.

Các log kiểm tra và ảnh của ca API thật được lưu riêng trong cùng thư mục. Token tài khoản kiểm tra nằm ở fixture riêng được Git bỏ qua, không có trong báo cáo.

## Giới hạn

Không có biểu đồ cột dữ liệu theo ngày vì API hiện tại không trả chuỗi ngày; đây là cách xử lý được người dùng chấp thuận. Không thay đổi API để tạo dữ liệu mới.

Kiểm tra bằng trình duyệt không thay thế đánh giá thủ công với mọi công nghệ hỗ trợ. Bộ e2e liên quan hai tab được chạy; không tuyên bố đã chạy toàn bộ e2e của dự án.

## Kết quả kiểm chứng

- TypeScript: `tsc --noEmit --incremental false`, exit 0 (`typescript.log`).
- Lint toàn dự án: `npm run lint`, exit 0 (`lint.log`); còn cảnh báo ở các file ngoài phạm vi. ESLint riêng các file TS/TSX thay đổi với `--max-warnings 0`: exit 0 (`lint-changed.log`).
- Production: `next build`, exit 0, sinh 42/42 trang (`build.log`). Dùng thư mục build riêng `.next-recovery-ai-support-redesign` để không ghi đè dev server; `tsconfig.json` và `next-env.d.ts` được khôi phục nguyên trạng trước build.
- E2E: 32 ca riêng biệt đạt qua các lượt chạy, gồm 31 ca fixture và 1 ca đọc API thật. Cả hai tab được kiểm tra ở 320/390/768/1024/1440px với light/dark, gồm lọc từ khóa/vai trò/danh mục/trạng thái, màu chip theo tag qua đổi thứ tự/lọc, bàn phím, route, CRUD contract, CSV, lỗi và kiểm soát truy cập.
- Lượt đầu (`e2e.log`): 27 đạt, 2 lỗi, 1 bỏ qua có điều kiện. Ca chuyển tab gặp timeout trên dev server; ca bàn phím thiếu fixture API hoạt động lúc chuyển trang. Bổ sung fixture; hai ca chạy lại đều đạt (`e2e-followup.log`). Không sửa logic sản phẩm để bỏ qua lỗi. Lượt bổ sung (`e2e-completion.log`): 4 đạt, gồm mốc ngày theo bộ lọc, Kho tri thức 1024px light/dark và API thật. Ca API thật được bật và chạy riêng, không tính ca đã bỏ qua là PASS.
- API thật: dùng tài khoản Admin đang tồn tại để đọc hai endpoint hiện có; không tạo tài khoản hoặc lưu bài viết. Đối chiếu fingerprint nội dung/trạng thái/thời gian cập nhật bài và số lượng tài khoản sau kiểm tra: không đổi.
- Tương phản chữ chip trên nền chip light/dark đo từ token: tối thiểu 4,55:1 (`tag-contrast.json`). Đây là đo các cặp màu token, không phải tuyên bố đã audit WCAG toàn trang.
