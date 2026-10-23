import { useState } from 'react';
import type { AssignmentDto } from '@rheinraum/shared';
import { api, qs } from '../api';
import { fullName, useLoad, useLookups } from '../hooks';
import { Badge, Button, Empty, Field, Notice, PageHeader } from '../components';
import { fmtDate, today } from '../format';

export function AssignmentsPage() {
  const { users, sites } = useLookups();
  const [filter, setFilter] = useState({ siteId: '', userId: '', activeOn: '' });
  const [form, setForm] = useState({ userId: '', siteId: '', validFrom: today(), validTo: '' });
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const { data, error, reload } = useLoad(
    () => api.get<{ assignments: AssignmentDto[] }>(`/api/admin/assignments${qs(filter)}`).then((r) => r.assignments),
    [JSON.stringify(filter)],
  );

  const create = async () => {
    setMsg(null);
    try {
      await api.post('/api/admin/assignments', { ...form, validTo: form.validTo || null });
      setMsg({ tone: 'success', text: 'Zuweisung gespeichert.' });
      reload();
    } catch (err) {
      setMsg({ tone: 'danger', text: (err as Error).message });
    }
  };

  const endToday = async (a: AssignmentDto) => {
    try {
      await api.patch(`/api/admin/assignments/${a.id}`, { validTo: today() < a.validFrom ? a.validFrom : today() });
      reload();
    } catch (err) {
      setMsg({ tone: 'danger', text: (err as Error).message });
    }
  };

  const remove = async (a: AssignmentDto) => {
    if (!confirm('Zuweisung löschen?')) return;
    try {
      await api.del(`/api/admin/assignments/${a.id}`);
      reload();
    } catch (err) {
      setMsg({ tone: 'danger', text: (err as Error).message });
    }
  };

  const activeUsers = users.filter((u) => u.active);
  const activeSites = sites.filter((s) => s.active);
  const t = today();

  return (
    <div className="stack">
      <PageHeader title="Baustellenzuweisungen" />
      <div className="card stack">
        <h2>Neue Zuweisung</h2>
        <div className="form-grid">
          <Field label="Mitarbeiter">
            <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
              <option value="">Bitte wählen</option>
              {activeUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {fullName(u)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Baustelle">
            <select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
              <option value="">Bitte wählen</option>
              {activeSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Von">
            <input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
          </Field>
          <Field label="Bis" hint="Leer = unbefristet">
            <input type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
          </Field>
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div>
          <Button onClick={create} disabled={!form.userId || !form.siteId || !form.validFrom}>
            Zuweisen
          </Button>
        </div>
      </div>

      <div className="filters" style={{ marginBottom: 0 }}>
        <Field label="Baustelle">
          <select value={filter.siteId} onChange={(e) => setFilter({ ...filter, siteId: e.target.value })}>
            <option value="">Alle</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mitarbeiter">
          <select value={filter.userId} onChange={(e) => setFilter({ ...filter, userId: e.target.value })}>
            <option value="">Alle</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {fullName(u)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Gültig am">
          <input type="date" value={filter.activeOn} onChange={(e) => setFilter({ ...filter, activeOn: e.target.value })} />
        </Field>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mitarbeiter</th>
              <th>Baustelle</th>
              <th>Zeitraum</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((a) => {
              const state = a.validFrom > t ? 'future' : a.validTo && a.validTo < t ? 'past' : 'active';
              return (
                <tr key={a.id} className={state === 'past' ? 'inactive' : ''}>
                  <td>{a.userName}</td>
                  <td>{a.siteName}</td>
                  <td>
                    {fmtDate(a.validFrom)} – {a.validTo ? fmtDate(a.validTo) : 'unbefristet'}
                  </td>
                  <td>
                    {state === 'active' ? <Badge tone="success">Aktiv</Badge> : state === 'future' ? <Badge tone="info">Geplant</Badge> : <Badge>Beendet</Badge>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {state !== 'past' && (
                        <Button small variant="secondary" onClick={() => endToday(a)}>
                          Heute beenden
                        </Button>
                      )}
                      <Button small variant="ghost" onClick={() => remove(a)}>
                        Löschen
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data?.length === 0 && (
          <div style={{ padding: 16 }}>
            <Empty>Keine Zuweisungen.</Empty>
          </div>
        )}
      </div>
    </div>
  );
}
