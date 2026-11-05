'use client';
import { aiErrorMessage } from '@/lib/ai-provider';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { supportAssistant, type AssistantSession, type SupportCommand, type SupportHistoryItem } from '@/lib/support-assistant';
import { chatDay, chatTime, supportChat, type SupportConversation as Conversation } from '@/lib/support-chat';
import { Button } from '@/components/ui/Button';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useSupportChat } from './SupportChatProvider';
import { SupportConversation } from './SupportConversation';
import styles from './SupportChat.module.css';

export function SupportAssistant({ headerAction, initialConversationId, onInitialConversationHandled }: {
  headerAction: ReactNode; initialConversationId?: string | null; onInitialConversationHandled?: () => void;
}) {
  const pathname = usePathname(); const { revision, refresh } = useSupportChat();
  const [session, setSession] = useState<AssistantSession | null>(null), [conversation, setConversation] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmation, setConfirmation] = useState<'close' | 'new' | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false), [history, setHistory] = useState<SupportHistoryItem[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const startKey = useRef<string | null>(null);
  const lock = useRef(false), mounted = useRef(false), epoch = useRef(0);
  const retry = useRef<SupportCommand | null>(null), scroller = useRef<HTMLDivElement>(null);
  const report = (cause: unknown) => {
    setBlocked(cause instanceof ApiError && cause.code === 'EXAM_IN_PROGRESS');
    setError(cause instanceof ApiError && ['EXAM_IN_PROGRESS', 'SUPPORT_SESSION_CLOSED'].includes(cause.code ?? '') ? cause.message : 'Không tải được hỗ trợ. Vui lòng thử lại.');
  };
  const start = async (fresh = false) => {
    if (lock.current) return;
    lock.current = true; setLoading(true); setError('');
    const request = ++epoch.current;
    try {
      if (fresh) startKey.current ??= crypto.randomUUID();
      const result = await supportAssistant.start(fresh, fresh ? startKey.current! : undefined);
      let viewed = result.data, linked: Conversation | null = null;
      if (!fresh && initialConversationId) {
        try {
          const thread = await supportChat.get(initialConversationId);
          if (thread.data.support_case) { viewed = (await supportAssistant.get(thread.data.support_case.id)).data; linked = thread.data; }
        } catch { if (mounted.current && request === epoch.current) setError('Không tìm thấy cuộc trò chuyện được liên kết hoặc bạn không có quyền truy cập.'); }
      }
      if (mounted.current && request === epoch.current) {
        setSession(viewed); setActiveId(['AI_ACTIVE', 'ESCALATED', 'ADMIN_ACTIVE'].includes(result.data.status) ? result.data.id : null); setConversation(linked); setDraft(''); setBlocked(false); retry.current = null;
        setConfirmation(null); setHistoryOpen(false); startKey.current = null;
        if (!fresh && initialConversationId) onInitialConversationHandled?.();
        if (fresh) refresh();
      }
    } catch (cause) { if (mounted.current && request === epoch.current) report(cause); }
    finally { if (request === epoch.current) { lock.current = false; if (mounted.current) setLoading(false); } }
  };
  useEffect(() => { mounted.current = true; lock.current = false; void start(); return () => { mounted.current = false; epoch.current++; }; }, []);
  useEffect(() => {
    if (!session || lock.current) return;
    let active = true; const request = epoch.current;
    supportAssistant.get(session.id).then(result => { if (active && !lock.current && request === epoch.current) {
      setSession(result.data);
      if (!['AI_ACTIVE', 'ESCALATED', 'ADMIN_ACTIVE'].includes(result.data.status)) setActiveId(current => current === result.data.id ? null : current);
    } }).catch(() => {});
    return () => { active = false; };
  }, [revision, session?.id]);
  useEffect(() => {
    if (!session?.conversation_id) return;
    let active = true;
    supportChat.get(session.conversation_id).then(result => { if (active) { setConversation(result.data); setError(''); } })
      .catch(() => { if (active) setError('Không tải được cuộc trò chuyện với quản trị viên.'); });
    return () => { active = false; };
  }, [session?.conversation_id, session?.status, revision]);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [session?.messages.length, busy]);
  const act = async (action: SupportCommand['action'], value?: string) => {
    if (!session || lock.current) return;
    const candidate = { action, ...(action === 'message' ? { text: (value ?? draft).trim() } : value ? { value } : {}), route: pathname };
    const old = retry.current;
    const command: SupportCommand = old && JSON.stringify({ ...old, client_id: undefined }) === JSON.stringify(candidate)
      ? old : { ...candidate, client_id: crypto.randomUUID() };
    retry.current = command; lock.current = true; setBusy(true); setError(''); ++epoch.current;
    try {
      const result = await supportAssistant.act(session.id, command);
      if (!mounted.current) return;
      setSession(result.data); setBlocked(false); retry.current = null;
      setActiveId(['AI_ACTIVE', 'ESCALATED', 'ADMIN_ACTIVE'].includes(result.data.status) ? result.data.id : null);
      if (action === 'close') { setConfirmation(null); setDraft(''); refresh(); }
      if (action === 'message') setDraft('');
      if (['escalate', 'reopen'].includes(action)) refresh();
    } catch (cause) { if (mounted.current) report(cause); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const showHistory = async (more = false) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setHistoryOpen(true);
    try {
      const result = await supportAssistant.history(more ? historyCursor ?? undefined : undefined);
      if (mounted.current) { setHistory(current => more ? [...current, ...result.data.filter(item => !current.some(old => old.id === item.id))] : result.data); setHistoryCursor(result.meta.next_cursor); }
    } catch (cause) { if (mounted.current) report(cause); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const openSession = async (id: string) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); ++epoch.current;
    try {
      const result = await supportAssistant.get(id);
      if (mounted.current) { setSession(result.data); setConversation(null); setDraft(''); retry.current = null; setHistoryOpen(false);
        if (['AI_ACTIVE', 'ESCALATED', 'ADMIN_ACTIVE'].includes(result.data.status)) setActiveId(result.data.id);
      }
    } catch (cause) { if (mounted.current) report(cause); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const requestNew = () => { if (activeId) setConfirmation('new'); else void start(true); };
  const terminal = session && ['CLOSED', 'RESOLVED_BY_AI'].includes(session.status);
  const humanActive = session && ['ESCALATED', 'ADMIN_ACTIVE'].includes(session.status);
  const controls = <div className={styles.headerControls}><ActionMenu label="Tùy chọn cuộc trò chuyện" className={styles.chatMenu} disabled={busy || loading || blocked}
    items={[
      ...(!humanActive ? [{ label: 'Cuộc trò chuyện mới', onSelect: requestNew }] : []),
      ...(!terminal && session ? [{ label: 'Kết thúc cuộc trò chuyện', onSelect: () => setConfirmation('close'), tone: 'danger' as const }] : []),
      { label: 'Lịch sử trò chuyện', onSelect: () => void showHistory() },
      ...(activeId && activeId !== session?.id ? [{ label: 'Tiếp tục cuộc trò chuyện hiện tại', onSelect: () => void openSession(activeId) }] : []),
    ]} />{headerAction}</div>;
  const confirmDialog = <ConfirmDialog open={confirmation !== null} title={confirmation === 'close' ? 'Kết thúc cuộc trò chuyện?' : 'Bắt đầu cuộc trò chuyện mới?'}
    description={confirmation === 'close' ? 'Bạn sẽ không thể gửi thêm tin nhắn trong cuộc trò chuyện này. Lịch sử vẫn được lưu.' : 'Nội dung hiện tại vẫn được lưu trong lịch sử.'}
    confirmLabel={confirmation === 'close' ? 'Kết thúc' : 'Bắt đầu mới'} busy={busy || loading} error={error || undefined}
    onCancel={() => { setConfirmation(null); setError(''); startKey.current = null; }} onConfirm={() => { if (confirmation === 'close') void act('close'); else void start(true); }} />;
  const header = <header className={styles.header}><div className={styles.identity}><strong>ProctoOwl Support</strong><small>Trợ lý hỗ trợ</small></div>{controls}</header>;
  if (historyOpen) return <section className={styles.conversation} aria-label="Lịch sử trò chuyện">{header}
    <div className={styles.historyHeading}><h2>Lịch sử trò chuyện</h2><Button size="sm" variant="ghost" disabled={busy} onClick={() => setHistoryOpen(false)}>Quay lại</Button></div>
    <div className={styles.messages} aria-busy={busy}>
      {busy && <p role="status">Đang tải lịch sử…</p>}{error && <p role="alert">{error}</p>}
      {!busy && !history.length && <p>Chưa có lịch sử trò chuyện.</p>}
      {history.map((item, index) => <Fragment key={item.id}>
        {(index === 0 || chatDay(history[index - 1].created_at) !== chatDay(item.created_at)) && <h3 className={styles.historyDay}>{chatDay(item.created_at)}</h3>}
        <button type="button" disabled={busy} className={styles.historyItem} onClick={() => void openSession(item.id)}><span className={styles.historyTitle}><strong>{item.title}</strong>
          {!!item.unread_count && <span className={styles.count} aria-label={`${item.unread_count} tin nhắn chưa đọc`}>{item.unread_count}</span>}</span>
          <span>{item.status === 'CLOSED' ? 'Đã kết thúc' : item.status === 'RESOLVED_BY_AI' ? 'Đã giải quyết' : 'Đang hỗ trợ'} · {chatTime(item.closed_at ?? item.updated_at)}</span></button>
      </Fragment>)}
      {historyCursor && <Button variant="outline" disabled={busy} onClick={() => void showHistory(true)}>Xem thêm lịch sử</Button>}
    </div>{confirmDialog}</section>;
  if (session?.conversation_id && conversation && !blocked) return <><SupportConversation key={conversation.id} conversation={{ ...conversation,
    support_case: conversation.support_case ? { ...conversation.support_case, status: session.status, closed_at: session.closed_at, closed_by: session.closed_by } : null }} headerAction={controls}
    supportActions={session.status === 'CLOSED' ? <div className={styles.supportActions}><p>Cuộc trò chuyện này đã kết thúc.</p>
      {session.closed_by && session.closed_by !== conversation.owner.id && <Button variant="outline" size="sm" disabled={busy || loading} onClick={requestNew}>Vẫn còn vấn đề</Button>}
      <Button size="sm" disabled={busy || loading} onClick={requestNew}>Bắt đầu cuộc trò chuyện mới</Button>
      {error && <p role="alert">{error}</p>}</div> : undefined} />{confirmDialog}</>;
  const active = session?.status === 'AI_ACTIVE';
  return <section className={styles.conversation} aria-label="ProctoOwl Support">
    {header}
    {active && !session.provider_configured && !blocked && <div className={styles.caseContext} role="status">
      <strong>{session.provider_error?.code && session.provider_error.code !== 'AI_NOT_CONFIGURED' ? aiErrorMessage(session.provider_error.code) : 'Trợ lý AI hiện chưa được cấu hình'}</strong><p>Bạn vẫn có thể tra cứu kết quả được cấp quyền, xem hướng dẫn theo chủ đề hoặc liên hệ quản trị viên.</p>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void act('escalate')}>Liên hệ System Admin</Button>
    </div>}
    <div className={styles.messages} ref={scroller} role="log" aria-label="Trao đổi với trợ lý AI" aria-live="polite" aria-busy={busy || loading}>
      {loading && <p role="status">Đang mở hỗ trợ...</p>}
      {session && <>
        <div className={styles.message}><small>Trợ lý AI</small><div className={styles.bubble}>{session.greeting}</div></div>
        {session.messages.map(message => <Fragment key={message.id}>
          {message.user_text && <div className={`${styles.message} ${styles.mine}`}><small>Bạn</small><div className={styles.bubble}>{message.user_text}</div></div>}
          <div className={styles.message}><small>{['close', 'resolved'].includes(message.action ?? '') ? 'Hệ thống' : 'Trợ lý AI'}{message.sources.some(source => source.kind === 'system_data') ? ' · Dữ liệu hệ thống' : message.sources.length ? ' · Tài liệu hỗ trợ' : ''}</small><div className={styles.bubble}>{message.assistant_text}</div>
            {message.sources.some(source => source.route) && <div className={styles.sources} aria-label={message.sources.some(source => source.kind === 'system_data') ? 'Chi tiết dữ liệu' : 'Tài liệu hướng dẫn'}>{message.sources.filter(source => source.route).map(source => <Link key={source.id} href={source.route}>{source.title} ↗</Link>)}</div>}
            {message.sources.some(source => source.links?.length) && <div className={styles.sources} aria-label="Chi tiết lượt làm bài">{message.sources.flatMap(source => source.links ?? []).map(link => <Link key={link.route} href={link.route}>{link.label} ↗</Link>)}</div>}
            {active && !blocked && message.id === session.messages.at(-1)?.id && message.sources.some(source => source.choices?.length) && <div className={styles.quickActions} aria-label="Chọn sinh viên, lớp hoặc kỳ thi">
              {message.sources.flatMap(source => source.choices ?? []).map(choice => <button type="button" key={choice.value} disabled={busy} onClick={() => void act('message', choice.value)}>{choice.label}</button>)}
            </div>}
          </div>
        </Fragment>)}
        {!blocked && active && <div className={styles.supportActions}>
          {session.phase === 'CATEGORY' && <div className={styles.quickActions} aria-label="Chọn nhóm vấn đề">{session.categories.map(category => <button type="button" key={category.id} disabled={busy} onClick={() => void act('category', category.id)}>{category.label}</button>)}</div>}
          {session.phase === 'DETAIL' && <div className={styles.quickActions} aria-label="Chọn vấn đề chi tiết">{session.topics.map(topic => <button type="button" key={topic.id} disabled={busy} onClick={() => void act('topic', topic.id)}>{topic.label}</button>)}</div>}
          {session.phase === 'FEEDBACK' && <><p>Vấn đề của bạn đã được giải quyết chưa?</p><Button size="sm" disabled={busy} onClick={() => void act('resolved')}>Đã giải quyết</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => void act('unresolved')}>Vẫn gặp lỗi</Button></>}
          {session.phase === 'UNAVAILABLE' && <Button variant="outline" size="sm" disabled={busy} onClick={() => void act('retry')}>Thử lại trợ lý AI</Button>}
          {session.phase === 'ESCALATE' && session.support_error?.code === 'SUPPORT_KNOWLEDGE_NOT_FOUND' && <Button variant="outline" size="sm" disabled={busy} onClick={() => void act('clarify')}>Thử mô tả chi tiết hơn</Button>}
          {session.provider_configured && ['ESCALATE', 'UNAVAILABLE'].includes(session.phase) && <Button size="sm" disabled={busy} onClick={() => void act('escalate')}>Liên hệ System Admin</Button>}
        </div>}
      </>}
      {busy && <p role="status">Đang xử lý yêu cầu...</p>}
      {error && <div className={styles.error} role="alert">{error}{!blocked && <button type="button" disabled={busy || loading} onClick={() => { if (retry.current) void act(retry.current.action, retry.current.text ?? retry.current.value); else void start(); }}>Thử lại</button>}</div>}
    </div>
    {terminal && <div className={styles.supportActions}><p>{session.status === 'RESOLVED_BY_AI' ? 'Vấn đề đã được đánh dấu là đã giải quyết.' : 'Cuộc trò chuyện này đã kết thúc.'}</p>
      <Button size="sm" disabled={busy || loading} onClick={requestNew}>{session.status === 'RESOLVED_BY_AI' ? 'Bắt đầu câu hỏi mới' : 'Bắt đầu cuộc trò chuyện mới'}</Button></div>}
    {active && !blocked && <form className={styles.composer} onSubmit={e => { e.preventDefault(); if (draft.trim()) void act('message'); }}>
      <div className={styles.composeRow}><textarea aria-label="Nhập vấn đề của bạn" placeholder="Nhập vấn đề của bạn..." rows={2} maxLength={2000}
        disabled={busy} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (draft.trim()) void act('message'); } }} />
        <Button type="submit" loading={busy} disabled={!draft.trim()}>Gửi</Button></div>
      <small className={styles.hint}>Không gửi mật khẩu hoặc thông tin bí mật. Trợ lý hướng dẫn sử dụng và tra cứu dữ liệu bạn được phép xem.</small>
    </form>}
    {confirmDialog}
  </section>;
}
