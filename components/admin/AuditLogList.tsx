'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useCollectionState, useServerCollection } from '@/lib/collections';
import { Button, Card, LoadingSkeleton, Modal, Table } from '@/components/ui';
import { CollectionToolbar, CollectionPagination, EmptySearchState } from '@/components/collections/CollectionToolbar';
import {
  type AuditRow, auditActionOptions, auditTechnicalIds, formatAuditAction, formatAuditActor,
  formatAuditDetails, formatAuditTarget, formatAuditTime, formatRawAuditMetadata,
} from '@/lib/audit-log-formatters';
import styles from './AuditLogList.module.css';

export default function AuditLogList() {
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const state = useCollectionState({ action: '', role: '', from_time: '', to_time: '' });
  const result = useServerCollection<AuditRow>(state, params => api.auditLogs.list({ ...params,
    from_time: params.from_time ? new Date(String(params.from_time) + 'T00:00:00+07:00').toISOString() : undefined,
    to_time: params.to_time ? new Date(String(params.to_time) + 'T23:59:59.999+07:00').toISOString() : undefined,
  }), 'Không tải được nhật ký hệ thống. Vui lòng thử lại.');
  return <div className={`workspace-page ${styles.page}`}>
    <Card><CollectionToolbar state={state} placeholder="Tìm người thực hiện hoặc hành động..." sorts={[{ value: 'newest', label: 'Mới nhất' }, { value: 'oldest', label: 'Cũ nhất' }]} filters={[
      { key: 'action', label: 'Hành động', options: auditActionOptions },
      { key: 'role', label: 'Vai trò người thực hiện', options: [{ value: 'admin', label: 'Quản trị viên' }, { value: 'teacher', label: 'Giảng viên' }, { value: 'student', label: 'Sinh viên' }] },
      { key: 'from_time', label: 'Từ ngày', type: 'date', options: [] }, { key: 'to_time', label: 'Đến ngày', type: 'date', options: [] },
    ]} /></Card>
    {result.loading && <LoadingSkeleton rows={4} />}
    {result.error && <Card role="alert"><p>{result.error}</p><Button onClick={() => void result.reload()}>Thử lại</Button></Card>}
    {!result.loading && !result.error && <Card>
      {result.rows.length ? <Table label="Nhật ký hệ thống">
        <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead>
        <tbody>{result.rows.map(row => {
          const actor = formatAuditActor(row), target = formatAuditTarget(row), details = formatAuditDetails(row);
          return <tr key={row.id}>
            <td><time dateTime={row.created_at}>{formatAuditTime(row.created_at)}</time></td>
            <td><strong>{actor.name}</strong>{actor.email && <small className={styles.secondary}>{actor.email}</small>}<small className={styles.secondary}>{actor.role}</small></td>
            <td><span className={styles.action}>{formatAuditAction(row.action)}</span></td>
            <td><small className={styles.secondary}>{target.label}</small><strong>{target.name}</strong>{target.description && <small className={styles.secondary}>{target.description}</small>}</td>
            <td><p className={styles.summary}>{details.summary}</p><Button size="sm" variant="ghost" className={styles.detailButton} onClick={() => setSelected(row)} aria-haspopup="dialog">Xem chi tiết<span className={styles.srOnly}>: {formatAuditAction(row.action)} lúc {formatAuditTime(row.created_at)}</span></Button></td>
          </tr>;
        })}</tbody>
      </Table> : <EmptySearchState state={state} />}
      <CollectionPagination state={state} total={result.total} count={result.rows.length} />
    </Card>}
    <Modal open={!!selected} title="Chi tiết nhật ký" size="large" className={styles.modal} onClose={() => setSelected(null)}>
      {selected && <AuditDetails key={selected.id} row={selected} />}
    </Modal>
  </div>;
}

function AuditDetails({ row }: { row: AuditRow }) {
  const actor = formatAuditActor(row), target = formatAuditTarget(row), details = formatAuditDetails(row);
  const [copyStatus, setCopyStatus] = useState('');
  async function copy(label: string, value: string) {
    try { await navigator.clipboard.writeText(value); setCopyStatus(`Đã sao chép ${label}.`); }
    catch { setCopyStatus('Không thể sao chép tự động. Bạn có thể chọn và sao chép nội dung bên dưới.'); }
  }
  return <div className={styles.detail}>
    <div className={styles.highlight}><span>Hành động</span><strong>{formatAuditAction(row.action)}</strong><time dateTime={row.created_at}>{formatAuditTime(row.created_at)} (GMT+7)</time></div>
    <dl className={styles.facts}>
      <div><dt>Người thực hiện</dt><dd><strong>{actor.name}</strong>{actor.email && <span>{actor.email}</span>}<span>{actor.role}</span></dd></div>
      <div><dt>Đối tượng</dt><dd><span>{target.label}</span><strong>{target.name}</strong>{target.description && <span>{target.description}</span>}{row.target && <small className={styles.secondary}>Tên và thông tin đối tượng theo hồ sơ hiện tại.</small>}</dd></div>
      {details.changedFields.length > 0 && <div><dt>Thông tin đã cập nhật</dt><dd><ul className={styles.fields}>{details.changedFields.map(field => <li key={field}>{field}</li>)}</ul></dd></div>}
      {details.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
    </dl>
    {details.beforeAfter.length > 0 && <section aria-label="Giá trị trước và sau" className={styles.changes}>
      <h3>Giá trị trước và sau</h3>
      {details.beforeAfter.map(change => <div key={change.label}><strong>{change.label}</strong><dl><div><dt>Trước</dt><dd>{change.before}</dd></div><div><dt>Sau</dt><dd>{change.after}</dd></div></dl></div>)}
    </section>}
    <details className={styles.technical}>
      <summary>Thông tin kỹ thuật</summary>
      <dl className={styles.technicalFields}>
        <div><dt>Mã hành động</dt><dd><code>{row.action}</code></dd></div>
        {row.entity_type && <div><dt>Loại đối tượng</dt><dd><code>{row.entity_type}</code></dd></div>}
        {auditTechnicalIds(row).map(({ label, value }) => <div key={label}><dt>{label}</dt><dd><code>{value}</code><Button size="sm" variant="outline" onClick={() => void copy(label, value)} aria-label={`Sao chép ${label}`}>Sao chép</Button></dd></div>)}
        {row.ip_address && <div><dt>Địa chỉ IP</dt><dd><code>{row.ip_address}</code></dd></div>}
      </dl>
      <div className={styles.rawHeading}><strong>Dữ liệu gốc</strong><Button size="sm" variant="outline" onClick={() => void copy('dữ liệu gốc', formatRawAuditMetadata(row.metadata))}>Sao chép JSON</Button></div>
      <pre>{formatRawAuditMetadata(row.metadata)}</pre>
      <p role="status" className={styles.copyStatus}>{copyStatus}</p>
    </details>
  </div>;
}
