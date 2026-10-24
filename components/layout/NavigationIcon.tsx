import {
  LayoutDashboard, LibraryBig, ClipboardList, MonitorCheck, Users, Video,
  ChartNoAxesCombined, UserRound, Settings, CircleHelp, History, IdCard,
  MessagesSquare, BookOpen, Activity, GraduationCap,
} from 'lucide-react';

/** Navigation artwork only; route ownership stays in AppShell. */
export function NavigationIcon({ href = '', label = '' }: { href?: string; label?: string }) {
  const Icon = href.includes('question-bank') ? LibraryBig
    : href.includes('live-class') ? Video
    : href.includes('student-card') ? IdCard
    : href.includes('monitor') ? MonitorCheck
    : href.includes('action-log') || href.includes('history') ? History
    : href.includes('report') || href.includes('grade') ? ChartNoAxesCombined
    : href.includes('users') ? Users
    : href.includes('profile') ? UserRound
    : href.includes('settings') ? Settings
    : href.includes('help') ? CircleHelp
    : href.includes('messages') || label.includes('hỗ trợ') ? MessagesSquare
    : href.includes('knowledge') ? BookOpen
    : href.includes('activity') ? Activity
    : href.includes('classes') ? GraduationCap
    : href.includes('exams') || label.includes('kiểm tra') ? ClipboardList
    : LayoutDashboard;
  return <Icon className="nav-icon" aria-hidden="true" />;
}
