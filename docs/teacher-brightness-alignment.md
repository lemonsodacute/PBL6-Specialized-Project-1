# Đồng bộ độ sáng Teacher với Tổng quan

Ngày: 29/10/2026. Phạm vi: Ngân hàng câu hỏi, Lớp học, Lớp học trực tuyến. Tổng quan hiện tại là mẫu chuẩn và được giữ nguyên.

## Chỗ lệch và thay đổi

Nền trang và card vốn đã dùng chung token với Tổng quan. Phần tạo cảm giác nặng màu là gradient hero phủ mint, viền riêng của hero/thống kê và các nền nhấn. Hai CSS module còn dùng shadow riêng và khai báo màu ô nhập không cùng nguồn.

Đã chỉnh đúng ba file CSS sản phẩm, không sửa JSX/TypeScript nghiệp vụ:

- `app/tokens.css`: hero lấy surface trắng của Tổng quan, chuyển nhẹ sang surface phụ ở mép; tiêu đề dùng cùng ink, mô tả dùng đúng token chữ phụ trên card Tổng quan. Viền hero/thống kê dùng cùng border card. Nền chip/avatar/ô ngày là accent teal pha 6% trên surface trắng. Shadow dùng lại token của KPI/biểu đồ Tổng quan.
- `app/dashboard/question-banks/QuestionBanks.module.css`: dùng chung nền nhấn, màu trường nhập, border control và shadow. Không đổi ảnh bìa, minh họa owl, grid, kích thước hoặc nội dung.
- `components/teacher/TeachingCollection.module.css`: dùng cùng shadow và border control cho hai trang Lớp học; chip, avatar và ô ngày kế thừa token nền nhấn đã làm nhẹ.

Nền trang `#f2f7f6`, card trắng, border card `#d3e5e2`, ink `#17343c` và nền trường `#f8fbfb` giữ nguyên theo hệ Tổng quan. Không đổi màu sidebar/topbar, accent/CTA teal hoặc màu ngữ nghĩa của các nút Bắt đầu/Kết thúc và chip trạng thái. Dark mode giữ các token hero/ink/stat có sẵn; không áp màu trắng của light mode sang dark mode.

Không đổi route, API, dữ liệu, logic, filter, button action, role, auth hay backend. Không thêm dependency/font. Các thay đổi có sẵn khác trong workspace được giữ nguyên.

## Kiểm tra

- TypeScript `tsc --noEmit`: **PASS** (`artifacts/teacher-brightness/typecheck.log`).
- Lint test mới: **PASS**, không warning/error (`lint.log`).
- **13 ca E2E riêng biệt đã đạt qua hai lần chạy**: 6 hồi quy chức năng có sẵn, 5 ca light mode ở 320/390/768/1024/1440px và 2 ca dark mode ở 390/1440px. Mỗi ca màu đối chiếu cả bốn trang với Tổng quan hiện tại, kiểm tra surface/border/ink/shadow, tương phản và overflow.
- Lần đầu có 8 ca đạt và 5 ca light phát hiện token mô tả hero lệch nhẹ so với chữ phụ trên card Tổng quan. Đã sửa token gốc và chạy lại đủ 5 ca light, đạt cả 5. Không mô tả đây là một lần chạy sạch 13/13. Logs: `e2e.log`, `e2e-light-final.log`.
- Hồi quy giữ hành vi tìm kiếm/sắp xếp ngân hàng; tìm kiếm/sắp xếp lớp; lọc trạng thái/lớp/lịch buổi học; xác nhận Bắt đầu/Kết thúc; tạo buổi học, payload và xử lý lỗi. Test dùng fixture API, không ghi dữ liệu thật.
- Production build: **PASS**, Next.js 15.5.28, 42/42 trang tĩnh (`build.log`). Dùng output riêng `.next-recovery-teacher-brightness`; khôi phục nguyên byte `tsconfig.json` và `next-env.d.ts` sau build. Build còn cảnh báo hook có sẵn ở các file ngoài phạm vi sửa; không phát sinh lỗi mới.

Skill `ui-ux-pro-max` được dùng để rà contrast, surface và responsive. Tra cứu stack cục bộ không có kết quả phù hợp cho màu surface; áp dụng Quick Reference và token/giá trị CSS thực tế của trang Tổng quan, không đưa một bảng màu mới vào dự án.

## Ảnh và đối chiếu

`artifacts/teacher-brightness/` có ảnh trước/sau của cả bốn trang ở 1440 và 390px, light/dark. [Mở bảng so sánh ảnh](../artifacts/teacher-brightness/comparison.html), hoặc xem [Ngân hàng câu hỏi sau sửa](../artifacts/teacher-brightness/after-banks-1440-light.png), [Lớp học sau sửa](../artifacts/teacher-brightness/after-classes-1440-light.png), [Lớp học trực tuyến mobile](../artifacts/teacher-brightness/after-live-390-light.png).

`before.json`, `after.json` và `comparison.json` lưu màu CSS, nội dung, kích thước và vị trí các khối. Script `compare.py` kiểm tra baseline Tổng quan, sidebar/topbar, nội dung và geometry không thay đổi; card và nền trang dùng cùng hệ màu với Tổng quan. Bộ ảnh cuối được chụp riêng sau kiểm thử để tránh timeout screenshot khi chạy nhiều browser đồng thời.

Đối chiếu cuối: **PASS, 16/16 lượt xem**; nền/card/border/ink khớp hệ Tổng quan, baseline Tổng quan và layout/nội dung/navigation không đổi, không overflow. Có **32 ảnh** trước/sau. Đã xem trực tiếp bốn trang desktop light, mobile light của Lớp học trực tuyến và desktop dark của Lớp học.

File kiểm chứng mới: `tests/e2e/teacher-brightness.spec.ts`. Không sửa các test nghiệp vụ hiện có. Không chạy toàn bộ suite backend/e2e; các kết quả contrast chỉ áp dụng cho những cặp màu có assertion, không phải đánh giá WCAG toàn sản phẩm.
