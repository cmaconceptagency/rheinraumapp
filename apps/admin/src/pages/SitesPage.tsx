import { useState } from 'react';
import { DEFAULT_SITE_RADIUS_M, type UserDto } from '@rheinraum/shared';
import { api } from '../api';
import { can, useAuth } from '../auth';
import { fullName, useLoad, type AdminSite } from '../hooks';
import { Badge, Button, Field, Modal, Notice, PageHeader } from '../components';

export function SitesPage() {
  const { user } = useAuth();
  const c = can(user);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<AdminSite | 'new' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { data, error, reload } = useLoad(
    () => api.get<{ sites: AdminSite[] }>(`/api/admin/sites${showInactive ? '?includeInactive=true' : ''}`).then((r) => r.sites),
    [showInactive],
  );
  const managers = useLoad(
    () => (c.admin ? api.get<{ users: UserDto[] }>('/api/admin/users').then((r) => r.users.filter((u) => u.role !== 'employee')) : Promise.resolve([])),
    [c.admin],
  );

  const toggle = async (s: AdminSite) => {
    if (s.active && !confirm(`Baustelle „${s.name}“ deaktivieren? Einstempeln ist danach nicht mehr möglich.`)) return;
    try {
      await api.patch(`/api/admin/sites/${s.id}`, { active: !s.active });
      reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  return (
    <div>
      <PageHeader title="Baustellen">
        <label className="checkbox">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Deaktivierte anzeigen
        </label>
        {c.admin && <Button onClick={() => setEditing('new')}>+ Baustelle anlegen</Button>}
      </PageHeader>
      {(error || msg) && <Notice tone="danger">{error ?? msg}</Notice>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Adresse</th>
              <th>Ansprechpartner</th>
              <th className="num">Radius</th>
              <th>Bauleitung</th>
              <th>Status</th>
              {c.admin && <th />}
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((s) => (
              <tr key={s.id} className={s.active ? '' : 'inactive'}>
                <td>
                  <strong>{s.name}</strong>
                </td>
                <td className="small">
                  {s.street}, {s.zip} {s.city}
                  <div className="muted">
                    {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
                  </div>
                </td>
                <td className="small">
                  {s.contactName ?? '–'}
                  {s.contactPhone && <div className="muted">{s.contactPhone}</div>}
                </td>
                <td className="num">{s.radiusM} m</td>
                <td className="small">
                  {s.managerIds
                    .map((id) => managers.data?.find((m) => m.id === id))
                    .filter(Boolean)
                    .map((m) => fullName(m!))
                    .join(', ') || '–'}
                </td>
                <td>{s.active ? <Badge tone="success">Aktiv</Badge> : <Badge>Deaktiviert</Badge>}</td>
                {c.admin && (
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <Button small variant="secondary" onClick={() => setEditing(s)}>
                        Bearbeiten
                      </Button>
                      <Button small variant="ghost" onClick={() => toggle(s)}>
                        {s.active ? 'Deaktivieren' : 'Aktivieren'}
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <SiteForm
          site={editing === 'new' ? null : editing}
          managers={managers.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function SiteForm({ site, managers, onClose, onSaved }: { site: AdminSite | null; managers: UserDto[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: site?.name ?? '',
    street: site?.street ?? '',
    zip: site?.zip ?? '',
    city: site?.city ?? '',
    lat: site ? String(site.lat) : '',
    lng: site ? String(site.lng) : '',
    radiusM: String(site?.radiusM ?? DEFAULT_SITE_RADIUS_M),
    contactName: site?.contactName ?? '',
    contactPhone: site?.contactPhone ?? '',
    notes: site?.notes ?? '',
  });
  const [managerIds, setManagerIds] = useState<string[]>(site?.managerIds ?? []);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const num = (v: string) => Number(v.replace(',', '.'));

  const save = async () => {
    setMsg(null);
    const body = {
      ...f,
      lat: num(f.lat),
      lng: num(f.lng),
      radiusM: Math.round(num(f.radiusM)),
      contactName: f.contactName || null,
      contactPhone: f.contactPhone || null,
      notes: f.notes || null,
    };
    try {
      const r = site ? await api.patch<{ site: { id: string } }>(`/api/admin/sites/${site.id}`, body) : await api.post<{ site: { id: string } }>('/api/admin/sites', body);
      await api.put(`/api/admin/sites/${r.site.id}/managers`, { userIds: managerIds });
      onSaved();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  return (
    <Modal title={site ? 'Baustelle bearbeiten' : 'Baustelle anlegen'} onClose={onClose}>
      <div className="form-grid">
        <Field label="Bezeichnung">
          <input value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Straße und Hausnummer">
          <input value={f.street} onChange={set('street')} />
        </Field>
        <Field label="PLZ">
          <input value={f.zip} onChange={set('zip')} />
        </Field>
        <Field label="Ort">
          <input value={f.city} onChange={set('city')} />
        </Field>
        <Field label="Breitengrad" hint="Dezimalgrad, z. B. 50.9265">
          <input value={f.lat} onChange={set('lat')} inputMode="decimal" />
        </Field>
        <Field label="Längengrad" hint="Dezimalgrad, z. B. 6.9637">
          <input value={f.lng} onChange={set('lng')} inputMode="decimal" />
        </Field>
        <Field label="Radius für Einstempeln (m)" hint="Standard 500 m, 50–10.000 m">
          <input value={f.radiusM} onChange={set('radiusM')} inputMode="numeric" />
        </Field>
        <Field label="Ansprechpartner">
          <input value={f.contactName} onChange={set('contactName')} />
        </Field>
        <Field label="Telefon Ansprechpartner">
          <input value={f.contactPhone} onChange={set('contactPhone')} />
        </Field>
      </div>
      <Field label="Hinweise für Mitarbeiter">
        <textarea value={f.notes} onChange={set('notes')} />
      </Field>
      <div>
        <strong>Zuständige Bauleiter</strong>
        <div className="row" style={{ marginTop: 6 }}>
          {managers.length === 0 && <span className="muted small">Keine Bauleiter vorhanden.</span>}
          {managers.map((m) => (
            <label key={m.id} className="checkbox">
              <input
                type="checkbox"
                checked={managerIds.includes(m.id)}
                onChange={(e) => setManagerIds((ids) => (e.target.checked ? [...ids, m.id] : ids.filter((x) => x !== m.id)))}
              />
              {fullName(m)}
            </label>
          ))}
        </div>
      </div>
      {msg && <Notice tone="danger">{msg}</Notice>}
      <div className="row">
        <Button onClick={save} disabled={!f.name || !f.street || !f.zip || !f.city || !f.lat || !f.lng}>
          Speichern
        </Button>
      </div>
    </Modal>
  );
}
