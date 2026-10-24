'use client';
import { ArrowRight, Check } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthContext';
import { Badge, Button, Card, Input, LoadingSkeleton, Select, Textarea } from '@/components/ui';

import { api } from '@/lib/api';
import { friendlyError } from '@/lib/uiErrors';
import { profileRoute, type ExamDefaults, type PersonalSettings, type PersonalSettingsPatch, type SystemSettings, type ThemePreference } from '@/lib/settings';
import { useTheme } from './ThemeProvider';
import styles from './SettingsHelp.module.css';

type Role = 'student' | 'teacher' | 'admin';
export function SettingsPage({ role }: { role: Role }) {
  const { user, authReady } = useAuth(); const { savedTheme } = useTheme();
  const [personal, setPersonal] = useState<PersonalSettings | null>(null); const [system, setSystem] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const epoch = useRef(0);
  const allowed = authReady && user?.role === role;
  const load = useCallback(async () => {
    if (!allowed) return;
    const request = ++epoch.current; setLoading(true); setError(''); setPersonal(null); setSystem(null);
    try {
      const [preferences, defaults] = await Promise.all([api.settings.me(), role === 'admin' ? api.settings.system() : Promise.resolve(null)]);
      if (request === epoch.current) { setPersonal(preferences); setSystem(defaults); savedTheme(preferences.theme); }
    } catch (cause) { if (request === epoch.current) setError(friendlyError(cause, 'Không tải được cài đặt. Vui lòng thử lại.')); }
    finally { if (request === epoch.current) setLoading(false); }
  }, [allowed, role, user?.id, savedTheme]);
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [load]);
  async function update(body: PersonalSettingsPatch) {
    const response = await api.settings.updateMe(body); setPersonal(response);
    if (body.theme) savedTheme(response.theme);
    if (body.notification_preferences) window.dispatchEvent(new Event('notification-preferences-updated'));
    return response;
  }
  async function updateSystem(body: Partial<SystemSettings>) { const response = await api.settings.updateSystem(body); setSystem(response); return response; }
  if (!authReady) return <LoadingSkeleton rows={4} />;
  if (!allowed) return <Card role="alert">Bạn không có quyền truy cập trang cài đặt này.</Card>;
  return <div className={`workspace-page ${styles.settings}`}>
    {loading && <LoadingSkeleton rows={4} />}
    {error && <Card role="alert"><p>{error}</p><Button onClick={() => void load()}>Thử lại</Button></Card>}
    {personal && <><h2 className={styles.groupHeading}>Cài đặt cá nhân</h2>
      <SettingsSection title="Giao diện" initial={{ theme: personal.theme }} save={async value => ({ theme: (await update(value)).theme })}>
        {(value, change) => <label className={styles.field}>Chế độ giao diện<Select value={value.theme} onChange={event => change({ theme: event.target.value as ThemePreference })}><option value="light">Sáng</option><option value="dark">Tối</option><option value="system">Theo hệ thống</option></Select></label>}
      </SettingsSection>
      {personal.notification_options.length > 0 ? <SettingsSection title="Thông báo trong ứng dụng" description="Áp dụng cho danh sách thông báo và số thông báo chưa đọc." initial={personal.notification_preferences} save={async value => (await update({ notification_preferences: value })).notification_preferences}>
        {(value, change) => <>{personal.notification_options.map(option => <label className={styles.check} key={option.key}><input type="checkbox" checked={value[option.key] !== false} onChange={event => change({ ...value, [option.key]: event.target.checked })} /><span>{option.label}</span></label>)}<SecurityNotificationNote /></>}
      </SettingsSection> : <Card className={styles.section}><h2>Thông báo trong ứng dụng</h2><SecurityNotificationNote /><p className={styles.muted}>Thông báo hồ sơ và thẻ sinh viên được giữ để bạn biết kết quả xác minh hoặc yêu cầu cập nhật.</p></Card>}
      {role === 'teacher' && personal.exam_defaults && personal.exam_overrides && <TeacherDefaults personal={personal} save={update} />}
      {role !== 'admin' && <Card className={styles.section}><h2>Hồ sơ</h2><p>Thông tin cá nhân được quản lý trong trang hồ sơ.</p>{role === 'student' && <p className={styles.muted}>Ảnh hồ sơ được lấy từ thẻ sinh viên đã xác thực.</p>}<Link className="ui-button ui-button-outline ui-button-md" href={profileRoute(role)}>{role === 'student' ? 'Mở hồ sơ sinh viên' : 'Mở hồ sơ giảng viên'}</Link></Card>}
    </>}
    {role === 'admin' && system && <><h2 className={styles.groupHeading}>Cài đặt hệ thống</h2>
      <SettingsSection title="Mặc định đề thi" description="Áp dụng cho đề mới khi giảng viên chưa lưu mặc định riêng. Đề đã tạo giữ nguyên cấu hình." initial={{ exam_duration_minutes: system.exam_duration_minutes, exam_require_camera: system.exam_require_camera, exam_require_mic: system.exam_require_mic }} save={async value => { const response = await updateSystem(value); return { exam_duration_minutes: response.exam_duration_minutes, exam_require_camera: response.exam_require_camera, exam_require_mic: response.exam_require_mic }; }}>
        {(value, change) => <ExamDefaultFields value={value} change={change} />}
      </SettingsSection>
      <SettingsSection title="Thông tin hỗ trợ" description="Nội dung này hiển thị trong Trợ giúp của tất cả người dùng." initial={{ support_text: system.support_text }} save={async value => ({ support_text: (await updateSystem(value)).support_text })}>
        {(value, change) => <label className={styles.field}>Hướng dẫn liên hệ hỗ trợ<Textarea rows={4} maxLength={2000} required value={value.support_text} onChange={event => change({ support_text: event.target.value })} /></label>}
      </SettingsSection><Link className="table-link" href="/dashboard/action-logs">Xem nhật ký thay đổi cài đặt hệ thống <ArrowRight className="inline-icon" aria-hidden="true" /></Link>
    </>}
  </div>;
}

function SecurityNotificationNote() {
  return <p className={styles.security}><Badge tone="info">Luôn nhận</Badge> Thông báo thu hồi xác thực, yêu cầu cập nhật thẻ, kết quả xác minh hồ sơ và kết thúc bài thi không thể tắt. Cảnh báo mức độ cao vẫn được hiển thị.</p>;
}

function SettingsSection<T>({ title, description, initial, save, children }: {
  title: string; description?: string; initial: T; save: (value: T) => Promise<T>;
  children: (value: T, change: (value: T) => void) => ReactNode;
}) {
  const [value, setValue] = useState(initial); const [baseline, setBaseline] = useState(JSON.stringify(initial));
  const [saving, setSaving] = useState(false); const [success, setSuccess] = useState(false); const [error, setError] = useState(''); const busy = useRef(false);
  const initialKey = JSON.stringify(initial);
  useEffect(() => { setValue(JSON.parse(initialKey)); setBaseline(initialKey); }, [initialKey]);
  const dirty = JSON.stringify(value) !== baseline;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy.current || !dirty) return;
    busy.current = true; setSaving(true); setSuccess(false); setError('');
    try { const saved = await save(value); setValue(saved); setBaseline(JSON.stringify(saved)); setSuccess(true); }
    catch (cause) { setError(friendlyError(cause, 'Không thể lưu cài đặt. Vui lòng thử lại.')); }
    finally { busy.current = false; setSaving(false); }
  }
  return <Card className={styles.section}><form onSubmit={event => void submit(event)} aria-label={title}>
    <h2>{title}</h2>{description && <p className={styles.muted}>{description}</p>}
    <fieldset disabled={saving} className={styles.fields}>{children(value, next => { setValue(next); setSuccess(false); setError(''); })}</fieldset>
    <div className={styles.actions}><Button type="submit" disabled={!dirty} loading={saving}>{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</Button>{success && <p role="status" className={styles.success}><Check className="inline-icon" aria-hidden="true" /> Đã lưu cài đặt</p>}</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </form></Card>;
}

function ExamDefaultFields({ value, change }: { value: ExamDefaults; change: (value: ExamDefaults) => void }) {
  return <><label className={styles.field}>Thời lượng mặc định (phút)<Input required type="number" min={1} max={1440} step={1} value={Number.isFinite(value.exam_duration_minutes) ? value.exam_duration_minutes : ''} onChange={event => change({ ...value, exam_duration_minutes: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
    <label className={styles.check}><input type="checkbox" checked={value.exam_require_camera} onChange={event => change({ ...value, exam_require_camera: event.target.checked })} />Yêu cầu camera mặc định</label>
    <label className={styles.check}><input type="checkbox" checked={value.exam_require_mic} onChange={event => change({ ...value, exam_require_mic: event.target.checked })} />Yêu cầu microphone mặc định</label></>;
}

function TeacherDefaults({ personal, save }: { personal: PersonalSettings; save: (body: PersonalSettingsPatch) => Promise<PersonalSettings> }) {
  const initial = { inherit: Object.values(personal.exam_overrides!).every(value => value === null), ...personal.exam_defaults! };
  return <SettingsSection title="Mặc định khi tạo đề" description="Điền sẵn trong đề mới; bạn có thể chỉnh lại trước khi lưu. Đề đã tạo không bị thay đổi." initial={initial}
    save={async value => {
      const data = await save({ exam_duration_minutes: value.inherit ? null : value.exam_duration_minutes, exam_require_camera: value.inherit ? null : value.exam_require_camera, exam_require_mic: value.inherit ? null : value.exam_require_mic });
      return { inherit: Object.values(data.exam_overrides!).every(item => item === null), ...data.exam_defaults! };
    }}>
    {(value, change) => <><label className={styles.check}><input type="checkbox" checked={value.inherit} onChange={event => change({ ...value, inherit: event.target.checked })} />Dùng mặc định hệ thống</label>
      <fieldset disabled={value.inherit} className={styles.fields}><ExamDefaultFields value={value} change={next => change({ ...value, ...next })} /></fieldset></>}
  </SettingsSection>;
}
