import Image from 'next/image';
import Link from 'next/link';
import styles from './PublicHome.module.css';

export function PublicBrand() {
  return <Link href="/" className={styles.brand} aria-label="ProctoOwl — Trang chủ">
    <Image className={styles.brandMark} src="/proctoowl-mark.svg" alt="" width={40} height={40} />
    <span>ProctoOwl</span>
  </Link>;
}
