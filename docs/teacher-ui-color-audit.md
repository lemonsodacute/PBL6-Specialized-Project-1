# TEACHER UI COLOR CONSISTENCY AUDIT

Ngày: 28/10/2026. Phạm vi: giao diện giảng viên ProctoOwl.

## Kết quả audit trước khi sửa

Đã lập inventory 27 route file trong dashboard/teacher/live-class và quét 110 source/style file liên quan (bao gồm stylesheet mới). Inventory gồm cả alias, redirect cũ và các route quản trị dùng chung cây dashboard; không thay quyền truy cập. Đã đọc các component chính, style/token liên quan và chụp 15 route đại diện bằng Edge ở light/dark, 1440/390px trước khi sửa.

| Nhóm trang | Nhận xét trước khi sửa | Xử lý |
|---|---|---|
| Tổng quan | KPI/thẻ sáng phù hợp; màu chữ/nền dùng hệ token cũ khác nhóm danh sách mới. | Giữ bố cục, đồng bộ token vùng nội dung. |
| Ngân hàng câu hỏi | Banner teal đặc lớn, chữ trắng, số liệu đặt trong mảng tối; nặng hơn nhóm thẻ sáng. | **FIXED**: mint gradient, chữ teal đậm, số liệu trên thẻ sáng; thu gọn banner; giữ hình minh họa và nội dung. |
| Đề thi | Panel lọc có nền/viền lồng trong thẻ; ô nhập trắng khác nhóm trang mới. | **FIXED**: bỏ khung lọc lồng, nền trường và header bảng dùng token chung. Lưu thay đổi ở đề đã xuất bản dùng teal; xuất bản vẫn giữ màu ngữ nghĩa. |
| Giám sát | Thẻ và màu cảnh báo hợp lý; cần đồng bộ nền/viền/typography chung. | **FIXED** qua token; giữ viền xanh của kỳ thi đang mở, amber/red của mức cảnh báo và nền tối của vùng media. |
| Lớp học | Banner teal đặc tạo khối tối lớn trong light mode. | **FIXED**: dùng cùng hệ hero mint và thẻ số liệu sáng; giữ minh họa riêng. |
| Lớp học trực tuyến | Hero tối tương tự Lớp học; nút lưu form xanh lá khác primary CTA teal. | **FIXED**: hero nhẹ, nút lưu form teal; Bắt đầu vẫn xanh lá, Kết thúc vẫn đỏ. |
| Báo cáo | Bộ lọc lồng nhiều lớp nền/viền; màu ô nhập khác nhóm trang mới. | **FIXED**: đồng bộ filter/table/card qua token, giữ màu biểu đồ và chỉ số ngữ nghĩa. |
| Hồ sơ giảng viên | Thẻ sáng, phân cấp phù hợp; không cần thiết kế lại. | **AUDITED / HARMONIZED**: kế thừa token nội dung chung. |
| Cài đặt | Thẻ và phần hướng dẫn sáng, bố cục phù hợp. | **AUDITED / HARMONIZED**: kế thừa token, giữ form và hành vi lưu. |
| Trợ giúp | Card hướng dẫn/FAQ phù hợp, không có mảng tối lớn. | **AUDITED / HARMONIZED**: kế thừa token, giữ tìm kiếm và liên kết. |

Danh sách điểm lệch trên cũng đã được gửi trong commentary trước khi sửa mã sản phẩm.

## Thay đổi dùng chung

- **Shared tokens updated: YES.** Thêm `--teacher-bg`, `--teacher-surface`, `--teacher-surface-soft`, `--teacher-field`, `--teacher-border`, nhóm hero/stat/CTA/focus và cặp dark tương ứng trong `app/tokens.css`.
- **Hardcoded color drift reduced: YES.** Hai CSS module của Question Bank và TeachingCollection dùng chung token cho nền, chữ, border, hero và CTA. Giữ màu trong artwork, màu cảnh báo, vùng video và các khai báo sidebar đã có.
- CSS mới giới hạn trong `.app-shell[data-role='teacher'] .shell-content` và form modal của teacher. Nền workspace dùng token trang. Sidebar/topbar không đổi cấu trúc hoặc style trong lượt này.
- Thẻ kế thừa token thay vì ghi đè mọi background/border, để giữ viền và màu ngữ nghĩa của từng card. Không đổi mọi trạng thái về teal.
- Ở 768–1100px, minh họa hero ẩn để chữ/số liệu không bị ép xuống nhiều dòng. Artwork desktop và các thẻ danh sách giữ nguyên.
- Không thêm font/dependency; không đổi JSX nghiệp vụ, API, route, backend, auth, roles, exam/question/monitoring/LiveKit/AI Support behavior.

## Các trang chi tiết đã xem xét

Đã chụp cả trước/sau cho:

- Chi tiết ngân hàng và danh sách câu hỏi; luồng nhập tài liệu.
- Chỉnh sửa đề thi.
- Chi tiết lớp và danh sách thành viên.
- Chi tiết báo cáo bài làm/sự kiện giám sát.

Các route kết quả `/exams/[id]/report` và `/attempts` dùng chung `TeacherResults`; trang chấm bài dùng cùng `TeacherResults.module.css`. Console giám sát và timeline dùng token semantic trong `ProctorConsole` và `ProctorEventDetail`. Alias monitor attempt trỏ về console; oral-grading cũ chỉ redirect về Đề thi. Đã rà soát source/style của các nhánh này, không sửa logic. Live-class và playback có vùng video tối có chủ đích; giữ nguyên màu media và source LiveKit.

## Kiểm chứng

| Hạng mục | Kết quả |
|---|---|
| Light mode | **PASS** trong phạm vi ảnh và các cặp màu kiểm tra bằng e2e. |
| Dark mode | **PASS** trong phạm vi ảnh và các cặp màu kiểm tra bằng e2e. |
| Responsive 1440/1024/768/390 | **PASS**: 15 route × 4 viewport × 2 mode, không tràn ngang. |
| TypeScript `tsc --noEmit` | **PASS**, exit 0, `typecheck.log`. |
| Lint toàn dự án | **PASS**, exit 0; còn warning hook có sẵn, `lint.log`. |
| Production build | **PASS**, exit 0; compile 26s, tạo 42/42 trang tĩnh; `build.log`. Output riêng `.next-recovery-teacher-color-audit`; khôi phục các file khai báo Next/TypeScript sau build. |
| Business logic changed | **NO**. Chỉ CSS/token và thêm import stylesheet. |

Test mới `teacher-color-consistency.spec.ts` kiểm tra 15 route × 4 viewport × 2 theme: không tràn ngang, nền sáng/tối đúng mode, tương phản chữ/thẻ/hero/stat/CTA, thống nhất màu primary, vùng chạm và chiều cao hero. Có ca riêng cho màu ngữ nghĩa, form lưu, focus bàn phím và phạm vi áp dụng admin/student.

**6/6 ca hồi quy hiện có PASS**, không sửa các test này (`e2e-regression.log`):

- `monitor-ui.spec.ts`: timeline, bàn phím, camera realtime giả lập ở 1440px.
- `settings-help.spec.ts`: sidebar/link/nội dung teacher và mobile dark.
- `teacher-profile.spec.ts`: sửa tên/điện thoại, cập nhật header và tải lại ở 375px.
- `teacher-results.spec.ts`: điều hướng báo cáo → kết quả → bài làm; cả hai URL kết quả giữ response và tải lại đúng.

**10/10 ca riêng biệt của suite màu đã đạt qua các lần chạy.** Lần đầu có 7/10 ca đạt; hai ca 1024px phát hiện hero cao 384px khi minh họa ép chữ, đã sửa breakpoint và chạy lại đạt. Một ca focus dùng `.focus()` sau click chuột không kích hoạt `:focus-visible`; đã đổi test sang phím Tab thật. Ca này sau đó phát hiện selector của nút lưu đề bị ảnh hưởng bởi nút success nằm sâu trong form; đã giới hạn selector vào hàng action trực tiếp và chạy lại đạt. Log lần đầu được giữ trong `e2e.log`, hai ca 1024px đạt trong `e2e-fixes.log`, ca semantic/focus/save đạt trong `e2e-semantic.log`. Không mô tả đây là một lần chạy sạch 10/10.

## Ảnh và bằng chứng

Thư mục `artifacts/teacher-color-audit/`:

- **60 ảnh trước + 60 ảnh sau**: `{before,after}-{route}-{1440,390}-{light,dark}.png`.
- `before-audit.json`, `after-audit.json`, `comparison.json`: 60 view đã chụp không tràn ngang; không có thay đổi màu sidebar/topbar trong từng cặp trước/sau.
- Một số ảnh live/monitor/editor được chụp lại sau tinh chỉnh; log và JSON có hậu tố partial được giữ riêng.
- `source-audit.json`: inventory route, source/style và vị trí màu literal.
- `capture.cjs`, `source-audit.cjs`: script tái tạo bằng chứng.

Ảnh/test dùng fixture API, không ghi dữ liệu thật. Đã xem trực tiếp ảnh light desktop của Question Bank, Classes, Exams, Reports; dark desktop của Question Bank; mobile dark của Online Classroom, cùng các ảnh trước để đối chiếu.

## File sản phẩm thay đổi trong lượt audit

1. `app/tokens.css` — token bề mặt teacher, hero/stat/CTA/focus, light/dark.
2. `app/teacher-surfaces.css` — scope màu/thẻ/filter/table/CTA của nội dung teacher.
3. `app/layout.tsx` — import stylesheet mới.
4. `app/dashboard/question-banks/QuestionBanks.module.css` — hero nhẹ, token chung, breakpoint.
5. `components/teacher/TeachingCollection.module.css` — áp dụng tương tự cho hai trang Lớp học.

File kiểm chứng mới: `tests/e2e/teacher-color-fixture.ts`, `tests/e2e/teacher-color-consistency.spec.ts`, báo cáo này và artifacts. Các source đang dirty từ công việc trước không thuộc lượt audit; không reset hay sửa backend.

## Giới hạn

Không chạy toàn bộ test backend/e2e. Không kiểm chứng media/WebRTC thật hoặc thao tác tạo/sửa/xóa trên dữ liệu thật. Audit source của media và route sâu không thay thế một bài kiểm thử LiveKit end-to-end. Các kết quả tương phản áp dụng cho những cặp màu có assertion, không phải tuyên bố kiểm định WCAG toàn hệ thống.
