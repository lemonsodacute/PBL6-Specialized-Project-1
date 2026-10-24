'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, AlertCircle, ArrowRight, Check, CheckCircle2, ChevronDown, Clock3, Code2, Download, FileQuestion, Filter, Headphones, Info, RefreshCw, Server, ShieldCheck, Sparkles, Star, Users } from 'lucide-react';
import { Button, Input, Select, Table } from '@/components/ui';
import { BarChart, ChartCard, ChartEmpty, DonutChart } from '@/components/analytics/Charts';
import { apiFetch, downloadAPIFile } from '@/lib/api';
import { AISupportTabs } from './AISupportTabs';
import { codeOf, configured, count, day, divide, errorDescriptions, healthStatus, numberOf, percent, providerName, rateOf, requestFailure, timestamp, type ActivityData, type DateWindow, type Failure, type Rate, type Tone } from './ai-activity';
import styles from './AIActivityDashboard.module.css';

function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`${styles.status} ${styles[tone]}`}><span aria-hidden="true" />{children}</span>;
}
function MetricBar({ label, value, tone = 'brand' }: { label: string; value: Rate | null; tone?: Tone }) {
  if (!value) return null;
  const text = percent(value), fill = Math.min(100, Math.max(0, (value.rate ?? 0) * 100));
  return <div className={styles.metricBar} data-chat-avoid>
    <div className={styles.barLabel}><span>{label}</span><strong>{text ?? 'Chưa có mẫu'}</strong></div>
    {text ? <div className={`${styles.track} ${styles[tone]}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={fill} aria-valuetext={`${text} · ${value.numerator} / ${value.denominator}`}><span style={{ width:`${fill}%` }} /></div>
      : <div className={`${styles.track} ${styles.neutral}`} aria-hidden="true" />}
    <small>{count(value.numerator)} / {count(value.denominator)} mẫu{text ? '' : ' · Chưa đủ dữ liệu để tính tỷ lệ'}</small>
  </div>;
}
function Stats({ items }: { items: { label: string; value: number | null; tone?: Tone }[] }) {
  return <dl className={styles.stats}>{items.filter(item => item.value != null).map(item => <div key={item.label}>
    <dt>{item.label}</dt><dd className={item.tone ? styles[item.tone] : undefined}>{count(item.value!)}</dd>
  </div>)}</dl>;
}
function Kpi({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: ReactNode; tone: Tone }) {
  return <article className={`${styles.kpi} ${styles[tone]}`}><div className={styles.kpiTop}><span>{label}</span><span className={styles.kpiIcon}>{icon}</span></div>
    <strong className={styles.kpiValue}>{value}</strong><p>{detail}</p></article>;
}

export default function AIActivityDashboard() {
  const [range, setRange] = useState('7');
  const [draft, setDraft] = useState<DateWindow>(() => ({ start:day(6), end:day() }));
  const [applied, setApplied] = useState<DateWindow>(() => ({ start:day(6), end:day() }));
  const [data, setData] = useState<ActivityData | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [dateError, setDateError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [exporting, setExporting] = useState<string | null>(null);
  const params = new URLSearchParams(applied).toString();
  useEffect(() => {
    let alive = true; setLoading(true); setData(null); setError(null);
    void apiFetch<{ data: ActivityData }>(`/admin/ai-support/activity?${params}`)
      .then(response => { if (alive) setData(response.data); })
      .catch(cause => { if (alive) setError(requestFailure(cause, 'Không tải được hoạt động AI. Vui lòng thử lại.')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [params, version]);
  function apply(event: FormEvent) {
    event.preventDefault();
    const span = (Date.parse(draft.end) - Date.parse(draft.start)) / 86400000;
    if (!draft.start || !draft.end || !Number.isFinite(span) || span < 0 || span > 366) {
      setDateError('Chọn khoảng ngày hợp lệ, tối đa 367 ngày; ngày kết thúc phải từ ngày bắt đầu trở đi.'); return;
    }
    setDateError(''); setApplied({ ...draft }); setVersion(value => value + 1);
  }
  async function download(feature: 'question' | 'support') {
    setExporting(feature);
    try { await downloadAPIFile(`/admin/ai-support/export/${feature}?${params}`, `ai-${feature}-${applied.start}-${applied.end}.csv`); }
    catch (cause) { setError(requestFailure(cause, 'Chưa xuất được CSV. Vui lòng thử lại.')); }
    finally { setExporting(null); }
  }
  const q = data?.question ?? {}, s = data?.support ?? {};
  const requests = numberOf(q,'requests'), success = numberOf(q,'success'), generated = numberOf(q,'generated_questions');
  const requested = numberOf(q,'requested_questions'), sessions = numberOf(s,'sessions'), escalated = numberOf(s,'escalated_count');
  const successRate = divide(success,requests), successPercent = successRate ? percent(successRate) : null;
  const failures = numberOf(q,'failures');
  const outcomes = requests != null && success != null && failures != null && success + failures === requests
    ? [{label:'Thành công',value:success,tone:'brand' as const},{label:'Thất bại',value:failures,tone:'critical' as const}] : [];
  const supportOutcomes = [
    {label:'Phiên hỗ trợ',value:sessions,tone:'blue' as const},
    {label:'Đã phản hồi giải quyết',value:numberOf(s,'resolved_by_ai_count'),tone:'brand' as const},
    {label:'Chuyển quản trị viên',value:escalated,tone:'warning' as const},
  ].filter((item):item is typeof item & {value:number} => item.value != null);
  const escalation = rateOf(s.escalation_rate) ?? divide(escalated,sessions);
  const health = data ? healthStatus(data.health) : null, lastError = data ? codeOf(data.health.last_error_code) : null;

  return <div className={`${styles.page} an-page`}>
    <header className={styles.header}><div className={styles.headingIcon}><Activity size={23} aria-hidden="true" /></div><div>
      <h1>Hoạt động AI</h1><p>Theo dõi tình trạng provider, tạo câu hỏi và hỗ trợ người dùng.</p>
    </div></header>
    <AISupportTabs selected="activity" />
    <section className={styles.filterPanel} aria-label="Bộ lọc hoạt động AI">
      <form className={styles.filters} onSubmit={apply} noValidate>
        <label><span><Filter size={14} aria-hidden="true" />Khoảng thời gian</span><Select value={range} onChange={event => {
          const value = event.target.value; setRange(value); setDateError('');
          if (value !== 'custom') setDraft({ start:day(Number(value)-1), end:day() });
        }}><option value="1">Hôm nay</option><option value="7">7 ngày</option><option value="30">30 ngày</option><option value="custom">Tùy chỉnh</option></Select></label>
        <label>Từ ngày<Input type="date" required value={draft.start} aria-invalid={!!dateError} onChange={event => { setRange('custom'); setDraft({ ...draft,start:event.target.value }); }} /></label>
        <label>Đến ngày<Input type="date" required value={draft.end} aria-invalid={!!dateError} onChange={event => { setRange('custom'); setDraft({ ...draft,end:event.target.value }); }} /></label>
        <Button type="submit" disabled={loading} className={styles.applyButton}><Check size={16} aria-hidden="true" />Áp dụng</Button>
      </form>
      <p className={styles.filterHelper}><Info size={13} aria-hidden="true" />Dữ liệu được chuẩn hóa theo UTC. Thời điểm sự kiện hiển thị theo giờ Việt Nam.</p>
      {dateError && <p role="alert" className={styles.dateError}>{dateError}</p>}
    </section>
    {error && <div role="alert" className={styles.errorBanner}><AlertCircle size={21} aria-hidden="true" /><div><strong>{error.message}</strong>
      {(error.code || error.status != null) && <p>{error.code && <code>{error.code}</code>}{error.status != null && ` · HTTP ${error.status}`}</p>}</div>
      <Button variant="outline" size="sm" onClick={() => setVersion(value => value+1)}><RefreshCw size={15} aria-hidden="true" />Thử lại</Button></div>}
    {loading && <div className={styles.loading} role="status" aria-label="Đang tải hoạt động AI"><span className="ui-spinner" aria-hidden="true" />Đang tải hoạt động AI…</div>}
    {data && health && <>
      {requests === 0 && sessions === 0 && <div className={styles.empty} role="status"><Info size={19} aria-hidden="true" /><div><strong>Chưa có dữ liệu trong khoảng thời gian này.</strong><p>Chọn khoảng thời gian khác hoặc sử dụng tính năng AI để bắt đầu ghi nhận hoạt động.</p></div></div>}
      <section className={styles.kpis} aria-label="Chỉ số hoạt động AI">
        {requests != null && <Kpi label={successPercent ? 'Tỷ lệ tạo câu hỏi thành công' : 'Lượt tạo câu hỏi'} value={successPercent ?? count(requests)} detail={success != null ? `${count(success)} / ${count(requests)} lượt xử lý thành công` : 'Lượt xử lý được ghi nhận'} icon={<ShieldCheck size={20} aria-hidden="true" />} tone="success" />}
        {generated != null && <Kpi label="Câu hỏi đã tạo" value={count(generated)} detail={requested != null ? `${count(requested)} câu được yêu cầu` : 'Câu hỏi được ghi nhận trong kỳ'} icon={<FileQuestion size={20} aria-hidden="true" />} tone="info" />}
        {sessions != null && <Kpi label="Phiên hỗ trợ" value={count(sessions)} detail="Phiên được tạo trong khoảng ngày đã chọn" icon={<Users size={20} aria-hidden="true" />} tone="brand" />}
        {escalation && <Kpi label="Chuyển quản trị viên" value={percent(escalation) ?? count(escalation.numerator)} detail={`${count(escalation.numerator)} / ${count(escalation.denominator)} phiên hỗ trợ`} icon={<ArrowRight size={20} aria-hidden="true" />} tone="warning" />}
      </section>
      <div className="an-grid an-grid-main">
        <ChartCard title="Kết quả tạo câu hỏi" description="Phân bố lượt xử lý trong khoảng ngày đã áp dụng" footer={requests != null ? `${count(requests)} lượt xử lý đã ghi nhận · không bao gồm so sánh tăng trưởng.` : 'Chưa có số liệu lượt xử lý.'}>
          <DonutChart label="Kết quả tạo câu hỏi" totalLabel="Lượt xử lý" items={outcomes} />
        </ChartCard>
        <ChartCard title="Kết quả hỗ trợ" description="Phiên hỗ trợ và phản hồi trong kỳ" footer="Phiên đã phản hồi giải quyết và phiên chuyển quản trị viên có thể trùng nhau; không cộng các nhóm thành tổng.">
          <BarChart label="Kết quả hỗ trợ trong kỳ" items={supportOutcomes} />
        </ChartCard>
      </div>
      <section className={styles.health} aria-labelledby="provider-health-title">
        <div className={styles.providerIdentity}><span className={`${styles.healthIcon} ${styles[health.tone]}`}><Server size={22} aria-hidden="true" /></span><div>
          <h2 id="provider-health-title">Tình trạng provider</h2><strong>{providerName(data.health.provider)}</strong><Status tone={health.tone}>{health.label}</Status>
        </div></div>
        <dl className={styles.healthFacts}>
          <div><dt>Tạo câu hỏi</dt><dd><CheckCircle2 size={14} aria-hidden="true" />{configured(data.health.question_model)}</dd></div>
          <div><dt>Hỗ trợ người dùng</dt><dd><Headphones size={14} aria-hidden="true" />{configured(data.health.support_model)}</dd></div>
          <div><dt>Thành công gần nhất</dt><dd><Clock3 size={14} aria-hidden="true" />{timestamp(data.health.last_success_at)}</dd></div>
          <div><dt>Lần chạm giới hạn trong kỳ</dt><dd>{count(data.rate_limit_errors)}</dd></div>
        </dl><p className={styles.healthNote}>{health.note}</p>
      </section>
      <ChartCard title="Xu hướng hoạt động AI" description="Tạo câu hỏi & hỗ trợ người dùng theo ngày">
        <ChartEmpty detail="Chưa có lịch sử theo ngày để hiển thị xu hướng. Bạn vẫn có thể xem số liệu tổng hợp của khoảng thời gian đã chọn ở phía trên." />
      </ChartCard>
      <div className={styles.analytics}>
        <section className={styles.panel} aria-labelledby="question-analytics-title">
          <div className={styles.panelHeader}><div><h2 id="question-analytics-title"><FileQuestion size={19} aria-hidden="true" />Tạo câu hỏi</h2><p>Hiệu suất xử lý và mức đáp ứng yêu cầu</p></div><Button variant="outline" size="sm" disabled={!!exporting} loading={exporting === 'question'} aria-label="Xuất CSV tạo câu hỏi" onClick={() => void download('question')}><Download size={15} aria-hidden="true" />Xuất CSV</Button></div>
          <Stats items={[{label:'Lượt xử lý',value:requests},{label:'Thành công',value:success,tone:'success'},{label:'Thất bại',value:numberOf(q,'failures'),tone:'danger'}]} />
          <div className={styles.bars}>
            <MetricBar label="Xử lý thành công" value={successRate} tone="success" />
            <MetricBar label="Đáp ứng số câu yêu cầu" value={divide(generated,requested)} tone="info" />
            <MetricBar label="Đạt kiểm tra nguồn" value={divide(numberOf(q,'grounded_questions'),generated)} />
          </div>
          <Stats items={[{label:'Câu có nguồn',value:numberOf(q,'questions_with_source')},{label:'Câu kèm ảnh',value:numberOf(q,'image_questions')}]} />
          <p className={styles.note}><Info size={14} aria-hidden="true" />Đạt kiểm tra nguồn không đồng nghĩa đáp án đúng về ngữ nghĩa. Chất lượng vẫn cần giảng viên đánh giá.</p>
          <details className={styles.subDetails}><summary><Star size={16} aria-hidden="true" />Đánh giá chất lượng{numberOf(q,'reviewed') != null && <span>{count(numberOf(q,'reviewed')!)} mẫu</span>}<ChevronDown size={15} aria-hidden="true" /></summary>
            <div className={styles.detailBody}>
              <MetricBar label="Được chấp nhận" value={rateOf(q.acceptance_rate)} tone="success" />
              <MetricBar label="Cần chỉnh sửa" value={rateOf(q.edit_rate)} tone="warning" />
              <MetricBar label="Bị loại bỏ" value={rateOf(q.reject_rate)} tone="danger" />
              {numberOf(q,'average_teacher_rating') != null ? <p className={styles.rating}><Star size={16} aria-hidden="true" />{count(numberOf(q,'average_teacher_rating')!)} / 5{numberOf(q,'teacher_rating_count') != null ? ` · ${count(numberOf(q,'teacher_rating_count')!)} đánh giá sao` : ''}</p> : numberOf(q,'teacher_rating_count') != null && <p className={styles.rating}>Chưa có đánh giá sao{numberOf(q,'teacher_rating_count') === 0 ? ' · 0 mẫu' : ''}</p>}
              {q.insufficient_reviewed_samples && <p className={styles.note}>Chưa đủ 30 mẫu đánh giá. Các tỷ lệ chỉ mô tả những mẫu đã được giảng viên đánh giá.</p>}
            </div>
          </details>
        </section>
        <section className={styles.panel} aria-labelledby="support-analytics-title">
          <div className={styles.panelHeader}><div><h2 id="support-analytics-title"><Headphones size={19} aria-hidden="true" />Hỗ trợ người dùng</h2><p>Kết quả hỗ trợ và khả năng tìm nội dung</p></div><Button variant="outline" size="sm" disabled={!!exporting} loading={exporting === 'support'} aria-label="Xuất CSV hỗ trợ" onClick={() => void download('support')}><Download size={15} aria-hidden="true" />Xuất CSV</Button></div>
          <Stats items={[{label:'Phiên hỗ trợ',value:sessions},{label:'AI giải quyết',value:numberOf(s,'resolved_by_ai_count'),tone:'success'},{label:'Chuyển quản trị viên',value:escalated,tone:'warning'}]} />
          <div className={styles.bars}>
            <MetricBar label="Tỷ lệ chuyển quản trị viên" value={escalation} tone="warning" />
            <MetricBar label="Truy xuất KB thành công" value={rateOf(s.retrieval_hit_rate)} />
            <MetricBar label="Phản hồi đã giải quyết" value={rateOf(s.helpful_rate)} tone="success" />
          </div>
          <Stats items={[{label:'Không tìm thấy trong kho tri thức',value:numberOf(s,'kb_not_found_count'),tone:'warning'}]} />
          <p className={styles.note}><Info size={14} aria-hidden="true" />Phiên tính theo ngày tạo. Tỷ lệ truy xuất tính theo lượt có dữ liệu tìm kiếm; giải quyết dựa trên phản hồi của người dùng.</p>
        </section>
      </div>
      <section className={styles.panel} aria-labelledby="recent-failures-title">
        <div className={styles.panelHeader}><div><h2 id="recent-failures-title"><AlertCircle size={18} aria-hidden="true" />Sự cố gần đây</h2><p>Sự kiện lỗi gần nhất toàn hệ thống, có thể nằm ngoài khoảng lọc.</p></div></div>
        {lastError ? <Table label="Lỗi provider gần nhất"><thead><tr><th>Thời điểm</th><th>Mã lỗi</th><th>Nội dung</th></tr></thead><tbody><tr><td><time dateTime={data.health.last_error_at ?? undefined}>{timestamp(data.health.last_error_at)}</time></td><td><code>{lastError}</code></td><td>{errorDescriptions[lastError] ?? 'Hệ thống đã ghi nhận lỗi từ dịch vụ AI.'}</td></tr></tbody></Table> : <p className={styles.noFailure}><CheckCircle2 size={18} aria-hidden="true" />Chưa ghi nhận sự cố provider.</p>}
        <div className={styles.failureCounts}>{numberOf(q,'provider_failure_count') != null && <span>Tạo câu hỏi: <strong>{count(numberOf(q,'provider_failure_count')!)} lần gọi provider lỗi</strong></span>}{numberOf(s,'provider_failure_count') != null && <span>Hỗ trợ: <strong>{count(numberOf(s,'provider_failure_count')!)} lần gọi provider lỗi</strong></span>}{numberOf(q,'retry_count') != null && <span>Thử lại tạo câu hỏi: <strong>{count(numberOf(q,'retry_count')!)} lượt</strong></span>}</div>
      </section>
    </>}
    {(data || error) && <details className={styles.technical} id="ai-technical-details"><summary><Code2 size={18} aria-hidden="true" /><span>Chi tiết kỹ thuật<small>Cấu hình và chẩn đoán dịch vụ</small></span><ChevronDown size={17} aria-hidden="true" /></summary>
      <div className={styles.technicalBody}>{data && <>
        <dl className={styles.diagnostics}>
          <div><dt>Provider adapter</dt><dd><code>{['gemini-openai-compatible','openai_compatible'].includes(data.health.provider) ? data.health.provider : 'Không xác định'}</code></dd></div>
          <div><dt>Model tạo câu hỏi</dt><dd>{configured(data.health.question_model)}</dd></div>
          <div><dt>Model hỗ trợ</dt><dd>{configured(data.health.support_model)}</dd></div>
          <div><dt>Cấp dịch vụ</dt><dd>{data.health.provider_tier === 'configured externally' ? 'Cấu hình trên máy chủ' : 'Chưa xác định'}</dd></div>
          <div><dt>Mã lỗi provider gần nhất</dt><dd><code>{lastError ?? 'Chưa ghi nhận'}</code></dd></div>
          {numberOf(q,'retry_count') != null && <div><dt>Lần thử lại khi tạo câu hỏi</dt><dd>{count(numberOf(q,'retry_count')!)}</dd></div>}
          {numberOf(q,'average_latency_ms') != null && <div><dt>Độ trễ tạo câu hỏi trung bình</dt><dd>{count(numberOf(q,'average_latency_ms')!)} ms</dd></div>}
          {numberOf(s,'average_response_latency_ms') != null && <div><dt>Độ trễ phản hồi hỗ trợ trung bình</dt><dd>{count(numberOf(s,'average_response_latency_ms')!)} ms</dd></div>}
        </dl>
        <MetricBar label="Đọc dữ liệu có cấu trúc thành công" value={rateOf(q.structured_parse_success_rate)} tone="info" />
        <p className={styles.note}>API hiện cung cấp số liệu tổng hợp, chưa có chuỗi thời gian hoặc dữ liệu chi phí tin cậy. Phân tích ảnh chưa có nhãn đánh giá thực tế.</p>
      </>}{error && <dl className={styles.diagnostics}><div><dt>Yêu cầu dữ liệu / xuất tệp</dt><dd>{error.message}</dd></div>{error.status != null && <div><dt>HTTP</dt><dd>{error.status}</dd></div>}{error.code && <div><dt>Mã lỗi</dt><dd><code>{error.code}</code></dd></div>}</dl>}</div>
    </details>}
    <p className={styles.footerNote}><Sparkles size={14} aria-hidden="true" />Các chỉ số lấy từ dữ liệu đã ghi nhận. Tỷ lệ luôn đi kèm số mẫu thực tế.</p>
  </div>;
}
