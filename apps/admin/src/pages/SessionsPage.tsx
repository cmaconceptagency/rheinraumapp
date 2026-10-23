import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDuration, type CorrectionDto, type Verification, type WorkSessionDto } from '@rheinraum/shared';
import { api, qs } from '../api';
import { fullName, useLoad, useLookups } from '../hooks';
import { Badge, Button, Empty, Field, Modal, Notice, PageHeader, VerificationBadge } from '../components';
import { daysAgo, fmtDate, fmtDateTime, fmtTime, fromLocalInput, toLocalInput, today } from '../format';

export function SessionsPage() {
  const [params] = useSearchParams();
  const { users, sites } = useLookups();
  const [filter, setFilter] = useState({
    from: daysAgo(14),
    to: today(),
    userId: '',
    siteId: '',
    verification: params.get('verification') ?? '',
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ sessions: WorkSessionDto[] }>(`/api/admin/sessions${qs(filter)}`).then((r) => r.sessions),
    [JSON.stringify(filter)],
  );
  const set = (k: keyof typeof filter) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilter((f) => ({ ...f, [k]: e.target.value }));
  const total = (data ?? []).reduce((a, s) => a + s.totals.netMs, 0);

  return (
    <div>
      <PageHeader title="Arbeitszeiten">
        <Button variant="secondary" onClick={() => setCreating(true)}>
          + Zeit manuell erfassen
        </Button>
      </PageHeader>
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
        <Field label="Status">
          <select value={filter.verification} onChange={set('verification')}>
            <option value="">Alle</option>
            <option value="verified">Serverbestätigt</option>
            <option value="unverified">Ungeprüft (offline)</option>
            <option value="corrected">Korrigiert</option>
            <option value="manual">Manuell erfasst</option>
          </select>
        </Field>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Datum</th>
              <th>Mitarbeiter</th>
              <th>Baustelle</th>
              <th>Beginn</th>
              <th>Ende</th>
              <th className="num">Pause</th>
              <th className="num">Netto</th>
              <th>Status</th>
              <th>Standort</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((s) => (
              <tr key={s.id} className="clickable" onClick={() => setSelected(s.id)}>
                <td>{fmtDate(s.startedAt)}</td>
                <td>{s.userName}</td>
                <td>{s.siteName}</td>
                <td>{fmtTime(s.startedAt)}</td>
                <td>{s.endedAt ? fmtTime(s.endedAt) : <Badge tone="success">läuft</Badge>}</td>
                <td className="num">{formatDuration(s.totals.breakMs)}</td>
                <td className="num">
                  {formatDuration(s.totals.netMs)} {s.breakHint && <span title={s.breakHint}>⚠️</span>}
                </td>
                <td>
                  <VerificationBadge v={s.verification} reviewed={!!s.reviewedAt} />
                </td>
                <td className="small">{s.startLocation?.distanceM != null ? `${Math.round(s.startLocation.distanceM)} m` : '–'}</td>
              </tr>
            ))}
          </tbody>
          {data && data.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={6}>
                  <strong>Summe ({data.length} Einträge)</strong>
                </td>
                <td className="num">
                  <strong>{formatDuration(total)}</strong>
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
        {!loading && data?.length === 0 && (
          <div style={{ padding: 16 }}>
            <Empty>Keine Arbeitszeiten für diese Filter.</Empty>
          </div>
        )}
      </div>
      {selected && <SessionDetail id={selected} onClose={() => setSelected(null)} onChanged={reload} sites={sites} />}
      {creating && (
        <ManualSessionModal
          users={users.filter((u) => u.active)}
          sites={sites.filter((s) => s.active)}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function SessionDetail({ id, onClose, onChanged, sites }: { id: string; onClose: () => void; onChanged: () => void; sites: { id: string; name: string }[] }) {
  const { data, error, setData } = useLoad(() => api.get<{ session: WorkSessionDto; corrections: CorrectionDto[] }>(`/api/admin/sessions/${id}`), [id]);
  const [mode, setMode] = useState<'view' | 'edit' | 'review'>('view');
  const [form, setForm] = useState<{ startedAt: string; endedAt: string; siteId: string; breaks: { startedAt: string; endedAt: string }[]; reason: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) return <Modal title="Arbeitszeit" onClose={onClose}><Notice tone="danger">{error}</Notice></Modal>;
  if (!data) return null;
  const s = data.session;

  const startEdit = () => {
    setForm({
      startedAt: toLocalInput(s.startedAt),
      endedAt: s.endedAt ? toLocalInput(s.endedAt) : '',
      siteId: s.siteId,
      breaks: s.breaks.map((b) => ({ startedAt: toLocalInput(b.startedAt), endedAt: b.endedAt ? toLocalInput(b.endedAt) : '' })),
      reason: '',
    });
    setMode('edit');
    setMsg(null);
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setMsg(null);
    try {
      // Nur geänderte Felder senden: Eingabefelder haben Minutengenauigkeit, unveränderte Werte
      // sollen ihre Sekunden behalten und nicht als Änderung in der Historie erscheinen.
      const initialBreaks = s.breaks.map((b) => ({ startedAt: toLocalInput(b.startedAt), endedAt: b.endedAt ? toLocalInput(b.endedAt) : '' }));
      const breaksChanged = JSON.stringify(form.breaks) !== JSON.stringify(initialBreaks);
      const body = {
        reason: form.reason,
        ...(form.startedAt !== toLocalInput(s.startedAt) ? { startedAt: fromLocalInput(form.startedAt) } : {}),
        ...(form.endedAt && form.endedAt !== (s.endedAt ? toLocalInput(s.endedAt) : '') ? { endedAt: fromLocalInput(form.endedAt) } : {}),
        ...(form.siteId !== s.siteId ? { siteId: form.siteId } : {}),
        ...(breaksChanged
          ? { breaks: form.breaks.filter((b) => b.startedAt && b.endedAt).map((b) => ({ startedAt: fromLocalInput(b.startedAt), endedAt: fromLocalInput(b.endedAt) })) }
          : {}),
      };
      const res = await api.post<{ session: WorkSessionDto; corrections: CorrectionDto[] }>(`/api/admin/sessions/${id}/corrections`, body);
      setData(res);
      setMode('view');
      onChanged();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const review = async (reason: string) => {
    setBusy(true);
    try {
      const res = await api.post<{ session: WorkSessionDto; corrections: CorrectionDto[] }>(`/api/admin/sessions/${id}/review`, { reason });
      setData(res);
      setMode('view');
      onChanged();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loc = s.startLocation as (WorkSessionDto['startLocation'] & { offline?: boolean; clockSkewS?: number | null }) | null;

  return (
    <Modal title={`${s.userName} · ${fmtDate(s.startedAt)}`} onClose={onClose}>
      <div className="row">
        <VerificationBadge v={s.verification as Verification} reviewed={!!s.reviewedAt} />
        <Badge tone="neutral">Quelle: {s.source === 'online' ? 'App (online)' : s.source === 'offline' ? 'App (offline nachgetragen)' : 'Verwaltung'}</Badge>
      </div>
      {s.verification === 'unverified' && (
        <Notice tone="warning">
          Diese Buchung wurde offline erfasst. Die Zeiten stammen von der Geräteuhr und wurden nicht zum Buchungszeitpunkt vom Server geprüft.
          {s.reviewedAt && ` Geprüft von ${s.reviewedByName} am ${fmtDateTime(s.reviewedAt)}.`}
        </Notice>
      )}
      {mode !== 'edit' && (
        <div className="form-grid">
          <div>
            <div className="muted small">Baustelle</div>
            <strong>{s.siteName}</strong>
          </div>
          <div>
            <div className="muted small">Zeit</div>
            <strong>
              {fmtTime(s.startedAt)} – {s.endedAt ? fmtTime(s.endedAt) : 'läuft'}
            </strong>
          </div>
          <div>
            <div className="muted small">Netto / Pause</div>
            <strong>
              {formatDuration(s.totals.netMs)} / {formatDuration(s.totals.breakMs)} Std.
            </strong>
          </div>
          <div>
            <div className="muted small">Standortprüfung beim Einstempeln</div>
            {loc ? (
              <span className="small">
                {loc.ok ? '✅ bestanden' : `❌ ${loc.code}`}
                {loc.distanceM != null && ` · ${Math.round(loc.distanceM)} m von ${loc.radiusM} m`}
                {loc.accuracyM != null && ` · ±${Math.round(loc.accuracyM)} m`}
                {loc.offline && ' · nur protokolliert (offline)'}
              </span>
            ) : (
              <span className="small muted">keine (manuell erfasst)</span>
            )}
          </div>
          {s.endDistanceM != null && (
            <div>
              <div className="muted small">Abstand beim Ausstempeln</div>
              <span className="small">{Math.round(s.endDistanceM)} m</span>
            </div>
          )}
        </div>
      )}
      {mode === 'view' && s.breaks.length > 0 && (
        <div className="small">
          <strong>Pausen:</strong> {s.breaks.map((b) => `${fmtTime(b.startedAt)}–${b.endedAt ? fmtTime(b.endedAt) : 'läuft'}`).join(', ')}
        </div>
      )}
      {s.breakHint && <Notice tone="warning">{s.breakHint}</Notice>}

      {mode === 'edit' && form && (
        <div className="stack">
          <div className="form-grid">
            <Field label="Beginn">
              <input type="datetime-local" value={form.startedAt} onChange={(e) => setForm({ ...form, startedAt: e.target.value })} />
            </Field>
            <Field label="Ende" hint={s.endedAt ? undefined : 'Leer lassen, solange die Sitzung läuft'}>
              <input type="datetime-local" value={form.endedAt} onChange={(e) => setForm({ ...form, endedAt: e.target.value })} />
            </Field>
            <Field label="Baustelle">
              <select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
                {sites.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <strong>Pausen</strong>
            {form.breaks.map((b, i) => (
              <div className="row" key={i}>
                <input type="datetime-local" value={b.startedAt} aria-label="Pausenbeginn" onChange={(e) => setForm({ ...form, breaks: form.breaks.map((x, j) => (j === i ? { ...x, startedAt: e.target.value } : x)) })} />
                <span>bis</span>
                <input type="datetime-local" value={b.endedAt} aria-label="Pausenende" onChange={(e) => setForm({ ...form, breaks: form.breaks.map((x, j) => (j === i ? { ...x, endedAt: e.target.value } : x)) })} />
                <Button variant="ghost" small onClick={() => setForm({ ...form, breaks: form.breaks.filter((_, j) => j !== i) })}>
                  Entfernen
                </Button>
              </div>
            ))}
            <div>
              <Button variant="secondary" small onClick={() => setForm({ ...form, breaks: [...form.breaks, { startedAt: form.startedAt, endedAt: form.startedAt }] })}>
                + Pause
              </Button>
            </div>
          </div>
          <Field label="Begründung (Pflicht, wird unveränderbar protokolliert)">
            <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
          {msg && <Notice tone="danger">{msg}</Notice>}
          <div className="row">
            <Button onClick={save} disabled={busy || form.reason.trim().length < 5}>
              Korrektur speichern
            </Button>
            <Button variant="ghost" onClick={() => setMode('view')}>
              Abbrechen
            </Button>
          </div>
        </div>
      )}

      {mode === 'review' && <ReviewForm busy={busy} onCancel={() => setMode('view')} onSubmit={review} />}

      {mode === 'view' && (
        <div className="row">
          <Button onClick={startEdit}>Zeit korrigieren</Button>
          {s.verification === 'unverified' && !s.reviewedAt && (
            <Button variant="secondary" onClick={() => setMode('review')}>
              Als geprüft markieren
            </Button>
          )}
        </div>
      )}
      {msg && mode === 'view' && <Notice tone="danger">{msg}</Notice>}

      <div>
        <h2>Änderungshistorie</h2>
        {data.corrections.length === 0 ? (
          <Empty>Keine Änderungen.</Empty>
        ) : (
          <div className="history">
            {data.corrections.map((c) => (
              <div key={c.id}>
                <div>
                  <strong>{fmtDateTime(c.createdAt)}</strong> · {c.changedByName}
                </div>
                <div className="small">Begründung: {c.reason}</div>
                <ChangeSummary before={c.before as Snapshot | null} after={c.after as Snapshot} />
              </div>
            ))}
          </div>
        )}
        <p className="muted small">Die Historie ist unveränderbar (Datenbank erlaubt nur Einfügen).</p>
      </div>
    </Modal>
  );
}

interface Snapshot {
  startedAt: string | null;
  endedAt: string | null;
  breaks?: { startedAt: string; endedAt: string | null }[];
  reviewed?: boolean;
}

function ChangeSummary({ before, after }: { before: Snapshot | null; after: Snapshot }) {
  const t = (v: string | null | undefined) => (v ? fmtDateTime(v) : '–');
  const lines: string[] = [];
  if (!before) lines.push(`Angelegt: ${t(after.startedAt)} – ${t(after.endedAt)}`);
  else {
    if (before.startedAt !== after.startedAt) lines.push(`Beginn: ${t(before.startedAt)} → ${t(after.startedAt)}`);
    if (before.endedAt !== after.endedAt) lines.push(`Ende: ${t(before.endedAt)} → ${t(after.endedAt)}`);
    if (JSON.stringify(before.breaks) !== JSON.stringify(after.breaks)) lines.push(`Pausen: ${before.breaks?.length ?? 0} → ${after.breaks?.length ?? 0} Einträge geändert`);
    if (after.reviewed) lines.push('Als geprüft markiert');
  }
  return (
    <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

function ReviewForm({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="stack">
      <Field label="Prüfvermerk (z. B. abgeglichen mit Bautagebuch)">
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="row">
        <Button onClick={() => onSubmit(reason)} disabled={busy || reason.trim().length < 5}>
          Prüfung speichern
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

function ManualSessionModal({
  users,
  sites,
  onClose,
  onSaved,
}: {
  users: { id: string; firstName: string; lastName: string }[];
  sites: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({ userId: users[0]?.id ?? '', siteId: sites[0]?.id ?? '', startedAt: `${today()}T07:00`, endedAt: `${today()}T16:00`, reason: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.post('/api/admin/sessions', {
        userId: f.userId,
        siteId: f.siteId,
        startedAt: fromLocalInput(f.startedAt),
        endedAt: f.endedAt ? fromLocalInput(f.endedAt) : null,
        reason: f.reason,
      });
      onSaved();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  return (
    <Modal title="Zeit manuell erfassen" onClose={onClose}>
      <div className="form-grid">
        <Field label="Mitarbeiter">
          <select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {fullName(u)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Baustelle">
          <select value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Beginn">
          <input type="datetime-local" value={f.startedAt} onChange={(e) => setF({ ...f, startedAt: e.target.value })} />
        </Field>
        <Field label="Ende">
          <input type="datetime-local" value={f.endedAt} onChange={(e) => setF({ ...f, endedAt: e.target.value })} />
        </Field>
      </div>
      <Field label="Begründung (Pflicht)">
        <textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
      {msg && <Notice tone="danger">{msg}</Notice>}
      <div className="row">
        <Button onClick={save} disabled={!f.userId || !f.siteId || f.reason.trim().length < 5}>
          Speichern
        </Button>
      </div>
    </Modal>
  );
}
