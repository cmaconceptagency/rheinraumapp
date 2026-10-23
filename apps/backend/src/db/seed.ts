/**
 * Beispieldaten für Entwicklung und Demo. Alle Personen, Adressen und Firmen sind frei erfunden.
 *
 *   npm run db:seed            – nur in eine leere Datenbank
 *   npm run db:seed -- --reset – Datenbank vollständig leeren, neu migrieren und befüllen
 */
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from './migrate.js';
import { hashPassword } from '../auth/crypto.js';

export const DEMO_PASSWORD = 'Baustelle2026!';

export const DEMO = {
  admin: 'admin@musterbau.example',
  office: 'buero@musterbau.example',
  manager: 'bauleiter@musterbau.example',
  max: 'max@musterbau.example',
  erika: 'erika@musterbau.example',
  invited: 'neu@musterbau.example',
};

/** Fester Einladungscode nur für die Demo (gilt 30 Tage ab Seed). */
export const DEMO_INVITE_CODE = 'DEMO-2026-CODE';

export async function seed(connectionString: string, opts: { reset?: boolean; log?: (m: string) => void } = {}) {
  const log = opts.log ?? console.log;
  if (opts.reset) {
    const c = new pg.Client({ connectionString });
    await c.connect();
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await c.end();
    log('Datenbank geleert.');
  }
  await migrate(connectionString, log);

  const db = new pg.Client({ connectionString });
  await db.connect();
  try {
    const existing = await db.query('SELECT count(*)::int AS n FROM companies');
    if (existing.rows[0].n > 0) {
      log('Es sind bereits Daten vorhanden. Zum Neuaufsetzen: npm run db:seed -- --reset');
      return;
    }
    await db.query('BEGIN');
    const pw = await hashPassword(DEMO_PASSWORD);
    const company = (
      await db.query(`INSERT INTO companies (name, licensed_seats) VALUES ('Musterbau GmbH (Demo)', 25) RETURNING id`)
    ).rows[0].id;

    const user = async (email: string, first: string, last: string, role: string, extra: { hr?: boolean; no?: string; invite?: boolean } = {}) =>
      (
        await db.query(
          `INSERT INTO users (company_id, email, password_hash, first_name, last_name, role, hr_access, personnel_no, phone)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '0221 000000') RETURNING id`,
          [company, email, extra.invite ? null : pw, first, last, role, extra.hr ?? false, extra.no ?? null],
        )
      ).rows[0].id as string;

    const admin = await user(DEMO.admin, 'Anna', 'Admin', 'admin', { hr: true, no: '1001' });
    await user(DEMO.office, 'Olaf', 'Office', 'admin', { no: '1002' }); // Admin ohne HR-Berechtigung
    const manager = await user(DEMO.manager, 'Bernd', 'Bauleiter', 'site_manager', { no: '2001' });
    const max = await user(DEMO.max, 'Max', 'Mustermann', 'employee', { no: '3001' });
    const erika = await user(DEMO.erika, 'Erika', 'Musterfrau', 'employee', { no: '3002' });
    const invited = await user(DEMO.invited, 'Nina', 'Neu', 'employee', { no: '3003', invite: true });

    await db.query(
      `INSERT INTO invites (user_id, token_hash, expires_at) VALUES ($1, encode(sha256($2::bytea), 'hex'), now() + interval '30 days')`,
      [invited, DEMO_INVITE_CODE],
    );

    // Fiktive Wohnorte (Koordinaten grob im Kölner/Bonner Raum).
    await db.query(
      `INSERT INTO employee_home (user_id, street, zip, city, lat, lng) VALUES
         ($1, 'Musterweg 1', '50765', 'Köln', 51.0120, 6.8950),
         ($2, 'Beispielstraße 7', '53113', 'Bonn', 50.7300, 7.0950)`,
      [max, erika],
    );

    const site = async (name: string, street: string, zip: string, city: string, lat: number, lng: number, contact: string, radius = 500) =>
      (
        await db.query(
          `INSERT INTO sites (company_id, name, street, zip, city, lat, lng, radius_m, contact_name, contact_phone, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '0221 111111', 'Beispielbaustelle') RETURNING id`,
          [company, name, street, zip, city, lat, lng, radius, contact],
        )
      ).rows[0].id as string;

    const hafen = await site('Neubau Rheinauhafen', 'Hafenkante 12', '50678', 'Köln', 50.9265, 6.9637, 'Frau Polier (Bauherrin)');
    const deutz = await site('Altbausanierung Deutz', 'Beispielufer 3', '50679', 'Köln', 50.9375, 6.9750, 'Herr Hausverwalter');
    const bonn = await site('Dachsanierung Bonn', 'Musterallee 44', '53111', 'Bonn', 50.7374, 7.0982, 'Familie Beispiel', 300);

    await db.query('INSERT INTO site_managers (site_id, user_id) VALUES ($1, $2), ($3, $2)', [hafen, manager, deutz]);
    const team = (await db.query(`INSERT INTO teams (company_id, name, manager_id) VALUES ($1, 'Team Köln', $2) RETURNING id`, [company, manager]))
      .rows[0].id;
    await db.query('INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)', [team, max]);

    const today = `(now() AT TIME ZONE 'Europe/Berlin')::date`;
    await db.query(
      `INSERT INTO site_assignments (site_id, user_id, valid_from, valid_to, created_by) VALUES
         ($1, $3, ${today} - 30, ${today} + 60, $5),
         ($2, $3, ${today} - 30, NULL, $5),
         ($4, $6, ${today} - 30, ${today} + 30, $5),
         ($1, $7, ${today}, ${today} + 30, $5)`,
      [hafen, deutz, max, bonn, admin, erika, invited],
    );

    // Vergangene Arbeitstage für Max (serverbestätigt) mit Pausen.
    for (let d = 1; d <= 7; d++) {
      const dow = (await db.query(`SELECT extract(isodow FROM ${today} - $1::int) AS d`, [d])).rows[0].d;
      if (Number(dow) > 5) continue;
      const base = `((${today} - ${d})::timestamp AT TIME ZONE 'Europe/Berlin')`;
      const s = await db.query(
        `INSERT INTO work_sessions (company_id, user_id, site_id, client_id, started_at, ended_at, verification, source,
            start_lat, start_lng, start_accuracy_m, start_check)
         VALUES ($1, $2, $3, gen_random_uuid(), ${base} + interval '7 hours', ${base} + interval '16 hours 15 minutes',
            'verified', 'online', 50.9266, 6.9640, 12, $4) RETURNING id`,
        [company, max, d % 2 ? hafen : deutz, { ok: true, code: 'OK', distanceM: 35, accuracyM: 12, ageS: 3, radiusM: 500, seeded: true }],
      );
      await db.query(
        `INSERT INTO work_breaks (session_id, client_id, started_at, ended_at) VALUES
           ($1, gen_random_uuid(), ${base} + interval '9 hours', ${base} + interval '9 hours 15 minutes'),
           ($1, gen_random_uuid(), ${base} + interval '12 hours', ${base} + interval '12 hours 30 minutes')`,
        [s.rows[0].id],
      );
    }

    // Eine offline erfasste, ungeprüfte Sitzung für Erika.
    await db.query(
      `INSERT INTO work_sessions (company_id, user_id, site_id, client_id, started_at, ended_at, device_started_at, verification, source, start_check)
       VALUES ($1, $2, $3, gen_random_uuid(),
         ((${today} - 1)::timestamp AT TIME ZONE 'Europe/Berlin') + interval '6 hours 45 minutes',
         ((${today} - 1)::timestamp AT TIME ZONE 'Europe/Berlin') + interval '15 hours',
         ((${today} - 1)::timestamp AT TIME ZONE 'Europe/Berlin') + interval '6 hours 45 minutes',
         'unverified', 'offline', $4)`,
      [company, erika, bonn, { ok: true, code: 'OK', distanceM: 80, accuracyM: 20, ageS: 5, radiusM: 300, offline: true }],
    );

    await db.query(
      `INSERT INTO correction_requests (company_id, user_id, site_id, client_id, requested_start, requested_end, reason)
       VALUES ($1, $2, $3, gen_random_uuid(),
         ((${today} - 2)::timestamp AT TIME ZONE 'Europe/Berlin') + interval '6 hours 30 minutes',
         ((${today} - 2)::timestamp AT TIME ZONE 'Europe/Berlin') + interval '14 hours 30 minutes',
         'Kein GPS-Empfang in der Tiefgarage, Einstempeln war nicht möglich.')`,
      [company, erika, bonn],
    );

    await db.query(
      `INSERT INTO reports (company_id, user_id, site_id, client_id, report_date, work_done, remarks)
       VALUES ($1, $2, $3, gen_random_uuid(), ${today} - 1, 'Schalung Decke 2. OG gestellt, Bewehrung vorbereitet.', 'Material für Donnerstag nachbestellen.')`,
      [company, max, hafen],
    );
    await db.query(
      `INSERT INTO sick_notes (company_id, user_id, client_id, start_date, expected_end_date, certificate_provided)
       VALUES ($1, $2, gen_random_uuid(), ${today} + 3, ${today} + 5, false)`,
      [company, erika],
    );

    await db.query('COMMIT');
    log('Beispieldaten angelegt.');
    log(`  Anmeldung (Passwort für alle: ${DEMO_PASSWORD}):`);
    log(`    Admin mit HR-Recht:  ${DEMO.admin}`);
    log(`    Admin ohne HR-Recht: ${DEMO.office}`);
    log(`    Bauleiter:           ${DEMO.manager}`);
    log(`    Mitarbeiter:         ${DEMO.max}, ${DEMO.erika}`);
    log(`  Einladung: ${DEMO.invited} mit Code ${DEMO_INVITE_CODE}`);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.env.NODE_ENV === 'production') {
    console.error('Beispieldaten werden in Produktion nicht angelegt.');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL fehlt (siehe apps/backend/.env.example)');
    process.exit(1);
  }
  seed(url, { reset: process.argv.includes('--reset') }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
