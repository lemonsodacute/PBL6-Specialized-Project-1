'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Card, LoadingSkeleton } from '@/components/ui';
import { eventLabels, proctorApi, type ProctorReport as ReportData } from '@/lib/proctoring';
import { useProctorRealtime } from './ProctoringProvider';
import { useAuth } from '@/components/auth/AuthContext';
import styles from './ProctorConsole.module.css';

export function ProctorReport({ examId }: { examId: string }) {
  const { user } = useAuth();
  return <ReportBody key={`${user?.id}|${examId}`} examId={examId} />;
}

function ReportBody({ examId }: { examId: string }) {
  const realtime = useProctorRealtime();
  const [data, setData] = useState<ReportData | null>(null), [simulated, setSimulated] = useState(false);
  const [error, setError] = useState(false), [retry, setRetry] = useState(0), [allowSimulator, setAllowSimulator] = useState(false);
  useEffect(() => {
    let active = true; setData(null); setError(false);
    void proctorApi.report(examId, simulated).then(result => {
      if (result.exam_id !== examId || result.is_simulated !== simulated) throw new Error('Invalid report scope');
      if (active) setData(result);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [examId, simulated, retry, realtime.revision]);
  useEffect(() => {
    let active = true;
    void proctorApi.health(examId).then(result => { if (active) setAllowSimulator(result.simulator_enabled); }).catch(() => {});
    return () => { active = false; };
  }, [examId]);
  const scope = simulated ? '?simulation=1' : '';
  return <Card className={styles.report}>
    <div className={styles.sectionHeading}><div><h2>Tổng hợp cảnh báo giám sát</h2><p>Tín hiệu và quyết định đã lưu của giám thị.</p></div>
      <Link className={styles.back} href={`/dashboard/monitor/${examId}${scope}`}>Xem cảnh báo</Link></div>
    {allowSimulator && <div className={styles.scopeLinks}>
      <Button variant={simulated ? 'outline' : 'primary'} onClick={() => setSimulated(false)}>Cảnh báo thực tế</Button>
      <Button variant={simulated ? 'primary' : 'outline'} onClick={() => setSimulated(true)}>Mô phỏng</Button>
    </div>}
    {simulated && <p className={styles.simulation}>Mô phỏng · Báo cáo kiểm thử riêng, không thuộc số liệu thực tế.</p>}
    {error ? <div className={styles.error} role="alert">Chưa tải được tổng hợp cảnh báo.<Button variant="outline" onClick={() => setRetry(value => value + 1)}>Thử lại</Button></div>
      : !data ? <LoadingSkeleton rows={2} /> : <>
        <div className={styles.metrics}>{[
          ['Tổng cảnh báo', data.summary.total], ['Đã xác nhận', data.summary.confirmed], ['Đã bỏ qua', data.summary.dismissed],
          ['Chưa xem', data.summary.new], ['Đã xem, chờ quyết định', data.summary.reviewed],
        ].map(([label, count]) => <div className={styles.metric} key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>
        <div className={styles.reportColumns}><section><h3>Theo loại sự kiện</h3>
          {data.types.length ? <ul className={styles.breakdown}>{data.types.map(type => <li key={type.event_type}><span>{eventLabels[type.event_type] ?? type.event_type}</span><strong>{type.count}</strong></li>)}</ul> : <p className={styles.muted}>Chưa ghi nhận cảnh báo.</p>}
        </section><section><h3>Sinh viên cần xem xét</h3>
          {data.students_requiring_review.length ? <ul className={styles.breakdown}>{data.students_requiring_review.map(student => <li key={student.id}>
            <Link className={styles.back} href={`/dashboard/monitor/${examId}?${simulated ? 'simulation=1&' : ''}q=${encodeURIComponent(student.student_code || student.full_name)}`}>{student.full_name}{student.student_code ? ` · ${student.student_code}` : ''}</Link><strong>{student.count}</strong>
          </li>)}</ul> : <p className={styles.muted}>Không có cảnh báo đang chờ xem xét.</p>}
        </section></div>
      </>}
    <p className={styles.disclaimer}>Cảnh báo là tín hiệu cần xem xét. Quyết định xác nhận không tự động thay đổi điểm thi.</p>
  </Card>;
}
