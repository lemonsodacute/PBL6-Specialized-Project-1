'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth/AuthContext';
import { Badge, Button, Card, LoadingSkeleton } from '@/components/ui';
import { ProfileAvatar } from '@/components/profile/ProfileAvatar';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/uiErrors';
import type { UserProfile } from '@/lib/profile';
import styles from './profile.module.css';

function AccountStatus({ active }: { active: boolean }) {
  return <Badge className={styles.status} tone={active ? 'success' : 'neutral'}>
    <span className={styles.statusDot} aria-hidden="true" />
    {active ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}
  </Badge>;
}

function createdDate(value?: string) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('vi-VN') : null;
}

const profileNote = 'Bạn có thể cập nhật thông tin cá nhân. Vai trò và trạng thái tài khoản do quản trị viên quản lý.';

export default function TeacherProfilePage() {
  const { user, login, refreshProfile } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false), [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState(''), [phone, setPhone] = useState('');
  const [avatar, setAvatar] = useState<File | null>(null), [preview, setPreview] = useState('');
  const [fileError, setFileError] = useState(''), [fieldError, setFieldError] = useState<{ name?: string; phone?: string }>({});
  const [saveError, setSaveError] = useState(''), [notice, setNotice] = useState(''), [checkingImage, setCheckingImage] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null), phoneInput = useRef<HTMLInputElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null), savingRef = useRef(false), fileGeneration = useRef(0);
  const restoreFocus = useRef(false);
  const owner = useRef(user?.id); owner.current = user?.id;
  useEffect(() => {
    if (user?.role !== 'teacher') return;
    let active = true;
    setProfile(null); setError('');
    api.auth.me().then(({ user: account }) => {
      if (active && account.role === 'teacher' && account.id === user.id) setProfile(account);
      else if (active) setError('Không tải được hồ sơ giảng viên.');
    }).catch(() => { if (active) setError('Không tải được hồ sơ giảng viên. Vui lòng thử lại.'); });
    return () => { active = false; fileGeneration.current++; };
  }, [user?.id, user?.role, reload]);
  useEffect(() => {
    if (!avatar) { setPreview(''); return; }
    const url = URL.createObjectURL(avatar); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatar]);
  useEffect(() => {
    if (editing) nameInput.current?.focus();
    else if (restoreFocus.current) { editButton.current?.focus(); restoreFocus.current = false; }
  }, [editing]);

  function beginEdit() {
    if (!profile) return;
    setFullName(profile.full_name); setPhone(profile.phone ?? ''); setAvatar(null);
    setFileError(''); setFieldError({}); setSaveError(''); setNotice(''); setEditing(true);
  }
  function closeEdit() {
    restoreFocus.current = true;
    fileGeneration.current++; setCheckingImage(false); setEditing(false); setAvatar(null);
  }
  async function chooseAvatar(file?: File) {
    if (!file) return;
    const generation = ++fileGeneration.current;
    setFileError(''); setSaveError(''); setAvatar(null);
    if (!['image/jpeg', 'image/png'].includes(file.type)) { setFileError('Chỉ chấp nhận ảnh JPG hoặc PNG.'); return; }
    if (!file.size || file.size > 5 * 1024 * 1024) { setFileError('Ảnh đại diện phải có dung lượng tối đa 5 MB.'); return; }
    setCheckingImage(true);
    try {
      const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const valid = image.width * image.height <= 16_000_000; image.close();
      if (generation !== fileGeneration.current) return;
      if (!valid) { setFileError('Ảnh phải có tối đa 16 triệu điểm ảnh.'); return; }
      setAvatar(file);
    } catch { if (generation === fileGeneration.current) setFileError('Không đọc được ảnh. Hãy chọn ảnh JPG hoặc PNG hợp lệ.'); }
    finally { if (generation === fileGeneration.current) setCheckingImage(false); }
  }
  const dirty = !!profile && (fullName.trim() !== profile.full_name || (phone.trim() || null) !== (profile.phone || null) || !!avatar);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !user || savingRef.current || checkingImage || !dirty) return;
    const values = { full_name: fullName.trim(), phone: phone.trim() || null };
    const errors: { name?: string; phone?: string } = {};
    if (values.full_name.length < 2 || values.full_name.length > 255) errors.name = 'Họ và tên cần từ 2 đến 255 ký tự, không được để trống.';
    if (values.phone && !/^\+?[0-9]{8,15}$/.test(values.phone)) errors.phone = 'Số điện thoại cần 8–15 chữ số, có thể bắt đầu bằng +.';
    setFieldError(errors); setSaveError('');
    if (errors.name || errors.phone) { (errors.name ? nameInput : phoneInput).current?.focus(); return; }
    savingRef.current = true; setSaving(true);
    const ownerId = profile.id;
    try {
      const result = avatar ? await api.auth.updateAvatar(avatar, values) : await api.auth.updateProfile(values);
      if (owner.current !== ownerId) return;
      if (result.user.id !== ownerId || result.user.role !== 'teacher') throw new Error('Invalid profile response');
      setProfile(result.user);
      // Apply the confirmed response immediately; refresh the shared account too.
      login({ ...user, ...result.user });
      closeEdit(); setNotice('Cập nhật hồ sơ thành công.');
      try { await refreshProfile(); } catch { /* The confirmed save remains successful. */ }
    } catch (cause) {
      if (owner.current === ownerId) setSaveError(friendlyError(cause, 'Không thể cập nhật hồ sơ. Vui lòng thử lại.'));
    } finally { savingRef.current = false; setSaving(false); }
  }
  const date = createdDate(profile?.created_at);
  return <div className={styles.page}>
    {user?.role !== 'teacher' ? <Card><p>Trang hồ sơ này dành cho giảng viên.</p></Card>
      : error ? <Card role="alert"><p>{error}</p><Button variant="warning" onClick={() => setReload(value => value + 1)}>Thử lại</Button></Card>
      : !profile ? <Card aria-busy="true"><LoadingSkeleton rows={3} /></Card>
      : <>
        <Card className={styles.summary}>
          <section className={styles.summaryContent} aria-label="Tổng quan hồ sơ giảng viên">
            <ProfileAvatar user={profile} className={`${styles.avatar} ${styles.initials}`} />
            <div className={styles.summaryIdentity}>
              <h2>{profile.full_name}</h2>
              <p className={styles.summaryEmail}>{profile.email}</p>
              <AccountStatus active={profile.is_active} />
            </div>
          </section>
          {!editing && <button ref={editButton} type="button" className={`ui-button ui-button-outline ${styles.editButton}`} onClick={beginEdit}>Chỉnh sửa hồ sơ</button>}
        </Card>
        {notice && <p className={styles.success} role="status">{notice}</p>}
        {editing ? <Card className={styles.sectionCard}>
          <form onSubmit={save} noValidate aria-labelledby="edit-profile-heading" aria-busy={saving}>
            <h2 id="edit-profile-heading">Chỉnh sửa hồ sơ</h2>
            <p className={styles.formNote}>{profileNote}</p>
            <div className={styles.formGrid}>
              <label className={styles.field} htmlFor="teacher-full-name">Họ và tên
                <input ref={nameInput} id="teacher-full-name" aria-label="Họ và tên" className="ui-field" autoComplete="name" maxLength={255} required disabled={saving} value={fullName}
                  aria-invalid={!!fieldError.name} aria-describedby={fieldError.name ? 'teacher-name-error' : undefined}
                  onChange={event => { setFullName(event.target.value); setFieldError(current => ({ ...current, name: undefined })); setSaveError(''); }} />
                {fieldError.name && <span id="teacher-name-error" className={styles.fieldError} role="alert">{fieldError.name}</span>}
              </label>
              <label className={styles.field} htmlFor="teacher-phone"><span>Số điện thoại <span className={styles.optional}>(không bắt buộc)</span></span>
                <input ref={phoneInput} id="teacher-phone" aria-label="Số điện thoại" className="ui-field" type="tel" autoComplete="tel" maxLength={20} disabled={saving} value={phone}
                  aria-invalid={!!fieldError.phone} aria-describedby={`teacher-phone-hint${fieldError.phone ? ' teacher-phone-error' : ''}`}
                  onChange={event => { setPhone(event.target.value); setFieldError(current => ({ ...current, phone: undefined })); setSaveError(''); }} />
                <span id="teacher-phone-hint" className={styles.hint}>8–15 chữ số, có thể bắt đầu bằng +. Để trống để xóa.</span>
                {fieldError.phone && <span id="teacher-phone-error" className={styles.fieldError} role="alert">{fieldError.phone}</span>}
              </label>
            </div>
            <div className={styles.avatarEditor}>
              {preview ? <img src={preview} alt="Xem trước ảnh đại diện" className={styles.avatar} /> : <ProfileAvatar user={profile} className={`${styles.avatar} ${styles.initials}`} decorative />}
              <div className={styles.avatarControls}>
                <strong>Ảnh đại diện</strong>
                <p id="teacher-avatar-hint" className={styles.hint}>JPG hoặc PNG, tối đa 5 MB. Ảnh sẽ được căn giữa thành hình vuông.</p>
                <input ref={fileInput} className={styles.fileInput} type="file" accept="image/jpeg,image/png" aria-label="Ảnh đại diện" aria-describedby="teacher-avatar-hint" disabled={saving || checkingImage}
                  onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void chooseAvatar(file); }} />
                <div className={styles.photoActions}><Button type="button" variant="outline" disabled={saving || checkingImage} onClick={() => fileInput.current?.click()}>{checkingImage ? 'Đang kiểm tra ảnh...' : 'Thay ảnh'}</Button>
                  {(avatar || fileError) && <Button type="button" variant="ghost" disabled={saving} onClick={() => { fileGeneration.current++; setAvatar(null); setFileError(''); setCheckingImage(false); }}>Bỏ ảnh đã chọn</Button>}</div>
                {fileError && <p className={styles.fieldError} role="alert">{fileError}</p>}
              </div>
            </div>
            <dl className={`${styles.details} ${styles.readOnlyDetails}`}>
              <div><dt>Email <span className={styles.optional}>(chỉ đọc)</span></dt><dd>{profile.email}</dd></div>
              <div><dt>Vai trò <span className={styles.optional}>(chỉ đọc)</span></dt><dd>Giảng viên</dd></div>
            </dl>
            {saveError && <p className={styles.fieldError} role="alert">{saveError}</p>}
            <div className={styles.formActions}><Button type="button" variant="outline" disabled={saving} onClick={closeEdit}>Hủy</Button><Button type="submit" disabled={!dirty || saving || checkingImage || !!fileError} loading={saving}>{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</Button></div>
          </form>
        </Card> : <>
          <div className={styles.sections}>
            <Card className={styles.sectionCard}><section aria-labelledby="teacher-information-heading">
              <h2 id="teacher-information-heading">Thông tin giảng viên</h2>
              <dl className={styles.details}><div><dt>Họ và tên</dt><dd>{profile.full_name}</dd></div><div><dt>Vai trò</dt><dd>Giảng viên</dd></div></dl>
              <p className={styles.lockedNote}>{profileNote}</p>
            </section></Card>
            <Card className={styles.sectionCard}><section aria-labelledby="teacher-contact-heading">
              <h2 id="teacher-contact-heading">Thông tin liên hệ</h2>
              <dl className={styles.details}><div><dt>Email</dt><dd>{profile.email}</dd></div><div><dt>Số điện thoại</dt><dd>{profile.phone || 'Chưa cập nhật'}</dd></div></dl>
            </section></Card>
          </div>
          <Card className={`${styles.sectionCard} ${styles.account}`}><section aria-labelledby="teacher-account-heading">
            <h2 id="teacher-account-heading">Thông tin tài khoản</h2>
            <dl className={`${styles.details} ${styles.accountDetails}`}><div><dt>Trạng thái tài khoản</dt><dd><AccountStatus active={profile.is_active} /></dd></div>{date && <div><dt>Ngày tạo tài khoản</dt><dd>{date}</dd></div>}</dl>
          </section></Card>
        </>}
      </>}
  </div>;
}
