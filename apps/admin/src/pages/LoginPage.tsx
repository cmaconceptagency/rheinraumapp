import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import { Field, Notice } from '../components';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login-card stack" onSubmit={submit}>
        <div className="row" style={{ gap: 10 }}>
          <span className="brand-mark" style={{ color: '#fff' }}>
            🔧
          </span>
          <div>
            <h1 style={{ fontSize: '1.4rem' }}>Rheinraum Verwaltung</h1>
            <div className="muted small">Für Bauleiter und Administratoren</div>
          </div>
        </div>
        <Field label="E-Mail">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </Field>
        <Field label="Passwort">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Anmelden …' : 'Anmelden'}
        </button>
      </form>
    </div>
  );
}
