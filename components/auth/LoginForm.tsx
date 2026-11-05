'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Input, PasswordInput, PasswordStrength, HelperText, ErrorMessage, borderProps } from '@/components/ui';
import { useAuth } from '@/components/auth/AuthContext';
import type { User } from '@/types';
import { api, ApiError } from '@/lib/api';
import { friendlyError } from '@/lib/uiErrors';
import { PUBLIC_HOME_HREF } from '@/lib/public-home-navigation';
import { PublicBrand } from '@/components/public/PublicBrand';
import { publicTypography } from '@/components/public/typography';
import homeStyles from '@/components/public/PublicHome.module.css';
import styles from './LoginForm.module.css';
import canvasStyles from '@/components/ui/DottedCanvas.module.css';

type Mode = 'login' | 'register' | 'forgot' | 'reset';
type FieldName = 'fullName' | 'email' | 'password' | 'confirmPassword' | 'token';
const titles: Record<Mode, string> = { login: 'Đăng nhập', register: 'Đăng ký', forgot: 'Quên mật khẩu', reset: 'Đặt lại mật khẩu' };
const subtitles: Record<Mode, string> = {
  login: 'Đăng nhập để tiếp tục vào hệ thống.',
  register: 'Tạo tài khoản để bắt đầu sử dụng ProctoOwl.',
  forgot: 'Nhập email của tài khoản cần khôi phục.',
  reset: 'Nhập mã đặt lại và chọn mật khẩu mới cho tài khoản.',
};

export default function LoginForm({ initialMode }: { initialMode?: string }) {
  const router = useRouter(); const { login } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode === 'register' ? 'register' : 'login');
  const [values, setValues] = useState<Record<FieldName, string>>({ fullName: '', email: '', password: '', confirmPassword: '', token: '' });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false); const submitting = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const [focusTarget, setFocusTarget] = useState<FieldName | 'form' | null>(null);
  useEffect(() => {
    if (!focusTarget || pending) return;
    form.current?.querySelector<HTMLElement>(focusTarget === 'form' ? '[data-form-error]' : `#auth-${focusTarget}`)?.focus();
    setFocusTarget(null);
  }, [focusTarget, pending]);
  const newPassword = mode === 'register' || mode === 'reset';
  const update = (field: FieldName, value: string) => {
    setValues(current => ({ ...current, [field]: value }));
    setErrors(current => ({ ...current, [field]: undefined }));
    setError('');
  };
  const changeMode = (next: Mode) => {
    if (submitting.current) return;
    setMode(next); setError(''); setNotice(''); setErrors({});
    setValues(current => ({ ...current, password: '', confirmPassword: '', token: '' }));
    setFocusTarget(next === 'register' ? 'fullName' : next === 'reset' ? 'token' : 'email');
  };
  const signIn = (user: User, accessToken?: string) => {
    login(user, accessToken);
    router.push(user.role === 'student' ? '/student' : user.role === 'admin' ? '/admin' : '/dashboard');
  };
  const validate = () => {
    const next: Partial<Record<FieldName, string>> = {};
    if (mode === 'register' && (Array.from(values.fullName.trim()).length < 2 || Array.from(values.fullName.trim()).length > 255)) next.fullName = 'Họ và tên cần từ 2 đến 255 ký tự.';
    if (mode !== 'reset' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) next.email = 'Vui lòng nhập địa chỉ email hợp lệ.';
    if (mode !== 'forgot') {
      const length = Array.from(values.password).length;
      if (length < 8) next.password = 'Mật khẩu phải có ít nhất 8 ký tự.';
      else if (length > 128) next.password = 'Mật khẩu không được vượt quá 128 ký tự.';
    }
    if (newPassword && values.confirmPassword !== values.password) next.confirmPassword = 'Mật khẩu xác nhận chưa khớp.';
    else if (newPassword && !values.confirmPassword) next.confirmPassword = 'Vui lòng xác nhận mật khẩu.';
    if (mode === 'reset' && (values.token.trim().length < 20 || values.token.trim().length > 256)) next.token = 'Vui lòng nhập đầy đủ mã đặt lại đã được cấp.';
    return next;
  };
  const focusError = (field?: FieldName) => setFocusTarget(field ?? 'form');
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    setError(''); setNotice('');
    const nextErrors = validate(); setErrors(nextErrors);
    const first = Object.keys(nextErrors)[0] as FieldName | undefined;
    if (first) { focusError(first); return; }
    submitting.current = true; setPending(true);
    try {
      if (mode === 'register') {
        const result = await api.auth.register(values.fullName.trim(), values.email.trim(), values.password);
        signIn(result.user as User, result.access_token);
      } else if (mode === 'forgot') {
        const result = await api.auth.forgotPassword(values.email.trim());
        if (result.reset_token) {
          setValues(current => ({ ...current, token: result.reset_token!, password: '', confirmPassword: '' }));
          setMode('reset'); setNotice('Mã đặt lại đã được cấp. Hãy chọn mật khẩu mới.');
          setFocusTarget('password');
        } else setNotice('Yêu cầu khôi phục đã được ghi nhận. Nếu chưa nhận được hướng dẫn, vui lòng liên hệ quản trị viên.');
      } else if (mode === 'reset') {
        await api.auth.resetPassword(values.token.trim(), values.password);
        setValues(current => ({ ...current, password: '', confirmPassword: '', token: '' }));
        setMode('login'); setNotice('Đặt lại mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.');
        setFocusTarget(values.email ? 'password' : 'email');
      } else {
        const result = await api.auth.login(values.email.trim(), values.password);
        signIn(result.user as User, result.access_token);
      }
    } catch (cause) {
      if (mode === 'register' && cause instanceof ApiError && (cause.code === 'EMAIL_EXISTS' || cause.status === 409)) {
        setErrors({ email: 'Email này đã được sử dụng.' }); focusError('email');
      } else {
        setError(mode === 'login' && cause instanceof ApiError && cause.status === 401 ? 'Email hoặc mật khẩu không chính xác.'
          : mode === 'login' && cause instanceof ApiError && cause.status === 403 ? 'Tài khoản hiện không thể đăng nhập.' : friendlyError(cause));
        focusError();
      }
    } finally { submitting.current = false; setPending(false); }
  };
  const fieldProps = (field: FieldName) => ({
    id: `auth-${field}`, name: field, value: values[field], disabled: pending,
    'aria-invalid': !!errors[field], 'aria-describedby': [errors[field] ? `auth-${field}-error` : '', field === 'password' && newPassword ? 'password-help' : ''].filter(Boolean).join(' ') || undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => update(field, event.target.value),
  });
  const fieldError = (field: FieldName) => errors[field] && <ErrorMessage id={`auth-${field}-error`}>{errors[field]}</ErrorMessage>;

  return <main className={`${styles.page} ${homeStyles.theme} ${canvasStyles.canvas} ${publicTypography}`}>
    <div className={`${styles.content} ${mode === 'register' ? styles.register : ''}`}>
    <Link href={PUBLIC_HOME_HREF} className={styles.backLink}><ArrowLeft size={18} aria-hidden="true" />Quay lại trang chủ</Link>
    <div className={styles.brand}><PublicBrand /></div>
    <Card borderRole="users" className={`login-card ${mode === 'register' ? 'register-card' : ''}`}>
      <div className="login-heading"><p className="eyebrow">Hệ thống thi trực tuyến</p><h1>{titles[mode]}</h1><p>{subtitles[mode]}</p></div>
      <form ref={form} onSubmit={handleSubmit} className="login-form" noValidate aria-busy={pending}>
        {mode === 'register' && <div className="auth-field"><label htmlFor="auth-fullName">Họ và tên</label><Input {...fieldProps('fullName')} required autoComplete="name" />{fieldError('fullName')}</div>}
        {mode === 'reset' && <div className="auth-field"><label htmlFor="auth-token">Mã đặt lại</label><Input {...fieldProps('token')} required autoComplete="one-time-code" />{fieldError('token')}</div>}
        {mode !== 'reset' && <div className="auth-field"><label htmlFor="auth-email">Email</label><Input {...fieldProps('email')} required type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="ban@example.com" />{fieldError('email')}</div>}
        {mode === 'register' && <fieldset className="auth-role"><legend>Vai trò</legend><label><input type="radio" name="role" value="student" checked readOnly disabled={pending} />Sinh viên</label><HelperText>Tài khoản giảng viên do quản trị viên cấp.</HelperText></fieldset>}
        {mode !== 'forgot' && <div className="auth-field"><label htmlFor="auth-password">{mode === 'reset' ? 'Mật khẩu mới' : 'Mật khẩu'}</label><PasswordInput key={`${mode}-password`} {...fieldProps('password')} required autoComplete={newPassword ? 'new-password' : 'current-password'} />
          {newPassword && <HelperText id="password-help">Từ 8 đến 128 ký tự. Nên dùng mật khẩu dài và riêng cho tài khoản này.</HelperText>}{fieldError('password')}
          {newPassword && <PasswordStrength value={values.password} />}
        </div>}
        {newPassword && <div className="auth-field"><label htmlFor="auth-confirmPassword">Xác nhận mật khẩu</label><PasswordInput {...fieldProps('confirmPassword')} required autoComplete="new-password" toggleLabel="mật khẩu xác nhận" />{fieldError('confirmPassword')}</div>}
        {error && <p role="alert" tabIndex={-1} data-form-error className="auth-message error" {...borderProps('danger')}>{error}</p>}
        {notice && <p role="status" className="auth-message success" {...borderProps('success')}>{notice}</p>}
        <Button type="submit" size="lg" loading={pending} className={`login-submit ${homeStyles.button} ${homeStyles.primaryButton}`}>{pending ? mode === 'register' ? 'Đang đăng ký…' : mode === 'login' ? 'Đang đăng nhập…' : 'Đang xử lý…' : mode === 'forgot' ? 'Yêu cầu đặt lại mật khẩu' : titles[mode]}</Button>
      </form>
      <div className="login-links">
        {mode === 'login' ? <><button type="button" disabled={pending} onClick={() => changeMode('forgot')}>Quên mật khẩu?</button><button type="button" disabled={pending} onClick={() => changeMode('register')}>Tạo tài khoản</button></>
          : <button type="button" disabled={pending} onClick={() => changeMode('login')}>Quay lại đăng nhập</button>}
        {mode === 'forgot' && <button type="button" disabled={pending} onClick={() => changeMode('reset')}>Tôi đã có mã đặt lại</button>}
      </div>
    </Card>
    </div>
  </main>;
}
