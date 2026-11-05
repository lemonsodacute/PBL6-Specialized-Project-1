# STUDENT ONLINE CLASSROOM REDESIGN

Reference followed: **YES** — ảnh `D:/Download/Bản 2 – Dịu hơn@1x.png` và yêu cầu trong file đính kèm. Dữ liệu minh họa trong ảnh không được đưa vào code sản phẩm.

| Hạng mục | Kết quả |
| --- | --- |
| Layout | PASS — nền kem, badge khu vực mint, tiêu đề navy và lưới thẻ 2 cột desktop. |
| Filter panel | PASS — panel trắng bo tròn, input/select viền navy, nút Làm mới mint; 1024/1440 nằm một hàng. |
| Class cards | PASS — dữ liệu hiện có; icon pastel theo hash ID, không theo vị trí danh sách; không ép chiều cao. |
| Status styling | PASS — scheduled tím, ongoing xanh lá, ended xám, cancelled hồng; luôn có chữ và chấm màu. |
| Schedule chip | PASS — chip vàng kem với calendar và hai thẻ time; giữ nguyên `classroomDate()` và timezone hiện có. |
| Sidebar | PASS — giữ cấu trúc/navigation; nền teal, profile sáng hơn, active vàng, icon/chữ rõ. |
| Chat launcher | PASS — hồng, tròn, viền navy; dùng launcher và portal hiện có, giữ nguyên anchor fixed và hành vi. |
| Responsive | PASS — 1440, 1024, 768, 390, 320px; không tràn ngang, điều khiển chính ít nhất 44px. |
| Dark mode | PASS — 1440 và 390px; surface tối, text sáng, giữ pastel có dark ink và contrast khi hover. |

Business logic changed: **NO**.

Các dòng khởi tạo collection, gọi `useServerCollection`, effect notice/polling 10 giây và biểu thức sắp xếp giữ nguyên so với bản trước sửa. Nhãn, điều kiện và đường dẫn của Tham gia / Xem chi tiết / Xem lại buổi học giữ nguyên, kể cả nhánh bản ghi được công bố. Không sửa API, auth, quyền, LiveKit, recording, attendance, lifecycle, database, env, package hoặc font.

Style shell dùng `.app-shell[data-role='student']:has(.page)` với class CSS module riêng của trang; không dựng lại AppShell. Chat dùng selector theo marker của trang vì launcher đang portal vào body. Khi chuyển trang, style này được gỡ theo DOM; đã kiểm tra chuyển bằng Next Link sang Lớp học phần để xác nhận sidebar/header/chat trở lại style chung.

File sửa/thêm trong nhiệm vụ:

- `app/student/live-classes/page.tsx`: trình bày lại phần render, tái sử dụng toolbar/pagination và các hook cũ.
- `components/student/StudentLiveClassCard.tsx`: component thẻ thuần trình bày, dùng đúng dữ liệu và action có sẵn.
- `components/student/StudentLiveClasses.module.css`: layout, thẻ, filter và trang trí shell giới hạn theo trang.
- `app/tokens.css`: token `--student-online-*` và cặp light/dark; cream, navy, mint, yellow, pink, purple tập trung một nơi.
- `components/ui/SupportChatButton.module.css`: biến thể màu/hình dạng chỉ cho trang Student online classes.
- `tests/e2e/student-online-classes-design.spec.ts`: e2e cho responsive, dark/hover contrast, dữ liệu, filters, refresh, notices/errors, href hành động và style scope.
- Báo cáo này.

Tests:

- TypeScript `tsc --noEmit`: **PASS**, exit 0, `artifacts/student-online-classroom-redesign/typecheck-final.log`.
- Lint ba file TS/TSX thay đổi: **PASS**, không có lỗi/cảnh báo ESLint; `lint-final.log`. Next có thông báo deprecation của `next lint`.
- E2E trên production với Edge: **10/10 PASS**, exit 0, khoảng 46 giây; `e2e-verified.log`. 7 cấu hình viewport/theme và 3 bài chức năng/phạm vi style. Đã xem ảnh desktop, tablet và mobile cùng dark mode.
- Một lượt xác minh trước đó timeout khi main còn “Đang tải” ở ngưỡng 10 giây; trace không có failed HTTP/page error. Đã chờ heading sẵn sàng tối đa 30 giây và chạy lại trọn bộ 10 bài. Không coi lượt timeout là PASS; log/trace cũ được giữ ở `e2e-final/`.
- Test dùng fixture UI để kiểm tra giao diện, query API và href. Không chạy tích hợp LiveKit/recording/media hay bộ backend tests thật trong nhiệm vụ UI này; không tuyên bố đã tham gia hoặc phát bản ghi trong phiên thật.

Build: **PASS**, exit 0, `build-final.log`. Còn các cảnh báo React Hook ở những file không sửa trong nhiệm vụ. Build riêng tại `.next-recovery-student-online-classroom`; khôi phục nguyên byte `tsconfig.json` và `next-env.d.ts` sau khi Next chạy. Server kiểm tra cổng 3107 được dừng sau QA; server dev 3000 được giữ nguyên.

Lệnh e2e cuối:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://localhost:3107'
$env:PLAYWRIGHT_CHANNEL='msedge'
node node_modules/@playwright/test/cli.js test tests/e2e/student-online-classes-design.spec.ts --max-failures=1 --output=artifacts/student-online-classroom-redesign/e2e-verified
```

Ảnh cuối (dữ liệu fixture, không phải số liệu thật của người dùng):

- [1440 light](../artifacts/student-online-classroom-redesign/e2e-verified/student-online-classes-des-0ca6e-c-cards-and-usable-controls/student-online-1440-light.png)
- [1024 light](../artifacts/student-online-classroom-redesign/e2e-verified/student-online-classes-des-3b3f4-c-cards-and-usable-controls/student-online-1024-light.png)
- [768 light](../artifacts/student-online-classroom-redesign/e2e-verified/student-online-classes-des-cb3ce-c-cards-and-usable-controls/student-online-768-light.png)
- [390 light](../artifacts/student-online-classroom-redesign/e2e-verified/student-online-classes-des-3eec4-c-cards-and-usable-controls/student-online-390-light.png)
- [320 light](../artifacts/student-online-classroom-redesign/e2e-verified/student-online-classes-des-cc45c-c-cards-and-usable-controls/student-online-320-light.png)
- [1440 dark](../artifacts/student-online-classroom-redesign/e2e-verified/student-online-classes-des-5a55d-c-cards-and-usable-controls/student-online-1440-dark.png)
- [390 dark](../artifacts/student-online-classroom-redesign/e2e-verified/student-online-classes-des-bd393-c-cards-and-usable-controls/student-online-390-dark.png)
