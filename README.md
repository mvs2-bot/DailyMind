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

## Einrichtung

Das Schema ist seit dem 20.10.2026 in „core“ angelegt, und `index.html` zeigt bereits auf „core“.

1. Weitere User für `dailymind` freischalten, siehe Beispiel am Ende der SQL-Datei
   (globale Admins haben automatisch Zugriff).
2. In Supabase unter *Authentication → URL Configuration* die Pages-URL
   `https://mvs2-bot.github.io/DailyMind/` als Redirect-URL erlauben
   (für E-Mail-Bestätigung und Passwort-Reset).
3. GitHub Pages für den Branch `main` aktivieren.
