'use client';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { borderProps } from '@/components/ui/Border';
import { ApiError } from '@/lib/api';
import { chatDay, chatTime, supportChat, supportRole, type SupportConversation as Conversation, type SupportMessage } from '@/lib/support-chat';
import { useSupportChat } from './SupportChatProvider';
import { supportAssistant } from '@/lib/support-assistant';
import styles from './SupportChat.module.css';

function merge(old: SupportMessage[], incoming: SupportMessage[]) {
  const map = new Map(old.map(item => [item.id, item]));
  incoming.forEach(item => map.set(item.id, item));
  return Array.from(map.values()).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export function SupportConversation({ conversation, onBack, headerAction, supportActions }: { conversation: Conversation; onBack?: () => void; headerAction?: ReactNode; supportActions?: ReactNode }) {
  const { user } = useAuth(); const { revision, connected, refresh } = useSupportChat();
  const [messages, setMessages] = useState<SupportMessage[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [historyBusy, setHistoryBusy] = useState(false), [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [sendError, setSendError] = useState('');
  const [newMessages, setNewMessages] = useState(false);
  const [resolving, setResolving] = useState(false), [resolutionError, setResolutionError] = useState('');
  const [resolvedLocally, setResolvedLocally] = useState(false);
  const resolveKey = useRef<string | null>(null), resolveLock = useRef(false);
  const scroller = useRef<HTMLDivElement>(null), nearBottom = useRef(true), initialized = useRef(false);
  const sendLock = useRef(false), olderLock = useRef(false), epoch = useRef(0), mounted = useRef(true);
  const retry = useRef<{ body: string; id: string } | null>(null), readThrough = useRef('');
  const restoreScroll = useRef<{ height: number; top: number } | null>(null);
  const lastRendered = useRef<string | null>(null);
  const id = conversation.id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const bottom = useCallback(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; nearBottom.current = true; setNewMessages(false); }, []);

  const load = useCallback(async () => {
    const request = ++epoch.current;
    try {
      const result = await supportChat.messages(id);
      if (request !== epoch.current) return;
      setMessages(current => {
        // If reconnect skipped more than a page, restart at the latest page so
        // history pagination stays contiguous rather than silently hiding a gap.
        const overlaps = result.data.some(item => current.some(existing => existing.id === item.id));
        if (!initialized.current || (current.length && !overlaps && result.data.length)) {
          setCursor(result.meta.next_cursor); return result.data;
        }
        return merge(current, result.data);
      });
      setLoadError(''); setLoading(false);
    } catch { if (request === epoch.current) { setLoadError('Không tải được tin nhắn.'); setLoading(false); } }
  }, [id]);
  useEffect(() => { void load(); }, [load, revision]);
  useLayoutEffect(() => {
    const el = scroller.current; if (!el) return;
    const latest = messages[messages.length - 1]?.id ?? null;
    if (restoreScroll.current) {
      el.scrollTop = restoreScroll.current.top + el.scrollHeight - restoreScroll.current.height;
      restoreScroll.current = null;
    } else if (!initialized.current || nearBottom.current) bottom();
    else if (latest && lastRendered.current && latest !== lastRendered.current) setNewMessages(true);
    lastRendered.current = latest;
    if (!loading) initialized.current = true;
  }, [messages, loading, bottom]);

  const markRead = useCallback(() => {
    const last = messages[messages.length - 1];
    if (!last || readThrough.current === last.id || document.visibilityState !== 'visible' || !nearBottom.current) return;
    const panel = scroller.current?.closest('[role="dialog"]'), focused = document.activeElement?.closest('[role="dialog"]');
    if (panel && focused && panel !== focused) return;
    readThrough.current = last.id;
    void supportChat.read(id, last.id).catch(() => { if (readThrough.current === last.id) readThrough.current = ''; });
  }, [id, messages]);
  useEffect(() => {
    markRead(); document.addEventListener('visibilitychange', markRead);
    return () => document.removeEventListener('visibilitychange', markRead);
  }, [markRead]);

  const older = async () => {
    if (!cursor || olderLock.current) return;
    olderLock.current = true; setHistoryBusy(true);
    try {
      const result = await supportChat.messages(id, cursor);
      if (!mounted.current) return;
      const el = scroller.current;
      if (el) restoreScroll.current = { height: el.scrollHeight, top: el.scrollTop };
      setMessages(current => merge(result.data, current)); setCursor(result.meta.next_cursor); setLoadError('');
    } catch { if (mounted.current) setLoadError('Không tải được lịch sử. Vui lòng thử lại.'); }
    finally { olderLock.current = false; if (mounted.current) setHistoryBusy(false); }
  };
  const send = async () => {
    const body = draft.trim(); if (!body || body.length > 4000 || sendLock.current) return;
    sendLock.current = true; setBusy(true); setSendError('');
    if (retry.current?.body !== body) retry.current = { body, id: crypto.randomUUID() };
    try {
      const result = await supportChat.send(id, body, retry.current.id);
      if (!mounted.current) return;
      nearBottom.current = true; setMessages(current => merge(current, [result.data])); setDraft(''); retry.current = null; refresh();
    } catch (cause) {
      if (mounted.current) setSendError(cause instanceof ApiError && cause.code === 'EXAM_IN_PROGRESS' ? cause.message : 'Không gửi được tin nhắn.');
    } finally { sendLock.current = false; if (mounted.current) setBusy(false); }
  };
  const admin = user?.role === 'admin';
  const closed = resolvedLocally || ['CLOSED', 'RESOLVED_BY_AI'].includes(conversation.support_case?.status ?? '');
  const resolve = async () => {
    if (!conversation.support_case || resolveLock.current) return;
    resolveLock.current = true; setResolving(true); setResolutionError('');
    resolveKey.current ??= crypto.randomUUID();
    try { await supportAssistant.act(conversation.support_case.id, { action: 'close', client_id: resolveKey.current }); setResolvedLocally(true); resolveKey.current = null; refresh(); }
    catch { setResolutionError('Không đóng được yêu cầu. Vui lòng thử lại.'); }
    finally { resolveLock.current = false; setResolving(false); }
  };
  return <section className={styles.conversation} aria-label="Cuộc trò chuyện hỗ trợ">
    <header className={styles.header}>
      {onBack && <button type="button" className={`icon-button ${styles.back}`} onClick={onBack} aria-label="Quay lại danh sách"><ArrowLeft size={20} aria-hidden="true" /></button>}
      <div className={styles.identity}><strong>{admin ? conversation.owner.full_name : 'ProctoOwl Support'}</strong><small>{admin ? supportRole(conversation.owner) : 'Trợ lý hỗ trợ · Quản trị viên'}</small>{admin && <small>{conversation.support_case?.summary.category}</small>}</div>
      {admin && <Link className={styles.profileLink} href={`/dashboard/users?edit_user=${encodeURIComponent(conversation.owner.id)}`}>Xem hồ sơ</Link>}
      {headerAction}
    </header>
    {conversation.support_case && <div className={styles.caseContext} {...borderProps(closed ? 'success' : 'users')}>
      {!admin && <p>Yêu cầu của bạn đã được chuyển đến quản trị viên hệ thống.</p>}
      <details className={styles.caseSummary}><summary>Tóm tắt từ AI</summary><div>
        <strong>{conversation.support_case.summary.category}</strong><p>{conversation.support_case.summary.issue}</p>
        {conversation.support_case.summary.subcategory && <p>Chi tiết: {conversation.support_case.summary.subcategory}</p>}
        {!!conversation.support_case.summary.articles?.length && <><strong>Tài liệu hỗ trợ đã tra cứu</strong><ul>{conversation.support_case.summary.articles.map(article => <li key={article.id}>{article.title}</li>)}</ul></>}
        {!!conversation.support_case.summary.steps?.length && <><strong>Hướng dẫn đã thử</strong><ul>{conversation.support_case.summary.steps.map((step, i) => <li key={i}>{step}</li>)}</ul></>}
        <p>{conversation.support_case.summary.result}</p>
      </div></details>
      {admin && !closed && <Button size="sm" variant="outline" loading={resolving} onClick={() => void resolve()}>Đánh dấu đã giải quyết</Button>}
      {closed && <small>Cuộc trò chuyện này đã kết thúc.</small>}
      {resolutionError && <p role="alert">{resolutionError}</p>}
    </div>}
    {!connected && <div className={styles.connection} role="status">Đang kết nối lại...</div>}
    {loadError && <div className={styles.error} role="alert">{loadError} <button type="button" onClick={() => void load()}>Thử lại</button></div>}
    <div className={styles.messages} ref={scroller} role="log" aria-label="Tin nhắn" aria-live="polite" aria-busy={loading} onScroll={() => {
      const el = scroller.current; if (!el) return;
      nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (nearBottom.current) { setNewMessages(false); markRead(); }
      if (el.scrollTop < 32 && initialized.current) void older();
    }}>
      {cursor && <button type="button" className={styles.older} disabled={historyBusy} onClick={() => void older()}>{historyBusy ? 'Đang tải...' : 'Tải tin nhắn cũ hơn'}</button>}
      {loading && <p className={styles.empty} role="status">Đang tải tin nhắn...</p>}
      {!loading && !messages.length && !loadError && <div className={styles.empty}><strong>Bạn cần hỗ trợ gì?</strong><p>Bạn chưa có tin nhắn với quản trị viên.</p></div>}
      {messages.map((message, index) => <Fragment key={message.id}>
        {(index === 0 || chatDay(messages[index - 1].created_at) !== chatDay(message.created_at)) && <div className={styles.date}>{chatDay(message.created_at)}</div>}
        <div data-author={message.sender_id === conversation.owner.id ? 'user' : 'admin'} className={`${styles.message} ${message.kind === 'system' ? styles.systemMessage : message.sender_id === user?.id ? styles.mine : ''}`}>
          <small>{message.kind === 'system' ? 'Hệ thống' : message.kind === 'case_summary' ? 'Tóm tắt hỗ trợ' : message.sender_id === conversation.owner.id ? (admin ? conversation.owner.full_name : 'Bạn') : 'Quản trị viên'}</small>
          <div className={styles.bubble}>{message.kind === 'case_summary' ? <details><summary>Yêu cầu chuyển quản trị viên</summary>{message.body}</details> : message.body}</div>
          <small>{chatTime(message.created_at)}{message.kind !== 'system' && message.sender_id === user?.id ? ` · ${message.read_at ? 'Đã đọc' : 'Đã gửi'}` : ''}</small>
        </div>
      </Fragment>)}
    </div>
    {newMessages && <button type="button" className={styles.newMessages} onClick={() => { bottom(); markRead(); }}>Tin nhắn mới ↓</button>}
    {supportActions}
    {!closed && <form className={styles.composer} onSubmit={event => { event.preventDefault(); void send(); }}>
      {sendError && <p className={styles.error} role="alert">{sendError} <button type="button" disabled={busy} onClick={() => void send()}>Thử lại</button></p>}
      <div className={styles.composeRow}><textarea aria-label="Nhập tin nhắn" placeholder="Nhập tin nhắn..." value={draft} maxLength={4000} rows={2} disabled={busy}
        onChange={event => { setDraft(event.target.value); setSendError(''); }} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
        }} /><Button type="submit" loading={busy} disabled={!draft.trim() || busy}>Gửi</Button></div>
      <small className={styles.hint}>Enter để gửi · Shift+Enter để xuống dòng{draft.length > 3500 ? ` · ${draft.length}/4000` : ''}</small>
    </form>}
  </section>;
}
