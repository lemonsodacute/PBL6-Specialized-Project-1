import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Users } from 'lucide-react';
import { Button, Card, LoadingSkeleton, borderProps } from '@/components/ui';
import { CollectionToolbar, CollectionPagination, EmptySearchState, commonSorts } from '@/components/collections/CollectionToolbar';
import type { CollectionState } from '@/lib/collections';
import type { ClassRow } from './ClassCollection';
import { classIllustration, TeacherIdentity } from '@/components/teacher/TeachingCollectionHeader';
import styles from '@/components/teacher/TeachingCollection.module.css';

export type ClassCollectionListProps = {
  state: CollectionState; rows: ClassRow[]; total: number | null; loading: boolean; error: string; onRetry: () => Promise<void>;
};

/** Shared presentation only; the owning collection retains its API and permissions. */
export function ClassCollectionList({ state, rows, total, loading, error, onRetry, audience, accessDenied = false }: ClassCollectionListProps & {
  audience: 'teacher' | 'student'; accessDenied?: boolean;
}) {
  const student = audience === 'student';
  const prefix = student ? '/student/classes' : '/dashboard/classes';
  const partial = total != null && total > rows.length;
  const students = rows.every(row => Number.isFinite(row.students_count)) ? rows.reduce((sum, row) => sum + row.students_count, 0) : null;
  return <div className={`workspace-page ${student ? styles.studentPage : styles.page}`}>
    {student && accessDenied && <Card role="alert">Bạn không có quyền xem lớp học này.</Card>}
    <h1 className={styles.srOnlyTitle}>{student ? 'Lớp học phần' : 'Lớp học'}</h1>
    <Card className={`${styles.toolbarCard} ${styles.classToolbar}`}><CollectionToolbar state={state} searchLabel={student ? 'Tìm học phần' : 'Tìm lớp học'} placeholder="Nhập tên lớp hoặc mô tả..." sorts={commonSorts} /></Card>
    <div className={styles.listHeading}><h2>{student ? 'Danh sách học phần' : 'Danh sách lớp học'}</h2>{!loading && !error && <p>{rows.length} / {total ?? rows.length} {student ? 'học phần' : 'lớp'}{students != null && ` · ${students.toLocaleString('vi-VN')} lượt sinh viên${partial ? ' trên trang' : ''}`}</p>}</div>
    {error && <Card role="alert"><p>{error}</p><Button onClick={() => void onRetry()}>Thử lại</Button></Card>}
    {loading ? <LoadingSkeleton rows={4} /> : !error && (rows.length ? <div className={styles.list}>{rows.map((item, index) => {
      const period = item.name.match(/\bHK\s*\d+\s+\d{4}\s*[/-]\s*\d{4}\b/i)?.[0];
      return <article className={`${styles.classCard}${student ? ' student-course-card' : ''}`} key={item.id} {...borderProps('classes')}
        data-teaching-class={student ? undefined : true} data-student-class={student ? true : undefined} data-chat-avoid={student ? true : undefined}>
        <Image className={styles.classArt} src={classIllustration(item.id, item.name)} alt="" width={112} height={112} loading={index < 4 ? 'eager' : 'lazy'} />
        <div className={styles.classCopy}>{period && <span className={styles.period}>{period}</span>}<h3><Link href={`${prefix}/${item.id}`}>{item.name}</Link></h3><p>{item.description || 'Chưa có mô tả.'}</p></div>
        <div className={styles.classMeta}><TeacherIdentity name={item.teacher?.full_name} caption /><span className={styles.studentCount}><Users size={17} aria-hidden="true" />{Number.isFinite(item.students_count) ? `${item.students_count.toLocaleString('vi-VN')} sinh viên` : 'Chưa có sĩ số'}</span></div>
        <Link className={styles.openClass} href={`${prefix}/${item.id}`} aria-label={`Mở lớp ${item.name}`}><ArrowRight size={18} aria-hidden="true" /></Link>
      </article>;
    })}</div> : <Card className={styles.empty}><EmptySearchState mascot state={state} /></Card>)}
    <CollectionPagination state={state} total={total} count={rows.length} loading={loading} />
  </div>;
}
