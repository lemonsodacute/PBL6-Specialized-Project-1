type AdminNavLink = { label: string; href: string; activePaths?: readonly string[]; disabled?: false };
type AdminNavPlaceholder = { label: string; disabled: true; href?: never };
type AdminNavGroup = { label: string; children: readonly AdminNavLink[]; href?: never; disabled?: false };
export type AdminNavItem = AdminNavLink | AdminNavPlaceholder | AdminNavGroup;

// Both /dashboard and /admin use this menu through WorkspaceShell.
export const adminNavItems: readonly AdminNavItem[] = [
  { label: 'Tổng quan hệ thống', href: '/dashboard', activePaths: ['/admin'] },
  { label: 'Quản lý lớp học', href: '/admin/classes' },
  { label: 'Quản lý người dùng', children: [
    { label: 'Danh sách người dùng', href: '/dashboard/users' },
    { label: 'Xác thực thẻ sinh viên', href: '/admin/student-cards' },
  ] },
  { label: 'Quản lý đề thi', href: '/dashboard/exams' },
  { label: 'Tin nhắn', href: '/admin/messages' },
  { label: 'Hỗ trợ AI', children: [
    { label: 'Kho tri thức', href: '/admin/ai-support/knowledge' },
    { label: 'Hoạt động AI', href: '/admin/ai-support/activity' },
  ] },
  { label: 'Báo cáo & thống kê', href: '/dashboard/reports' },
  { label: 'Nhật ký hệ thống', href: '/dashboard/action-logs', activePaths: ['/admin/action-logs'] },
  { label: 'Cài đặt', href: '/admin/settings' },
];

export function isAdminNavItemActive(item: AdminNavItem, pathname: string): boolean {
  if (item.disabled) return false;
  if ('children' in item) return item.children.some(child => isAdminNavItemActive(child, pathname));
  return [item.href, ...(item.activePaths ?? [])].some(path => pathname === path
    || (!['/dashboard', '/admin'].includes(path) && pathname.startsWith(`${path}/`)));
}
