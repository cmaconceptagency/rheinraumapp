import { useEffect, useState } from 'react';
import type { PhotoDto, ReportDto } from '@rheinraum/shared';
import { api, qs } from '../api';
import { fullName, useLoad, useLookups } from '../hooks';
import { Empty, Field, Modal, Notice, PageHeader } from '../components';
import { daysAgo, fmtDate, today } from '../format';

export function ReportsPage() {
  const { users, sites } = useLookups();
  const [filter, setFilter] = useState({ from: daysAgo(14), to: today(), userId: '', siteId: '' });
  const [zoom, setZoom] = useState<string | null>(null);
  const { data, error } = useLoad(() => api.get<{ reports: ReportDto[] }>(`/api/admin/reports${qs(filter)}`).then((r) => r.reports), [JSON.stringify(filter)]);
  const set = (k: keyof typeof filter) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilter((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <PageHeader title="Tätigkeitsberichte & Fotos" />
      <div className="filters">
        <Field label="Von">
          <input type="date" value={filter.from} onChange={set('from')} />
        </Field>
        <Field label="Bis">
          <input type="date" value={filter.to} onChange={set('to')} />
        </Field>
        <Field label="Mitarbeiter">
          <select value={filter.userId} onChange={set('userId')}>
            <option value="">Alle</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {fullName(u)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Baustelle">
          <select value={filter.siteId} onChange={set('siteId')}>
            <option value="">Alle</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="stack">
        {(data ?? []).map((r) => (
          <div className="card stack" key={r.id} style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>
                {fmtDate(r.reportDate)} · {r.siteName}
              </strong>
              <span className="muted small">{r.userName}</span>
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{r.workDone}</div>
            {r.remarks && (
              <div className="small" style={{ whiteSpace: 'pre-wrap' }}>
                <strong>Bemerkungen:</strong> {r.remarks}
              </div>
            )}
            {r.photos.length > 0 && (
              <div className="photos">
                {r.photos.map((p) => (
                  <ProtectedImage key={p.id} photo={p} onOpen={setZoom} />
                ))}
              </div>
            )}
          </div>
        ))}
        {data?.length === 0 && <Empty>Keine Berichte für diese Filter.</Empty>}
      </div>
      {zoom && (
        <Modal title="Foto" onClose={() => setZoom(null)}>
          <img src={zoom} alt="Foto zum Bericht" style={{ maxWidth: '100%', borderRadius: 12 }} />
        </Modal>
      )}
    </div>
  );
}

/** Fotos sind privat: Abruf mit Anmeldung als Blob, Anzeige über eine lokale Objekt-URL. */
function ProtectedImage({ photo, onOpen }: { photo: PhotoDto; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let alive = true;
    api
      .blob(photo.url)
      .then((b) => {
        objectUrl = URL.createObjectURL(b);
        if (alive) setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.url]);
  if (!url) return <div style={{ width: 120, height: 120, background: '#e9edf2', borderRadius: 10 }} />;
  return <img src={url} alt="Foto zum Bericht" onClick={() => onOpen(url)} />;
}
