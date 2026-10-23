import type { AuthUser } from '../auth/plugin.js';

/**
 * Hilfen für serverseitige Sichtbarkeitsregeln. Jede Funktion hängt ihre Parameter an `params` an
 * und liefert ein SQL-Fragment für die WHERE-Klausel.
 *
 * - Administrator: alles innerhalb der eigenen Firma.
 * - Bauleiter: Baustellen, für die er eingetragen ist, sowie Mitglieder seiner Teams.
 * - Mitarbeiter: nur eigene Daten.
 */
export class Scope {
  constructor(
    private user: AuthUser,
    public params: unknown[] = [],
  ) {}

  p(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  /** Sichtbare Baustellen (Alias der sites-Tabelle). */
  sites(alias: string): string {
    const company = `${alias}.company_id = ${this.p(this.user.companyId)}`;
    if (this.user.role === 'admin') return company;
    if (this.user.role === 'site_manager') {
      return `${company} AND ${alias}.id IN (SELECT site_id FROM site_managers WHERE user_id = ${this.p(this.user.id)})`;
    }
    return `${company} AND ${alias}.id IN (SELECT site_id FROM site_assignments WHERE user_id = ${this.p(this.user.id)})`;
  }

  /** Sichtbare Benutzer (Alias der users-Tabelle). */
  users(alias: string): string {
    const company = `${alias}.company_id = ${this.p(this.user.companyId)}`;
    if (this.user.role === 'admin') return company;
    if (this.user.role === 'site_manager') {
      const me = this.p(this.user.id);
      return `${company} AND (${alias}.id = ${me}
        OR ${alias}.id IN (SELECT tm.user_id FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE t.manager_id = ${me})
        OR ${alias}.id IN (SELECT sa.user_id FROM site_assignments sa JOIN site_managers sm ON sm.site_id = sa.site_id WHERE sm.user_id = ${me}))`;
    }
    return `${company} AND ${alias}.id = ${this.p(this.user.id)}`;
  }

  /**
   * Sichtbare Datensätze mit user_id und site_id (Arbeitssitzungen, Berichte, Korrekturanfragen).
   * Bauleiter: Datensätze auf eigenen Baustellen oder von Mitgliedern eigener Teams.
   */
  records(alias: string): string {
    const company = `${alias}.company_id = ${this.p(this.user.companyId)}`;
    if (this.user.role === 'admin') return company;
    const me = this.p(this.user.id);
    if (this.user.role === 'site_manager') {
      return `${company} AND (${alias}.site_id IN (SELECT site_id FROM site_managers WHERE user_id = ${me})
        OR ${alias}.user_id IN (SELECT tm.user_id FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE t.manager_id = ${me}))`;
    }
    return `${company} AND ${alias}.user_id = ${me}`;
  }
}
