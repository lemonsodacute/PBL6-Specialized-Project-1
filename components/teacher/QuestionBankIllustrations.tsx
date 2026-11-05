'use client';

import { useId } from 'react';
import { ProctoOwlArtwork } from '@/components/brand/ProctoOwlMascot';
import type { Bank } from '@/lib/question-selection';

const covers = ['testing', 'architecture', 'web', 'api', 'network', 'project'] as const;

/** Decoration follows the subject; unknown banks keep the same cover when sorted. */
export function questionBankCover(bank: Pick<Bank, 'id' | 'name' | 'subject'>) {
  const text = `${bank.name} ${bank.subject ?? ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  const topic = /kiem thu|testing|yeu cau|quality/.test(text) ? 'testing'
    : /\bgit\b|kien truc|architecture/.test(text) ? 'architecture'
    : /javascript|\bapi\b|\brest\b/.test(text) ? 'api'
    : /html|css|web|frontend/.test(text) ? 'web'
    : /mang|network|bao mat|security/.test(text) ? 'network'
    : /pbl|du an|project/.test(text) ? 'project'
    : covers[Array.from(bank.id).reduce((hash, character) => (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0, 0) % covers.length];
  return `/illustrations/question-banks/${topic}.svg`;
}

export function QuestionBankHeroArt() {
  const uid = `bank-owl-${useId().replace(/:/g, '')}`;
  return <svg viewBox="0 0 390 250" width="390" height="250" fill="none" aria-hidden="true" focusable="false">
    <circle cx="239" cy="126" r="105" fill="white" fillOpacity=".07" />
    <rect x="73" y="50" width="156" height="120" rx="16" transform="rotate(-8 73 50)" fill="#A5D1D4" fillOpacity=".75" />
    <rect x="108" y="62" width="170" height="138" rx="18" fill="white" />
    <path d="M132 87h43" stroke="#F5BB4B" strokeWidth="9" strokeLinecap="round" />
    <path d="M132 106h120M132 120h83" stroke="#C7DFE2" strokeWidth="8" strokeLinecap="round" />
    <g strokeWidth="2"><circle cx="134" cy="143" r="7" fill="#0D7784" /><path d="m131 143 2 2 4-4" stroke="white" strokeLinecap="round" /><circle cx="134" cy="163" r="7" stroke="#A4C7CC" /><circle cx="134" cy="182" r="7" stroke="#A4C7CC" /></g>
    <path d="M154 143h77M154 163h58M154 182h67" stroke="#CCE1E4" strokeWidth="8" strokeLinecap="round" />
    <svg x="260" y="99" width="105" height="132" viewBox="92 48 336 380"><ProctoOwlArtwork idPrefix={uid} /></svg>
    <circle cx="360" cy="69" r="15" fill="#FFD075" /><path d="M356 66a4 4 0 1 1 6 4c-2 1-3 2-3 4" stroke="#174B55" strokeWidth="2.5" strokeLinecap="round" /><circle cx="359" cy="79" r="1.4" fill="#174B55" />
    <path d="M47 181h12m-6-6v12M300 39h10m-5-5v10" stroke="#7ABAC2" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}
