import type { ReportsOverview } from './teacher-reports';
import type { ChartValue, TrendPoint } from '@/components/analytics/Charts';
import { resultStatusLabels } from './teacher-results';

export function submissionTrend(data: ReportsOverview): TrendPoint[] {
  const days = new Map<string, number>();
  for (const row of data.results) {
    if (!data.completed_statuses.includes(row.status) || !row.submitted_at || !Number.isFinite(Date.parse(row.submitted_at))) continue;
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(row.submitted_at));
    days.set(date, (days.get(date) ?? 0) + 1);
  }
  return [...days.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([date, value]) => ({ date, label: `${date.slice(8)}/${date.slice(5, 7)}`, value }));
}

export function attemptDistribution(data: ReportsOverview): ChartValue[] {
  const counts = new Map<string, number>();
  for (const row of data.results) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  return [...counts].map(([status, value]) => ({ label: resultStatusLabels[status as keyof typeof resultStatusLabels] ?? status, value,
    tone: status === 'submitted' ? 'brand' : status === 'in_progress' ? 'blue' : status === 'auto_submitted' ? 'warning' : 'critical' }));
}
