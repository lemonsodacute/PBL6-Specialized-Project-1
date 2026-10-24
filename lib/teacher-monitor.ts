import { readCollection, type ListParams } from './collection-query';

export type MonitoringExam = {
  id: string; title: string; status: string; start_time: string; end_time: string;
  classes: { id: string; name: string }[];
  attempt_count?: number; completed_attempt_count?: number;
};
export type MonitoringPhase = 'open' | 'upcoming' | 'ended' | 'unknown';
export const monitoringPhases: MonitoringPhase[] = ['open', 'upcoming', 'ended', 'unknown'];
export const monitoringLabels: Record<MonitoringPhase, string> = {
  open: 'Đang diễn ra', upcoming: 'Sắp diễn ra', ended: 'Đã kết thúc', unknown: 'Chưa xác định thời gian',
};

export function monitoringPhase(exam: MonitoringExam, now = Date.now()): MonitoringPhase {
  if (exam.status === 'closed') return 'ended';
  const start = Date.parse(exam.start_time), end = Date.parse(exam.end_time);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'unknown';
  if (now >= end) return 'ended';
  if (now < start) return 'upcoming';
  return 'open';
}

// Read every server page before grouping: active exams must not be hidden
// behind older exams on another page. Existing endpoints and permissions apply.
export async function readAllPages<T>(loader: (params: ListParams) => Promise<unknown>, params: ListParams = {}): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const result = readCollection<T>(await loader({ ...params, page, limit: 100 }));
    rows.push(...result.data);
    if (!result.data.length || (result.meta?.total !== undefined ? rows.length >= result.meta.total : result.data.length < 100)) return rows;
  }
}

export function monitoringPage(exams: MonitoringExam[], params: ListParams, now = Date.now()) {
  const phase = String(params.period ?? '');
  const rows = exams.filter(exam => ['published', 'ongoing', 'closed'].includes(exam.status)
    && (!phase || monitoringPhase(exam, now) === phase));
  const time = (value: string) => Date.parse(value) || 0;
  rows.sort((a, b) => {
    const group = monitoringPhases.indexOf(monitoringPhase(a, now)) - monitoringPhases.indexOf(monitoringPhase(b, now));
    if (group) return group;
    if (params.sort === 'name') return a.title.localeCompare(b.title, 'vi') || a.id.localeCompare(b.id);
    const status = monitoringPhase(a, now);
    // Closest upcoming start / active end; most recent ended exam first.
    return (status === 'upcoming' ? time(a.start_time) - time(b.start_time)
      : status === 'ended' ? time(b.end_time) - time(a.end_time)
      : time(a.end_time) - time(b.end_time)) || a.id.localeCompare(b.id);
  });
  const page = Number(params.page ?? 1), limit = Number(params.limit ?? 20);
  return { data: rows.slice((page - 1) * limit, page * limit), meta: { total: rows.length, page, limit } };
}

export function monitoringCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}
