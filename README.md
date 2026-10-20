# DailyMind

Ein minimalistisches, accountbasiertes Tagebuch im Stil des 6-Minuten-Tagebuchs:
morgens Dankbarkeit, Tagesfokus und Affirmation, abends kleine Erfolge, Gelerntes
sowie Stimmung und Energie. Mit Archiv (Liste und Kalender) und Dark Mode.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html` | Die komplette App: HTML, Tailwind (CDN), Alpine.js, supabase-js. Läuft direkt auf GitHub Pages. |
| `supabase/001_dailymind_schema.sql` | Tabelle `public.dailymind_entries`, RLS-Policies, App-Registrierung in `overall_apps`. |

## Datenmodell

Ein Eintrag pro User und Tag (`unique (user_id, entry_date)`):

- **Morgen:** `gratitude text[]` (max. 3), `great_day text[]` (max. 3), `affirmation text`, `morning_done_at`
- **Abend:** `went_well text[]` (max. 3), `learned text`, `mood 1–5`, `energy 1–5`, `evening_done_at`

## Sicherheit

- RLS ist aktiv (und erzwungen). Jede Policy prüft `user_id = auth.uid()`.
- Einträge sind **strikt privat**: Auch Admins sehen keine fremden Tagebücher.
- Zugriff nur mit Freischaltung für die App `dailymind` (mindestens Rolle `member`
  in `overall_app_access`), wie bei den anderen Apps in „core“.
- Die Rolle `anon` hat keinerlei Rechte auf die Tabelle.

## Konten und Profilmenü

- Es gibt keine Registrierung in der App. Konten legt ein Admin in den Admin-Einstellungen
  im Dashboard an (`/admin.html`) und gibt dort den Zugang für DailyMind frei.
- Rechts oben sitzt wie in den anderen Apps das Profil-Rechteck (Profilbild oder 👤). Es öffnet ein Menü mit
  ⚙️ Kontoeinstellungen (`/konto.html`), 🛡️ Admin-Einstellungen (nur für Admins) und 🚪 Abmelden.
- Anzeigename und Profilbild kommen aus dem gemeinsamen Profil `overall_profiles`, Hell/Dunkel aus
  dem gemeinsamen Schlüssel `overall-theme`.

## Tagesablauf

- Oben läuft die aktuelle Uhrzeit (mit Sekunden) und das Datum mit Wochentag.
- Ab 15 Uhr öffnet die App direkt mit der Abendroutine, davor mit der Morgenroutine
  (`EVENING_FROM_HOUR` in `index.html`). Das gilt beim Öffnen, nach dem Login und wenn man
  später zur offenen App zurückkehrt.
- Sind alle Felder einer Routine ausgefüllt, erscheint darunter ein Kompliment. Pro Tag und Routine
  bleibt es dasselbe, damit es beim Tippen nicht wechselt.
