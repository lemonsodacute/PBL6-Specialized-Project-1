'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChartNoAxesCombined } from 'lucide-react';
import { borderProps, type BorderRole } from '@/components/ui/Border';

export type ChartTone = 'brand' | 'blue' | 'purple' | 'positive' | 'warning' | 'critical';
export type ChartValue = { label: string; value: number; tone?: ChartTone };
export type TrendPoint = { date: string; label: string; value: number };
export const formatMetric = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const compact = (value: number) => value.toLocaleString('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
const validValues = (items: ChartValue[]) => items.length > 0 && items.every(item => Number.isFinite(item.value) && item.value >= 0);

export function ChartCard({ title, description, action, footer, children, className = '', borderRole }: { title: string; description: string; action?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string; borderRole?: BorderRole }) {
  const titleId = useId();
  return <section className={`an-card ${className}`} aria-labelledby={titleId} {...borderProps(borderRole)}>
    <header className="an-card-header"><div><h2 id={titleId}>{title}</h2><p>{description}</p></div>{action}</header>
    <div className="an-card-body">{children}</div>
    {footer && <footer className="an-card-footer" data-chat-avoid>{footer}</footer>}
  </section>;
}

export function ChartEmpty({ detail = 'Dữ liệu sẽ xuất hiện khi có hoạt động được ghi nhận.' }: { detail?: string }) {
  return <div className="an-empty" role="status"><span><ChartNoAxesCombined size={24} aria-hidden="true" /></span><strong>Chưa có đủ dữ liệu để hiển thị biểu đồ</strong><p>{detail}</p></div>;
}

export function KpiCard({ label, value, detail, icon, tone = 'brand', borderRole }: { label: string; value: ReactNode; detail: string; icon: ReactNode; tone?: ChartTone; borderRole?: BorderRole }) {
  return <article className="an-kpi" data-tone={tone} {...borderProps(borderRole)}><div><span>{label}</span><span className="an-kpi-icon">{icon}</span></div><strong>{value}</strong><p>{detail}</p></article>;
}

export function DonutChart({ items, label, totalLabel = 'Tổng cộng' }: { items: ChartValue[]; label: string; totalLabel?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const selected = active == null ? undefined : items[active];
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!validValues(items) || total <= 0 || !Number.isFinite(total)) return <ChartEmpty />;
  let offset = 0;
  return <div className="an-donut-layout">
    <div className="an-donut" data-chat-avoid>
      <svg viewBox="0 0 200 200" role="group" aria-label={label}>
        <circle className="an-donut-track" cx="100" cy="100" r="76" fill="none" strokeWidth="19" />
        {items.map((item, index) => {
          const fraction = item.value / total, start = offset; offset += fraction * 100;
          return item.value > 0 && <circle key={item.label} className="an-donut-segment" data-tone={item.tone ?? 'brand'} cx="100" cy="100" r="76" fill="none" strokeWidth={active === index ? 23 : 19} pathLength="100" strokeDasharray={`${fraction * 100} ${100 - fraction * 100}`} strokeDashoffset={-start} transform="rotate(-90 100 100)" tabIndex={0} role="img" aria-label={`${item.label}: ${formatMetric(item.value)}, ${formatMetric(fraction * 100)}%`} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)}><title>{item.label}: {formatMetric(item.value)} ({formatMetric(fraction * 100)}%)</title></circle>;
        })}
      </svg>
      <div className="an-donut-center" aria-live="polite"><strong>{compact(selected?.value ?? total)}</strong><span>{selected?.label ?? totalLabel}</span></div>
    </div>
    <ul className="an-legend" data-chat-avoid>{items.map(item => <li key={item.label} data-tone={item.tone ?? 'brand'}><span className="an-swatch" aria-hidden="true" /><span>{item.label}<small>{formatMetric(item.value / total * 100)}%</small></span><strong>{formatMetric(item.value)}</strong></li>)}</ul>
  </div>;
}

export function BarChart({ items, label }: { items: ChartValue[]; label: string }) {
  const maximum = Math.max(...items.map(item => item.value), 0);
  if (!validValues(items) || maximum <= 0) return <ChartEmpty />;
  return <ul className="an-bars" aria-label={label} data-chat-avoid>{items.map(item => <li key={item.label} data-tone={item.tone ?? 'brand'}>
    <div><span>{item.label}</span><strong>{formatMetric(item.value)}</strong></div>
    <svg viewBox="0 0 400 12" preserveAspectRatio="none" role="img" aria-label={`${item.label}: ${formatMetric(item.value)}`}><rect className="an-bar-track" width="400" height="12" rx="6" /><rect className="an-bar-fill" width={item.value / maximum * 400} height="12" rx="6"><title>{item.label}: {formatMetric(item.value)}</title></rect></svg>
  </li>)}</ul>;
}

export function AreaChart({ points, label }: { points: TrendPoint[]; label: string }) {
  const gradientId = useId();
  const [active, setActive] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const node = plot.current;
    if (!node) return;
    const resize = new ResizeObserver(entries => {
      const available = entries[0]?.contentRect.width ?? 0;
      if (available > 0) setWidth(Math.max(260, Math.round(available)));
    });
    resize.observe(node);
    return () => resize.disconnect();
  }, [points.length]);
  if (points.length < 4 || points.some(point => !Number.isFinite(Date.parse(point.date)) || !Number.isFinite(point.value) || point.value < 0)) return <ChartEmpty detail="Cần ít nhất 4 ngày có bài nộp trong dữ liệu đang hiển thị. Các ngày chưa có bản ghi không được suy diễn thành 0." />;
  const start = Date.parse(points[0].date), end = Date.parse(points[points.length - 1].date);
  if (end <= start) return <ChartEmpty />;
  const maximum = Math.max(1, Math.ceil(Math.max(...points.map(point => point.value)) / 4) * 4);
  const right = width - 22;
  const coordinates = points.map(point => ({ x: 42 + (Date.parse(point.date) - start) / (end - start) * (right - 42), y: 218 - point.value / maximum * 184 }));
  const path = coordinates.reduce((result, point, index) => {
    if (!index) return `M ${point.x},${point.y}`;
    const previous = coordinates[index - 1], middle = (previous.x + point.x) / 2;
    return `${result} C ${middle},${previous.y} ${middle},${point.y} ${point.x},${point.y}`;
  }, '');
  const selected = active == null ? null : points[active];
  const tickIndexes = [...new Set([0, Math.floor((points.length - 1) / 3), Math.floor((points.length - 1) * 2 / 3), points.length - 1])];
  return <div className="an-area">
    <div className="an-chart-caption"><span><i className="an-swatch" />{label}</span><span>Đơn vị: lượt · ngày có bản ghi</span></div>
    <div className="an-plot" ref={plot} data-chat-avoid>
      <svg viewBox={`0 0 ${width} 260`} role="group" aria-label={label}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-brand)" stopOpacity=".2" /><stop offset="100%" stopColor="var(--chart-brand)" stopOpacity=".01" /></linearGradient></defs>
        {[0, 1, 2, 3, 4].map(tick => <g key={tick}><line className="an-grid-line" x1="42" x2={right} y1={218 - tick * 46} y2={218 - tick * 46} /><text className="an-axis" x="30" y={222 - tick * 46} textAnchor="end">{compact(maximum * tick / 4)}</text></g>)}
        <path d={`${path} L ${right},218 L 42,218 Z`} fill={`url(#${gradientId})`} />
        <path className="an-area-line" d={path} fill="none" strokeWidth="2.5" />
        {tickIndexes.map(index => <text className="an-axis" key={points[index].date} x={coordinates[index].x} y="246" textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{points[index].label}</text>)}
        {coordinates.map((point, index) => <g key={points[index].date} tabIndex={0} role="img" aria-label={`${points[index].label}: ${formatMetric(points[index].value)} ${label}`} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)}>
          <circle className="an-point-target" cx={point.x} cy={point.y} r="13" /><circle className="an-point" cx={point.x} cy={point.y} r={active === index ? 5 : 3.5} /><title>{points[index].label}: {formatMetric(points[index].value)}</title>
        </g>)}
      </svg>
      {selected && <div className="an-tooltip" role="status"><span>{selected.date}</span><strong>{label}: {formatMetric(selected.value)}</strong></div>}
    </div>
    <details className="an-data-details"><summary>Xem dữ liệu biểu đồ</summary><div className="an-data-table"><table><caption>{label}</caption><thead><tr><th>Ngày nộp (giờ Việt Nam)</th><th>Số lượt</th></tr></thead><tbody>{points.map(point => <tr key={point.date}><td>{point.date}</td><td>{formatMetric(point.value)}</td></tr>)}</tbody></table></div></details>
  </div>;
}
