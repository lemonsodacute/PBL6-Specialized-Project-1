# Navigation Admin dùng chung

## Audit

Trước khi sửa, Admin có hai mảng menu: `adminNavigation` trong
`components/layout/AppShell.tsx` và `links` trong `app/admin/layout.tsx`.
Mảng `links` thiếu Quản lý đề thi và Báo cáo, đồng thời đổi tên Tổng quan và
Nhật ký. Không có `AdminSidebar` riêng hoặc menu hard-code trong các page.

Các route `/dashboard/*` dùng shell từ root `AppShell`; các route `/admin/*`
dùng `app/admin/layout.tsx`. Cả hai render cùng `WorkspaceShell`, nhưng mảng
`links` trước đây ghi đè menu mặc định của shell. Root bỏ qua shell cho
`/admin/*`, nên không cần thêm một sidebar/header vào page thẻ sinh viên.

## Nguồn duy nhất

`lib/admin-navigation.ts` định nghĩa đủ 8 mục, nhãn, URL và alias active.
`WorkspaceShell` luôn lấy `adminNavItems` khi tài khoản có role Admin;
`app/admin/layout.tsx` không còn khai báo hoặc truyền menu riêng.
Teacher/Student vẫn dùng navigation hiện có. Middleware, auth, permission
và nội dung nghiệp vụ của page không thay đổi.

| Route hiện có | Mục active |
| --- | --- |
| `/dashboard`, `/admin` | Tổng quan hệ thống |
| `/admin/classes`, `/admin/classes/[id]` | Quản lý lớp học |
| `/dashboard/users` | Quản lý người dùng |
| `/dashboard/exams`, các route con | Quản lý đề thi |
| `/admin/student-cards` | Xác thực thẻ sinh viên |
| `/dashboard/reports` | Báo cáo & thống kê |
| `/dashboard/action-logs`, `/admin/action-logs` | Nhật ký hệ thống |
| `/admin/settings` | Cài đặt |

`Cài đặt` dùng route thật `/admin/settings` trong nguồn navigation chung,
chỉ xuất hiện một lần. `Trợ giúp` ở footer dùng `/admin/help`. Teacher/Student
giữ vị trí menu ở footer, liên kết tới `/teacher/settings`, `/teacher/help`
và `/student/settings`, `/student/help`. Nội dung dùng các component chung,
không tạo thêm layout/sidebar. Chi tiết xem [settings-help.md](settings-help.md).

## Kiểm tra

`tests/e2e/admin-navigation.spec.ts` kiểm tra điều hướng bằng link qua các
layout, history back/forward, reload, các URL alias, route lớp con và menu
mobile. Mỗi route giữ đủ menu, đúng một mục active, một logo/header/sidebar.
Test cũng kiểm tra Teacher/Student giữ menu của từng role.
