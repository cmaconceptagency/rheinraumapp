import { useState } from 'react';
import { api } from '../api';
import { can, useAuth } from '../auth';
import { fullName, useLoad, useLookups } from '../hooks';
import { Button, Empty, Field, Modal, Notice, PageHeader } from '../components';

interface Team {
  id: string;
  name: string;
  managerId: string | null;
  managerName: string | null;
  memberIds: string[];
}

export function TeamsPage() {
  const { user } = useAuth();
  const c = can(user);
  const { users } = useLookups();
  const [editing, setEditing] = useState<Team | 'new' | null>(null);
  const { data, error, reload } = useLoad(() => api.get<{ teams: Team[] }>('/api/admin/teams').then((r) => r.teams), []);
  const name = (id: string) => {
    const u = users.find((x) => x.id === id);
    return u ? fullName(u) : '…';
  };

  return (
    <div>
      <PageHeader title="Teams">{c.admin && <Button onClick={() => setEditing('new')}>+ Team anlegen</Button>}</PageHeader>
      <Notice tone="info">Bauleiter sehen Arbeitszeiten und Berichte der Mitglieder ihrer Teams sowie aller Personen auf ihren Baustellen.</Notice>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid grid-4" style={{ marginTop: 12 }}>
        {(data ?? []).map((t) => (
          <div className="card stack" key={t.id} style={{ gap: 6 }}>
            <h2 style={{ margin: 0 }}>{t.name}</h2>
            <div className="small muted">Bauleitung: {t.managerName ?? '–'}</div>
            <div className="small">{t.memberIds.length ? t.memberIds.map(name).join(', ') : 'Keine Mitglieder'}</div>
            {c.admin && (
              <div>
                <Button small variant="secondary" onClick={() => setEditing(t)}>
                  Bearbeiten
                </Button>
              </div>
            )}
          </div>
        ))}
        {data?.length === 0 && <Empty>Noch keine Teams.</Empty>}
      </div>
      {editing && (
        <TeamForm
          team={editing === 'new' ? null : editing}
          users={users.filter((u) => u.active)}
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

function TeamForm({
  team,
  users,
  onClose,
  onSaved,
}: {
  team: Team | null;
  users: { id: string; firstName: string; lastName: string; role: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nameV, setName] = useState(team?.name ?? '');
  const [managerId, setManagerId] = useState(team?.managerId ?? '');
  const [members, setMembers] = useState<string[]>(team?.memberIds ?? []);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    const body = { name: nameV, managerId: managerId || null, memberIds: members };
    try {
      if (team) await api.put(`/api/admin/teams/${team.id}`, body);
      else await api.post('/api/admin/teams', body);
      onSaved();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  return (
    <Modal title={team ? 'Team bearbeiten' : 'Team anlegen'} onClose={onClose}>
      <div className="form-grid">
        <Field label="Name">
          <input value={nameV} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Bauleitung">
          <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">–</option>
            {users
              .filter((u) => u.role !== 'employee')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {fullName(u)}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <div>
        <strong>Mitglieder</strong>
        <div className="row" style={{ marginTop: 6 }}>
          {users
            .filter((u) => u.role === 'employee')
            .map((u) => (
              <label key={u.id} className="checkbox">
                <input type="checkbox" checked={members.includes(u.id)} onChange={(e) => setMembers((m) => (e.target.checked ? [...m, u.id] : m.filter((x) => x !== u.id)))} />
                {fullName(u)}
              </label>
            ))}
        </div>
      </div>
      {msg && <Notice tone="danger">{msg}</Notice>}
      <div className="row">
        <Button onClick={save} disabled={!nameV.trim()}>
          Speichern
        </Button>
      </div>
    </Modal>
  );
}
