import Image from 'next/image';
import styles from './TeachingCollection.module.css';
import { borderProps, type BorderRole } from '@/components/ui/Border';

type Metric = { label: string; value: string | number; borderRole?: BorderRole };
export function TeachingCollectionHeader({ kind, metrics, audience = 'teacher' }: { kind: 'classes' | 'live'; metrics: Metric[]; audience?: 'teacher' | 'student' }) {
  const student = audience === 'student';
  const titleId = student ? `student-${kind}-title` : `teaching-${kind}-title`;
  return <section className={styles.hero} aria-labelledby={titleId} {...borderProps('classes')}>
    <div className={styles.heroCopy}>
      <h1 id={titleId}>{kind === 'classes' ? student ? 'Lớp học phần' : 'Lớp học' : 'Lớp học trực tuyến'}</h1>
      <p className={styles.intro}>{kind === 'classes' ? student ? 'Xem các học phần bạn tham gia, thông tin giảng viên và mở lớp để theo dõi bài kiểm tra, buổi học.' : 'Xem các lớp bạn phụ trách, sĩ số sinh viên và mở lớp để quản lý đề thi, thành viên và buổi học.' : 'Lên lịch buổi học, theo dõi trạng thái và bắt đầu phòng học khi giảng viên sẵn sàng.'}</p>
      <dl className={styles.metrics} aria-label="Số liệu danh sách">{metrics.map(metric => <div key={metric.label} {...borderProps(metric.borderRole ?? 'classes')}><dt>{metric.label}</dt><dd>{typeof metric.value === 'number' ? metric.value.toLocaleString('vi-VN') : metric.value}</dd></div>)}</dl>
    </div>
    <Image className={styles.heroArt} src={`/illustrations/classes/${kind}-hero.svg`} alt="" width={340} height={230} priority />
  </section>;
}

export function TeacherIdentity({ name, caption = false }: { name?: string | null; caption?: boolean }) {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const initials = parts.length ? `${parts[0][0]}${parts.length > 1 ? parts.at(-1)![0] : ''}`.toLocaleUpperCase('vi-VN') : '—';
  return <div className={styles.identity}><span className={styles.avatar} aria-hidden="true">{initials}</span><span>{caption && <small>Giảng viên</small>}<strong>{name || 'Chưa phân công'}</strong></span></div>;
}

export function classIllustration(id: string, name: string) {
  const text = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  const variants = ['software', 'web', 'code', 'ai'];
  const variant = /\bai\b|proctor|tri tue|machine learning/.test(text) ? 'ai'
    : /phan mem|kiem thu|software/.test(text) ? 'software'
    : /javascript|\bapi\b|\brest\b/.test(text) ? 'code'
    : /web|html|css/.test(text) ? 'web'
    : variants[Array.from(id).reduce((hash, character) => (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0, 0) % variants.length];
  return `/illustrations/classes/${variant}.svg`;
}
