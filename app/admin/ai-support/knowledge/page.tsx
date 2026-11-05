'use client';
import { useEffect, useState } from 'react';
import { AISupportTabs, supportPanelId, supportTabId } from '@/components/admin/AISupportTabs';
import { AISupportHeader } from '@/components/admin/AISupportHeader';
import { BookOpen, Check, Pause, Pencil, Plus, Search } from 'lucide-react';
import { Button, Card, Input, Select, Textarea, Modal } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { tagStyle, tagTone } from '@/lib/tagColors';
import pageStyles from '@/components/admin/AISupportPage.module.css';
import styles from '@/components/admin/KnowledgePage.module.css';

type Article = { id: string; title: string; role: 'student' | 'teacher'; category: string; content: string; keywords: string[]; route: string; is_active: boolean; requires_admin: boolean; updated_at: string; updated_by: string | null };
type Library = { articles: Article[]; categories: Record<string, { id: string; label: string }[]>; routes: Record<string, string[]> };
const emptyArticle = (): Article => ({ id: '', title: '', role: 'student', category: 'other', content: '', keywords: [], route: '', is_active: true, requires_admin: false, updated_at: '', updated_by: null });

export default function KnowledgePage() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [query, setQuery] = useState(''); const [role, setRole] = useState(''); const [category, setCategory] = useState(''); const [active, setActive] = useState('');
  const [editing, setEditing] = useState<Article | null>(null); const [keywords, setKeywords] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true; setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams(); if (query) params.set('q', query); if (role) params.set('role', role); if (category) params.set('category', category); if (active) params.set('active', active);
      void apiFetch<{ data: Library }>(`/admin/ai-support/articles?${params}`).then(r => { if (alive) { setLibrary(r.data); setError(''); } })
        .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Không tải được kho tri thức.'); })
        .finally(() => { if (alive) setLoading(false); });
    }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, role, category, active, version]);
  function edit(article: Article) { setEditing({ ...article }); setKeywords(article.keywords.join(', ')); setError(''); }
  async function save() {
    if (!editing || busy) return; setBusy(true); setError('');
    const { id, updated_at, updated_by, ...fields } = editing;
    try {
      await apiFetch(`/admin/ai-support/articles${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PUT' : 'POST', body: { ...fields, keywords: keywords.split(',').map(v => v.trim()).filter(Boolean) } });
      setEditing(null); setVersion(v => v + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa lưu được bài viết.'); }
    finally { setBusy(false); }
  }
  const categories = [...new Map(Object.values(library?.categories ?? {}).flat().map(c => [c.id, c])).values()];
  return <div className={`${pageStyles.theme} ${pageStyles.page}`}>
    <AISupportHeader selected="knowledge" /><AISupportTabs selected="knowledge" />
    <section className={styles.section} role="tabpanel" id={supportPanelId('knowledge')} aria-labelledby={supportTabId('knowledge')} tabIndex={0}>
    <div className={styles.heading}><div><h2 id="knowledge-list-title">Kho tri thức</h2>
      <p>Nội dung được dùng để hỗ trợ theo vai trò. Thay đổi có hiệu lực với câu hỏi mới; lịch sử hướng dẫn đã gửi được giữ nguyên.</p></div>
      <Button onClick={() => edit(emptyArticle())}><Plus size={20} aria-hidden="true" />Tạo bài hướng dẫn</Button></div>
    {error && !editing && <div role="alert" className={styles.error}>{error}</div>}
    <Card className={pageStyles.panel}><div className={styles.filters}><label>Tìm tiêu đề / nội dung<Input type="search" placeholder="Nhập từ khóa…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label>Vai trò<Select value={role} onChange={e => { setRole(e.target.value); setCategory(''); }}><option value="">Tất cả</option><option value="student">Sinh viên</option><option value="teacher">Giảng viên</option></Select></label>
      <label>Danh mục<Select value={category} onChange={e => setCategory(e.target.value)}><option value="">Tất cả</option>{(role ? library?.categories[role] ?? [] : categories).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></label>
      <label>Trạng thái<Select value={active} onChange={e => setActive(e.target.value)}><option value="">Tất cả</option><option value="true">Đang sử dụng</option><option value="false">Đã tạm ngưng</option></Select></label></div></Card>
    <div className={styles.legend} role="group" aria-label="Chú giải màu tag"><strong>Chú giải màu</strong>
      <div className={styles.legendGroup}><span>Vai trò:</span>{[['student', 'Sinh viên'], ['teacher', 'Giảng viên'], ['admin', 'Quản trị viên']].map(([value, label]) => <span className={styles.chip} style={tagStyle(value, 'role')} key={value}>{label}</span>)}</div>
      <div className={styles.legendGroup}><span>Danh mục:</span><span className={styles.chip} style={tagStyle('Thẻ sinh viên', 'category')}>Thẻ sinh viên</span></div>
      <div className={styles.legendGroup}><span>Trạng thái:</span><span className={styles.chip} style={tagStyle('active', 'status')}>Đang sử dụng</span><span className={styles.chip} style={tagStyle('inactive', 'status')}>Đã tạm ngưng</span></div>
      <p>Viền và icon theo màu danh mục. Tag khác nhận màu cố định theo tên.</p>
    </div>
    {loading ? <div className={styles.empty} role="status">Đang tải bài hướng dẫn…</div> : library?.articles.length ? <div className={styles.list}>{library.articles.map(a => {
      const categoryName = library.categories[a.role]?.find(c => c.id === a.category)?.label ?? a.category;
      return <article key={a.id} className={styles.article} style={tagStyle(categoryName, 'category')} data-category={categoryName} data-tag-tone={tagTone(categoryName, 'category')}>
      <span className={styles.icon}><BookOpen size={23} aria-hidden="true" /></span><div className={styles.articleCopy}>
      <h3>{a.title}</h3><div className={styles.meta}>
        <span className={styles.chip} style={tagStyle(a.role, 'role')} data-tag-kind="role" data-tag-tone={tagTone(a.role, 'role')}>{a.role === 'student' ? 'Sinh viên' : 'Giảng viên'}</span>
        <span className={styles.chip} style={tagStyle(categoryName, 'category')} data-tag-kind="category" data-tag-tone={tagTone(categoryName, 'category')}>{categoryName}</span>
        <span className={styles.chip} style={tagStyle(a.is_active ? 'active' : 'inactive', 'status')} data-tag-kind="status" data-tag-tone={tagTone(a.is_active ? 'active' : 'inactive', 'status')}>{a.is_active ? <Check size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}{a.is_active ? 'Đang sử dụng' : 'Đã tạm ngưng'}</span>
      </div><p className={styles.updated}>Cập nhật {new Date(a.updated_at).toLocaleString('vi-VN')} · {a.updated_by ?? 'Nội dung khởi tạo'}</p></div>
      <Button variant="outline" className={styles.editButton} aria-label={`Sửa ${a.title}`} onClick={() => edit(a)}><Pencil size={16} aria-hidden="true" />Sửa</Button>
    </article>; })}</div> : <div className={styles.empty}><Search size={26} aria-hidden="true" /><h3>Không có bài hướng dẫn phù hợp.</h3><p>Thử bỏ bớt từ khóa hoặc thay đổi vai trò, danh mục và trạng thái.</p></div>}
    </section>
    <Modal open={!!editing} title={editing?.id ? 'Sửa bài hướng dẫn' : 'Tạo bài hướng dẫn'} size="large" className={`${pageStyles.theme} ${styles.editor}`} onClose={() => { if (!busy) setEditing(null); }}>
      {editing && <form className={styles.editorForm} onSubmit={e => { e.preventDefault(); void save(); }}>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <p>Chỉ nhập hướng dẫn sử dụng. Không nhập khóa API, lời nhắc hệ thống hoặc thông tin bí mật.</p>
        <label>Tiêu đề<Input required minLength={3} maxLength={200} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></label>
        <div className={styles.editorGrid}><label>Vai trò bài viết<Select value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value as Article['role'], category: 'other', route: '' })}><option value="student">Sinh viên</option><option value="teacher">Giảng viên</option></Select></label>
          <label>Danh mục bài viết<Select value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })}>{library?.categories[editing.role]?.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></label></div>
        <label>Nội dung (mỗi bước một dòng)<Textarea required minLength={10} maxLength={12000} rows={10} value={editing.content} onChange={e => setEditing({ ...editing, content: e.target.value })} /></label>
        <label>Từ khóa (cách nhau bằng dấu phẩy)<Input value={keywords} onChange={e => setKeywords(e.target.value)} /></label>
        <label>Trang liên quan<Select value={editing.route} onChange={e => setEditing({ ...editing, route: e.target.value })}><option value="">Không có</option>{library?.routes[editing.role]?.map(r => <option key={r} value={r}>{r}</option>)}</Select></label>
        <label className={styles.toggle}><input type="checkbox" checked={editing.is_active} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} /> Đang sử dụng</label>
        <label className={styles.toggle}><input type="checkbox" checked={editing.requires_admin} onChange={e => setEditing({ ...editing, requires_admin: e.target.checked })} /> Cần quản trị viên xử lý</label>
        <Button type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu bài hướng dẫn'}</Button>
      </form>}
    </Modal>
  </div>;
}
