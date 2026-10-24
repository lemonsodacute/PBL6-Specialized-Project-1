'use client';

import { Check, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Input, LoadingSkeleton, Select, Textarea, Modal } from '@/components/ui';
import { QuestionEditor } from '@/components/teacher/QuestionEditor';
import { ProtectedDocumentImage, QuestionImages } from '@/components/questions/QuestionImages';
import { api, ApiError, apiFetch } from '@/lib/api';
import { DraftQualityReview, type QualityFeedback } from '@/components/teacher/DraftQualityReview';
import { aiErrorMessage } from '@/lib/ai-provider';
import { difficultyLabels, typeLabels, questionTypeLabel, unwrap, type Bank, type SelectionQuestion } from '@/lib/question-selection';
import { documentError, documentImportReview, draftProblems, draftSelectionQuestion, normalizeDraftContent, updateDocumentDraft,
  type DocumentCapabilities, type DocumentConfiguration, type DocumentDraft, type DocumentSession } from '@/lib/question-documents';

const initialConfig: DocumentConfiguration = { mode: 'import', count: 20, question_type: 'mcq_single', difficulty: 'medium', topic: null };
const normalize = normalizeDraftContent;
const steps = ['Tài liệu', 'Cấu hình', 'Xem câu hỏi', 'Thêm vào ngân hàng'];

export default function DocumentQuestionsPage() {
  const { bankId } = useParams<{ bankId: string }>();
  const [bank, setBank] = useState<(Bank & { questions: SelectionQuestion[] }) | null>(null);
  const [capabilities, setCapabilities] = useState<DocumentCapabilities | null>(null);
  const [document, setDocument] = useState<DocumentSession | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [config, setConfig] = useState<DocumentConfiguration>(initialConfig);
  const [step, setStep] = useState(1);
  const [showPreview, setShowPreview] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [visibleImages, setVisibleImages] = useState(12);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<DocumentDraft | null>(null);
  const [quality, setQuality] = useState<Record<string, QualityFeedback>>({});
  const [savingReviews, setSavingReviews] = useState<Set<string>>(new Set());
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [imported, setImported] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);
  const working = useRef(false);
  const removedDraftIds = useRef(new Set<string>());
  const alive = useRef(true);
  const existing = new Set((bank?.questions ?? []).map(question => normalize(question.content)));
  const drafts = document?.questions ?? [];
  const review = documentImportReview(drafts, selected.filter(id => quality[id]?.decision !== 'rejected'),
    (bank?.questions ?? []).map(question => question.content), document?.images);
  const { selection, readyCount, invalidCount } = review;
  const complete = !(document?.batches ?? []).some(batch => !batch.complete);
  const remainingParts = document?.batches.filter(batch => !batch.complete).length ?? 0;
  const reviewCounts = {
    accepted: drafts.filter(draft => quality[draft.id]?.decision === 'accepted').length,
    edited: drafts.filter(draft => quality[draft.id]?.decision === 'edited').length,
    rejected: drafts.filter(draft => quality[draft.id]?.decision === 'rejected').length,
    unreviewed: drafts.filter(draft => !quality[draft.id]?.decision).length,
  };
  const importBlockers = [
    ...(busy ? ['Đang xử lý yêu cầu. Vui lòng chờ hoàn tất.'] : []),
    ...(savingReviews.size ? ['Đang lưu đánh giá chất lượng. Vui lòng chờ hoàn tất.'] : []),
    ...(expired ? ['Phiên tài liệu đã hết hạn. Vui lòng tải lại file.'] : []),
    ...(!document?.config ? ['Vui lòng tạo bản nháp trước khi thêm vào ngân hàng.'] : []),
    ...(!selection.length ? ['Chưa chọn câu hỏi nào. Hãy chọn ít nhất một câu hợp lệ để thêm.'] : []),
    ...(invalidCount ? [`Còn ${invalidCount} câu đang chọn chưa hợp lệ. Vui lòng sửa lỗi ghi tại từng câu hoặc bỏ chọn trước khi thêm.`] : []),
  ];
  const importDisabled = importBlockers.length > 0;

  useEffect(() => {
    alive.current = true;
    let active = true;
    setLoading(true);
    const saved = new URL(window.location.href).searchParams.get('document');
    void Promise.all([api.questionBanks.get(bankId), api.questionBanks.documentCapabilities(bankId)]).then(async ([response, available]) => {
      if (!active) return;
      setBank(unwrap<Bank & { questions: SelectionQuestion[] }>(response)); setCapabilities(available);
      let session: DocumentSession | null = null;
      if (saved) {
        try { session = await api.questionBanks.document(bankId, saved); }
        catch (cause) {
          if (!active) return;
          setError(documentError(cause, 'Phiên tài liệu không còn khả dụng. Vui lòng tải lại file.'));
          setDocument(null); setStep(1);
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
      if (!active) return;
      if (session) {
        setDocument(session);
        if (session.config) setConfig(session.config);
        setSelected(session.questions.filter(draft => !draft.duplicate && !draftProblems(draft).length).map(draft => draft.id));
        setImported(session.imported_count ?? null);
        setStep(session.imported_count != null ? 4 : session.questions.length && session.batches.every(batch => batch.complete) ? 3 : 2);
      }
    }).catch(cause => { if (active) setError(documentError(cause, 'Không tải được ngân hàng hoặc phiên tài liệu. Vui lòng mở lại ngân hàng.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; alive.current = false; };
  }, [bankId]);
  useEffect(() => {
    if (!document) { setExpired(false); return; }
    const check = () => setExpired(new Date(document.expires_at).getTime() <= Date.now());
    check(); const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [document?.expires_at]);
  useEffect(() => {
    let active = true; setQuality({});
    if (document?.id) void apiFetch<{ data: Record<string, QualityFeedback> }>(`/question-banks/${bankId}/documents/${document.id}/feedback`)
      .then(r => { if (active) {
        setQuality(r.data);
        setSelected(current => current.filter(id => r.data[id]?.decision !== 'rejected'));
      } }).catch(() => {});
    return () => { active = false; };
  }, [bankId, document?.id]);

  function setSession(session: DocumentSession) {
    setDocument(current => ({ ...session, sections: session.sections ?? current?.sections }));
  }
  function chooseDefaults(session: DocumentSession) {
    setSelected(session.questions.filter(draft => !draft.duplicate && !draftProblems(draft).length).map(draft => draft.id));
  }
  function chooseAll() {
    const seen = new Set(existing);
    const candidates = documentImportReview(drafts, [], (bank?.questions ?? []).map(question => question.content), document?.images);
    setSelected(drafts.filter(draft => {
      const content = normalize(draft.content);
      if (quality[draft.id]?.decision === 'rejected' || candidates.problems.get(draft.id)?.length || seen.has(content)) return false;
      seen.add(content);
      return true;
    }).map(draft => draft.id));
  }
  function saveQuality(draft: DocumentDraft, value: QualityFeedback) {
    setQuality(current => ({ ...current, [draft.id]: value }));
    if (value.decision === 'rejected') setSelected(current => current.filter(id => id !== draft.id));
  }
  function reviewSaving(id: string, saving: boolean) {
    setSavingReviews(current => {
      if (current.has(id) === saving) return current;
      const next = new Set(current);
      if (saving) next.add(id); else next.delete(id);
      return next;
    });
  }
  async function upload() {
    if (!file || working.current) return;
    const extension = file.name.split('.').pop()?.toLocaleLowerCase();
    const mime = extension === 'pdf' ? 'application/pdf' : extension === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : null;
    if (!mime || file.type !== mime) { setError('Vui lòng chọn file PDF hoặc DOCX có đúng định dạng.'); return; }
    if (!file.size || file.size > (capabilities?.max_file_bytes ?? 10 * 1024 * 1024)) { setError('Tài liệu phải có dữ liệu và không vượt quá 10 MB.'); return; }
    working.current = true; setBusy(true); setError('');
    try {
      const session = await api.questionBanks.uploadDocument(bankId, file);
      if (!alive.current) return;
      setDocument(session); setSelected([]); setShowPreview(false); setShowImages(false); setVisibleImages(12);
      removedDraftIds.current.clear();
      window.history.replaceState(null, '', `${window.location.pathname}?document=${session.id}`);
    } catch (cause) { if (alive.current) setError(documentError(cause, 'Chưa đọc được tài liệu. Vui lòng thử lại.')); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function reset() {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try {
      if (document && !expired) await api.questionBanks.discardDocument(bankId, document.id);
      setDocument(null); setSelected([]); setFile(null); setConfig(initialConfig); setStep(1); setProgress(''); setImported(null);
      removedDraftIds.current.clear();
      window.history.replaceState(null, '', window.location.pathname);
    } catch (cause) { setError(documentError(cause, 'Chưa bỏ được phiên tài liệu. Vui lòng thử lại.')); }
    finally { working.current = false; setBusy(false); }
  }
  async function prepare(retryOnly = false) {
    if (!document || working.current || expired) return;
    const requested = retryOnly ? document.config : config;
    if (!requested) return;
    if (requested.mode === 'generate' && (!Number.isInteger(requested.count) || requested.count < 1 || requested.count > 100)) {
      setError('Số câu cần là số nguyên từ 1 đến 100.'); return;
    }
    working.current = true; setBusy(true); setError(''); setProgress('Đang chuẩn bị bản nháp…');
    try {
      const requestConfig = { ...requested, topic: requested.topic?.trim() || null };
      setConfig(requestConfig);
      const resume = requestConfig.mode === 'generate' && document.batches.some(batch => !batch.complete)
        && (retryOnly || JSON.stringify(document.config) === JSON.stringify(requestConfig));
      const reviewedIds = new Set([...document.questions.map(question => question.id), ...removedDraftIds.current]);
      if (!resume) removedDraftIds.current.clear();
      let session = resume ? document : await api.questionBanks.prepareDocumentDrafts(bankId, document.id, requestConfig);
      if (!alive.current) return;
      setSession(session);
      let lastFailure: string | null = null;
      for (const batch of session.batches) {
        if (batch.complete) continue;
        setProgress(`Đã xử lý ${session.batches.filter(part => part.complete).length}/${session.batches.length} phần · Đã tạo ${session.questions.length} câu. Đang tạo và kiểm tra câu hỏi ở phần ${batch.index + 1}…`);
        try {
          const next = await api.questionBanks.generateDocumentBatch(bankId, document.id, batch.index);
          if (!alive.current) return;
          session = { ...next, questions: next.questions.filter(question => !removedDraftIds.current.has(question.id))
            .map(question => session.questions.find(old => old.id === question.id) ?? question) };
          setSession(session);
        } catch (cause) {
          if (!alive.current) return;
          lastFailure = documentError(cause, 'Phần tài liệu này chưa xử lý được. Bạn có thể thử lại.');
          session = { ...session, batches: session.batches.map(part => part.index === batch.index ? { ...part, error: { code: cause instanceof ApiError ? cause.code ?? 'AI_REQUEST_FAILED' : 'AI_REQUEST_FAILED', message: lastFailure! } } : part) };
          setSession(session);
          // Global quota/auth/model failures will affect every remaining batch.
          if (cause instanceof ApiError && ['AI_RATE_LIMITED', 'AI_AUTH_FAILED', 'AI_NOT_CONFIGURED', 'AI_MODEL_UNSUPPORTED'].includes(cause.code ?? '')) break;
        }
      }
      if (resume) setSelected(session.questions.filter(question => !question.duplicate && !draftProblems(question).length
        && (selected.includes(question.id) || !reviewedIds.has(question.id))).map(question => question.id));
      else chooseDefaults(session);
      if (session.questions.length || session.batches.every(batch => batch.complete)) setStep(3);
      if (lastFailure) setError(lastFailure);
      setProgress('');
    } catch (cause) { if (alive.current) setError(documentError(cause, 'Chưa tạo được bản nháp. Các lượt đã hoàn tất được giữ lại để bạn tiếp tục.')); }
    finally { working.current = false; if (alive.current) { setBusy(false); setProgress(''); } }
  }
  async function regenerate(draft: DocumentDraft) {
    if (!document || working.current || expired) return;
    working.current = true; setBusy(true); setError('');
    try {
      const next = await api.questionBanks.regenerateDocumentDraft(bankId, document.id, draft.id);
      setQuality(current => { const next = { ...current }; delete next[draft.id]; return next; });
      if (alive.current) setDocument(current => current ? { ...current, questions: current.questions.map(question => question.id === draft.id ? next : question) } : current);
    } catch (cause) { if (alive.current) setError(documentError(cause, 'Chưa tạo lại được câu hỏi. Bản nháp hiện tại được giữ nguyên.')); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function importQuestions() {
    if (!document || working.current || importDisabled) return;
    working.current = true; setBusy(true); setError('');
    try {
      const result = await api.questionBanks.importDocumentDrafts(bankId, document.id, selection);
      if (alive.current) setImported(result.imported_count);
    } catch (cause) { if (alive.current) setError(documentError(cause, 'Chưa thêm được câu hỏi. Bản nháp và lựa chọn hiện tại được giữ nguyên.')); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }

  return <div className="workspace-page question-bank-page document-question-page">
    <nav className="bank-breadcrumb" aria-label="Đường dẫn ngân hàng"><Link href="/dashboard/question-banks">Ngân hàng câu hỏi</Link><span aria-hidden="true">/</span><Link href={`/dashboard/question-banks/${bankId}`}>{bank?.name ?? 'Ngân hàng'}</Link><span aria-hidden="true">/</span><span>Tạo từ tài liệu</span></nav>
    <ol className="document-steps" aria-label="Các bước tạo câu hỏi">{steps.map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined}><span>{index + 1}</span><strong>{label}</strong></li>)}</ol>
    {error && <Card role="alert"><p>{error}</p></Card>}
    {expired && imported == null && <Card role="alert"><p>Phiên tài liệu đã hết hạn. Vui lòng tải lại file.</p><Button variant="outline" disabled={busy} onClick={() => void reset()}>Tải tài liệu mới</Button></Card>}
    {progress && <p role="status" aria-live="polite">{progress}</p>}
    {document && document.config?.mode === 'generate' && remainingParts > 0 && !busy && <Card><p>Đã tạo {document.questions.length} câu hỏi. {remainingParts} phần chưa xử lý được.</p>
      <Button variant="outline" disabled={expired || savingReviews.size > 0} onClick={() => void prepare(true)}>Thử lại phần lỗi</Button>
      {!!document.questions.length && step !== 3 && <Button variant="outline" onClick={() => setStep(3)}>Xem câu hỏi đã tạo</Button>}</Card>}
    {loading ? <LoadingSkeleton rows={4} /> : bank && <>
      {step === 1 && <Card className="document-stage"><h2>Bước 1 — Tài liệu</h2>
        {!document ? <div className="form-stack"><label>Chọn tài liệu<Input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(''); }} /></label>
          <p>PDF hoặc DOCX, tối đa 10 MB và 200 trang PDF. PDF scan cần được chuyển sang text trước khi tải.</p>
          <Button disabled={!file || busy} onClick={() => void upload()}>{busy ? 'Đang đọc tài liệu…' : 'Đọc tài liệu'}</Button></div>
          : <div className="form-stack"><div className="document-summary">
            <div className="document-summary-heading"><strong>{document.filename}</strong><Badge>{(document.file_type ?? document.filename.split('.').pop() ?? '').toUpperCase()}</Badge></div>
            <p className="document-read-success" role="status"><Check className="inline-icon" aria-hidden="true" /> Đã đọc tài liệu thành công</p>
            <div className="document-metadata"><span>{document.character_count.toLocaleString('vi-VN')} ký tự</span>
              {document.page_count != null && <span>{document.page_count.toLocaleString('vi-VN')} trang{document.page_count_estimated ? ' (ước tính)' : ''}</span>}
              <span>{(document.image_count ?? 0).toLocaleString('vi-VN')} hình ảnh</span>
              {document.structured_question_count != null && <span>{document.structured_question_count.toLocaleString('vi-VN')} câu hỏi có cấu trúc được phát hiện</span>}</div>
            <ul className="document-read-checks"><li><Check className="inline-icon" aria-hidden="true" /> Đã trích xuất văn bản</li>
              <li><Check className="inline-icon" aria-hidden="true" /> Đã phát hiện {document.image_count ?? 0} hình ảnh</li>
              {document.structured_question_count != null && <li><Check className="inline-icon" aria-hidden="true" /> Đã phát hiện {document.structured_question_count} câu hỏi có cấu trúc</li>}
              {document.structure_parsed && <li><Check className="inline-icon" aria-hidden="true" /> Đã phân tích cấu trúc tài liệu</li>}</ul>
          </div>
            {document.warnings.map(warning => <p className="document-warning" key={warning}>{warning}</p>)}
            <div className="form-toolbar"><Button variant="outline" aria-expanded={showPreview} onClick={() => setShowPreview(value => !value)}>Xem trước nội dung</Button>
              {!!document.images?.length && <Button variant="outline" aria-expanded={showImages} onClick={() => setShowImages(value => !value)}>Xem hình ảnh</Button>}</div>
            {showPreview && <label>Xem trước nội dung<Textarea rows={12} readOnly value={document.preview_text ?? document.sections?.map(item => item.text).join('\n').slice(0, 1000) ?? ''} /></label>}
            {showImages && !expired && <><div className="document-image-gallery">{document.images?.slice(0, visibleImages).map((image, index) => <figure key={image.id}>
              <ProtectedDocumentImage path={image.temp_url} alt={`Hình ảnh trong tài liệu ${index + 1}`} />
              <figcaption>{image.page ? `Trang ${image.page}` : 'Tài liệu Word'}{image.question_number != null ? ` · Câu ${image.question_number}` : ' · Chưa xác định câu hỏi'}</figcaption></figure>)}</div>
              {(document.images?.length ?? 0) > visibleImages && <Button variant="outline" onClick={() => setVisibleImages(value => value + 12)}>Xem thêm hình ảnh</Button>}</>}
            <p className="field-helper">Phiên tài liệu có hiệu lực 2 giờ. Nội dung nguồn được xóa sau khi nhập thành công.</p>
            <div className="form-actions"><Button variant="outline" disabled={busy} onClick={() => void reset()}>Đổi tài liệu</Button><Button disabled={busy || expired} onClick={() => { setError(''); setStep(2); }}>Tiếp tục cấu hình</Button></div></div>}
      </Card>}

      {step === 2 && document && <Card className="document-stage"><h2>Bước 2 — Cấu hình</h2><div className="form-stack">
        <label>Cách xử lý tài liệu<Select value={config.mode} disabled={busy || expired} onChange={event => { setError(''); setConfig(current => ({ ...current, mode: event.target.value as 'import' | 'generate' })); }}>
          <option value="import">Nhập câu hỏi có sẵn</option><option value="generate" disabled={!capabilities?.generation_available}>Tạo câu hỏi từ tài liệu</option></Select></label>
        {config.mode === 'import' ? <><p>Dùng tài liệu có câu hỏi và đáp án. Nội dung được giữ nguyên để bạn review, không viết lại bằng AI.</p><div className="document-format-example">Câu 1: Nội dung câu hỏi…<br />A. Phương án thứ nhất<br />B. Phương án thứ hai<br />Đáp án: B</div></>
          : <><p>Câu hỏi được tạo theo từng lượt từ các phần trải đều tài liệu. Bạn cần kiểm tra nội dung, phương án và đáp án trước khi thêm.</p>
            <div className="form-grid"><label>Số câu<Input type="number" min={1} max={100} value={config.count} disabled={busy} onChange={event => setConfig(current => ({ ...current, count: Number(event.target.value) }))} /></label>
              <label>Loại câu hỏi<Select value={config.question_type} disabled={busy} onChange={event => setConfig(current => ({ ...current, question_type: event.target.value as DocumentConfiguration['question_type'] }))}>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
              <label>Độ khó<Select value={config.difficulty} disabled={busy} onChange={event => setConfig(current => ({ ...current, difficulty: event.target.value as DocumentConfiguration['difficulty'] }))}>{Object.entries(difficultyLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label></div></>}
        {capabilities && !capabilities.generation_available && <p className="field-helper">{capabilities.provider_status?.error?.code && capabilities.provider_status.error.code !== 'AI_NOT_CONFIGURED' ? aiErrorMessage(capabilities.provider_status.error.code) : 'Chức năng tạo bằng AI chưa được cấu hình.'} Bạn vẫn có thể nhập câu hỏi có sẵn từ tài liệu.</p>}
        {!!document.image_count && <p>Đã phát hiện {document.image_count} hình ảnh. {capabilities?.vision_available ? 'AI có thể phân tích hình ảnh.' : 'AI sẽ chỉ dùng nội dung văn bản.'}</p>}
        {!!document.image_count && !capabilities?.vision_available && <p className="document-warning">AI vẫn có thể tạo câu hỏi từ phần văn bản đủ thông tin; câu có hình đính kèm sẽ được đánh dấu để bạn kiểm tra thủ công.</p>}
        <label>Chủ đề / chương<Input maxLength={255} value={config.topic ?? ''} disabled={busy} placeholder="Không bắt buộc" onChange={event => setConfig(current => ({ ...current, topic: event.target.value || null }))} /></label>
        {!!document.questions.length && !complete && <p>Đã tạo {document.questions.length}/{config.count} câu. Bạn có thể tiếp tục các lượt còn lại.</p>}
        <div className="form-actions"><Button variant="outline" disabled={busy} onClick={() => { setError(''); setStep(1); }}>Quay lại tài liệu</Button>
          <Button disabled={busy || expired || (config.mode === 'generate' && !capabilities?.generation_available)} onClick={() => void prepare()}>{busy ? 'Đang xử lý…' : config.mode === 'import' ? 'Đọc câu hỏi có sẵn' : !complete ? 'Tiếp tục tạo câu hỏi' : 'Tạo bản nháp'}</Button></div>
      </div></Card>}

      {step === 3 && document && <>
        <Card className="document-review-heading"><h2>Bước 3 — Câu hỏi đề xuất — {drafts.length}</h2><p>Các câu này là bản nháp. Chưa có câu hỏi nào được thêm vào ngân hàng.</p>
          {document.warnings.map(warning => <p className="document-warning" key={warning}>{warning}</p>)}
          {!drafts.length && <p>Phần nguồn chưa đủ căn cứ để tạo câu hỏi. Hãy bổ sung tài liệu hoặc chọn nội dung khác.</p>}
          <div className="form-toolbar"><Button variant="outline" disabled={busy || expired} onClick={chooseAll}>Chọn tất cả</Button><Button variant="outline" disabled={busy} onClick={() => setSelected([])}>Bỏ chọn tất cả</Button></div>
        </Card>
        <div className="document-draft-list">{drafts.map((draft, index) => {
          const problems = review.problems.get(draft.id) ?? [];
          const rejected = quality[draft.id]?.decision === 'rejected';
          return <Card className="document-draft-card" key={draft.id}>
            <label className="document-draft-select"><input className="ui-checkbox" type="checkbox" disabled={busy || expired || rejected} aria-label={`Chọn câu đề xuất ${index + 1}`} checked={!rejected && selected.includes(draft.id)} onChange={event => setSelected(current => event.target.checked ? [...current, draft.id] : current.filter(id => id !== draft.id))} /><strong>Câu {index + 1}</strong></label>
            <p className="document-draft-content">{draft.content}</p><p className="question-row-meta"><Badge className="question-type" data-type={draft.type}>{questionTypeLabel(draft.type)}</Badge>{draft.difficulty && <span className="question-difficulty" data-difficulty={draft.difficulty}>{difficultyLabels[draft.difficulty]}</span>}{draft.topic && <span>{draft.topic}</span>}<span>{Number(draft.default_points)} điểm</span></p>
            {!expired && <QuestionImages images={draft.images?.map(image => ({ ...image, preview_url: image.temp_url }))} />}
            {!expired && draft.images?.map((image, imageIndex) => <Button key={image.id} variant="outline" onClick={() => setSourceImage(image.temp_url)}>Xem hình nguồn {imageIndex + 1}</Button>)}
            {draft.warning_codes?.includes('IMAGE_REQUIRES_VISION') && <p className="document-warning"><TriangleAlert className="inline-icon" aria-hidden="true" /> Hình ảnh chưa được AI phân tích. Hãy kiểm tra hình và đáp án trước khi nhập.</p>}
            {!!draft.options.length && <ol className="document-options" type="A">{draft.options.map((option, optionIndex) => <li key={optionIndex}>{option}{draft.answers.includes(option) && <Badge tone="success">Đáp án đúng</Badge>}</li>)}</ol>}
            <p><strong>{draft.type.startsWith('mcq_') ? 'Đáp án đúng' : 'Đáp án mẫu'}:</strong> {draft.answers.join(' · ') || 'Chưa có — cần bổ sung'}</p>
            {draft.explanation && <p><strong>Giải thích:</strong> {draft.explanation}</p>}
            <p className="field-helper">Nguồn: {draft.source_page ? `Trang ${draft.source_page}` : 'Trang chưa xác định'} · {draft.source_section || 'Tài liệu đã tải'}{draft.images?.length ? ` · ${draft.images.length} hình đi kèm` : ''}</p>
            <details className="document-source"><summary>Hiển thị đoạn nguồn</summary><blockquote>{draft.source_excerpt}</blockquote></details>
            {problems.map(problem => <p className="document-warning" key={problem}><TriangleAlert className="inline-icon" aria-hidden="true" /> {problem}</p>)}
            {document.config?.mode === 'generate' && <DraftQualityReview key={`${draft.id}:${draft.content}`} initial={quality[draft.id]}
              onSaved={value => saveQuality(draft, value)}
              onSavingChange={value => reviewSaving(draft.id, value)}
              path={`/question-banks/${bankId}/documents/${document.id}/drafts/${draft.id}/feedback`} disabled={busy || expired} />}
            <div className="draft-question-actions" role="group" aria-label={`Thao tác câu ${index + 1}`}><h3>Thao tác</h3><div className="form-toolbar">
              <Button variant="outline" disabled={busy || expired || savingReviews.has(draft.id)} onClick={() => { setError(''); setEditing(draft); }}>Sửa</Button>
              {config.mode === 'generate' && <Button variant="outline" disabled={busy || expired || savingReviews.has(draft.id)} onClick={() => void regenerate(draft)}>Tạo lại câu này</Button>}
              <Button variant="ghost" disabled={busy || expired || savingReviews.has(draft.id)} onClick={() => { removedDraftIds.current.add(draft.id); setDocument(current => current ? { ...current, questions: current.questions.filter(question => question.id !== draft.id) } : current); setSelected(current => current.filter(id => id !== draft.id)); }}>Bỏ</Button>
            </div></div>
          </Card>;
        })}</div>
        <Card className="document-review-actions">
          <div className="document-review-summary" aria-live="polite"><span>{drafts.length} câu được tạo</span><strong>Đã chọn: {selection.length}</strong><strong>Sẵn sàng thêm: {readyCount}</strong>
            {document.config?.mode === 'generate' && <><span>Đạt: {reviewCounts.accepted}</span><span>Cần sửa: {reviewCounts.edited}</span><span>Loại bỏ: {reviewCounts.rejected}</span><span>Chưa đánh giá: {reviewCounts.unreviewed}</span></>}
          </div>
          {document.config?.mode === 'generate' && <p className="field-helper">Đánh giá chất lượng là tùy chọn, không phải điều kiện mở khóa import. Mọi câu đang chọn vẫn phải có nội dung, phương án và đáp án hợp lệ.</p>}
          {remainingParts > 0 && <p className="document-warning">Còn {remainingParts} phần chưa xử lý xong. Bạn có thể thử lại phần lỗi hoặc tiếp tục thêm {readyCount} câu hợp lệ đã tạo. Nhập thành công sẽ kết thúc phiên tài liệu.</p>}
          {importBlockers.length > 0 && <div id="document-import-blockers" role="status">{importBlockers.map(reason => <p className="document-warning" key={reason}>{reason}</p>)}</div>}
          <div className="form-actions"><Button variant="outline" disabled={busy || savingReviews.size > 0} onClick={() => { setError(''); setStep(2); }}>Quay lại cấu hình</Button>
            <Button disabled={importDisabled} aria-describedby={importDisabled ? 'document-import-blockers' : undefined} onClick={() => { if (!importDisabled) { setError(''); setStep(4); } }}>Tiếp tục thêm {readyCount} câu</Button></div>
        </Card>
      </>}

      {step === 4 && <Card className="document-stage"><h2>Bước 4 — Thêm vào ngân hàng</h2>
        {imported != null ? <div className="form-stack"><p role="status">Đã thêm {imported} câu vào ngân hàng “{bank.name}”.</p><Link className="bank-open-link" href={`/dashboard/question-banks/${bankId}`}>Mở ngân hàng</Link><Button variant="outline" onClick={() => void reset()}>Nhập tài liệu khác</Button></div>
          : <div className="form-stack"><p>Bạn đã chọn {selection.length} câu để thêm vào “{bank.name}”.</p><p>Vui lòng xác nhận rằng bạn đã kiểm tra nội dung, phương án và đáp án của các câu đang chọn.</p>
            {remainingParts > 0 && <p className="document-warning">Còn {remainingParts} phần chưa xử lý xong. Xác nhận sẽ chỉ thêm {readyCount} câu đang chọn và kết thúc phiên; các phần chưa xong sẽ không được nhập. Quay lại review nếu bạn muốn thử lại phần lỗi trước.</p>}
            {importBlockers.length > 0 && <div id="document-import-blockers" role="status">{importBlockers.map(reason => <p className="document-warning" key={reason}>{reason}</p>)}</div>}
            <div className="form-actions"><Button variant="outline" disabled={busy} onClick={() => { setError(''); setStep(3); }}>Quay lại review</Button><Button variant="success" disabled={importDisabled} aria-describedby={importDisabled ? 'document-import-blockers' : undefined} onClick={() => void importQuestions()}>{busy ? 'Đang thêm…' : `Thêm ${readyCount} câu vào ngân hàng`}</Button></div></div>}
      </Card>}
    </>}
    <Modal open={!!sourceImage} title="Hình nguồn" size="extra-large" onClose={() => setSourceImage(null)}>{sourceImage && <ProtectedDocumentImage path={sourceImage} alt="Hình ảnh nguồn tài liệu" />}</Modal>
    {editing && <QuestionEditor key={editing.id} documentImages={document?.images} question={draftSelectionQuestion(editing, bankId)} onClose={() => setEditing(null)} onSaveDraft={edited => {
      const next = updateDocumentDraft(editing, edited, document?.images);
      if (next.images?.length && !capabilities?.vision_available) next.warning_codes = ['IMAGE_REQUIRES_VISION'];
      setDocument(current => current ? { ...current, questions: current.questions.map(question => question.id === editing.id ? next : question) } : current);
      setEditing(null);
    }} />}
  </div>;
}
