import { useEffect, type ReactNode } from 'react';
import { VERIFICATION_LABELS, type Verification } from '@rheinraum/shared';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export const Badge = ({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) => (
  <span className={`badge badge-${tone}`}>{children}</span>
);

export const Notice = ({ tone, children }: { tone: Exclude<Tone, 'neutral'>; children: ReactNode }) => (
  <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
    {children}
  </div>
);

export function VerificationBadge({ v, reviewed }: { v: Verification; reviewed?: boolean }) {
  const tone: Tone = v === 'verified' ? 'success' : v === 'unverified' ? 'warning' : 'info';
  return (
    <span className="row" style={{ gap: 4 }}>
      <Badge tone={tone}>{VERIFICATION_LABELS[v]}</Badge>
      {reviewed && <Badge tone="neutral">geprüft</Badge>}
    </span>
  );
}

export function Button({
  children,
  variant = 'primary',
  small,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost'; small?: boolean }) {
  return (
    <button type="button" className={`btn ${variant !== 'primary' ? `btn-${variant}` : ''} ${small ? 'btn-sm' : ''}`} {...props}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Schließen">
            ✕
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      <div className="row">{children}</div>
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="muted">{children}</p>;
