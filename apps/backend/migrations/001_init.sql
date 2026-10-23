-- Grundschema: Mandanten (Firmen/Lizenzen), Benutzer, Baustellen, Zeiterfassung, Berichte, Fotos,
-- Krankmeldungen, Korrekturen mit unveränderbarer Historie.

CREATE TABLE companies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  timezone        text NOT NULL DEFAULT 'Europe/Berlin',
  -- Anzahl lizenzierter aktiver Mitarbeiterkonten (Grundlage für Abrechnung pro Mitarbeiter).
  licensed_seats  integer NOT NULL DEFAULT 10 CHECK (licensed_seats >= 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE user_role AS ENUM ('employee', 'site_manager', 'admin');

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  email          text NOT NULL,
  password_hash  text,
  first_name     text NOT NULL,
  last_name      text NOT NULL,
  role           user_role NOT NULL DEFAULT 'employee',
  -- Ausdrückliche Berechtigung für Krankmeldungen und Wohnadressen (nur für Administratoren vergebbar).
  hr_access      boolean NOT NULL DEFAULT false,
  personnel_no   text,
  phone          text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_access_only_admin CHECK (NOT hr_access OR role = 'admin')
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE INDEX users_company_idx ON users (company_id);

-- Wohnadresse getrennt gespeichert, damit sie nur gezielt (eigene Person oder HR-Berechtigung) gelesen wird.
CREATE TABLE employee_home (
  user_id     uuid PRIMARY KEY REFERENCES users(id),
  street      text NOT NULL,
  zip         text NOT NULL,
  city        text NOT NULL,
  lat         double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE sites (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  name           text NOT NULL,
  street         text NOT NULL,
  zip            text NOT NULL,
  city           text NOT NULL,
  lat            double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng            double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius_m       integer NOT NULL DEFAULT 500 CHECK (radius_m BETWEEN 50 AND 10000),
  contact_name   text,
  contact_phone  text,
  notes          text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sites_company_idx ON sites (company_id);

-- Bauleiter, die für eine Baustelle zuständig sind.
CREATE TABLE site_managers (
  site_id  uuid NOT NULL REFERENCES sites(id),
  user_id  uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (site_id, user_id)
);

CREATE TABLE teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  name        text NOT NULL,
  -- Zuständiger Bauleiter des Teams.
  manager_id  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  team_id  uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (team_id, user_id)
);

-- Zuweisung Mitarbeiter ↔ Baustelle für einen Zeitraum (Datumsangaben in Firmenzeitzone, inklusiv).
CREATE TABLE site_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES sites(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  valid_from  date NOT NULL,
  valid_to    date,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX site_assignments_user_idx ON site_assignments (user_id, valid_from);

CREATE TYPE verification_state AS ENUM ('verified', 'unverified', 'corrected', 'manual');
CREATE TYPE booking_source AS ENUM ('online', 'offline', 'admin');

CREATE TABLE work_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  user_id            uuid NOT NULL REFERENCES users(id),
  site_id            uuid NOT NULL REFERENCES sites(id),
  -- Vom Gerät erzeugte ID: macht Wiederholungen (Netzabbruch, Offline-Sync) idempotent.
  client_id          uuid NOT NULL,
  started_at         timestamptz NOT NULL,
  ended_at           timestamptz,
  end_client_id      uuid,
  -- Vom Gerät gemeldete Zeiten (nur Information; maßgeblich ist bei Online-Buchungen die Serverzeit).
  device_started_at  timestamptz,
  device_ended_at    timestamptz,
  verification       verification_state NOT NULL,
  source             booking_source NOT NULL,
  start_lat          double precision,
  start_lng          double precision,
  start_accuracy_m   double precision,
  start_location_at  timestamptz,
  start_check        jsonb,
  end_lat            double precision,
  end_lng            double precision,
  end_accuracy_m     double precision,
  end_distance_m     double precision,
  note               text,
  -- Prüfung ungeprüfter (Offline-)Buchungen durch Admin/Bauleiter; ändert die Kennzeichnung nicht.
  reviewed_by        uuid REFERENCES users(id),
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  UNIQUE (user_id, client_id)
);
-- Höchstens eine offene Arbeitssitzung pro Mitarbeiter – auch bei parallelen Anfragen.
CREATE UNIQUE INDEX work_sessions_one_open ON work_sessions (user_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX work_sessions_end_client ON work_sessions (user_id, end_client_id) WHERE end_client_id IS NOT NULL;
CREATE INDEX work_sessions_company_start ON work_sessions (company_id, started_at);
CREATE INDEX work_sessions_site_idx ON work_sessions (site_id);

CREATE TABLE work_breaks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES work_sessions(id),
  client_id        uuid NOT NULL,
  end_client_id    uuid,
  started_at       timestamptz NOT NULL,
  ended_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  UNIQUE (session_id, client_id)
);
CREATE UNIQUE INDEX work_breaks_one_open ON work_breaks (session_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX work_breaks_end_client ON work_breaks (session_id, end_client_id) WHERE end_client_id IS NOT NULL;

-- Unveränderbare Änderungshistorie für Zeitkorrekturen (nur INSERT erlaubt, siehe Trigger).
CREATE TABLE time_corrections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES work_sessions(id),
  changed_by  uuid NOT NULL REFERENCES users(id),
  reason      text NOT NULL CHECK (length(trim(reason)) >= 5),
  before      jsonb,
  after       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_corrections_session_idx ON time_corrections (session_id);

CREATE FUNCTION forbid_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabelle % ist unveränderbar (nur Einfügen erlaubt)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER time_corrections_append_only
  BEFORE UPDATE OR DELETE ON time_corrections
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER time_corrections_no_truncate
  BEFORE TRUNCATE ON time_corrections
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

CREATE TYPE request_status AS ENUM ('pending', 'approved', 'rejected');

-- Begründete Korrekturanfragen von Mitarbeitern (z. B. Einstempeln ohne gültigen Standort).
CREATE TABLE correction_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  user_id          uuid NOT NULL REFERENCES users(id),
  site_id          uuid NOT NULL REFERENCES sites(id),
  session_id       uuid REFERENCES work_sessions(id),
  client_id        uuid NOT NULL,
  requested_start  timestamptz NOT NULL,
  requested_end    timestamptz,
  reason           text NOT NULL CHECK (length(trim(reason)) >= 10),
  status           request_status NOT NULL DEFAULT 'pending',
  reviewed_by      uuid REFERENCES users(id),
  reviewed_at      timestamptz,
  review_note      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (requested_end IS NULL OR requested_end > requested_start),
  UNIQUE (user_id, client_id)
);

CREATE TABLE reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  site_id      uuid NOT NULL REFERENCES sites(id),
  client_id    uuid NOT NULL,
  report_date  date NOT NULL,
  work_done    text NOT NULL CHECK (length(trim(work_done)) > 0),
  remarks      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);
CREATE INDEX reports_company_date ON reports (company_id, report_date);

CREATE TABLE photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id    uuid NOT NULL REFERENCES reports(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  client_id    uuid NOT NULL,
  storage_key  text NOT NULL UNIQUE,
  mime         text NOT NULL,
  size_bytes   integer NOT NULL,
  sha256       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);
CREATE INDEX photos_report_idx ON photos (report_id);

-- Krankmeldung: bewusst ohne Diagnosefeld.
CREATE TABLE sick_notes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id),
  user_id               uuid NOT NULL REFERENCES users(id),
  client_id             uuid NOT NULL,
  start_date            date NOT NULL,
  expected_end_date     date NOT NULL,
  certificate_provided  boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (expected_end_date >= start_date),
  UNIQUE (user_id, client_id)
);

-- Zwischenspeicher für berechnete Straßenentfernungen (einfache Strecke).
CREATE TABLE route_cache (
  user_id      uuid NOT NULL REFERENCES users(id),
  site_id      uuid NOT NULL REFERENCES sites(id),
  home_hash    text NOT NULL,
  provider     text NOT NULL,
  distance_m   double precision NOT NULL,
  duration_s   double precision,
  simulated    boolean NOT NULL,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, site_id)
);
