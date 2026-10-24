'use client';
import { Eye, EyeOff } from 'lucide-react';

import { useState, type InputHTMLAttributes } from 'react';
import { Input } from './Field';

export function PasswordInput({ toggleLabel = 'mật khẩu', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { toggleLabel?: string }) {
  const [visible, setVisible] = useState(false);
  return <div className="password-field">
    <Input {...props} type={visible ? 'text' : 'password'} />
    <button type="button" className="password-toggle" disabled={props.disabled} aria-label={`${visible ? 'Ẩn' : 'Hiện'} ${toggleLabel}`}
      aria-pressed={visible} aria-controls={props.id} onClick={() => setVisible(value => !value)}>
      {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
    </button>
  </div>;
}

/** A suggestion only. The server's 8–128 character policy is the validation rule. */
export function PasswordStrength({ value }: { value: string }) {
  const length = Array.from(value).length;
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(rule => rule.test(value)).length;
  const score = !length ? 0 : length < 8 ? 1 : length >= 12 && variety >= 3 ? 3 : 2;
  const label = ['Chưa nhập mật khẩu', 'Ngắn', 'Trung bình', 'Tốt'][score];
  return <div className="password-strength" data-strength={score}>
    <div role="meter" aria-label="Độ mạnh mật khẩu (gợi ý)" aria-valuemin={0} aria-valuemax={3} aria-valuenow={score} aria-valuetext={label}>
      {[1, 2, 3].map(step => <span key={step} className={step <= score ? 'filled' : ''} />)}
    </div>
    <span>Độ mạnh: {label.toLowerCase()}. Chỉ mang tính gợi ý.</span>
  </div>;
}
