import { useState } from 'react';
import { api } from '../api';
import { Button, Field, Notice, PageHeader } from '../components';

export function ExportPage() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const blob = await api.blob(`/api/admin/export/time.csv?month=${month}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `arbeitszeiten-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader title="Monatlicher CSV-Export" />
      <div className="card stack">
        <p>
          Exportiert alle für Sie sichtbaren Arbeitszeiten eines Monats (eine Zeile je Arbeitssitzung) mit Beginn, Ende, Pausen,
          Nettozeit und Prüfstatus. Format: Semikolon-getrennt, Dezimalkomma, UTF-8 – direkt in Excel/DATEV-Vorbereitung nutzbar.
        </p>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Monat">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <Button onClick={download} disabled={busy || !month}>
            {busy ? 'Wird erstellt …' : 'CSV herunterladen'}
          </Button>
        </div>
        {msg && <Notice tone="danger">{msg}</Notice>}
        <p className="muted small">Hinweis: Ungeprüfte (offline erfasste) Zeiten sind in der Spalte „Status“ gekennzeichnet.</p>
      </div>
    </div>
  );
}
