# ProctoOwl — collapsible sidebar

Ngày: 22/10/2026.

| Yêu cầu | Kết quả |
| --- | --- |
| Sidebar collapse | Có |
| Expanded width | 260px, giữ kích thước hiện tại |
| Collapsed width | 80px |
| Nội dung nhận thêm chiều rộng | 180px trên desktop |
| Preference persisted | Có, `localStorage['proctoowl-sidebar-collapsed']` |
| Student / Teacher / Admin | Một cơ chế chung trong WorkspaceShell |
| Mobile / tablet drawer | Có, dưới 1024px; đóng mặc định, nội dung dùng toàn chiều rộng |
| Brand | ProctoOwl, primary #006D77 |
| Business logic / API / auth / backend / database | Không đổi |

## Sử dụng

Desktop từ 1024px: nút PanelLeftClose/PanelLeftOpen nằm trong sidebar, ở mép trên phải cạnh logo ProctoOwl. Khi thu nhỏ, nút PanelLeftOpen căn giữa bên dưới logo và có tooltip “Hiện thanh điều hướng”. Mặc định mở rộng khi chưa lưu tùy chọn. Nhấn nút để thu về 80px hoặc mở lại. Header và main cùng nằm trong phần workspace của flex layout, không dùng margin-left cố định. Thay đổi chiều rộng/basis trong 220ms ease-out; reduced motion tắt transition.

Collapsed: mark cú được căn giữa, giữ avatar Student, icon điều hướng, icon cài đặt/trợ giúp. Nhãn và tên/role được ẩn trực quan nhưng tên truy cập điều hướng vẫn còn cho screen reader. Hover/focus icon hoặc avatar hiển thị tooltip; active icon giữ nền/viền chỉ báo. Không ép wordmark dài vào rail nhỏ. Expanded giữ logo, hồ sơ và nhãn hiện tại.

Submenu Student và hai nhóm Admin: expanded giữ hành vi disclosure hiện có. Collapsed nhấn icon hoặc ArrowRight/ArrowDown để mở flyout bên cạnh, focus vào liên kết đầu tiên. ArrowUp/Down, Home/End, Tab/Shift+Tab và Escape sử dụng được; Escape trả focus về trigger. Chọn liên kết, click/focus bên ngoài, scroll hoặc resize đóng flyout. Sidebar không phải mở rộng để dùng submenu.

Tooltip và flyout render bằng portal/fixed positioning để không bị cắt bởi sidebar có cuộn. Các listener được cleanup khi đóng/unmount. Flyout giữ liên kết Next.js và các route/active checks có sẵn.

Tooltip cho phép rê chuột vào phần nội dung mà không bị đóng ngay, có khoảng chờ 180ms khi rời và đóng bằng Escape. Drawer mobile dành riêng khoảng rộng cạnh logo cho nút X có tương phản rõ; không đặt icon trắng chìm trên logo nền trắng.

Dưới 1024px: không giữ rail 80px. Hamburger mở drawer đầy đủ nhãn, có backdrop, focus trap và khóa cuộn hiện có. Đóng khi chọn route, click ngoài hoặc Escape. Tùy chọn desktop được giữ để khôi phục khi quay lại màn hình rộng; không ghi đè preference chỉ vì thay đổi viewport. Nếu trình duyệt chặn storage, toggle vẫn hoạt động trong phiên hiện tại.

## Files changed

- `components/layout/AppShell.tsx`: state/toggle/persist dùng chung, breakpoint và kết nối hint/compact submenu; giữ guard/auth và menu theo role.
- `components/layout/SidebarNavGroup.tsx`: flyout cho chế độ compact, bàn phím, outside/resize/route close; expanded behavior giữ nguyên.
- `components/layout/SidebarHint.tsx` (mới): tooltip hover/focus qua portal.
- `components/layout/Sidebar.module.css` (mới): chiều rộng/layout/transition, logo compact, nhãn ẩn trực quan và overlay styles.
- `tests/e2e/collapsible-sidebar.spec.ts` (mới): 10 ca acceptance cho ba role, persistence, chiều rộng, chat, submenu, mobile/tablet, reduced motion và storage bị chặn.
- `docs/COLLAPSIBLE_SIDEBAR.md`.

Không sửa role menu arrays, route constants, auth provider, API hoặc dashboard content. `artifacts/collapsible-sidebar/audit-scope.py` xác minh guard, navigation arrays, route/label Student và auth provider; diff đầy đủ ở `source-review.patch`.

## Validation

Build production: PASS. TypeScript/lint của các component được sửa: PASS. Build còn các cảnh báo hook/img có sẵn ở các vùng ngoài phạm vi.

Kiểm tra browser production và ảnh được lưu trong `artifacts/collapsible-sidebar/`; kết quả cuối ở `validation-summary.json`. Kiểm tra dùng fixture API sẵn có, không thay đổi dữ liệu backend thật.

28 ca riêng biệt được kiểm chứng PASS qua các batch: 10 ca mới, 7 ca menu Admin, 9 ca responsive theo role, 1 ca touch và 1 ca chat mobile/dark. Lượt production cuối **12/12 PASS**, gồm cả 10 ca acceptance và 2 ca drawer/touch hồi quy; 2 ca mobile được chạy lại để chụp sau khi font/transition đã ổn định và đều PASS. Không tuyên bố chạy 28/28 trong một lượt cuối. Các hồi quy còn lại đã PASS trước tinh chỉnh cuối chỉ liên quan tooltip hover và nút đóng drawer.

Lượt 28 ca ban đầu có một assertion reduced motion yêu cầu chuỗi `0s`, trong khi CSS toàn ứng dụng dùng `.01ms !important`. Test cuối xác nhận `transition-property: none` và thời lượng không đáng kể, đồng thời kiểm tra focus bằng thao tác bàn phím thật; không đổi CSS reduced motion toàn ứng dụng.

Ảnh: `student-expanded.png`, `student-collapsed.png`, `student-collapsed-dark.png`, `student-flyout.png`, `teacher-collapsed.png`, `admin-collapsed.png`, `admin-flyout.png`, `drawer-390.png`, `drawer-768.png`.
