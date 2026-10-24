# Frontend polish — 2026-10-03

## Inventory before implementation

| Area | Existing implementation | Finding / intended work |
| --- | --- | --- |
| Auth | `app/login/page.tsx`, shared Field/PasswordInput/Button | Four modes already validated. Freeze TSX/handlers; visual changes through shared CSS only. |
| Root / student / teacher / admin | root AppShell and WorkspaceShell, separate teacher/admin wrappers | Preserve sidebar + header + main; avoid duplicate nested page padding. |
| Sidebar / header | AppShell, AccountMenu, NotificationBell | Account menu already supports keyboard and one logout. Tokenize module styles; improve notification focus, touch dismissal and constrained panel. |
| Profile | `/student/profile`, profile.module.css | Real API data already present. Promote name/email/status beside photo; retain personal, academic and account sections. No student-code field exists. |
| Dashboards | StudentCalendar, dashboard/page, teacher/page, admin/page | Student already has greeting/stats/upcoming. Add recent activity using existing attempts endpoint. Teacher/admin contain mock/hardcoded metrics: replace with existing dashboard stats API and genuine error/empty states. |
| Classes | student/dashboard/admin list and detail pages | Reuse existing tables/cards; standardize static page headings, spacing and interactive links. |
| Exams | student lists, teacher lists/settings/attempts/grading | Keep all rule calculations and handlers. Shared headers, table and badge presentation. |
| Face verification | verify page, identity page, CameraPreview/useIdentityCamera | Enrollment remains a prerequisite for camera-required exams. Preserve all handlers and enrollment links; add camera/instructions grid and requested title. |
| Results / history | student grades/history/result, teacher report/grading | Shared Table already supplies keyboard-scrollable region; standardize status tones, headings, row/action focus. |
| Timetable | StudentCalendar and `/student/schedule` | Preserve existing calendar views and weekly timetable. Shared spacing and local overflow; recent activity only on overview. |
| Forms | Field, PasswordInput, form-grid | Existing labels and auth validation retained; spacing/touch targets/focus use tokens. |
| Tables | Table, ui-table, table-wrap | Existing horizontal region retained; header/rows/hover/focus/actions unified. |
| Modal | Modal/useDialogFocus | Existing focus trap, Escape and restoration retained. Shared overlay/radius/spacing. |
| Dropdown | AccountMenu and NotificationBell | Account keyboard behavior already tested; notification disclosure needs Escape/focus-out/pointer support. |
| Badges | Badge/SeverityBadge plus repeated inline status mappings | Keep severity semantics; share attempt status presentation without changing status computation. |
| Feedback | Feedback/Toast and per-page load/error states | Use existing skeleton, empty, alert/retry patterns; no artificial dashboard loading timer. |

## Duplication audit

Global import order: globals → overrides → reference-theme → identity → design-system.
PostCSS inventory: 795 / 117 / 154 / 65 / 210 rules respectively. There are 36 byte-equivalent rule bodies with identical selectors and conditional context repeated earlier in the cascade (34 in overrides, 2 in design-system). Keep the last occurrence; remove earlier identical declarations only. Differing contextual overrides are not interchangeable.

`reference-theme.css` contains multiple historical blue/teal root palettes and repeated shell rules. `design-system.css` is already the authoritative token source. Consolidate unconditional root aliases there; preserve page-specific layout rules. Page-heading markup is repeated across student/teacher lists; extract PageHeader. Profile/account module colors and radii duplicate global tokens. Dashboard implementations duplicate mock metrics and should share one actual API-driven view.

## Final email check and auth freeze

The new database-backed regression test reproduced a duplicate against a pre-existing mixed-case email (HTTP 200 instead of 409). Registration lookup now uses `lower(User.email)`, matching login; public registration still stores lowercase. All three requested variants share one account and log in successfully. Two new tests, **93 backend tests PASS**. No migration or schema changes. This is an application-path check; it neither cleans pre-existing duplicates nor adds a database-wide case-insensitive constraint for unrelated writers.

Auth frontend, AuthContext, API contracts, permissions, face engine/settings and all exam handlers are frozen for the UI work. Remember me, production reset-email service and ESLint setup remain deliberately deferred.

## Design tokens

Giữ logo, teal/navy/light blue và cấu trúc AI PROCTO hiện tại. `app/design-system.css` là nguồn token dùng chung; không thêm framework hay animation library.

| Nhóm | Giá trị |
| --- | --- |
| Brand / hover | `#006d77` / `#005761` |
| Nền / surface / muted surface | `#edf6f9` / `#ffffff` / `#f4f8f9` |
| Chữ chính / phụ / muted | `#203d47` / `#506b75` / `#58717a` |
| Border / accent | `#c5e0e2` / `#83c5be` |
| Typography | Inter; page 30px (26px mobile), section 20px, body 15px, small 14px, caption 13px |
| Spacing | 4 / 8 / 12 / 16 / 24 / 32 / 48px |
| Radius | 6 / 9 / 12px; badge pill |
| Shadow | subtle / medium / overlay; không dùng gradient mới |
| Container | max-width 1280px; padding 32px desktop, 16px mobile |
| Interaction | 160ms, drawer 200ms; reduced-motion được giữ |

Đã loại 36 rule trùng hoàn toàn và 32 khai báo root alias bị nguồn token cuối ghi đè. Giữ các override khác nhau theo ngữ cảnh để tránh ảnh hưởng màn hình nghiệp vụ. Màu muted được tăng tương phản trên nền xanh nhạt; ngày ngoài tháng cũng dùng token thay cho xám quá nhạt.

## Shared components

- `PageHeader`: thống nhất eyebrow, title, subtitle và vùng action; dùng cho dashboard, profile, danh sách lớp/đề thi, lịch sử/điểm, lịch học, identity, chấm bài, báo cáo, người dùng và giám sát. Các callback/action hiện có được giữ.
- `AttemptStatusBadge`: màu và nhãn theo trạng thái đã có; không sửa cách tính/trả trạng thái.
- `Overview`: dùng chung cho `/dashboard`, `/teacher`, `/admin`; dữ liệu từ `/dashboard/stats` và danh sách đề đã xuất bản/đang diễn ra. Không còn số liệu mock/hardcoded ở ba dashboard này.
- `RecentActivity`: đọc ba lượt làm bài gần nhất qua API hiện có, link tiếp tục bài hoặc xem kết quả; hỗ trợ loading/empty/error/retry riêng. Không suy diễn tên đề khi không có dữ liệu.
- Giữ Button, Field, PasswordInput, Card, Table, Modal, Feedback và Toast; chuẩn hóa style, bỏ padding kép của card toolbar, thêm focus-within cho hàng bảng và touch target phù hợp.

## Layout improvements

Giữ sidebar | header | main, logo và navigation hiện có. Account menu vẫn có một thao tác đăng xuất; chuyển màu/radius/shadow của menu sang token chung. Notification panel hỗ trợ Enter, Escape trả focus, Tab ra ngoài để đóng, pointer dismissal và trạng thái tải/lỗi. Panel không tràn viewport mobile. Dashboard ở wrapper teacher/admin không còn padding lồng nhau.

## Pages improved

- Auth: chỉ visual qua CSS chung (logo spacing, footer-link hover, input focus, tokens). `app/login/page.tsx` không thay đổi.
- Student overview: greeting → quick stats → upcoming → recent activity → calendar. Các con số lịch giữ phạm vi các sự kiện API hiện có; không tự tạo tổng hệ thống.
- Profile: ảnh cạnh tên/email/status; section cá nhân, học tập, tài khoản rõ ràng. Ảnh gọn hơn; giữ fallback và tải lại dữ liệu. Không tạo mã sinh viên hoặc đưa enrollment vào profile.
- Face verification: tiêu đề/subtitle đúng yêu cầu; camera bên trái, hướng dẫn bên phải; stack trên mobile. Preview hiện trước khi bật camera. Giữ nguyên các handler, consent, kiểm tra thiết bị, capture, verify và start.
- Classes/exams/results/timetable/teacher pages: shared header, card/table/button/badge styling; các trang chi tiết/chấm bài/giám sát vẫn giữ cấu trúc nghiệp vụ.

**Phụ thuộc product còn lại:** camera-required exam vẫn cần reference được enrollment trước. Vì vậy link đăng ký/cập nhật khuôn mặt còn được giữ ở identity/verification. Chỉ có thể bỏ flow này sau một task thay đổi product/backend riêng; không phải lỗi của UI polish.

## Responsive

Kiểm tra 375 / 768 / 1024 / 1440px: student overview/classes/exams/history/grades/profile/schedule/identity, login/register, teacher dashboard/classes/exams/question banks/reports, camera verification, notification panel và dashboard alias teacher/admin. Drawer được kiểm tra đóng/mở, Escape và focus; profile test cũ còn kiểm tra 320px và tên/email dài. Bảng kết quả cuộn trong region riêng, không làm trang tràn ngang. Ảnh review trong `artifacts/ui-review/polish/`.

## Accessibility

Giữ label/error association, show/hide password, focus trap/restoration của dialog/drawer và keyboard account menu. Thêm region/heading/focus cho thông báo, focus hàng bảng, underline hover, 44px controls chính và nút nhỏ trên thiết bị coarse-pointer. Hướng dẫn camera là danh sách có thứ tự; trạng thái có chữ, không chỉ màu.

Kiểm tra tương phản token chính bằng công thức WCAG: text chính, text phụ, muted, primary button, sidebar active và semantic badges đều đạt ít nhất 4.5:1 trên nền dự kiến. Đây không phải chứng nhận accessibility cho mọi trạng thái giám sát/video hay nội dung động chưa được dựng.

## Files changed

36 file hiện có được chỉnh và 6 file mới. Manifest đầy đủ: `artifacts/ui-review/polish/files-changed.json`.

| Nhóm | File |
| --- | --- |
| Shared styles | `app/design-system.css`, `app/globals.css`, `app/reference-theme.css` |
| Shared UI | `components/ui/PageHeader.tsx` (mới), `Badge.tsx`, `index.ts` |
| Header | `components/layout/AccountMenu.module.css`, `NotificationBell.tsx` |
| Dashboard | `components/dashboard/Overview.tsx`, `RecentActivity.tsx` (mới); `app/dashboard/page.tsx`, `app/teacher/page.tsx`, `app/admin/page.tsx`, `app/student/StudentCalendar.tsx` |
| Student | `classes/page.tsx`, `exams/page.tsx`, `grades/page.tsx`, `history/page.tsx`, `identity/page.tsx`, `schedule/page.tsx`, `profile/page.tsx`, `profile/profile.module.css`, `exams/[examId]/verify/page.tsx` |
| Teacher/shared role pages | `dashboard/classes/page.tsx`, `classes/[id]/page.tsx`, `exams/page.tsx`, `exams/[id]/attempts/page.tsx`, `exams/[id]/report/page.tsx`, `exams/[id]/grade/[attemptId]/page.tsx`, `live-classes/page.tsx`, `monitor/page.tsx`, `monitor/[examId]/page.tsx`, `oral-grading/page.tsx`, `oral-grading/[oralAnswerId]/page.tsx`, `question-banks/page.tsx`, `reports/page.tsx`, `users/page.tsx` |
| Email final check | `backend/app/api/v1/auth.py` (một điều kiện); `backend/tests/test_auth_email_uniqueness.py` (mới) |
| Verification/docs | `tests/e2e/ui-fixtures.ts`, `tests/e2e/frontend-polish.spec.ts` (mới), báo cáo này (mới) |

## Tests / typecheck / build

- Backend: **93/93 PASS**, gồm 2 test database-backed mới cho email và toàn bộ suite cũ. SQLite cô lập, không sửa database đang chạy.
- TypeScript: **PASS**, `node node_modules/typescript/bin/tsc --noEmit --incremental false`.
- Production build: **PASS**, Next.js 14.2.35, 28 static pages; build ở thư mục tách biệt trên ổ D để không ghi đè `.next` của workspace.
- Browser: **53/53 PASS** trên Microsoft Edge, production server `http://localhost:3100`, 1 worker, khoảng 1.2 phút. Bao gồm toàn bộ 39 test cũ (28 auth/profile) và 14 test mới: viewport, notification keyboard, dashboard dữ liệu/lỗi/retry, alias routes, recent activity, enrollment/no-camera và capture/consent/rejected/verified. Lượt đầu có một selector test chọn cả Next route announcer; đã giới hạn vào `main` và chạy lại toàn suite thành công.
- Freeze audit: 62 file backend/auth/API/middleware/camera-hook khớp hash sau email fix. Các handler trong trang exam verification khớp snapshot trước UI polish.
- Browser fixtures dùng dữ liệu giả lập chỉ trong test; camera là canvas stream tổng hợp. Chưa kiểm thử camera vật lý, nhận diện model hay deployment production; không có thay đổi các phần này.

## Visual inconsistencies remaining

- CSS legacy còn các rule khác nhau theo selector/ngữ cảnh trong globals/reference-theme và style riêng của monitor/video/report. Đã bỏ duplicate chính xác; chưa viết lại toàn bộ CSS vì có thể ảnh hưởng trạng thái realtime chưa được kiểm thử trực tiếp.
- Một số trang nghiệp vụ dài còn markup compact và style chuyên biệt; chúng nhận token/shared header/table mới nhưng không bị redesign layout.
- Không có lỗi tràn viewport trong các màn hình/phạm vi fixture đã kiểm tra. Nội dung video/realtime và dữ liệu cực lớn cần kiểm tra khi có phiên thật.

## TODOs intentionally not implemented

- Remember me, production reset-email service, ESLint configuration.
- DB migration/schema, database-wide email uniqueness cho các writer khác hoặc cleanup duplicate cũ.
- FaceEngine/YuNet/SFace/threshold, thay thế enrollment bằng trusted reference, exam rules, permissions, auth/API contracts.
- Mã sinh viên, khoa/ngành/khóa và ảnh trusted reference chưa có API: không giả lập hoặc gắn nhãn sai.
- `dashboard/reports/page.tsx` vẫn là báo cáo legacy dựa trên mock; task này chỉ chuẩn hóa presentation của trang đó. Việc nối dữ liệu báo cáo tổng hợp và bỏ các fallback mock sẵn có trong `lib/dataSource.ts` là công việc tích hợp riêng. Dashboard tổng quan mới gọi API trực tiếp và không dùng các fallback đó.
