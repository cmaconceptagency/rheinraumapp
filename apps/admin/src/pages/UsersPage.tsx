import { useState } from 'react';
import { ROLE_LABELS, ROLES, type Role, type UserDto } from '@rheinraum/shared';
import { api } from '../api';
import { can, useAuth } from '../auth';
import { fullName, useLoad } from '../hooks';
import { Badge, Button, Field, Modal, Notice, PageHeader } from '../components';
import { fmtDateTime } from '../format';

interface Invite {
  code: string;
  expiresAt: string;
  delivery: 'simulated';
}

export function UsersPage() {
  const { user } = useAuth();
  const c = can(user);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<UserDto | 'new' | null>(null);
  const [invite, setInvite] = useState<{ user: UserDto; invite: Invite } | null>(null);
  const [homeFor, setHomeFor] = useState<UserDto | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { data, error, reload } = useLoad(
    () => api.get<{ users: UserDto[] }>(`/api/admin/users${showInactive ? '?includeInactive=true' : ''}`).then((r) => r.users),
    [showInactive],
  );

  const toggleActive = async (u: UserDto) => {
    if (u.active && !confirm(`${fullName(u)} deaktivieren? Die Person kann sich danach nicht mehr anmelden.`)) return;
    setMsg(null);
    try {
      await api.patch(`/api/admin/users/${u.id}`, { active: !u.active });
      reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const newInvite = async (u: UserDto) => {
    try {
      const r = await api.post<{ invite: Invite }>(`/api/admin/users/${u.id}/invite`);
      setInvite({ user: u, invite: r.invite });
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  return (
    <div>
      <PageHeader title="Mitarbeiter">
        <label className="checkbox">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Deaktivierte anzeigen
        </label>
        {c.admin && <Button onClick={() => setEditing('new')}>+ Mitarbeiter anlegen</Button>}
      </PageHeader>
      {!c.admin && <Notice tone="info">Als Bauleiter sehen Sie nur Mitarbeiter Ihrer Teams und Baustellen.</Notice>}
      {(error || msg) && <Notice tone="danger">{error ?? msg}</Notice>}
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Pers.-Nr.</th>
              <th>E-Mail</th>
              <th>Rolle</th>
              <th>Status</th>
              {c.admin && <th />}
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((u) => (
              <tr key={u.id} className={u.active ? '' : 'inactive'}>
                <td>
                  <strong>{fullName(u)}</strong>
                </td>
                <td>{u.personnelNo ?? '–'}</td>
                <td className="small">{u.email}</td>
                <td>
                  {ROLE_LABELS[u.role]} {u.hrAccess && <Badge tone="info">HR</Badge>}
                </td>
                <td>
                  {!u.active ? <Badge>Deaktiviert</Badge> : u.invitePending ? <Badge tone="warning">Einladung offen</Badge> : <Badge tone="success">Aktiv</Badge>}
                </td>
                {c.admin && (
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <Button small variant="secondary" onClick={() => setEditing(u)}>
                        Bearbeiten
                      </Button>
                      {u.active && u.invitePending && (
                        <Button small variant="ghost" onClick={() => newInvite(u)}>
                          Neuer Code
                        </Button>
                      )}
                      {c.hr && (
                        <Button small variant="ghost" onClick={() => setHomeFor(u)}>
                          Wohnort
                        </Button>
                      )}
                      {u.id !== user?.id && (
                        <Button small variant="ghost" onClick={() => toggleActive(u)}>
                          {u.active ? 'Deaktivieren' : 'Aktivieren'}
                        </Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <UserForm
          user={editing === 'new' ? null : editing}
          canGrantHr={c.hr}
          onClose={() => setEditing(null)}
          onSaved={(u, inv) => {
            setEditing(null);
            if (inv) setInvite({ user: u, invite: inv });
            reload();
          }}
        />
      )}
      {invite && (
        <Modal title="Einladungscode" onClose={() => setInvite(null)}>
          <p>
            Bitte geben Sie diesen Code an <strong>{fullName(invite.user)}</strong> weiter. In der App: „Einladungscode einlösen“ → E-Mail{' '}
            <strong>{invite.user.email}</strong> + Code + eigenes Passwort.
          </p>
          <div>
            <span className="code">{invite.invite.code}</span>
          </div>
          <p className="muted small">Gültig bis {fmtDateTime(invite.invite.expiresAt)}. Der Code wird nur jetzt angezeigt.</p>
          <Notice tone="warning">E-Mail-Versand ist nicht angebunden (simuliert). Bitte den Code persönlich oder per sicherem Kanal übermitteln.</Notice>
        </Modal>
      )}
      {homeFor && <HomeModal user={homeFor} onClose={() => setHomeFor(null)} />}
    </div>
  );
}

function UserForm({ user, canGrantHr, onClose, onSaved }: { user: UserDto | null; canGrantHr: boolean; onClose: () => void; onSaved: (u: UserDto, invite?: Invite) => void }) {
  const [f, setF] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    email: user?.email ?? '',
    personnelNo: user?.personnelNo ?? '',
    phone: user?.phone ?? '',
    role: (user?.role ?? 'employee') as Role,
    hrAccess: user?.hrAccess ?? false,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setMsg(null);
    const body = { ...f, hrAccess: f.role === 'admin' && f.hrAccess, personnelNo: f.personnelNo || null, phone: f.phone || null };
    try {
      if (user) {
        const r = await api.patch<{ user: UserDto }>(`/api/admin/users/${user.id}`, body);
        onSaved(r.user);
      } else {
        const r = await api.post<{ user: UserDto; invite: Invite | null }>('/api/admin/users', body);
        onSaved(r.user, r.invite ?? undefined);
      }
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  return (
    <Modal title={user ? 'Mitarbeiter bearbeiten' : 'Mitarbeiter anlegen'} onClose={onClose}>
      <div className="form-grid">
        <Field label="Vorname">
          <input value={f.firstName} onChange={set('firstName')} />
        </Field>
        <Field label="Nachname">
          <input value={f.lastName} onChange={set('lastName')} />
        </Field>
        <Field label="E-Mail (Anmeldename)">
          <input type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Personalnummer">
          <input value={f.personnelNo} onChange={set('personnelNo')} />
        </Field>
        <Field label="Telefon">
          <input value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Rolle">
          <select value={f.role} onChange={set('role')}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {f.role === 'admin' && (
        <label className="checkbox">
          <input type="checkbox" checked={f.hrAccess} disabled={!canGrantHr} onChange={(e) => setF({ ...f, hrAccess: e.target.checked })} />
          HR-Berechtigung (Krankmeldungen und Wohnadressen einsehen)
        </label>
      )}
      {!user && <Notice tone="info">Nach dem Anlegen wird ein Einladungscode erzeugt, mit dem die Person ihr Passwort selbst festlegt.</Notice>}
      {msg && <Notice tone="danger">{msg}</Notice>}
      <div className="row">
        <Button onClick={save} disabled={!f.firstName || !f.lastName || !f.email}>
          Speichern
        </Button>
      </div>
    </Modal>
  );
}

interface Home {
  street: string;
  zip: string;
  city: string;
  lat: number;
  lng: number;
}

function HomeModal({ user, onClose }: { user: UserDto; onClose: () => void }) {
  const { data, error } = useLoad(() => api.get<{ home: Home | null }>(`/api/admin/users/${user.id}/home`).then((r) => r.home), [user.id]);
  const [f, setF] = useState<Record<keyof Home, string> | null>(null);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const form = f ?? (data ? { street: data.street, zip: data.zip, city: data.city, lat: String(data.lat), lng: String(data.lng) } : { street: '', zip: '', city: '', lat: '', lng: '' });
  const set = (k: keyof Home) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...form, [k]: e.target.value });
  const save = async () => {
    try {
      await api.put(`/api/admin/users/${user.id}/home`, { ...form, lat: Number(form.lat.replace(',', '.')), lng: Number(form.lng.replace(',', '.')) });
      setMsg({ tone: 'success', text: 'Gespeichert.' });
    } catch (err) {
      setMsg({ tone: 'danger', text: (err as Error).message });
    }
  };
  return (
    <Modal title={`Wohnort von ${fullName(user)}`} onClose={onClose}>
      <Notice tone="info">Nur für HR-berechtigte Administratoren sichtbar. Wird für die Entfernungsberechnung (einfache Strecke) verwendet.</Notice>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="form-grid">
        <Field label="Straße und Hausnummer">
          <input value={form.street} onChange={set('street')} />
        </Field>
        <Field label="PLZ">
          <input value={form.zip} onChange={set('zip')} />
        </Field>
        <Field label="Ort">
          <input value={form.city} onChange={set('city')} />
        </Field>
        <Field label="Breitengrad" hint="z. B. 50.9375">
          <input value={form.lat} onChange={set('lat')} inputMode="decimal" />
        </Field>
        <Field label="Längengrad" hint="z. B. 6.9603">
          <input value={form.lng} onChange={set('lng')} inputMode="decimal" />
        </Field>
      </div>
      <p className="muted small">Koordinaten z. B. über openstreetmap.org ermitteln (Rechtsklick → „Adresse anzeigen“). Eine automatische Geokodierung ist nicht angebunden.</p>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="row">
        <Button onClick={save} disabled={!form.street || !form.zip || !form.city || !form.lat || !form.lng}>
          Speichern
        </Button>
      </div>
    </Modal>
  );
}
