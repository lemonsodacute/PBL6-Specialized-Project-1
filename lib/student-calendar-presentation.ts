import type { CSSProperties } from 'react';
import { calendarDayKey, calendarEventOnDay, type CalendarEvent } from './student-calendar';

export type CalendarEntryKind = 'open' | 'close' | 'single' | 'ongoing';
export type CalendarDayEntry = { event: CalendarEvent; kind: CalendarEntryKind };

/** Stable across API ordering, visible months, refreshes and status changes. */
export function calendarEventAppearance(event: CalendarEvent): CSSProperties {
  const id = event.type === 'class' && event.courseId ? `course-${event.courseId}` : event.id;
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  // A wide pastel hue range avoids the frequent collisions of a five-color
  // modulo palette. No visible-event ordering or status participates in it.
  const hue = ((hash >>> 8) % 360000) / 1000;
  return {
    '--event-light-bg': `hsl(${hue} 64% 93%)`,
    '--event-light-border': `hsl(${hue} 38% 65%)`,
    '--event-light-accent': `hsl(${hue} 48% 34%)`,
    '--event-dark-bg': `hsl(${hue} 26% 23%)`,
    '--event-dark-border': `hsl(${hue} 32% 53%)`,
    '--event-dark-accent': `hsl(${hue} 64% 77%)`,
  } as CSSProperties;
}

export const isSingleDayCalendarEvent = (event: CalendarEvent) => !event.end || calendarDayKey(event.start) === calendarDayKey(event.end);

/** Endpoints are primary. Ongoing windows also remain discoverable today and
 * at the start of a window when their opening date is outside the view. */
export function calendarDayEntries(day: Date, events: CalendarEvent[], firstVisibleDay: Date, today: Date): CalendarDayEntry[] {
  const dateKey = calendarDayKey(day);
  return events.flatMap((event): CalendarDayEntry[] => {
    if (!calendarEventOnDay(event, day)) return [];
    if (isSingleDayCalendarEvent(event)) return [{ event, kind: 'single' }];
    if (dateKey === calendarDayKey(event.start)) return [{ event, kind: 'open' }];
    if (dateKey === calendarDayKey(event.end!)) return [{ event, kind: 'close' }];
    if (dateKey === calendarDayKey(today) || dateKey === calendarDayKey(firstVisibleDay)) return [{ event, kind: 'ongoing' }];
    return [];
  }).sort((a, b) => {
    const time = (entry: CalendarDayEntry) => entry.kind === 'close' ? entry.event.end!.getTime() : entry.event.start.getTime();
    return time(a) - time(b) || a.event.id.localeCompare(b.event.id);
  });
}
