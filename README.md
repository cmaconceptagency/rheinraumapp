# Rheinraum – Zeiterfassung für Handwerksbetriebe

Mitarbeiter-App (iOS/Android, Expo + React Native + TypeScript) und responsive Admin-Weboberfläche (React + Vite)
mit gemeinsamer Backend-API (Node.js/Fastify) und PostgreSQL-Datenbank.

> Stand: lauffähiger Entwicklungsstand mit Beispieldaten. **Keine** Veröffentlichung in App Stores, **kein** produktives Deployment.

---

## Inhalt

1. [Funktionen](#funktionen)
2. [Projektstruktur](#projektstruktur)
3. [Demo im Browser (ohne Installation)](#demo-im-browser-ohne-installation)
4. [Schnellstart (lokal)](#schnellstart-lokal)
4. [App auf dem Handy testen (Expo Go)](#app-auf-dem-handy-testen-expo-go)
5. [Expo Development Build (falls Expo Go nicht passt)](#expo-development-build)
6. [Demo-Zugänge](#demo-zugänge)
7. [Tests und Prüfungen](#tests-und-prüfungen)
8. [Standortprüfung beim Einstempeln](#standortprüfung-beim-einstempeln)
9. [Offline-Betrieb und Synchronisation](#offline-betrieb-und-synchronisation)
10. [Rollen und Berechtigungen](#rollen-und-berechtigungen)
11. [Sicherheit](#sicherheit)
12. [Simulierte Integrationen und bekannte Einschränkungen](#simulierte-integrationen-und-bekannte-einschränkungen)
13. [Lizenzmodell / Mandanten](#lizenzmodell--mandanten)
14. [Vor einem Produktivbetrieb](#vor-einem-produktivbetrieb)
15. [API-Überblick](#api-überblick)

---

## Funktionen

**Mitarbeiter-App**
- Anmeldung mit vom Admin angelegtem Konto oder per Einladungscode (Passwort wird selbst gesetzt)
- Übersicht der zugewiesenen Baustellen mit Adresse, Ansprechpartner, Anruf- und Kartenknopf
- Arbeitsbeginn → Pause → Fortsetzen → Arbeitsende mit großem Timer und klaren Statusanzeigen
- Standortprüfung beim Einstempeln (serverseitig), verständliche Rückmeldungen, erneute Prüfung, Korrekturanfrage
- Tages- und Monatsübersicht der eigenen Arbeitszeiten inkl. Pausenhinweis nach § 4 ArbZG
- Tätigkeitsberichte (Datum, Baustelle, ausgeführte Arbeiten, Bemerkungen) mit Fotos aus Kamera oder Galerie
- Krankmeldung mit Beginn und voraussichtlichem Ende – **ohne Diagnosefeld**
- Straßenentfernung Wohnort → Baustelle über austauschbare Routing-Schnittstelle, **„Einfache Strecke“** gekennzeichnet
- Offline-Zwischenspeicherung von Zeitbuchungen, Berichten, Fotos, Krankmeldungen und Korrekturanfragen

**Admin-Weboberfläche** (Bauleiter und Administratoren)
- Übersicht: wer ist gerade eingestempelt, offene Korrekturanfragen, ungeprüfte Offline-Buchungen, Lizenzauslastung
- Mitarbeiter anlegen, bearbeiten, deaktivieren, Einladungscodes erzeugen, Rollen und HR-Berechtigung
- Baustellen anlegen/bearbeiten/deaktivieren inkl. Koordinaten, Radius (Standard 500 m) und zuständigen Bauleitern
- Mitarbeiter Baustellen für Zeiträume zuweisen, Teams pflegen
- Arbeitszeiten filtern und prüfen, Zeitkorrekturen mit Pflicht-Begründung und **unveränderbarer Änderungshistorie**
- Korrekturanfragen genehmigen/ablehnen, ungeprüfte Offline-Buchungen als geprüft markieren
- Berichte und Fotos filtern und ansehen (Fotos werden geschützt geladen)
- Krankmeldungen und Wohnadressen nur für Administratoren mit ausdrücklicher HR-Berechtigung
- Monatlicher CSV-Export (Semikolon, Dezimalkomma, UTF-8 mit BOM – Excel-tauglich)

## Projektstruktur

```
.
├── apps/
│   ├── backend/          Fastify-API, Migrationen, Beispieldaten, Integrationstests
│   │   ├── migrations/   SQL-Migrationen (werden der Reihe nach angewendet)
│   │   ├── src/
│   │   │   ├── routes/   auth, me (Mitarbeiter), admin, photos
│   │   │   ├── services/ Zeiterfassung, Korrekturen, Sichtbarkeit (Scope), Routing, Fotoablage, CSV
│   │   │   └── db/       Verbindung, migrate.ts, seed.ts
│   │   └── test/         Tests gegen echte PostgreSQL-Testdatenbank
│   ├── admin/            React + Vite Admin-Weboberfläche
│   └── mobile/           Expo-App (Expo Router, Bildschirme unter src/app)
│       ├── src/state/    App-Zustand, Offline-Warteschlange, Timer
│       ├── src/sync/     Warteschlange (reines TypeScript, getestet)
│       └── test/         Vitest-Tests der Warteschlange und Timer-Logik
├── packages/shared/      Gemeinsame Typen, Standortprüfung, Pausenberechnung (getestet)
├── docker-compose.yml    Lokale PostgreSQL-Datenbank (inkl. Testdatenbank)
└── package.json          npm-Workspaces und Sammelbefehle
```

## Demo im Browser (ohne Installation)

Für einen schnellen Eindruck gibt es eine Browser-Demo der Mitarbeiter-App: die echte App-Oberfläche, aber mit
**simuliertem Server, Beispieldaten und simuliertem GPS** (Bedienfeld neben der App: Standort wählen, Verbindung trennen,
Daten zurücksetzen). Sie ersetzt nicht den Test auf einem echten Handy mit dem echten Backend.

```bash
npm run demo:build -w @rheinraum/mobile
# Ergebnis: apps/mobile/dist-demo/rheinraum-demo.html (eine Datei, im Browser öffnen)
```

Technik: `EXPO_PUBLIC_DEMO=1` aktiviert beim Web-Build `src/demo/setup.web.ts`, das alle API-Aufrufe an den simulierten
Server `src/demo/mockServer.ts` umleitet (gleiche Fehlercodes und Standortprüfung wie das Backend). Native Builds
enthalten davon nichts (`setup.ts` ist leer).

## Schnellstart (lokal)

**Voraussetzungen**
- Node.js **22** (mind. 20.19) und npm 10
- Docker Desktop (für PostgreSQL) **oder** eine eigene PostgreSQL-16-Installation
- Für das Handy: App **Expo Go** (App Store / Google Play) – siehe unten

**1. Abhängigkeiten installieren** (im Projektordner)

```bash
npm install
```

**2. Datenbank starten**

```bash
docker compose up -d db
```

Ohne Docker: PostgreSQL 16 installieren und einmalig ausführen:
```sql
CREATE USER handwerk WITH PASSWORD 'handwerk' CREATEDB;
CREATE DATABASE handwerk OWNER handwerk;
CREATE DATABASE handwerk_test OWNER handwerk;
```

**3. Backend konfigurieren**

```bash
cp apps/backend/.env.example apps/backend/.env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
Den ausgegebenen Wert in `apps/backend/.env` bei `JWT_SECRET=` eintragen.

**4. Migrationen und Beispieldaten**

```bash
npm run db:migrate
npm run db:seed
```
Später komplett neu aufsetzen: `npm run db:seed -- --reset` (löscht alle Daten!).

**5. Backend starten** (Terminal 1, Port 4000)

```bash
npm run dev:backend
```
Prüfen: <http://localhost:4000/api/health>

**6. Admin-Weboberfläche starten** (Terminal 2)

```bash
npm run dev:admin
```
Öffnen: <http://localhost:5173> – Anmeldung z. B. mit `admin@musterbau.example` / `Baustelle2026!`

**7. Mitarbeiter-App starten** (Terminal 3)

```bash
npm run dev:mobile
```
Es erscheint ein QR-Code – weiter im nächsten Abschnitt.

## App auf dem Handy testen (Expo Go)

1. **Expo Go** auf dem Handy installieren.
2. Handy und Rechner ins **gleiche WLAN**.
3. `npm run dev:mobile` starten und den QR-Code scannen
   (Android: in Expo Go „Scan QR code“, iPhone: mit der Kamera-App).
4. Anmelden mit `max@musterbau.example` / `Baustelle2026!`.

**Wie findet die App das Backend?** In der Entwicklung verwendet die App automatisch die IP-Adresse des Rechners, auf dem
`expo start` läuft, mit Port 4000. Falls das nicht klappt (z. B. VPN, mehrere Netzwerkkarten):

```bash
cp apps/mobile/.env.example apps/mobile/.env
# in apps/mobile/.env eintragen, z. B.:
# EXPO_PUBLIC_API_URL=http://192.168.178.20:4000
npm run dev:mobile -- --clear
```
Die verwendete Adresse steht in der App unter **Mehr → Server**.

**Firewall:** Der Rechner muss eingehende Verbindungen auf **Port 4000** (Backend) und **8081** (Expo) im WLAN erlauben.

**Einstempeln ausprobieren:** Die Demo-Baustellen liegen in Köln/Bonn. Um das Einstempeln von woanders zu testen, in der
Admin-Oberfläche unter *Baustellen → Bearbeiten* die Koordinaten auf den eigenen Standort setzen
(z. B. aus Google Maps/OpenStreetMap kopieren).

**Hinweis zu Expo Go und SDK-Version:** Das Projekt nutzt **Expo SDK 58**. Expo Go im Store unterstützt immer nur die
aktuelle SDK-Version. Meldet Expo Go „Project is incompatible with this version of Expo Go“, bitte den Development Build
(nächster Abschnitt) verwenden.

## Expo Development Build

Alle verwendeten nativen Module (Standort, Kamera/Fotos, SecureStore, Dateisystem, Krypto, NetInfo, AsyncStorage,
DateTimePicker) sind in Expo Go enthalten – **für die Entwicklung reicht Expo Go**. Ein Development Build wird benötigt,
wenn die Expo-Go-Version nicht passt, eigene native Module hinzukommen oder echte App-Symbole/Berechtigungstexte getestet
werden sollen. Die Konfiguration liegt in `apps/mobile/eas.json` (Profil `development`).

**Variante A – Cloud-Build mit EAS (kein Android Studio/Xcode nötig)**

```bash
cd apps/mobile
npx expo install expo-dev-client
npx eas-cli@latest login                 # kostenloses Expo-Konto
npx eas-cli@latest build:configure       # einmalig, verknüpft das Projekt
npx eas-cli@latest build --profile development --platform android
```
Den angezeigten Link auf dem Android-Handy öffnen und die App installieren. Danach:
```bash
npx expo start --dev-client
```
und den QR-Code mit der installierten Entwicklungs-App scannen.

Für iOS: `--platform ios` (erfordert ein kostenpflichtiges Apple-Developer-Konto; das Gerät wird beim ersten Build registriert).

**Variante B – lokal bauen**
- Android (Android Studio + SDK installiert, Handy per USB mit USB-Debugging): `cd apps/mobile && npx expo run:android`
- iOS (Mac mit Xcode): `cd apps/mobile && npx expo run:ios --device`

Vorher in `app.json` `ios.bundleIdentifier` und `android.package` (derzeit Platzhalter `de.example.rheinraum`) auf
eigene Kennungen ändern.

**HTTP im Development Build:** Debug-Builds erlauben in der Regel unverschlüsselte Verbindungen ins lokale Netz. Kommt
trotzdem keine Verbindung zustande (iOS App Transport Security), das Backend über HTTPS bereitstellen, z. B. per Tunnel.
Release-Builds benötigen grundsätzlich **HTTPS**.

## Demo-Zugänge

Alle Personen und Firmen sind frei erfunden. Passwort für alle: **`Baustelle2026!`**

| Rolle | E-Mail | Besonderheit |
|---|---|---|
| Administrator mit HR-Recht | `admin@musterbau.example` | sieht Krankmeldungen und Wohnadressen |
| Administrator ohne HR-Recht | `buero@musterbau.example` | sieht keine Krankmeldungen/Wohnadressen |
| Bauleiter | `bauleiter@musterbau.example` | Team Köln, Baustellen Rheinauhafen und Deutz |
| Mitarbeiter | `max@musterbau.example` | Wohnort hinterlegt, Rheinauhafen + Deutz |
| Mitarbeiter | `erika@musterbau.example` | Dachsanierung Bonn, eine ungeprüfte Offline-Buchung |
| Eingeladen | `neu@musterbau.example` | Einladungscode **`DEMO-2026-CODE`** |

## Tests und Prüfungen

```bash
npm run typecheck   # TypeScript in allen Paketen (shared, backend, admin, mobile)
npm test            # Unit- und Integrationstests (Backend braucht laufende Testdatenbank)
npm run build       # Builds von shared, backend und admin
```

Einzeln: `npm test -w @rheinraum/backend`, `npm test -w @rheinraum/mobile`, `npm test -w @rheinraum/shared`.
Die Backend-Tests verwenden `postgres://handwerk:handwerk@localhost:5432/handwerk_test` (änderbar über `TEST_DATABASE_URL`)
und setzen diese Datenbank bei jedem Testlauf neu auf.

**Abgedeckt (Auszug)**
- **Rollenrechte:** Mitarbeiter ohne Adminzugriff; Bauleiter sehen nur Teams/Baustellen; Admin ohne HR-Recht sieht keine
  Krankmeldungen/Wohnadressen; Fotos nur für Berechtigte; Mandantentrennung zwischen Firmen
- **500-Meter-Grenzfall:** 499,5 m erlaubt, exakt 500 m erlaubt, 500,5 m abgelehnt (API und reine Funktion)
- **Ungenaue/veraltete/fehlende Standorte:** werden serverseitig abgelehnt
- **Doppelte Buchungen:** gleiche clientId → idempotent; zweite offene Sitzung → abgelehnt; 8 gleichzeitige Anfragen → genau eine Sitzung
- **Pausenberechnung:** Abzug, Überlappungen, offene Pausen, automatisches Pausenende beim Ausstempeln, ArbZG-Hinweise
- **Offline-Synchronisation:** Gerätezeit + Kennzeichnung „ungeprüft“, erneutes Senden ohne Duplikate, Konflikte einzeln,
  online angekommene Buchung bleibt beim Nachsenden serverbestätigt; App-Warteschlange übersteht Neustart
- **Korrekturen:** Pflicht-Begründung, Vorher/Nachher-Protokoll, Historie per Datenbank-Trigger unveränderbar
- **Uploads:** Dateisignatur statt Client-Angabe, Größenlimit, Duplikaterkennung
- **Auth:** Refresh-Token-Rotation mit Wiederverwendungserkennung, httpOnly-Cookie für die Weboberfläche, Einladungen

## Standortprüfung beim Einstempeln

- Jede Baustelle hat Koordinaten und einen Radius (Standard **500 m**, einstellbar 50–10.000 m).
- Die App fragt beim Einstempeln **einmalig** den aktuellen Standort ab (nur Vordergrund-Berechtigung, kein zwischengespeicherter
  Standort, keine Hintergrund-Ortung – die Android-Hintergrundberechtigung ist in `app.json` ausdrücklich blockiert).
- Das **Backend** prüft: Benutzer aktiv, Baustelle aktiv, **Zuweisung für den heutigen Tag**, **Standortalter** (≤ 120 s),
  **Genauigkeit** (≤ 100 m) und **Abstand** (≤ Radius, Grenzwert inklusive). Nur bei Erfolg wird mit **Serverzeit** gebucht.
  Ein deaktivierter Knopf in der App ist nur Komfort – maßgeblich ist die Serverprüfung.
- Bei fehlender Berechtigung, ausgeschalteter Ortung oder ungenauem Standort zeigt die App eine verständliche Meldung,
  „Erneut prüfen“ und „Korrektur beantragen“ (begründete manuelle Anfrage, die ein Admin/Bauleiter genehmigt).
- **Ausstempeln ist immer möglich**, auch außerhalb des Radius; ein Standort wird dann nur protokolliert.
- Grenzwerte: `LOCATION_MAX_ACCURACY_M`, `LOCATION_MAX_AGE_S` in `apps/backend/.env`.

> **Wichtig:** Standortdaten stammen vom Gerät und können (z. B. mit Fake-GPS-Apps) manipuliert werden. Sie sind ein
> Plausibilitätsnachweis, **kein absolut manipulationssicherer Anwesenheitsnachweis**.

## Offline-Betrieb und Synchronisation

- Zeitbuchungen, Berichte, Fotos, Krankmeldungen und Korrekturanfragen landen bei fehlender Verbindung in einer
  **persistenten Warteschlange** (AsyncStorage; Fotos werden in den App-Speicher kopiert).
- Jeder Eintrag hat eine vom Gerät erzeugte **clientId**. Der Server erkennt Wiederholungen – auch wenn eine Anfrage
  ankam, die Antwort aber verloren ging. So entstehen **keine Duplikate**.
- Offline-Zeitbuchungen verwenden die **Gerätezeit** und werden als **„Ungeprüft (offline)“** gekennzeichnet.
  Das Standortergebnis wird nur protokolliert; es wird **keine erfolgreiche Serverprüfung vorgetäuscht**.
  Admins können solche Einträge prüfen („geprüft“-Vermerk), die Kennzeichnung bleibt erhalten.
- Fachlich abgelehnte Einträge (z. B. Überschneidung) erscheinen in der App unter **Mehr → Abgelehnte Einträge**.
- Der Timer wird aus dem gespeicherten Beginn und den Pausen berechnet und übersteht App-Schließen und Neustarts.

## Rollen und Berechtigungen

| | Mitarbeiter | Bauleiter | Administrator | Administrator + HR |
|---|---|---|---|---|
| Eigene Zeiten, Berichte, Krankmeldung | ✔ | ✔ | ✔ | ✔ |
| Admin-Weboberfläche | – | ✔ (eingeschränkt) | ✔ | ✔ |
| Zeiten/Berichte/Fotos sehen | – | eigene Teams + Baustellen | alle der Firma | alle der Firma |
| Zeitkorrekturen, Anfragen genehmigen | – | im eigenen Bereich | ✔ | ✔ |
| Zuweisungen | – | eigene Baustellen | ✔ | ✔ |
| Mitarbeiter/Baustellen/Teams verwalten | – | – | ✔ | ✔ |
| Krankmeldungen, Wohnadressen | – | – | – | ✔ |
| HR-Recht vergeben | – | – | – | ✔ |

Alle Regeln werden bei **jedem API-Zugriff serverseitig** geprüft (`apps/backend/src/services/scope.ts`,
`apps/backend/src/auth/plugin.ts`). Die Oberflächen blenden nur zusätzlich aus.

## Sicherheit

- Passwörter mit bcrypt (Kosten 12), Login mit Zeitausgleich gegen Benutzer-Enumeration und Rate-Limit
- Access-Token (JWT, 15 Min.) + rotierende Refresh-Token (in der DB nur als SHA-256-Hash); Wiederverwendung sperrt alle Sitzungen
- App: Refresh-Token im **SecureStore** (iOS Keychain / Android Keystore); Web: **httpOnly-Cookie** (SameSite=Strict)
- Deaktivierte Konten verlieren sofort den Zugriff (Benutzer wird bei jeder Anfrage geprüft)
- Fotos **privat** außerhalb öffentlicher Verzeichnisse, Auslieferung nur über geschützten Endpunkt, Prüfung der
  Dateisignatur (JPEG/PNG/WebP/HEIC), Größenlimit (`MAX_UPLOAD_MB`)
- Parallele Sitzungen per **Unique-Index** in der Datenbank verhindert (auch bei gleichzeitigen Anfragen)
- Änderungshistorie per **Datenbank-Trigger** gegen UPDATE/DELETE/TRUNCATE geschützt
- CSV-Export mit Schutz gegen Formel-Injektion
- **Keine Secrets im Repository**: `.env` ist ignoriert, nur `.env.example` ist eingecheckt; die App enthält keine Geheimnisse

## Simulierte Integrationen und bekannte Einschränkungen

**Simuliert / nicht angebunden (eindeutig gekennzeichnet)**
- **Routing:** Standard ist `ROUTING_PROVIDER=simulated` = Luftlinie × 1,3 bei 50 km/h. Die App zeigt dazu ein
  **„Simuliert“**-Abzeichen. Für echte Straßenentfernungen `ROUTING_PROVIDER=osrm` und `OSRM_URL` auf einen eigenen
  OSRM-Server setzen (der öffentliche Demo-Server ist nicht für Produktion gedacht). Weitere Anbieter lassen sich über das
  Interface `RoutingProvider` in `apps/backend/src/services/routing.ts` ergänzen.
- **E-Mail-Versand von Einladungen:** nicht angebunden. Der Einladungscode wird einmalig in der Admin-Oberfläche angezeigt.
- **Geokodierung:** nicht angebunden. Koordinaten von Baustellen und Wohnorten werden manuell eingetragen.

**Einschränkungen der Prüfung in der Entwicklungsumgebung (Cloud-Container)**
- Die App wurde **nicht auf einem echten Gerät oder Simulator** ausgeführt (kein Gerät verfügbar). Geprüft wurden
  TypeScript, die Vitest-Tests der Warteschlange/Timer-Logik und ein vollständiger **Metro-Bundle-Build für Android und iOS**
  (`npx expo export`).
- `expo-doctor`: 18 von 20 Prüfungen bestanden; die zwei übrigen benötigen Zugriff auf die Expo-API, der in der
  Umgebung gesperrt war. Bitte lokal `npm run doctor -w @rheinraum/mobile` ausführen.
- Backend und Admin-Oberfläche wurden lokal gestartet und der Ablauf Login → Zuweisung → Standortprüfung → Einstempeln →
  Pause → Ausstempeln → Adminübersicht per HTTP sowie die Weboberfläche per Browser-Automatisierung geprüft.

## Lizenzmodell / Mandanten

Die Datenbank ist **mandantenfähig** (`companies`). Jede Firma hat `licensed_seats` (Anzahl lizenzierter aktiver Konten).
Das Anlegen/Reaktivieren von Konten über die Lizenzzahl hinaus wird mit `SEAT_LIMIT` abgelehnt; die Auslastung wird in der
Übersicht angezeigt. Damit ist die Grundlage für eine Abrechnung „pro Mitarbeiter“ gelegt. **Nicht enthalten:**
Registrierung neuer Firmen, Zahlungsabwicklung, Super-Admin-Oberfläche (neue Firmen derzeit per SQL anlegen).

## Vor einem Produktivbetrieb

- Backend hinter HTTPS (Reverse Proxy), `NODE_ENV=production`, starkes `JWT_SECRET`, `CORS_ORIGINS` setzen
- Admin-Oberfläche (`npm run build -w @rheinraum/admin`) und `/api` unter **derselben Domain** ausliefern (Cookie SameSite=Strict)
- Fotoablage auf privaten Objektspeicher umstellen (Interface `PhotoStorage`), Backups für Datenbank und Fotos
- Echte Bundle-IDs, App-Symbole und Datenschutzhinweise; EAS-Build-Profile `preview`/`production` verwenden
- Rechtliches klären (keine Rechtsberatung): Datenschutzinformation und Löschfristen nach DSGVO, Mitbestimmung des
  Betriebsrats bei technischer Zeiterfassung und Standortabfrage (§ 87 Abs. 1 Nr. 6 BetrVG), Aufbewahrungspflichten

## API-Überblick

| Bereich | Endpunkte |
|---|---|
| Anmeldung | `POST /api/auth/login`, `/refresh`, `/logout`, `/accept-invite` |
| Mitarbeiter | `GET /api/me`, `/me/sites`, `/me/home`, `/me/sites/:id/distance` |
| Zeiterfassung | `GET /api/me/time/current`, `/me/time/sessions`; `POST /me/time/clock-in`, `/pause`, `/resume`, `/clock-out`, `/sync` |
| Berichte/Fotos | `GET/POST /api/me/reports`, `POST /api/me/photos`, `GET /api/photos/:id/file` |
| Krankmeldung/Korrektur | `GET/POST /api/me/sick-notes`, `GET/POST /api/me/correction-requests` |
| Verwaltung | `/api/admin/overview`, `/users`, `/sites`, `/assignments`, `/teams`, `/sessions`, `/correction-requests`, `/reports`, `/sick-notes`, `/export/time.csv` |

Fehlerantworten haben immer die Form `{ "error": { "code": "...", "message": "deutscher Text", "details": ... } }`;
die Codes stehen in `packages/shared/src/index.ts` (`ERROR_MESSAGES`).
