# AI PROCTO — shared UI audit

Phạm vi là frontend/presentation. Giữ nguyên API contracts, database, quyền,
exam/scoring, OCR, Face Verification và identity workflow. Thời khóa biểu riêng
đã được bỏ theo yêu cầu trước; lịch trên Trang chủ sinh viên vẫn giữ nguyên.

Notification Bell đã được thu gọn, dùng chung cho ba role; filter/pagination
chuyển sang `/notifications`. Chi tiết kiểm chứng bổ sung tại
[notification-ux.md](notification-ux.md).

Latest presentation update: redundant page introductions are removed across all
roles; compact detail context and toolbar actions remain. See
[page-intro-audit.md](page-intro-audit.md) for the route audit and validation.

## Nền tảng chung

| Thành phần | Chuẩn mới / cách áp dụng |
| --- | --- |
| Button/IconButton | Primary, secondary, outline, success, warning, danger, ghost, icon; 40–44px trở lên, không co/wrap label |
| ActionMenu | Một menu portal dùng chung; đặt theo viewport, đóng khi scroll/outside, arrows/Home/End/Escape/Tab, danger cuối menu |
| Table | Desktop table; mobile card với label từ header, giữ semantics table/row/cell; scroll local là lựa chọn rõ ràng cho dữ liệu dạng ma trận |
| CollectionToolbar | Search 50px; remote lookup thu gọn; filters bổ sung khi nhiều lựa chọn; search full width trên mobile |
| Pagination | Controls 40px, nhóm có khoảng cách; không bị chat che phía cuối page |
| Modal | 520/720/960/1100px theo tokens hiện có; giới hạn 95vw/90dvh, body scroll dọc, header riêng, footer có spacing và bố trí mobile |
| ConfirmDialog | Shared xác nhận xóa/thu hồi/từ chối/kết thúc; busy/error/disabled; không dùng browser confirm |
| Badge | Cùng chiều cao/radius/padding; StatusBadge và AttemptStatusBadge dùng trạng thái thực tế |
| Card/PageHeader | Card padding 24/16; no collection/profile/dashboard intro; detail context 16px; actual section headings 20/16; main top padding 28/16 |
| Field | Input/select 50px, textarea 128px; label/error/helper spacing, min-width:0 trong grid |
| Sidebar/Header | Một shell/source theo role; Settings/Help cuối menu; name/email tách riêng và ẩn email trước trên mobile |
| Layers | base 0, sticky 20, floating 30, drawer 40, dropdown 60, modal 80, menu trong modal 90, toast 100, skip link 120 |
| Floating UI | Chat trên header ở mobile; safe-area và padding cuối trang ở desktop; chat ẩn khi menu/dialog mở và ở exam/verification; camera realtime nằm trên panel chi tiết, giữ stream/logic hiện có |
| Feedback | Empty có icon/message/CTA, skeleton, ErrorState retry; chat API lỗi hiện lỗi, không tạo câu trả lời mock |

`app/ui-consistency.css` là lớp presentation cuối sau theme, dùng tokens hiện
có để giữ teal/light/dark. Không sửa legacy token names/API consumers. Table
thêm data-label và roles trong component chung, không copy markup mobile ở
từng page. ActionMenu chỉ nhận các action caller đã cho phép; không tự suy
đoán trạng thái hoặc quyền.

## Audit theo khu vực

| Khu vực / trang | Thay đổi hoặc pattern áp dụng |
| --- | --- |
| Admin Dashboard | Shared metrics, typography, cards, spacing, sidebar/header |
| User Management | Chỉnh sửa + menu; xác nhận khóa; password dialog thay prompt/alert; responsive table |
| Admin Classes / members | Shared table/card, lookup/toolbar; ConfirmDialog xóa lớp/gỡ thành viên |
| Student Card Verification | Shared table; Xem + menu; menu trong detail; reason và phiên bản giữ nguyên; xác nhận thu hồi |
| Admin Exams / Reports | Shared table/card, existing exam state decisions, menu/confirm, summary/data giữ nguyên |
| Audit Logs | Shared table/card, toolbar, pager; actor/action/time queries giữ nguyên |
| Admin Settings / Help | Shared form/card/feedback/sidebar; không thêm option giả |
| Teacher Dashboard | Shared metrics/card/title and responsive shell |
| Question Bank list / detail | Mở + menu; question menu dùng portal; ConfirmDialog archive/bulk soft delete; selection/random/points giữ nguyên |
| Teacher Exams | ExamActions giữ state/API, reuse ActionMenu; ConfirmDialog close/delete; editor size large |
| Exam Results / grading | Shared table/card/modal/forms; history/score/correct answers không đổi |
| Monitoring | Shared toolbar/cards/layers; card trigger là button thật; camera/call/risk policies giữ nguyên |
| Teacher Classes / students | Shared responsive table and member removal confirmation; back link có keyboard semantics |
| Vấn đáp | Đã bỏ khỏi luồng sử dụng theo yêu cầu tiếp theo; xem [retired-oral-exams.md](retired-oral-exams.md) |
| Live class list / room | Shared table/form; ConfirmDialog kết thúc buổi; media/admission/attendance giữ nguyên |
| Teacher Reports / Profile / Settings / Help | Shared card/form/spacing/table/header; phone/avatar/readonly fields giữ nguyên |
| Student Dashboard / Exams / classes / live classes | Shared cards and controls, table → cards ở list; date/source/state logic giữ nguyên |
| Student Exam Room | Layout/layers/control sizing; chat không che bài thi; countdown/submit/camera/verification không đổi |
| Student Results | Shared mobile cards, score 0 vẫn hiển thị, link kết quả giữ nguyên |
| Student Profile / identity | Spacing/forms/modal; verified card và sanitized avatar vẫn khóa như hiện có |
| Student Settings / Help | Shared typography/controls/cards và responsive shell |

Không gọi API thật để tạo/xóa/thu hồi dữ liệu khi kiểm tra visual. Các fixture
chỉ nằm trong Playwright; production collection không fallback fixture.
Ảnh kiểm tra và traces được ghi ra TEMP ngoài workspace để không gây HMR.

## Kiểm tra ngày 2026-10-12

- TypeScript toàn project: `npx tsc --noEmit --incremental false --pretty false` chạy sạch, gồm cả các test phòng thi.
- 89 ca E2E riêng biệt đã qua: 8 Student Cards, 9 Exam Actions, 9 Profile Verification, 6 Reports, 8 Results, 16 Teacher Workspace, 12 Shared UI và 18 Exam Experience; bổ sung 3 ca Monitor UI.
- Lượt 86 ca tổng hợp có 84 ca qua ngay. Hai test đã được sửa để chờ debounce và dùng đúng mục menu được focus, sau đó chạy lại thành công. Không sửa nghiệp vụ để làm test qua.
- Responsive chính: Student/Teacher/Admin qua 28 route ở 375/768/1440px; profile/question selector và camera phòng thi còn được kiểm tra ở 320/1024px. Kiểm tra drawer 375 → 1024px, mobile table cards, menu trong viewport, keyboard/focus, xác nhận trước khi gọi API, chế độ tối, chat error/retry không sinh câu trả lời giả.
- Phòng thi: giữ stream khi chỉnh thiết bị, chuyển thiết bị, drag/thu nhỏ/mở camera, answer-before-submit, double submit, submit failure/retry, countdown, server termination và cleanup. Monitor UI kiểm tra camera nổi trên panel và nút đóng bấm được; các ca media dùng thiết bị giả/signaling stub, không khẳng định đã thử truyền WebRTC giữa hai người dùng thật.
- Read-only PostgreSQL/API/browser: điểm `1/15`, risk `66`, 7 sự kiện và CSV theo filter khớp dữ liệu lưu; summary toàn scope là 4 completed, 40 events, 16,67%. Đây là snapshot local, không hard-code vào sản phẩm. Không phát sinh lỗi JavaScript trong kiểm tra browser dữ liệu thật.

Artifacts ngoài workspace: `%TEMP%/ui-upgrade-complete`, `%TEMP%/ui-upgrade-last-checks`, `%TEMP%/ui-upgrade-real-proof.log`. Không tạo/xóa dữ liệu thật để kiểm tra giao diện.
