# Thiết kế lại Ngân hàng câu hỏi

Tham chiếu: ảnh người dùng `D:/Download/Ngân hàng câu hỏi@1x.png`, bản sao trong `artifacts/question-bank-redesign/reference.png`.

## Thay đổi

- Banner teal với tiêu đề, mô tả, ba chỉ số từ danh sách API và minh họa checklist/cú ProctoOwl. Tái sử dụng artwork cú đang có, không sửa nguồn mascot chung.
- Thanh tìm kiếm, sắp xếp và nút tạo gọn trên cùng một hàng desktop; xếp dọc ở mobile.
- Lưới thẻ 3/2/1 cột, ảnh bìa theo chủ đề, nhãn môn học thật nếu có, tiêu đề, mô tả, số câu hỏi, ngày cập nhật, nút mở/thêm câu hỏi và menu thao tác.
- Sáu minh họa SVG được vẽ riêng theo phong cách ảnh tham chiếu: kiểm thử, kiến trúc/Git, Web, JavaScript/API, mạng, dự án. Không có yêu cầu mạng đến kho ảnh bên ngoài. Ba bìa đầu tải ngay; các bìa còn lại dùng native lazy loading. Bìa có kích thước cố định để không gây nhảy layout.
- Bìa chọn từ tên/môn học, trường hợp chưa phân loại dùng hash ID ổn định. Không thay bìa vì đổi thứ tự/sắp xếp.
- Màu light/dark, focus rõ, nút chính tối thiểu 44px, hỗ trợ reduced motion. Sidebar chỉ đổi màu riêng trên trang này để khớp mẫu; không thay cấu trúc AppShell hoặc topbar.

## Dữ liệu và hành vi giữ nguyên

Route `/dashboard/question-banks`, API list/create/PATCH/delete, query tìm kiếm/sắp xếp/phân trang, modal tạo/đổi tên và xác nhận xóa, auth, quyền và khóa storage không thay đổi. Không sửa backend, schema, dependency hay font.

Ảnh tham chiếu có học kỳ nhưng model hiện không có trường đó. Không thêm hoặc gán học kỳ giả: dùng `subject` có sẵn khi có dữ liệu. Tổng số ngân hàng lấy `meta.total`; số câu hỏi và cập nhật tính từ danh sách thực đang tải. Nếu có nhiều trang, nhãn nói rõ số câu hỏi/cập nhật chỉ thuộc trang hiện tại. Không hard-code 6 ngân hàng, 41 câu hoặc ngày mẫu vào sản phẩm.

## File

- `app/dashboard/question-banks/page.tsx`
- `app/dashboard/question-banks/QuestionBanks.module.css` (mới)
- `components/teacher/QuestionBankIllustrations.tsx` (mới)
- `public/illustrations/question-banks/{testing,architecture,web,api,network,project}.svg` (mới)
- `tests/e2e/question-bank-design-fixture.ts`, `tests/e2e/question-bank-design.spec.ts` (mới)
- Báo cáo này; ảnh và công cụ chụp trong `artifacts/question-bank-redesign/`.

Ảnh `before/after-{1440,390}-{light,dark}.png` dùng fixture e2e để so sánh nhất quán, không phải bản ghi hard-code trong ứng dụng. Đã mở ảnh render từ trình duyệt để kiểm tra desktop light và mobile dark.

## Kết quả kiểm chứng

- TypeScript `tsc --noEmit --incremental false`: exit 0 (`typescript.log`).
- ESLint các file TS/TSX thay đổi với `--max-warnings 0`: exit 0 (`lint-changed.log`).
- Build production: exit 0, 42/42 trang (`build.log`), gồm bước lint/typecheck của Next.js. Còn các cảnh báo có sẵn ngoài phạm vi. Dùng `.next-recovery-question-bank-redesign` riêng, khôi phục nguyên trạng cấu hình TypeScript sau build.
- Lượt e2e cuối: **13/13 đạt**, không bỏ qua (`e2e-final.log`). Gồm 10 cấu hình 320/390/768/1024/1440px light/dark, ảnh bìa tải thành công, chỉ số từ fixture, route, grid/no overflow, reduced motion; 1 ca tìm kiếm/sắp xếp/query/trạng thái rỗng; 2 ca hồi quy có sẵn cho tạo ngân hàng/câu hỏi, đổi tên và xóa. Hai ca hồi quy được chạy nguyên trạng trong `teacher-workspace.spec.ts`.
- Lượt đầu có lỗi kiểm chứng ảnh lazy chưa cuộn vào viewport, so sánh reduced-motion với literal `0s` trong khi CSS chung dùng `0.01ms`, và timeout dev server khi chạy cùng build. Đã sửa cách kiểm tra ảnh bằng cuộn thực, chấp nhận thời lượng reduced-motion dưới 1ms, và chạy lại toàn bộ 13 ca sau build với thời gian chờ test 90 giây (`--timeout=90000`). Không dùng click force, không bỏ qua assertion hoặc sửa nghiệp vụ để làm test đạt. Log lượt đầu được giữ ở `e2e.log`.
- Tổng sáu tệp SVG chỉ 5.853 byte; các hình có nền sẵn, không phụ thuộc dịch vụ ảnh hay font từ bên ngoài.

Chưa chạy toàn bộ e2e của dự án; không có thay đổi ở trang chi tiết ngân hàng, hệ thống tạo câu hỏi hay backend.
