'use client';
import { useEffect, useState } from 'react';
import { AISupportTabs } from '@/components/admin/AISupportTabs';
import { Button, Card, Input, Select, Textarea, Modal } from '@/components/ui';
import { apiFetch } from '@/lib/api';

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
        .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Không tải được Knowledge Base.'); })
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
  return <div className="workspace-page"><div className="form-toolbar"><h1>Kho tri thức</h1><Button onClick={() => edit(emptyArticle())}>Tạo bài hướng dẫn</Button></div><AISupportTabs selected="knowledge" />
    <p>Nội dung được dùng cho Support theo role. Thay đổi có hiệu lực với câu hỏi mới; lịch sử hướng dẫn đã gửi được giữ nguyên.</p>
    {error && !editing && <Card role="alert">{error}</Card>}
    <Card><div className="form-grid"><label>Tìm tiêu đề / nội dung<Input value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label>Role<Select value={role} onChange={e => { setRole(e.target.value); setCategory(''); }}><option value="">Tất cả</option><option value="student">Student</option><option value="teacher">Teacher</option></Select></label>
      <label>Category<Select value={category} onChange={e => setCategory(e.target.value)}><option value="">Tất cả</option>{(role ? library?.categories[role] ?? [] : categories).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></label>
      <label>Trạng thái<Select value={active} onChange={e => setActive(e.target.value)}><option value="">Tất cả</option><option value="true">Active</option><option value="false">Inactive</option></Select></label></div></Card>
    {loading ? <p role="status">Đang tải…</p> : library?.articles.length ? <div className="form-stack">{library.articles.map(a => <Card key={a.id}>
      <div className="form-toolbar"><strong>{a.title}</strong><Button variant="outline" onClick={() => edit(a)}>Sửa</Button></div>
      <p>{a.role === 'student' ? 'Student' : 'Teacher'} · {library.categories[a.role]?.find(c => c.id === a.category)?.label ?? a.category} · {a.is_active ? 'Active' : 'Inactive'}</p>
      <p className="field-helper">Cập nhật {new Date(a.updated_at).toLocaleString('vi-VN')} · {a.updated_by ?? 'Nội dung khởi tạo'}</p>
    </Card>)}</div> : <Card>Không có bài hướng dẫn phù hợp.</Card>}
    <Modal open={!!editing} title={editing?.id ? 'Sửa bài hướng dẫn' : 'Tạo bài hướng dẫn'} size="large" onClose={() => { if (!busy) setEditing(null); }}>
      {editing && <form className="form-stack" onSubmit={e => { e.preventDefault(); void save(); }}>
        {error && <p role="alert">{error}</p>}
        <p>Chỉ nhập hướng dẫn sử dụng. Không nhập API key, system prompt hoặc thông tin bí mật.</p>
        <label>Tiêu đề<Input required minLength={3} maxLength={200} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></label>
        <div className="form-grid"><label>Role bài viết<Select value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value as Article['role'], category: 'other', route: '' })}><option value="student">Student</option><option value="teacher">Teacher</option></Select></label>
          <label>Category bài viết<Select value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })}>{library?.categories[editing.role]?.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></label></div>
        <label>Nội dung (mỗi bước một dòng)<Textarea required minLength={10} maxLength={12000} rows={10} value={editing.content} onChange={e => setEditing({ ...editing, content: e.target.value })} /></label>
        <label>Keywords (cách nhau bằng dấu phẩy)<Input value={keywords} onChange={e => setKeywords(e.target.value)} /></label>
        <label>Related route<Select value={editing.route} onChange={e => setEditing({ ...editing, route: e.target.value })}><option value="">Không có</option>{library?.routes[editing.role]?.map(r => <option key={r} value={r}>{r}</option>)}</Select></label>
        <label><input type="checkbox" checked={editing.is_active} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} /> Active</label>
        <label><input type="checkbox" checked={editing.requires_admin} onChange={e => setEditing({ ...editing, requires_admin: e.target.checked })} /> Vấn đề cần System Admin</label>
        <Button type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu bài hướng dẫn'}</Button>
      </form>}
    </Modal>
  </div>;
}
