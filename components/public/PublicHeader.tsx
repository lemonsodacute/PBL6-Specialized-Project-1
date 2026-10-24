'use client';

import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { PublicBrand } from './PublicBrand';
import styles from './PublicHome.module.css';

const links = [
  { href: '#trang-chu', label: 'Trang chủ' },
  { href: '#tinh-nang', label: 'Tính năng' },
  { href: '#cach-hoat-dong', label: 'Cách hoạt động' },
  { href: '#ho-tro', label: 'Hỗ trợ' },
];

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => navigation.current?.querySelector('a')?.focus());
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => {
    const desktop = matchMedia('(min-width: 901px)');
    const close = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener('change', close);
    return () => desktop.removeEventListener('change', close);
  }, []);

  return <header ref={header} className={styles.header}>
    <div className={`${styles.container} ${styles.headerInner}`}>
      <PublicBrand />
      <nav ref={navigation} id="public-navigation" aria-label="Điều hướng trang chủ" className={`${styles.navigation} ${open ? styles.navigationOpen : ''}`} onClick={() => setOpen(false)}>
        {links.map(link => <a key={link.href} href={link.href} aria-current={link.href === '#trang-chu' ? 'page' : undefined}>{link.label}</a>)}
        <a className={`${styles.button} ${styles.primaryButton} ${styles.mobileRegister}`} href="/login?mode=register">Đăng ký</a>
      </nav>
      <div className={styles.headerActions}>
        <a href="/login" className={styles.loginLink}>Đăng nhập</a>
        <a href="/login?mode=register" className={`${styles.button} ${styles.primaryButton} ${styles.desktopRegister}`}>Bắt đầu</a>
        <button ref={toggle} type="button" className={styles.menuToggle} aria-label={open ? 'Đóng menu' : 'Mở menu'} aria-expanded={open} aria-controls="public-navigation" onClick={() => setOpen(value => !value)}>
          {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </div>
    </div>
  </header>;
}
