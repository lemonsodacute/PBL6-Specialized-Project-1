import type { CSSProperties } from 'react';

export type TagKind = 'role' | 'category' | 'status';
export type TagTone = 'orange' | 'teal' | 'purple' | 'red' | 'green' | 'gray';
const palette: readonly TagTone[] = ['orange', 'teal', 'purple', 'red', 'green'];
const normalize = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim().replace(/\s+/g, ' ');
const known: Record<TagKind, Readonly<Record<string, TagTone>>> = {
  role: { student: 'purple', 'sinh vien': 'purple', teacher: 'teal', 'giang vien': 'teal', admin: 'red', 'quan tri vien': 'red' },
  category: { 'student-card': 'orange', 'the sinh vien': 'orange' },
  status: { active: 'green', true: 'green', 'dang su dung': 'green', inactive: 'gray', false: 'gray', 'da tam ngung': 'gray' },
};

/** Presentation only: colors depend on the tag, never article order or IDs. */
export function tagTone(name: string, kind: TagKind): TagTone {
  const key = normalize(name);
  if (Object.hasOwn(known[kind], key)) return known[kind][key];
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return palette[(hash >>> 0) % palette.length];
}

export function tagStyle(name: string, kind: TagKind): CSSProperties {
  const tone = tagTone(name, kind);
  return { '--tag-color': `var(--tag-${tone})`, '--tag-soft': `var(--tag-${tone}-soft)`, '--tag-ink': `var(--tag-${tone}-ink)` } as CSSProperties;
}
