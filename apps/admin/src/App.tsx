import { useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ROLE_LABELS } from '@rheinraum/shared';
import { can, useAuth } from './auth';
import { Button } from './components';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SessionsPage } from './pages/SessionsPage';
import { CorrectionRequestsPage } from './pages/CorrectionRequestsPage';
import { UsersPage } from './pages/UsersPage';
import { SitesPage } from './pages/SitesPage';
import { AssignmentsPage } from './pages/AssignmentsPage';
import { TeamsPage } from './pages/TeamsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SickNotesPage } from './pages/SickNotesPage';
import { ExportPage } from './pages/ExportPage';

export function App() {
  const { user, loading, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  if (loading) return <p style={{ padding: 24 }}>Wird geladen …</p>;
  if (!user) return <LoginPage />;
  const c = can(user);

  const links: [string, string, boolean][] = [
    ['/', '🏠 Übersicht', true],
    ['/arbeitszeiten', '⏱️ Arbeitszeiten', true],
    ['/korrekturanfragen', '✍️ Korrekturanfragen', true],
    ['/berichte', '📝 Berichte & Fotos', true],
    ['/zuweisungen', '📅 Zuweisungen', true],
    ['/mitarbeiter', '👷 Mitarbeiter', true],
    ['/baustellen', '🏗️ Baustellen', true],
    ['/teams', '👥 Teams', true],
    ['/krankmeldungen', '🩺 Krankmeldungen', c.hr],
    ['/export', '⬇️ CSV-Export', true],
  ];

  return (
    <div className="layout">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="row" style={{ gap: 10 }}>
            <span className="brand-mark">🔧</span> Rheinraum
          </span>
          <button className="menu-toggle" aria-label="Menü" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            ☰
          </button>
        </div>
        <nav className="nav" onClick={() => setMenuOpen(false)}>
          {links
            .filter(([, , visible]) => visible)
            .map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/'}>
                {label}
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-footer stack" style={{ gap: 6 }}>
          <div>
            <strong>
              {user.firstName} {user.lastName}
            </strong>
            <div className="small">
              {ROLE_LABELS[user.role]}
              {user.hrAccess ? ' · HR' : ''}
            </div>
            <div className="small">{user.companyName}</div>
          </div>
          <Button variant="secondary" small onClick={logout}>
            Abmelden
          </Button>
        </div>
      </aside>
      <main className="main" key={location.pathname}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/arbeitszeiten" element={<SessionsPage />} />
          <Route path="/korrekturanfragen" element={<CorrectionRequestsPage />} />
          <Route path="/berichte" element={<ReportsPage />} />
          <Route path="/zuweisungen" element={<AssignmentsPage />} />
          <Route path="/mitarbeiter" element={<UsersPage />} />
          <Route path="/baustellen" element={<SitesPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          {c.hr && <Route path="/krankmeldungen" element={<SickNotesPage />} />}
          <Route path="/export" element={<ExportPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
