import { Link } from 'react-router-dom';
import { computeSessionTotals, formatDuration, type WorkSessionDto } from '@rheinraum/shared';
import { api } from '../api';
import { useLoad } from '../hooks';
import { Badge, Empty, Notice, PageHeader, VerificationBadge } from '../components';
import { fmtTime } from '../format';

interface Overview {
  openSessions: WorkSessionDto[];
  pendingCorrectionRequests: number;
  unverifiedSessions: number;
  company: { name: string; licensedSeats: number; usedSeats: number };
  serverTime: string;
}

export function DashboardPage() {
  const { data, error } = useLoad(() => api.get<Overview>('/api/admin/overview'), []);
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return <p>Wird geladen …</p>;
  const now = new Date();
  return (
    <div className="stack">
      <PageHeader title="Übersicht">
        <span className="muted small">{data.company.name}</span>
      </PageHeader>
      <div className="grid grid-4">
        <div className="card">
          <div className="stat-value">{data.openSessions.length}</div>
          <div className="stat-label">Aktuell eingestempelt</div>
        </div>
        <Link to="/korrekturanfragen" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="stat-value">{data.pendingCorrectionRequests}</div>
          <div className="stat-label">Offene Korrekturanfragen</div>
        </Link>
        <Link to="/arbeitszeiten?verification=unverified" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="stat-value">{data.unverifiedSessions}</div>
          <div className="stat-label">Ungeprüfte Offline-Buchungen</div>
        </Link>
        <div className="card">
          <div className="stat-value">
            {data.company.usedSeats}/{data.company.licensedSeats}
          </div>
          <div className="stat-label">Aktive Konten / Lizenzen</div>
        </div>
      </div>
      <div className="card">
        <h2>Jetzt auf der Baustelle</h2>
        {data.openSessions.length === 0 ? (
          <Empty>Derzeit ist niemand eingestempelt.</Empty>
        ) : (
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Mitarbeiter</th>
                  <th>Baustelle</th>
                  <th>Seit</th>
                  <th className="num">Netto</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.openSessions.map((s) => {
                  const t = computeSessionTotals(s, s.breaks, now);
                  const onBreak = s.breaks.some((b) => !b.endedAt);
                  return (
                    <tr key={s.id}>
                      <td>{s.userName}</td>
                      <td>{s.siteName}</td>
                      <td>{fmtTime(s.startedAt)}</td>
                      <td className="num">{formatDuration(t.netMs)}</td>
                      <td className="row" style={{ gap: 4 }}>
                        {onBreak ? <Badge tone="warning">Pause</Badge> : <Badge tone="success">Arbeitet</Badge>}
                        <VerificationBadge v={s.verification} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted small">
        Hinweis: Standortdaten beim Einstempeln sind ein Plausibilitätsnachweis, aber kein absolut manipulationssicherer
        Anwesenheitsnachweis. Offline erfasste Zeiten beruhen auf der Geräteuhr und sind als „ungeprüft“ gekennzeichnet.
      </p>
    </div>
  );
}
