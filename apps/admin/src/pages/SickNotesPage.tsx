import { useState } from 'react';
import type { SickNoteDto } from '@rheinraum/shared';
import { api, qs } from '../api';
import { useLoad } from '../hooks';
import { Badge, Empty, Field, Notice, PageHeader } from '../components';
import { daysAgo, fmtDate, fmtDateTime } from '../format';

/** Nur für Administratoren mit HR-Berechtigung (Backend prüft zusätzlich). */
export function SickNotesPage() {
  const [from, setFrom] = useState(daysAgo(60));
  const { data, error } = useLoad(() => api.get<{ sickNotes: SickNoteDto[] }>(`/api/admin/sick-notes${qs({ from })}`).then((r) => r.sickNotes), [from]);
  return (
    <div>
      <PageHeader title="Krankmeldungen" />
      <Notice tone="info">Vertrauliche Daten: nur für HR-berechtigte Administratoren sichtbar. Es werden keine Diagnosen erfasst.</Notice>
      <div className="filters" style={{ marginTop: 12 }}>
        <Field label="Ab (Ende nach)">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mitarbeiter</th>
              <th>Beginn</th>
              <th>Voraussichtliches Ende</th>
              <th>AU-Bescheinigung</th>
              <th>Gemeldet</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((s) => (
              <tr key={s.id}>
                <td>{s.userName}</td>
                <td>{fmtDate(s.startDate)}</td>
                <td>{fmtDate(s.expectedEndDate)}</td>
                <td>{s.certificateProvided ? <Badge tone="success">liegt vor</Badge> : <Badge tone="warning">fehlt</Badge>}</td>
                <td className="small">{fmtDateTime(s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && (
          <div style={{ padding: 16 }}>
            <Empty>Keine Krankmeldungen im Zeitraum.</Empty>
          </div>
        )}
      </div>
    </div>
  );
}
