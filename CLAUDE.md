# Rheinraum – Projektkontext für Claude

Zeiterfassungs-App für Handwerksbetriebe, später als Lizenzprodukt (pro Mitarbeiter, z. B. 7 €) an andere Firmen.
Der Auftraggeber ist kein Entwickler: Antworten auf Deutsch, verständlich, ohne Fachjargon; Bedienschritte genau beschreiben.

## Aufbau (npm-Workspaces)

- `apps/mobile` – Mitarbeiter-App, Expo SDK 58 + React Native + Expo Router (`src/app` = Bildschirme).
  - `src/state/AppData.tsx` (Zeitbuchungen, Offline-Warteschlange, Sync), `src/sync/queue.ts` (reines TS, getestet)
  - `*.web.ts`-Dateien nur für die Browser-Demo; `src/demo/*` = simulierter Server (nur mit `EXPO_PUBLIC_DEMO=1`)
- `apps/admin` – Admin-Weboberfläche (React + Vite), spricht `/api` unter derselben Adresse
- `apps/backend` – Fastify-API + PostgreSQL; SQL-Migrationen in `migrations/`, Beispieldaten `src/db/seed.ts`
  - Sichtbarkeitsregeln zentral in `src/services/scope.ts`, Zeitlogik in `src/services/time.ts`
- `packages/shared` – gemeinsame Typen, Standortprüfung, Pausenberechnung (eine Datei, keine relativen Importe)

## Befehle

```bash
npm install                      # baut auch packages/shared (postinstall)
npm run typecheck                # alle Pakete
npm test                         # Unit + Integrationstests (Backend braucht PostgreSQL, DB handwerk_test)
npm run build                    # shared, backend, admin
npm run dev:backend | dev:admin | dev:mobile
npm run demo:build -w @rheinraum/mobile   # Browser-Demo als eine HTML-Datei
```

Lokale DB in einer Cloud-Sitzung: `service postgresql start`; Benutzer/DBs `handwerk`/`handwerk_test`
(siehe README, Schnellstart). Expo-Pakete mit `EXPO_OFFLINE=1 npx expo install <paket>` installieren, falls die Expo-API
nicht erreichbar ist.

## Fachliche Regeln (nicht aufweichen)

- Einstempeln nur nach **serverseitiger** Prüfung: Zuweisung, Standortalter ≤ 120 s, Genauigkeit ≤ 100 m,
  Abstand ≤ Radius (Standard 500 m, Grenze inklusive). Ausstempeln überall erlaubt. Keine Hintergrund-Ortung.
- Zeitbuchungen idempotent über `clientId`; eine offene Sitzung pro Person (Unique-Index).
- Offline-Buchungen = Gerätezeit + `verification = 'unverified'`; nie als serverbestätigt ausgeben.
- Korrekturen nur mit Begründung; `time_corrections` ist per Trigger unveränderbar.
- Krankmeldungen ohne Diagnosefeld; Krankmeldungen/Wohnadressen nur für Admins mit `hr_access`.
- Bauleiter sehen nur eigene Teams/Baustellen. Jede Berechtigung serverseitig prüfen.
- Keine Secrets ins Repo, nur `.env.example`. Nur erfundene Beispieldaten.

## Betrieb / Deployment

- Hosting: **Render** (Blueprint `render.yaml`, Region Frankfurt): ein Web-Service liefert API und Admin-Oberfläche aus,
  PostgreSQL `rheinraum-db`, Fotos auf Disk `/var/data`. Jeder Push auf den verbundenen Branch wird automatisch ausgeliefert.
- Start auf Render: `npm run start:render` = Migrationen → Beispieldaten (nur leere DB und `ALLOW_DEMO_SEED=true`) → Server.
- Vor echten Kundendaten: `ALLOW_DEMO_SEED=false`, Demo-Konten deaktivieren, AVV mit Render abschließen.

## Stand und nächste Schritte

- Umgesetzt: siehe README „Funktionen“. Backend 46 Tests, App 8, Shared 9 – alle grün.
- Simuliert: Routing (Luftlinie × 1,3), kein E-Mail-Versand (Einladungscode wird angezeigt), keine Geokodierung.
- Offen: echte Handy-App per Expo/EAS (Expo-Konto des Auftraggebers nötig, `EXPO_PUBLIC_API_URL` auf Render-Adresse),
  Firmen-Registrierung/Abrechnung der Lizenzen, Branch `main` + Pull-Request-Ablauf (Auftraggeber fragen).
