import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';
export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input className={`ui-field ${className}`} {...props} />; }
export function Select({ children, className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) { return <select className={`ui-field ${className}`} {...props}>{children}</select>; }
export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={`ui-field ui-textarea ${className}`} {...props} />; }
export function Checkbox({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) { return <input type="checkbox" className={`ui-checkbox ${className}`} {...props} />; }
export function HelperText({ id, children }: { id?: string; children: ReactNode }) { return <p id={id} className="field-helper">{children}</p>; }
export function ErrorMessage({ id, children }: { id?: string; children: ReactNode }) { return <p id={id} className="field-error">{children}</p>; }
