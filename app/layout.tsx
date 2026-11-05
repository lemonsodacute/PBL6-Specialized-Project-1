import type { Metadata } from 'next';
import { publicTypography } from '@/components/public/typography';
import './globals.css';
import './overrides.css';
import './reference-theme.css';
import './identity.css';
import './proctoowl-theme.css';
import './tokens.css';
import './design-system.css';
import './teacher-workspace.css';
import './exam-experience.css';
import './classroom.css';
import './theme.css';
import './ui-consistency.css';
import './support-chat.css';
import './proctoowl-ui.css';
import './student-visual.css';
import './analytics.css';
import './dark-polish.css';
import './teacher-surfaces.css';
import './functional-borders.css';
import { AppShell } from '@/components/layout/AppShell';
import { AuthProvider } from '@/components/auth/AuthContext';
import { ThemeProvider } from '@/components/settings/ThemeProvider';
import { themeBootstrap } from '@/lib/theme-bootstrap';
import { NotificationsProvider } from '@/components/notifications/NotificationsProvider';
import { SupportChatProvider } from '@/components/chat/SupportChatProvider';
import { ProctoringProvider } from '@/components/proctoring/ProctoringProvider';

export const metadata: Metadata = {
  title: 'ProctoOwl - Hệ thống thi trực tuyến',
  description: 'ProctoOwl hỗ trợ quản lý bài thi, xác minh danh tính và giám sát thi trực tuyến.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={publicTypography} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head>
      <body>
        <AuthProvider><ThemeProvider><ProctoringProvider><NotificationsProvider><SupportChatProvider><AppShell>{children}</AppShell></SupportChatProvider></NotificationsProvider></ProctoringProvider></ThemeProvider></AuthProvider>
      </body>
    </html>
  );
}
