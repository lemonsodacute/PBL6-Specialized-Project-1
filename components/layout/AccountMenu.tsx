'use client';
import { ChevronDown, UserRound, LogOut } from 'lucide-react';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { usePathname } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { ProfileAvatar, type AvatarUser } from '@/components/profile/ProfileAvatar';
import styles from './AccountMenu.module.css';

export function AccountMenu({ user, onLogout }: {
  user: AvatarUser & { email: string; role: string };
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const closeOutside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const navigateMenu = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (current + 1) % items.length
      : event.key === 'ArrowUp' ? (current - 1 + items.length) % items.length : -1;
    if (next >= 0) {
      event.preventDefault();
      items[next]?.focus();
    }
  };

  return <div ref={root} className={`topbar-user ${styles.root}`}>
    <button ref={trigger} type="button" className={styles.trigger}
      aria-label={`Tài khoản của ${user.full_name}`} aria-haspopup="menu"
      aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen((value) => !value)}
      onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>
      <span className={`topbar-user-name ${styles.identity}`}><strong>{user.full_name}</strong><small>{user.email}</small></span>
      <ProfileAvatar user={user} className="topbar-avatar" decorative />
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <Card className={styles.panel}>
      <div className={styles.summary}><strong>{user.full_name || 'Tài khoản'}</strong><span>{user.email || 'Chưa cập nhật'}</span><span>{user.role === 'student' ? 'Sinh viên' : user.role === 'teacher' ? 'Giảng viên' : 'Quản trị viên'}</span></div>
      <div ref={menu} id={menuId} role="menu" aria-label="Tài khoản" onKeyDown={navigateMenu}>
        {['student', 'teacher'].includes(user.role) && <Link href={user.role === 'teacher' ? '/teacher/profile' : '/student/profile'} role="menuitem" tabIndex={-1} className={styles.item} onClick={() => setOpen(false)}>
          <UserRound size={19} aria-hidden="true" />
          {user.role === 'teacher' ? 'Hồ sơ giảng viên' : 'Hồ sơ sinh viên'}
        </Link>}
        <button type="button" role="menuitem" tabIndex={-1} className={`${styles.item} ${styles.logout}`} onClick={() => { setOpen(false); onLogout(); }}>
          <LogOut size={19} aria-hidden="true" />
          Đăng xuất
        </button>
      </div>
    </Card>}
  </div>;
}
