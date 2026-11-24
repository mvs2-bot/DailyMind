# CLAUDE.md – DailyMind

Accountbasiertes Tagebuch (6-Minuten-Tagebuch: Morgen-/Abendroutine, Archiv, Tschick-/Getränke-Tracking, Streak).
Läuft auf GitHub Pages unter `/DailyMind/`. Kein Build, kein npm: reines HTML/CSS/JS, Alpine.js + supabase-js per CDN.
Sprache in UI, Kommentaren, Doku und Commits: Deutsch. Ausführliche Nutzer-Doku: `README.md`.

## Arbeitsweise (Token-Effizienz, verbindlich für jeden Worker)
- Nicht das ganze Repo einlesen. Nur diese Datei + per `grep -n` gezielt die betroffenen Stellen öffnen.
  `index.html` (~1670 Zeilen) nie komplett lesen, sondern über die Abschnitte unten anspringen.
- Vor dem PR selbst prüfen (kein separater Test-Thread): Syntax (z. B. `node --check` für .js,
  Inline-Skripte), kaputte Referenzen/IDs/`x-ref`, Design-Konsistenz mit den Tokens unten, Hell + Dunkel.
- Ändern sich Architektur, Dateistruktur oder Supabase-Schema dauerhaft: diese Datei im selben PR anpassen
  (strikt unter 150 Zeilen).
- Rückmeldung kurz: geänderte Dateien, PR-Link, ggf. nötige SQL-Migrationen.
- Keine Secrets. Erlaubt sind nur öffentliche Werte (Supabase-URL, Publishable/Anon Key). Niemals
  `service_role`, VAPID-Private-Key o. Ä.

## Dateien
| Datei | Inhalt |
| --- | --- |
| `index.html` | Komplette App: CSS (`<style>`), Markup, Alpine-Komponente `dailyMind()` |
| `sprueche.js` | `SPRUECHE.morning/evening` mit `titles` + `texts` (je 100), täglich rotierend |
| `push.js` | `DailyMindPush` (Web-Push-Abo je Gerät). Wird auch von `/konto.html` (Dashboard-Repo) geladen! |
| `sw.js` | Service Worker: eigene Dateien network-first (4 s), CDN cache-first, Supabase nie gecacht, Push-Anzeige |
| `shared/ios-nav.js` | **Kopie** – Original in `mvs2-bot.github.io/shared/`. Nur dort ändern, dann kopieren. |
| `shared/streak.js`, `shared/streak.css` | **Kopie** des Streak-Clients aus `mvs2-bot.github.io/shared/` (Doku dort `docs/STREAK.md`) |
| `manifest.json`, `icon.svg`, `icon.png`, `apple-touch-icon.png`, `icons/` | PWA |
| `docs/` | Screenshots (Handy/Rechner) |

## Aufbau `index.html` (Orientierung, Zeilen ca.)
- `19–31` Theme-Init vor dem Rendern (`localStorage['overall-theme']`, Fallback `dailymind-theme`).
- `32–388` CSS (`<style>`): `:root`-Tokens, `[data-theme="dark"]`, Komponenten, Rechner-Layout (`@media (min-width: 1100px)`).
- `390–396` Skripte: supabase-js `2.45.4`, Alpine `3.14.1` (jsDelivr), `ios-nav.js`, `sprueche.js`, `push.js`, `streak.js`.
- `404–408` Konfiguration: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_ID = 'dailymind'`.
- `410–1015` Markup. Views über `view`: `loading`, `config`, `auth`, `noaccess`, `app`.
  Im App-View Tabs über `tab`: `today`, `archive`, `profile`. Mobile Tab-Leiste `nav.tabbar`, Tastenkürzel-Dialog `.keys`.
- `1017–1072` Helfer: Datum (`toISO`/`fromISO`, immer lokale Zeit, nie UTC), `emptyEntry()`,
  `EVENING_FROM_HOUR = 15` (ab dann öffnet die Abendroutine), `pickSpruch`, `withTimeout`.
- `1074–1665` `dailyMind()`: Login, Profil/Avatar, Zugriffsprüfung, Push-Hinweis, Streak, Laden/Speichern/Löschen,
  Archiv-Vorschau (`archSel`, `pv()`, `pickArchive`), Tastenkürzel (`onKey`, `focusPart`).
- Ende: Boot-Fehler-Hinweis (`#bootFail`), Service-Worker-Registrierung.

## Breiten (Handy bleibt unverändert)
- `< 768 px` Handy: Tab-Leiste unten, Profil-Tab. `768–1099 px`: eine Spalte (600 px), Segmente oben.
- `≥ 1100 px` Rechner (`wide`, `wideMq`): `.desk` = Tagebuch + Seitenleiste `.side` (Kalender, Monat, Serie),
  `.routines` zeigt Morgen und Abend nebeneinander (Umschalter `.parts` aus), Archiv `.arch-grid` mit Vorschau.
- Neue Rechner-Styles nur in diesem Media-Block; Elemente dafür sind darunter per CSS ausgeblendet.

## Supabase-Anbindung
- Gemeinsames Core-Projekt; Client: `supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)`.
- **Schema liegt ausschließlich im Repo `supabase-core`** (Präfix `dailymind_`). Schemaänderung = dort neue
  Migration + Test, eigener PR. Migrationen bisher: `…_dailymind_core`, `…_dailymind_push`,
  `…_dailymind_push_vapid`, `…_dailymind_tschick`, `…_dailymind_drinks`, `…_dailymind_push_streak`
  (dazu `…_streak_repair`). Edge Function `dailymind-push`.
- Tabellen/RPCs im Client:
  - `dailymind_entries` – ein Eintrag je User und Tag (`unique (user_id, entry_date)`). Felder:
    `gratitude[]`, `great_day[]`, `affirmation`, `morning_done_at`, `went_well[]`, `learned`, `mood 1–5`,
    `energy 1–5`, `evening_done_at`, `tschick`, `tschick_tags[]`, `drank_enough`, `drank_alcohol`.
  - `dailymind_push_settings` – Erinnerungen (`morning_/evening_/streak_enabled` + Zeiten, `tschick_enabled`, `drinks_enabled`).
  - `dailymind_push_subscriptions` – Push-Abo je Gerät (über `push.js`).
  - `overall_profiles` (Name, `avatar_path` → Storage-Bucket `avatars`), RPC `overall_app_role(p_app)`,
    RPC `dailymind_is_member`, Streak über `Streak.status(sb, 'dailymind')`; `streak.days`
    markiert die Kalender (aktiv/Freeze/repariert), `streak.repair` zeigt den Reparatur-Hinweis im Tagebuch.
- Sicherheit: RLS erzwungen, jede Policy `user_id = auth.uid()`; Einträge strikt privat (auch nicht für Admins).
  Zugang ab Rolle `member` in `overall_app_access`. Konten legt nur ein Admin im Dashboard an (keine Registrierung).

## Design-Tokens (`:root` in `index.html`)
- Flächen: `--bg #f2f2f7`, `--card #fff`, `--well`, `--hover`, `--line`, `--sep`.
- Text: `--ink #1c1c1e`, `--text #3a3a3c`, `--mute #6c6c70`.
- Akzent Salbeigrün: `--p1 #4a7356` (dunkel `#8fc49c`), `--p1-soft`, `--on-p1`.
- Morgen: `--sun #b25000` / `--sun-soft` (dunkel `#ffb340`); Abend: `--moon` = `--p1`; Streak-Flamme `--star` = `--sun`,
  Freeze `--streak-ice`, Reparatur `--streak-repair`.
- Status: `--ok`, `--danger`, `--danger-soft`.
- `--radius 18px`, `--radius-s 12px`, `--shadow`, `--pop`, `--font` (Systemschrift/SF),
  `--serif` (New York/Georgia – Überschriften und Affirmation).
- Aliasse für `ios-nav.js`: `--border`, `--accent`, `--card-hover`, `--muted`.
- Dark Mode: `[data-theme="dark"]`, Karten `#1c1c1e` auf Schwarz.
- Apple-Designsprache wie Dashboard: Typo 12–22 px (Basis 14), weiße Karten auf Grau, Linien-Symbole statt Emojis.

## Konventionen
- Neue Farben als Variable in `:root` **und** im Dark-Theme, nie hart im Markup.
- **Bei jeder Änderung an gecachten Dateien `V` in `sw.js` hochzählen** (`dailymind-vNN`);
  neue Datei zusätzlich in `CORE` von `sw.js` aufnehmen.
- `push.js` bleibt abwärtskompatibel, da `/konto.html` es mitlädt (Scope fest `/DailyMind/`).
- Geteilte Dateien (`shared/*`) nicht hier ändern, sondern im Original-Repo und dann kopieren.
- Datumslogik immer lokal (`toISO`), nie `toISOString()`.
- Neue Sprüche einfach in `sprueche.js` ergänzen.
