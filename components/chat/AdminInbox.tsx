'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthContext';
import { supportChat, supportRole, chatTime, type SupportConversation as Conversation } from '@/lib/support-chat';
import { notificationTime } from '@/lib/notifications';
import { useSupportChat } from './SupportChatProvider';
import { SupportConversation } from './SupportConversation';
import styles from './SupportChat.module.css';

const filters = [['all', 'Đang hỗ trợ'], ['unread', 'Chưa đọc'], ['student', 'Sinh viên'], ['teacher', 'Giảng viên'], ['closed', 'Đã đóng']];
export function AdminInbox() {
  const { user } = useAuth(); const { revision, count } = useSupportChat(); const params = useSearchParams();
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [filter, setFilter] = useState('all');
  const [items, setItems] = useState<Conversation[]>([]), [selected, setSelected] = useState<Conversation | null>(null);
  const [cursor, setCursor] = useState<string | null>(null), [loading, setLoading] = useState(true), [moreBusy, setMoreBusy] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0), moreLock = useRef(false), selectedRef = useRef(selected); selectedRef.current = selected;
  const target = params.get('conversation');
  useEffect(() => { const timer = setTimeout(() => setSearch(query), 250); return () => clearTimeout(timer); }, [query]);
  const load = useCallback(async () => {
    if (user?.role !== 'admin') return;
    const request = ++epoch.current;
    try {
      const result = await supportChat.list(search, filter);
      if (request !== epoch.current) return;
      setItems(result.data); setCursor(result.meta.next_cursor); setError('');
      const updated = result.data.find(item => item.id === selectedRef.current?.id);
      if (updated) setSelected(updated);
      else if (selectedRef.current) {
        const selectedId = selectedRef.current.id;
        const current = await supportChat.get(selectedId);
        if (request === epoch.current && selectedRef.current?.id === selectedId) setSelected(current.data);
      }
    } catch { if (request === epoch.current) setError('Không tải được hộp thư hỗ trợ.'); }
    finally { if (request === epoch.current) setLoading(false); }
  }, [user?.role, search, filter]);
  useEffect(() => { setItems([]); setLoading(true); setCursor(null); }, [search, filter]);
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [load, revision]);
  useEffect(() => {
    if (!target || user?.role !== 'admin') return;
    let active = true;
    supportChat.get(target).then(result => { if (active) setSelected(result.data); })
      .catch(() => { if (active) setError('Không tìm thấy cuộc trò chuyện hoặc bạn không có quyền truy cập.'); });
    return () => { active = false; };
  }, [target, user?.role]);
  const more = async () => {
    if (!cursor || moreLock.current) return;
    moreLock.current = true; setMoreBusy(true); const request = epoch.current;
    try {
      const result = await supportChat.list(search, filter, cursor);
      if (request !== epoch.current) return;
      setItems(current => [...current, ...result.data.filter(item => !current.some(existing => existing.id === item.id))]);
      setCursor(result.meta.next_cursor); setError('');
    } catch { if (request === epoch.current) setError('Không tải được thêm cuộc trò chuyện.'); }
    finally { moreLock.current = false; setMoreBusy(false); }
  };
  if (user?.role !== 'admin') return null;
  return <div className={styles.inboxPage}>
    <div className={styles.pageHeading}><h1>Tin nhắn hỗ trợ</h1><p>Hộp thư hỗ trợ sinh viên và giảng viên.{count > 0 ? ` ${count} tin nhắn chưa đọc.` : ''}</p></div>
    <div className={`${styles.inbox} ${selected ? styles.hasSelection : ''}`}>
      <aside className={styles.list} aria-label="Cuộc trò chuyện">
        <div className={styles.listTools}><h2>Cuộc trò chuyện</h2><input type="search" aria-label="Tìm cuộc trò chuyện" placeholder="Tìm tên, email, MSSV..." value={query} onChange={event => setQuery(event.target.value)} />
          <div className={styles.filters} aria-label="Lọc cuộc trò chuyện">{filters.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
        </div>
        {error && <div className={styles.error} role="alert">{error} <button type="button" onClick={() => void load()}>Thử lại</button></div>}
        <div className={styles.listScroll}>
          {loading && <p className={styles.empty} role="status">Đang tải hộp thư...</p>}
          {!loading && !error && !items.length && <p className={styles.empty}>{search || filter !== 'all' ? 'Không có cuộc trò chuyện phù hợp.' : 'Chưa có yêu cầu hỗ trợ.'}</p>}
          {items.map(item => <button key={item.id} type="button" className={`${styles.listItem} ${selected?.id === item.id ? styles.activeItem : ''}`} onClick={() => setSelected(item)} aria-current={selected?.id === item.id ? 'true' : undefined}>
            <span className={styles.avatar} aria-hidden="true">{item.owner.full_name.split(/\s+/).filter(Boolean).slice(-2).map(word => word[0]).join('').toUpperCase()}</span>
            <span className={styles.itemContent}><span className={styles.itemTitle}><strong>{item.owner.full_name}</strong>{item.unread_count > 0 && <span className={styles.count} aria-label={`${item.unread_count} chưa đọc`}>{item.unread_count}</span>}</span>
              <small>{supportRole(item.owner)}</small><strong className={styles.preview}>{item.support_case?.summary.category}</strong>
              <span className={styles.preview}>{item.support_case?.summary.issue}</span>
              <small>{item.support_case?.status === 'CLOSED' ? 'Đã đóng' : item.support_case?.status === 'ESCALATED' ? 'AI chuyển quản trị viên kiểm tra' : 'Đang hỗ trợ'}</small>
              <span className={styles.preview}>{item.last_message?.kind === 'case_summary' ? 'Có yêu cầu hỗ trợ mới' : `${item.last_message?.sender_id !== item.owner.id ? 'Quản trị viên: ' : ''}${item.last_message?.body ?? ''}`}</span>
              {item.last_message_at && <time dateTime={item.last_message_at} title={chatTime(item.last_message_at)}>{notificationTime(item.last_message_at)}</time>}
            </span>
          </button>)}
          {cursor && <button type="button" className={styles.older} disabled={moreBusy} onClick={() => void more()}>{moreBusy ? 'Đang tải...' : 'Tải thêm cuộc trò chuyện'}</button>}
        </div>
      </aside>
      <div className={styles.detail}>{selected ? <SupportConversation key={`${user.id}:${selected.id}`} conversation={selected} onBack={() => setSelected(null)} />
        : <div className={styles.empty}>Chọn một cuộc trò chuyện để bắt đầu.</div>}</div>
    </div>
  </div>;
}
