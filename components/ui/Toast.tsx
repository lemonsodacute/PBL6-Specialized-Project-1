import type { ReactNode } from 'react';
type Severity = 'low' | 'medium' | 'high' | 'critical';
export function Alert({ severity, children }: { severity: Severity; children: ReactNode }) { return <div className={`ui-alert severity-${severity}`} role="alert"><span className="alert-dot" />{children}</div>; }
export function Toast({ severity, children }: { severity: Severity; children: ReactNode }) { const labels = { low: 'Thấp', medium: 'Trung bình', high: 'Cao', critical: 'Nghiêm trọng' }; return <div className={`ui-toast severity-${severity}`} role="status"><strong>{labels[severity]}</strong><span>{children}</span></div>; }
