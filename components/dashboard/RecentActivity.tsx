'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AttemptStatusBadge, Button, Card, EmptyState, LoadingSkeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/uiErrors';

type Activity = { id: string; exam_id: string; exam_title?: string; status: string; started_at: string; submitted_at?: string | null; score: number | string | null; max_score: number | string | null };

export function RecentActivity({ examTitles }: { examTitles: Record<string, string> }) {
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void api.attempts.mine({ limit: 3 }).then(response => {
      if (active) setItems(((response as unknown as { data?: Activity[] }).data ?? response) as Activity[]);
    }).catch(cause => { if (active) setError(friendlyError(cause, 'Không tải được hoạt động gần đây.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  return <Card className="recent-activity-card" role="region" aria-labelledby="recent-activity-title">
    <div className="card-toolbar"><h2 id="recent-activity-title">Hoạt động gần đây</h2><Link href="/student/history" className="table-link">Xem lịch sử</Link></div>
    {loading ? <LoadingSkeleton rows={2} /> : error ? <div role="alert"><p>{error}</p><Button variant="warning" onClick={() => setReload(value => value + 1)}>Tải lại hoạt động</Button></div>
      : items.length ? <div className="activity-list">{items.slice(0, 3).map(item => {
        const date = new Date(item.submitted_at ?? item.started_at);
        return <Link className="activity-row" key={item.id} href={`/student/attempts/${item.id}${item.status === 'in_progress' ? '' : '/result'}`}>
          <span><strong>{item.exam_title ?? examTitles[item.exam_id] ?? 'Bài thi'}</strong><small>{Number.isFinite(date.getTime()) ? date.toLocaleDateString('vi-VN') : 'Chưa có thời gian cập nhật'}</small></span>
          <span className="activity-result"><AttemptStatusBadge status={item.status} />{item.status !== 'in_progress' && item.score != null && <strong>{item.score} / {item.max_score ?? '—'}</strong>}</span>
        </Link>;
      })}</div> : <EmptyState title="Chưa có hoạt động làm bài">Các lượt thi và kết quả gần đây sẽ xuất hiện tại đây.</EmptyState>}
  </Card>;
}
