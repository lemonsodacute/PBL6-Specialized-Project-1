'use client';
import { borderProps } from '@/components/ui/Border';


import { ArrowRight, CalendarDays, ClipboardCheck, Video, ChartNoAxesCombined, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GreetingMascot } from '@/components/student/GreetingMascot';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge, Button, Card, EmptyState, LoadingSkeleton } from '@/components/ui';
import { RecentActivity } from '@/components/dashboard/RecentActivity';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/uiErrors';
import {readCalendarWindow} from '@/lib/calendar-collection';
import { useAuth } from '@/components/auth/AuthContext';
import { formatCalendarDate, formatCalendarTime } from '@/lib/calendar-date';
import { calendarDayKey as key, calendarEventStatus, mapCalendarEvents, type CalendarEvent as EventItem, type CalendarExam, type CalendarClass } from '@/lib/student-calendar';
import { calendarDayEntries, calendarEventAppearance, isSingleDayCalendarEvent, type CalendarDayEntry } from '@/lib/student-calendar-presentation';
import { StudentHeroExam } from '@/components/student/StudentHeroExam';
import styles from './StudentCalendar.module.css';

const monday = (date: Date) => { const result = new Date(date); result.setHours(0, 0, 0, 0); const day = result.getDay() || 7; result.setDate(result.getDate() - day + 1); return result; };
const monthDays = (date: Date) => {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = monday(first);
  const count = Math.ceil(((first.getDay() + 6) % 7 + new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()) / 7) * 7;
  return Array.from({ length: count }, (_, index) => { const day = new Date(start); day.setDate(day.getDate() + index); return day; });
};
type CalendarMode = 'month' | 'week' | 'day' | 'agenda';
type CalendarPopover = { event?: EventItem; day?: Date; entries?: CalendarDayEntry[]; top: number; left: number; pinned: boolean };

export default function StudentCalendar({ overview = false }: { overview?: boolean }) {
  const { user } = useAuth();
  const [cursor, setCursor] = useState(new Date()); const [mode, setMode] = useState<CalendarMode>('month');
  const [now, setNow] = useState(Date.now());
  const [popover, setPopover] = useState<CalendarPopover | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const popoverScroll = useRef({ x: 0, y: 0 });
  const restoringFocus = useRef(false);
  const dismissPopover = useCallback((returnFocus = false) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setPopover(null);
    if (returnFocus) { restoringFocus.current = true; triggerRef.current?.focus({ preventScroll: true }); restoringFocus.current = false; }
  }, []);
  const dialogId = useId();
  const [examTitles, setExamTitles] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<EventItem[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const refresh = () => { if (document.visibilityState === 'visible') { setNow(Date.now()); setReload(value => value + 1); } };
    const updated = (event: Event) => { const id = (event as CustomEvent<{ studentId?: string }>).detail?.studentId; if (!id || id === user?.id) refresh(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh); window.addEventListener('student-exam-updated', updated);
    return () => { window.clearInterval(tick); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('student-exam-updated', updated); };
  }, [user?.id]);
  useEffect(() => {
    setPopover(null);
    return () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  }, [cursor, mode, reload]);
  useEffect(() => {
    if (!popover) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismissPopover(true); };
    const hide = (event: Event) => {
      // A click may open the panel before the browser delivers its preceding
      // scroll-into-view event. Only a subsequent movement invalidates its anchor.
      if (event.type === 'scroll' && event.target === document && window.scrollX === popoverScroll.current.x && window.scrollY === popoverScroll.current.y) return;
      if (!(event.target instanceof Node) || !popoverRef.current?.contains(event.target)) setPopover(null);
    };
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !popoverRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setPopover(null); };
    document.addEventListener('keydown', escape); window.addEventListener('resize', hide); window.addEventListener('scroll', hide, true);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', escape); window.removeEventListener('resize', hide); window.removeEventListener('scroll', hide, true); document.removeEventListener('pointerdown', outside); };
  }, [popover, dismissPopover]);
  useEffect(() => { if (popover?.pinned) popoverRef.current?.focus({ preventScroll: true }); }, [popover?.pinned, popover?.event?.id, popover?.day]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void (async () => {
      try {
        const from=mode==='day'?new Date(cursor):mode==='week'?monday(cursor):monday(new Date(cursor.getFullYear(),cursor.getMonth(),1));from.setHours(0,0,0,0);
        const to=new Date(from);to.setDate(to.getDate()+(mode==='day'?1:mode==='week'?7:monthDays(cursor).length));
        const [exams,classes]=await Promise.all([readCalendarWindow<CalendarExam>(api.exams.list,from,to,()=>active),readCalendarWindow<CalendarClass>(api.liveClasses.list,from,to,()=>active)]);
        if (active) setExamTitles(Object.fromEntries(exams.map(exam => [exam.id, exam.title])));
        if (active) setEvents(mapCalendarEvents(exams, classes));
      } catch (cause) { if (active) setError(friendlyError(cause, 'Không tải được lịch học. Vui lòng thử lại.')); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [reload,cursor,mode,user?.id]);
  const days = useMemo(() => {
    if (mode === 'week') return Array.from({ length: 7 }, (_, index) => { const date = monday(cursor); date.setDate(date.getDate() + index); return date; });
    if (mode === 'day') return [cursor];
    return monthDays(cursor);
  }, [cursor, mode]);
  const calendarDays = useMemo(() => days.map(day => ({ day, entries: calendarDayEntries(day, events, days[0], new Date(now)) })), [days, events, now]);
  const statusOf = (event: EventItem) => calendarEventStatus(event, user?.id, now);
  const upcoming = events.filter(event => {
    const state = statusOf(event);
    return (event.end ?? event.start).getTime() >= now && (state.canRetry || !['submitted','auto_submitted','completed','graded','finalized','terminated'].includes(state.status)) && state.status !== 'ended' && state.status !== 'unavailable';
  }).sort((a, b) => a.start.getTime() - b.start.getTime());
  const nextExam = !loading && !error ? upcoming.find(event => event.type === 'exam') : undefined;
  const nextClass = !loading && !error ? upcoming.find(event => event.type === 'class') : undefined;
  const featuredExam = !loading && !error ? events.find(event => event.type === 'exam' && statusOf(event).status === 'in_progress') ?? nextExam : undefined;
  const shift = (direction: number) => {
    const next = new Date(cursor);
    if (mode === 'day' || mode === 'week') next.setDate(next.getDate() + direction * (mode === 'week' ? 7 : 1));
    else { next.setDate(1); next.setMonth(next.getMonth() + direction); }
    setCursor(next);
  };
  const windowDateTime = (date: Date | null) => date ? `${formatCalendarDate(date)} · ${formatCalendarTime(date)}` : 'Chưa có thông tin';
  const eventDetails = (event: EventItem, compact = false) => <>
    {compact && event.end && isSingleDayCalendarEvent(event) ? <>
      <small>{formatCalendarDate(event.start)}</small>
      <small className={styles.timeWindow}><time dateTime={event.start.toISOString()}>{formatCalendarTime(event.start)}</time> → <time dateTime={event.end.toISOString()}>{formatCalendarTime(event.end)}</time></small>
    </> : <>
      <small>{event.type === 'exam' ? 'Mở' : 'Bắt đầu'}: {windowDateTime(event.start)}</small>
      <small>{event.type === 'exam' ? 'Đóng' : 'Kết thúc'}: {windowDateTime(event.end)}</small>
    </>}
    {event.type === 'exam' && <small>Thời lượng làm bài: {event.durationMinutes !== undefined ? `${event.durationMinutes} phút` : 'Chưa có thông tin'}</small>}
    <small>Trạng thái: <strong className={styles.statusText}>{statusOf(event).label}</strong></small>
  </>;
  const eventLabel = (event: EventItem) => `${event.title}\n${event.courseNames?.join(', ') ?? ''}\nMở: ${windowDateTime(event.start)}\nĐóng: ${windowDateTime(event.end)}${event.type === 'exam' ? `\nThời lượng làm bài: ${event.durationMinutes !== undefined ? `${event.durationMinutes} phút` : 'Chưa có thông tin'}` : ''}\nTrạng thái: ${statusOf(event).label}`;
  const keepPopover = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  const closePopover = () => { if (!popover?.pinned) { keepPopover(); closeTimer.current = setTimeout(() => setPopover(null), 180); } };
  const openPopover = (content: { event: EventItem } | { day: Date; entries: CalendarDayEntry[] }, element: HTMLElement, pinned: boolean) => {
    if (restoringFocus.current || (!pinned && popover?.pinned)) return;
    keepPopover();
    triggerRef.current = element;
    const rect = element.getBoundingClientRect(), width = Math.min(380, window.innerWidth - 24);
    const height = 'day' in content ? 480 : 340;
    const top = rect.bottom + height + 12 < window.innerHeight ? rect.bottom + 6 : Math.max(12, rect.top - height - 6);
    popoverScroll.current = { x: window.scrollX, y: window.scrollY };
    setPopover({ ...content, pinned, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top });
  };
  const entrySummary = ({ event, kind }: CalendarDayEntry, compact = false) => kind === 'open' ? `MỞ${compact ? '' : ' ·'} ${formatCalendarTime(event.start)}`
    : kind === 'close' ? `ĐÓNG${compact ? '' : ' ·'} ${formatCalendarTime(event.end!)}`
      : kind === 'ongoing' ? statusOf(event).label
        : `${formatCalendarTime(event.start)}${event.end ? `${compact ? '–' : ' → '}${formatCalendarTime(event.end)}` : ' · Chưa có giờ đóng'}`;
  const renderEntry = (entry: CalendarDayEntry, agendaEntry = false) => {
    const { event, kind } = entry;
    const title = <span className={styles.entryTitle}>{event.title}</span>;
    const timing = <span className={styles.entryTiming}>{kind !== 'single' && <i className={styles.entryMarker} aria-hidden="true" />}{entrySummary(entry, !agendaEntry)}</span>;
    return <button type="button" className={`calendar-event ${event.type} ${event.type === 'class' ? 'live_class' : ''} ${styles.eventColor} ${styles.eventEntry} ${agendaEntry ? styles.agendaEntry : ''}`} data-border-role={event.type==='exam'?'exams':'classes'} style={{...calendarEventAppearance(event),...borderProps(event.type==='exam'?'exams':'classes').style}} key={event.id}
      data-event-id={event.id} data-status={statusOf(event).status} data-marker={kind} data-open-ended={!event.end || undefined} aria-label={`${entrySummary(entry)}. ${eventLabel(event)}`} aria-haspopup="dialog" aria-controls={popover?.event?.id === event.id ? dialogId : undefined} aria-expanded={popover?.event?.id === event.id}
      onMouseEnter={e => openPopover({ event }, e.currentTarget, false)} onMouseLeave={closePopover} onFocus={e => openPopover({ event }, e.currentTarget, false)} onBlur={closePopover} onClick={e => openPopover({ event }, e.currentTarget, true)}>
      {kind === 'single' ? <>{title}{timing}</> : <>{timing}{title}</>}
      {agendaEntry && <span className={styles.agendaSummary}>{event.courseNames?.join(' · ')}{event.durationMinutes !== undefined && `${event.courseNames?.length ? ' · ' : ''}${event.durationMinutes} phút làm bài`}</span>}
    </button>;
  };
  const moreEvents = (day: Date, entries: CalendarDayEntry[]) => entries.length > 3 && <button type="button" className={styles.moreEvents} aria-haspopup="dialog" aria-label={`Xem ${entries.length} sự kiện ngày ${formatCalendarDate(day)}`} onClick={e => openPopover({ day, entries }, e.currentTarget, true)}>+{entries.length - 3} sự kiện khác</button>;
  const periodLabel = mode === 'week'
    ? `${days[0].toLocaleDateString('vi-VN')} – ${days[6].toLocaleDateString('vi-VN')}`
    : mode === 'day' ? cursor.toLocaleDateString('vi-VN')
      : new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(cursor);
  const agenda = <div className={styles.agenda}>
    {events.length ? calendarDays.map(({ day, entries }) => {
      if (!entries.length && key(day) !== key(new Date(now))) return null;
      return <div className={styles.agendaDay} key={key(day)}>
        <h3>{key(day) === key(new Date(now)) ? 'Hôm nay · ' : ''}{day.toLocaleDateString('vi-VN', { weekday: 'short', day: 'numeric', month: 'numeric' })}</h3>
        {entries.length ? <>{entries.slice(0, 3).map(entry => renderEntry(entry, true))}{moreEvents(day, entries)}</> : <p className={styles.muted}>Không có sự kiện trong ngày.</p>}
      </div>;
    }) : <EmptyState title="Chưa có lịch học hoặc lịch thi">Không có sự kiện trong khoảng lịch đang xem.</EmptyState>}
  </div>;
  return <div className={`workspace-page student-calendar-page ${styles.page} ${overview ? styles.neoPage : ''}`}>
    {overview && <>
      <header className={styles.welcome} {...borderProps('users')}>
        <div><p>Xin chào, <strong>{user?.full_name ?? 'bạn'}</strong></p><h1>Hôm nay bạn có gì?</h1><span>Lên kế hoạch học tập, sẵn sàng cho kỳ thi tiếp theo.</span></div>
        <GreetingMascot className={styles.welcomeMascot} />
        <div className={styles.todayNote}><CalendarDays size={22} aria-hidden="true" /><time dateTime={new Date(now).toISOString()}>{new Date(now).toLocaleDateString('vi-VN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}</time></div>
      </header>
      {featuredExam ? <StudentHeroExam event={featuredExam} user={user} now={now} /> : !loading && !error && <div className={styles.noNextExam}><ClipboardCheck size={23} aria-hidden="true"/><div><strong>Chưa có kỳ thi sắp tới trong khoảng lịch đang xem.</strong><p>Bạn có thể xem các bài kiểm tra trong danh sách của mình.</p></div><Link href="/student/exams">Xem bài kiểm tra<ArrowRight size={17} aria-hidden="true"/></Link></div>}
      <nav className={styles.learningCards} aria-label="Không gian học tập">
        <Link href="/student/live-classes" className={styles.learningCard} {...borderProps('classes')} data-kind="live"><span className={styles.learningIcon}><Video size={24} aria-hidden="true" /></span><div><h3>Lớp học trực tuyến</h3><p>{nextClass ? nextClass.title : 'Mở không gian lớp học của bạn'}</p></div><ArrowRight size={20} aria-hidden="true" /></Link>
        <Link href="/student/exams" className={styles.learningCard} {...borderProps('exams')} data-kind="exam"><span className={styles.learningIcon}><ClipboardCheck size={24} aria-hidden="true" /></span><div><h3>Bài kiểm tra</h3><p>Tiếp tục, làm bài hoặc xem lịch thi</p></div><ArrowRight size={20} aria-hidden="true" /></Link>
        <Link href="/student/grades" className={styles.learningCard} {...borderProps('success')} data-kind="result"><span className={styles.learningIcon}><ChartNoAxesCombined size={24} aria-hidden="true" /></span><div><h3>Điểm số / Kết quả</h3><p>Xem kết quả các bài đã hoàn thành</p></div><ArrowRight size={20} aria-hidden="true" /></Link>
      </nav>
    </>}
    <div className={overview ? styles.mainGrid : undefined}>
    <section id="student-calendar" aria-labelledby="student-calendar-title" className={styles.calendarSection}>
      <div className={styles.sectionHeader}>
        <h2 id="student-calendar-title" className="calendar-title">Lịch học và lịch thi</h2>
        <select className={styles.modeSelect} aria-label="Chế độ xem lịch" value={mode} onChange={event => setMode(event.target.value as CalendarMode)}>
          <option value="month">Theo tháng</option><option value="week">Theo tuần</option><option value="day">Theo ngày</option><option value="agenda">Lịch trình</option>
        </select>
      </div>
      <Card className={`calendar-card ${styles.refinedCalendar}`}>
        <div className="calendar-toolbar"><button type="button" aria-label="Lịch trước" onClick={() => shift(-1)}><ChevronLeft size={18} aria-hidden="true" /></button><button type="button" className={styles.todayButton} onClick={() => setCursor(new Date())}>Hôm nay</button><button type="button" aria-label="Lịch tiếp theo" onClick={() => shift(1)}><ChevronRight size={18} aria-hidden="true" /></button><strong>{periodLabel}</strong></div>
        {loading ? <LoadingSkeleton rows={4} /> : error ? <div role="alert" className={styles.feedback}><p className="form-error">{error}</p><Button variant="warning" onClick={() => setReload(value => value + 1)}>Thử lại</Button></div>
          : mode === 'agenda' ? agenda : <>
            <div className={styles.desktopGrid}><div className={`calendar-grid ${mode}`}><div className="calendar-weekdays">{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(day => <span key={day}>{day}</span>)}</div>
              {calendarDays.map(({ day, entries }) => <div className={`calendar-day ${day.getMonth() !== cursor.getMonth() && mode === 'month' ? 'outside' : ''} ${key(day) === key(new Date(now)) ? 'today' : ''}`} data-date={formatCalendarDate(day)} key={key(day)}>
                <span aria-current={key(day) === key(new Date(now)) ? 'date' : undefined}>{mode === 'month' ? day.getDate() : day.toLocaleDateString('vi-VN', { weekday: 'short', day: 'numeric' })}</span>
                <div className={styles.dayEntries}>{entries.slice(0, 3).map(entry => renderEntry(entry))}{moreEvents(day, entries)}</div>
              </div>)}
            </div></div>
            <div className={styles.mobileAgenda}>{agenda}</div>
          </>}
        <div className={`calendar-legend ${styles.markerLegend}`} aria-label="Ký hiệu lịch"><span><i className={styles.openMarker} aria-hidden="true" />Ngày mở</span><span><i className={styles.closeMarker} aria-hidden="true" />Ngày đóng</span><span>Giờ mở → giờ đóng: cùng ngày</span><small>Màu theo từng bài thi / buổi học.</small></div>
      </Card>
    </section>
    {overview && <>
      <section aria-labelledby="upcoming-title" className={styles.upcomingSection}>
        <Card className={styles.compactCard}><div className={styles.sectionHeader}><h2 id="upcoming-title">Sắp diễn ra</h2><Link className="table-link" href="#student-calendar">Xem toàn bộ lịch</Link></div>
          {loading ? <LoadingSkeleton rows={2} /> : error ? <p className={styles.muted}>Chưa tải được sự kiện. Vui lòng thử lại ở lịch phía trên.</p>
            : upcoming.length ? <div className={styles.upcomingList}>{upcoming.slice(0, 3).map(event => <div className={`${styles.eventRow} ${styles.eventColor} ${styles.upcomingEvent}`} data-border-role={event.type==='exam'?'exams':'classes'} style={{...calendarEventAppearance(event),...borderProps(event.type==='exam'?'exams':'classes').style}} data-event-id={event.id} data-event-type={event.type === 'exam' ? 'exam' : 'live'} key={event.id} data-chat-avoid>
              <div className={styles.upcomingLabel}><span className={styles.upcomingIcon}>{event.type === 'exam' ? <ClipboardCheck size={18} aria-hidden="true" /> : <Video size={18} aria-hidden="true" />}</span><Badge tone={event.type === 'exam' ? 'info' : 'purple'}>{statusOf(event).label}</Badge></div>
              <div><h3>{event.title}</h3>{event.courseNames?.length ? <p className={styles.courseNames}>{event.courseNames.join(' · ')}</p> : null}{eventDetails(event, true)}</div><Link className="table-link" href={event.href} aria-label={`Xem ${event.title}`}>{event.exam && statusOf(event).canRetry ? 'Làm lại bài thi' : 'Xem chi tiết'}<ArrowRight size={16} aria-hidden="true" /></Link>
            </div>)}</div> : <p className={styles.muted}>Không có sự kiện sắp tới trong khoảng lịch đang xem.</p>}
        </Card>
      </section>
    </>}
    </div>
    {overview && <>
      <RecentActivity examTitles={examTitles} />
      <nav className={`quick-actions ${styles.quickLinks}`} aria-label="Liên kết nhanh">
        <Link className="ui-button ui-button-outline" href="/student/exams">Bài kiểm tra</Link><Link className="ui-button ui-button-outline" href="/student/classes">Lớp học phần</Link><Link className="ui-button ui-button-outline" href="/student/grades">Kết quả</Link>
      </nav>
    </>}
    {popover && createPortal(<aside ref={popoverRef} id={dialogId} tabIndex={-1} role="dialog" data-student-presentation="true" aria-label={popover.day ? `Sự kiện ngày ${formatCalendarDate(popover.day)}` : 'Chi tiết sự kiện'} className={`${styles.eventPopover} ${styles.refinedPopover}`} style={{ top: popover.top, left: popover.left, maxHeight: `calc(100dvh - ${popover.top + 12}px)` }} onMouseEnter={keepPopover} onMouseLeave={closePopover} onFocus={keepPopover} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) dismissPopover(); }}>
      <div className={styles.popoverHeader}><span>{popover.day ? formatCalendarDate(popover.day) : 'Chi tiết sự kiện'}</span><button type="button" aria-label="Đóng chi tiết lịch" onClick={() => dismissPopover(true)}><X size={18} aria-hidden="true" /></button></div>
      {(popover.event ? [popover.event] : popover.entries!.map(entry => entry.event)).map(event => <article className={`${styles.eventColor} ${styles.popoverEvent}`} data-border-role={event.type==='exam'?'exams':'classes'} style={{...calendarEventAppearance(event),...borderProps(event.type==='exam'?'exams':'classes').style}} data-event-id={event.id} key={event.id}>
        <h3>{event.title}</h3>
        {event.courseNames?.length ? <p className={styles.courseNames}>{event.courseNames.join(' · ')}</p> : null}
        {eventDetails(event)}
        <Link href={event.href} className="table-link">{event.exam && statusOf(event).canRetry ? 'Làm lại bài thi' : 'Xem chi tiết'}<ArrowRight size={16} aria-hidden="true" /></Link>
      </article>)}
    </aside>, document.body)}
  </div>;
}
