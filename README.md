# DailyMind

Ein minimalistisches, accountbasiertes Tagebuch im Stil des 6-Minuten-Tagebuchs:
morgens Dankbarkeit, Tagesfokus und Affirmation, abends kleine Erfolge, Gelerntes
sowie Stimmung und Energie. Mit Archiv (Liste und Kalender) und Dark Mode.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html` | Die komplette App: HTML, Tailwind (CDN), Alpine.js, supabase-js. Läuft direkt auf GitHub Pages. |
| `sprueche.js` | Je 100 Sprüche für Morgen und Abend (plus kurze Überschriften). |
| `push.js` | Push-Erinnerungen auf einem Gerät ein-/ausschalten. Wird auch von `/konto.html` geladen. |
| `sw.js`, `manifest.json` | App zum Installieren + Offline-Modus, zeigt Push-Erinnerungen. |
| `icons/` | App-Icons (Startbildschirm, maskable, Favicon). |
| `supabase/001_dailymind_schema.sql` | Tabelle `public.dailymind_entries`, RLS-Policies, App-Registrierung in `overall_apps`. |
| `supabase/002_dailymind_push.sql` | Push-Erinnerungen: Einstellungen, Geräte-Abos, Cron-Job (rein additiv). |
| `supabase/003_dailymind_push_vapid.sql` | VAPID-Schlüssel für Web Push im Vault. |
| `supabase/functions/dailymind-push/` | Edge Function, die die Erinnerungen per Web Push verschickt. |

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
- Sind alle Felder einer Routine ausgefüllt, erscheint darunter ein Spruch aus `sprueche.js`.
  Pro Kalendertag rückt die Liste um einen weiter: Innerhalb von 100 Tagen wiederholt sich kein Spruch,
  und beim Tippen bleibt er gleich. Neue Sprüche einfach in die Liste schreiben.

## Archiv

- Das Archiv öffnet immer in der Kalenderansicht. Die Listenansicht ist einen Klick entfernt.
- In der Liste hat jeder Eintrag rechts einen Papierkorb. Nach einer kurzen Sicherheitsabfrage wird
  genau dieser eine Tag gelöscht (nur eigene Einträge, abgesichert über RLS).

## Push-Erinnerungen

- Einstellungen in den Kontoeinstellungen (`/konto.html`, Karte DailyMind): Morgen und Abend getrennt
  an/aus, jeweils mit eigener Uhrzeit. Gespeichert in `dailymind_push_settings` (mit Zeitzone des Browsers).
- Jedes Gerät braucht ein eigenes Push-Abo (`dailymind_push_subscriptions`). Es wird beim Einschalten
  angelegt oder über „Auf diesem Gerät aktivieren“. Sind Erinnerungen an, das Gerät aber noch nicht
  angemeldet, zeigt die App oben einen Hinweis mit „Aktivieren“.
- iPhone/iPad: nur in der zum Home-Bildschirm hinzugefügten App (ab iOS 16.4). Dort in DailyMind auf
  „Aktivieren“ tippen.
- Ablauf: `pg_cron` ruft alle 5 Minuten die Edge Function `dailymind-push` auf. Die holt über
  `dailymind_push_claim()` die fälligen Erinnerungen (höchstens eine pro Tag und Routine, nur in der Stunde
  nach der gewählten Uhrzeit, nicht wenn die Routine schon begonnen ist) und verschickt sie.

### Einrichtung (einmalig)

1. `supabase/002_dailymind_push.sql` im SQL-Editor ausführen. Legt nur neue Tabellen an; das Geheimnis für
   den Cron-Aufruf erzeugt das Skript selbst im Vault.
2. `supabase/003_dailymind_push_vapid.sql` ausführen. Die VAPID-Schlüssel erzeugt die Edge Function dann beim
   ersten Aufruf selbst und speichert sie im Vault (eigene Schlüssel optional als Secrets `VAPID_PUBLIC_KEY`
   und `VAPID_PRIVATE_KEY`).
3. Edge Function `dailymind-push` deployen, „Verify JWT“ ausschalten
   (`supabase functions deploy dailymind-push --no-verify-jwt`).
