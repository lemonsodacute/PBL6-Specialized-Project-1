'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import styles from './PhoneEditor.module.css';

export function PhoneEditor({ phone, onSaved, layout = 'inline' }: {
  phone: string | null;
  onSaved: (phone: string | null) => void;
  layout?: 'inline' | 'stacked';
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const trigger = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const working = useRef(false);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (restoreFocus.current) { trigger.current?.querySelector('button')?.focus(); restoreFocus.current = false; }
  }, [editing]);
  function close() { restoreFocus.current = true; setEditing(false); setError(''); }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (working.current) return;
    const value = draft.trim();
    if (value && !/^\+?[0-9]{8,15}$/.test(value)) {
      setError('Số điện thoại cần 8–15 chữ số, có thể bắt đầu bằng +.'); input.current?.focus(); return;
    }
    working.current = true; setSaving(true); setError('');
    try {
      const result = await api.auth.updatePhone(value || null);
      onSaved(result.user.phone ?? null);
      close(); setNotice('Số điện thoại đã được cập nhật.');
    } catch { setError('Không thể cập nhật số điện thoại. Vui lòng thử lại.'); }
    finally { working.current = false; setSaving(false); }
  }
  return <div>
    <dt>{editing ? <label htmlFor={id}>Số điện thoại</label> : 'Số điện thoại'}</dt>
    <dd>
      {editing ? <form onSubmit={save} style={{ display: 'grid', gap: 20, width: '100%', maxWidth: 420, minWidth: 0 }}>
        <input ref={input} className="ui-field" id={id} type="tel" inputMode="tel" autoComplete="tel" maxLength={20}
          value={draft} disabled={saving} aria-invalid={!!error} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          onChange={event => { setDraft(event.target.value); setError(''); }} />
        <p id={`${id}-hint`}>Ví dụ: 0901234567 hoặc +84901234567. Để trống để xóa số điện thoại.</p>
        {error && <p id={`${id}-error`} role="alert">{error}</p>}
        <div className="form-actions">
          <Button type="button" variant="outline" disabled={saving} onClick={close}>Hủy</Button>
          <Button type="submit" variant="success" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</Button>
        </div>
      </form> : <div ref={trigger} className={layout === 'stacked' ? styles.stacked : undefined}
        style={layout === 'inline' ? { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 } : undefined}>
        <span>{phone || 'Chưa cập nhật'}</span>
        <Button type="button" variant="outline" onClick={() => { setDraft(phone ?? ''); setError(''); setNotice(''); setEditing(true); }}>
          {phone ? 'Chỉnh sửa' : 'Thêm số điện thoại'}
        </Button>
      </div>}
      {notice && <p className={layout === 'stacked' ? styles.notice : undefined} role="status">{notice}</p>}
    </dd>
  </div>;
}
