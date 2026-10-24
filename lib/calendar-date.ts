// Keep the exam availability window separate from the attempt duration.
export const formatCalendarTime = (value: Date) => value.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
export const formatCalendarDate = (value: Date) => value.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
export function formatCalendarDateTime(value: Date | string | null | undefined) {
  if (!value) return 'Chưa có thông tin';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? `${formatCalendarTime(date)} ${formatCalendarDate(date)}` : 'Chưa có thông tin';
}
