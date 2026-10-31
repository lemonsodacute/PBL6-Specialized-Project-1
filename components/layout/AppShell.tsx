'use client';

import Link, { useLinkStatus } from 'next/link';
import { Menu, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { NavigationIcon } from './NavigationIcon';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSupportChat } from '@/components/chat/SupportChatProvider';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthContext';
import { AIChatbox } from '@/components/ui/AIChatbox';
import { LoadingSkeleton } from '@/components/ui/Feedback';
import { useDialogFocus } from '@/components/ui/useDialogFocus';
import { NotificationBell } from './NotificationBell';
import { AccountMenu } from './AccountMenu';
import { SidebarNavGroup } from './SidebarNavGroup';
import { SidebarHint } from './SidebarHint';
import sidebarStyles from './Sidebar.module.css';
import topbarStyles from './WorkspaceTopbar.module.css';
import canvasStyles from '@/components/ui/DottedCanvas.module.css';
import { ProfileAvatar, type AvatarUser } from '@/components/profile/ProfileAvatar';
import { adminNavItems, isAdminNavItemActive } from '@/lib/admin-navigation';
import { settingsRoute, helpRoute } from '@/lib/settings';
import neoStyles from '@/app/student/StudentCalendar.module.css';

export type NavItem = { label: string; href: string };
export const teacherNavigation: NavItem[] = [
  { label: 'Tổng quan', href: '/dashboard' }, { label: 'Ngân hàng câu hỏi', href: '/dashboard/question-banks' },
  { label: 'Đề thi', href: '/dashboard/exams' }, { label: 'Giám sát', href: '/dashboard/monitor' },
  { label: 'Lớp học', href: '/dashboard/classes' },
  { label: 'Lớp học trực tuyến', href: '/dashboard/live-classes' }, { label: 'Báo cáo', href: '/dashboard/reports' },
  { label: 'Hồ sơ giảng viên', href: '/teacher/profile' },
];

type ShellUser = AvatarUser & { email: string; role: string };
function NavigationPending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="ui-spinner" role="status" aria-label="Đang chuyển trang" data-navigation-pending /> : null;
}
export function WorkspaceShell({ children, user, navigation, contentClassName = '', showChat = true, showNotifications = true }: {
  children: ReactNode; user: ShellUser; navigation?: NavItem[]; contentClassName?: string; showChat?: boolean; showNotifications?: boolean;
}) {
  const pathname = usePathname(); const router = useRouter(); const { logout } = useAuth();
  const student = user.role === 'student';
  // This attribute selects visual density only; routing and access checks stay below.
  const experience = user.role === 'admin' || /^\/dashboard\/(monitor|reports)(\/|$)/.test(pathname) || /^\/dashboard\/exams\/[^/]+\/(report|attempts)(\/|$)/.test(pathname)
    ? 'analytics'
    : !student && !/^\/dashboard\/question-banks\/[^/]+\/documents(\/|$)/.test(pathname) && /^\/dashboard\/(question-banks|oral-grading|exams\/[^/]+\/grade)(\/|$)/.test(pathname) ? 'productivity' : 'learning';
  const { count: chatUnread } = useSupportChat();
  const area = student ? 'Khu vực sinh viên' : user.role === 'admin' ? 'Khu vực quản trị' : 'Khu vực giảng dạy';
  const items = user.role === 'admin' ? adminNavItems : navigation ?? teacherNavigation;
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [preferenceReady, setPreferenceReady] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const compact = desktop && collapsed;
  const testsActive = ['/student/exams', '/student/history', '/student/attempts'].some(href => pathname.startsWith(href));
  const sidebar = useRef<HTMLElement>(null);
  useDialogFocus(open, sidebar, () => setOpen(false));
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const closeOnDesktop = () => { setDesktop(!media.matches); if (!media.matches) setOpen(false); };
    closeOnDesktop();
    media.addEventListener('change', closeOnDesktop);
    return () => media.removeEventListener('change', closeOnDesktop);
  }, []);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem('proctoowl-sidebar-collapsed') === 'true'); } catch { /* Navigation still works when storage is unavailable. */ }
    setPreferenceReady(true);
    const sync = (event: StorageEvent) => { if (event.key === 'proctoowl-sidebar-collapsed' || event.key === null) setCollapsed(event.newValue === 'true'); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem('proctoowl-sidebar-collapsed', String(next)); } catch { /* A session-only preference is fine in restricted browsers. */ }
  };
  const navLink = (href: string, label: string, active?: boolean, hint = true) => {
    const current = active ?? (pathname === href || (href === '/dashboard' && pathname === '/teacher') || (!['/student', '/dashboard', '/admin', '/teacher'].includes(href) && pathname.startsWith(`${href}/`)));
    return <SidebarHint key={href} label={label} enabled={compact && hint}><Link href={href} className={current ? 'current' : ''} aria-current={current ? 'page' : undefined}><NavigationIcon href={href} /><span className="nav-label">{label}</span>{href === '/admin/messages' && chatUnread > 0 && <span className="support-nav-badge" aria-label={`${chatUnread} tin nhắn chưa đọc`}>{chatUnread > 99 ? '99+' : chatUnread}</span>}<NavigationPending /></Link></SidebarHint>;
  };

  return <div className={`app-shell ${sidebarStyles.shell} ${student ? 'student-app-shell' : ''} ${student && pathname === '/student' ? `neo-dashboard-shell ${neoStyles.neoShell}` : ''}`} data-role={user.role} data-experience={experience} data-sidebar-collapsed={compact}>
    <a href="#main-content" className="skip-link">Đến nội dung chính</a>
    {open && <button type="button" className="sidebar-backdrop" aria-label="Đóng menu bên ngoài" tabIndex={-1} onClick={() => setOpen(false)} />}
    <aside ref={sidebar} id="workspace-sidebar" className={`sidebar ${student ? 'student-sidebar' : ''} ${open ? 'open' : ''}`}
      role={open ? 'dialog' : undefined} aria-modal={open || undefined} aria-label="Menu điều hướng" tabIndex={-1}>
      <button type="button" className="icon-button shell-close-button" aria-label="Đóng menu" onClick={() => setOpen(false)}><X size={20} aria-hidden="true" /></button>
      <Link href={student ? '/student' : '/dashboard'} className="brand" aria-label="ProctoOwl — Trang chủ">ProctoOwl</Link>
      <SidebarHint enabled={compact} label="Hiện thanh điều hướng">
        <button type="button" className={`icon-button ${sidebarStyles.collapseToggle}`} disabled={!preferenceReady} aria-label={collapsed ? 'Hiện thanh điều hướng' : 'Thu gọn thanh điều hướng'} title={collapsed ? 'Hiện thanh điều hướng' : 'Thu gọn thanh điều hướng'} aria-expanded={!collapsed} aria-controls="workspace-sidebar" onClick={toggleCollapsed}>
          {collapsed ? <PanelLeftOpen size={21} aria-hidden="true" /> : <PanelLeftClose size={21} aria-hidden="true" />}
        </button>
      </SidebarHint>
      {student ? <SidebarHint enabled={compact} label={`${user.full_name} · Sinh viên`}><div className="student-profile" tabIndex={compact ? 0 : undefined} aria-label={compact ? `${user.full_name} · Sinh viên` : undefined}><ProfileAvatar user={user} className="student-avatar" decorative /><span><strong>{user.full_name}</strong><small>Sinh viên</small></span></div></SidebarHint>
        : <div className="role-label">{area}</div>}
      <nav aria-label={student ? 'Điều hướng sinh viên' : 'Điều hướng hệ thống'}>
        {student ? <>
          {navLink('/student', 'Trang chủ')}{navLink('/student/classes', 'Lớp học phần')}{navLink('/student/live-classes', 'Lớp học trực tuyến')}
          <SidebarNavGroup label="Bài kiểm tra" active={testsActive} pathname={pathname} compact={compact}>
            {navLink('/student/exams', 'Làm kiểm tra', pathname.startsWith('/student/exams') || pathname.startsWith('/student/attempts'), false)}{navLink('/student/history', 'Lịch sử làm bài', undefined, false)}
          </SidebarNavGroup>
          {navLink('/student/grades', 'Điểm số / Kết quả')}
        </> : items.filter(item=>item.href!==settingsRoute(user.role)).map(item => 'disabled' in item && item.disabled
          ? <span key={item.label} className="sidebar-disabled" aria-disabled="true">{item.label}</span>
          : 'children' in item ? <SidebarNavGroup key={item.label} label={item.label} active={isAdminNavItemActive(item, pathname)} pathname={pathname} compact={compact}>
            {item.children.map(child => navLink(child.href, child.label, isAdminNavItemActive(child, pathname), false))}
          </SidebarNavGroup>
          : navLink(item.href, item.label, user.role === 'admin' ? isAdminNavItemActive(item, pathname) : undefined))}
      </nav>
      <div className="sidebar-bottom">{navLink(settingsRoute(user.role), 'Cài đặt')}{navLink(helpRoute(user.role), 'Trợ giúp')}</div>
    </aside>
    <div className={`workspace ${student ? canvasStyles.canvas : ''}`}>
      <header className={`topbar ${topbarStyles.bar} ${student ? 'student-topbar' : ''}`}>
        <button type="button" className="icon-button shell-menu-button" disabled={!preferenceReady} aria-label="Mở menu" aria-expanded={open} aria-controls="workspace-sidebar" onClick={() => setOpen(true)}>
          <Menu size={20} aria-hidden="true" />
        </button>
        <div className="topbar-title">{area}</div>
        <div className="header-actions">{showNotifications && <NotificationBell />}<AccountMenu user={user} onLogout={() => { logout(); router.push('/login'); }} /></div>
      </header>
      <main id="main-content" tabIndex={-1} className={`shell-content ${contentClassName}`}>{children}</main>
      {student && <footer className="student-footer">Hệ thống thi trực tuyến ProctoOwl</footer>}
    </div>
    {showChat && pathname !== '/admin/messages' && <Suspense fallback={null}><AIChatbox /></Suspense>}
  </div>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname(); const router = useRouter(); const { user, authReady } = useAuth();
  const standalone = pathname === '/' || pathname === '/login' || pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/teacher' || pathname.startsWith('/teacher/');
  const adminOnlyDashboard = /^\/dashboard\/(users|action-logs)(\/|$)/.test(pathname);
  const wrongWorkspace = !!user && ((user.role !== 'admin' && adminOnlyDashboard) || (user.role === 'student' && (pathname === '/dashboard' || pathname.startsWith('/dashboard/'))) ||
    (user.role !== 'student' && (pathname === '/student' || pathname.startsWith('/student/'))));
  useEffect(() => {
    if (!standalone && authReady && !user) router.replace('/login');
    else if (authReady && user && wrongWorkspace) router.replace(user.role === 'student' ? '/student' : user.role === 'admin' ? '/admin' : '/dashboard');
  }, [standalone, authReady, user, router, wrongWorkspace]);
  if (standalone) return <>{children}</>;
  if (!authReady || !user || wrongWorkspace) return <div className="workspace-page"><LoadingSkeleton rows={3} /></div>;
  return <WorkspaceShell user={user} showChat={!pathname.startsWith('/live-class/')&&!pathname.startsWith('/student/attempts/')&&!pathname.includes('/verify')}>{children}</WorkspaceShell>;
}
