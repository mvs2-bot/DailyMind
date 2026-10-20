-- =====================================================================
-- DailyMind – Schema für das Supabase-Projekt "core"
-- ---------------------------------------------------------------------
-- Folgt den Konventionen der bestehenden Apps in "core":
--   * Tabellen im Schema public mit App-Präfix (dailymind_*)
--   * App-Registrierung in public.overall_apps, Freischaltung über
--     public.overall_app_access (Rolle guest/member/admin)
--   * Hilfsfunktionen als STABLE SECURITY DEFINER mit leerem search_path
--
-- Datenschutz: Tagebucheinträge sind strikt privat. Anders als z. B. im
-- PegelTracker gibt es KEINEN Admin-Lesezugriff auf fremde Einträge.
-- Jeder User sieht und ändert ausschließlich Zeilen mit seiner user_id.
--
-- Das Skript ist idempotent und kann im SQL-Editor ausgeführt werden.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. App registrieren
-- ---------------------------------------------------------------------
insert into public.overall_apps (id, name, url, is_active)
values ('dailymind', 'DailyMind', 'https://mvs2-bot.github.io/DailyMind/', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Zugriffsprüfung: mindestens Rolle "member" für die App "dailymind"
-- ---------------------------------------------------------------------
create or replace function public.dailymind_is_member()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
    select public.overall_has_app_role('dailymind', 'member');
$$;

revoke all on function public.dailymind_is_member() from public, anon;
grant execute on function public.dailymind_is_member() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Tabelle: ein Eintrag pro User und Tag (Morgen + Abend)
-- ---------------------------------------------------------------------
create table if not exists public.dailymind_entries (
    id               uuid        primary key default gen_random_uuid(),
    user_id          uuid        not null default auth.uid()
                                 references auth.users (id) on delete cascade,
    entry_date       date        not null default current_date,

    -- Morgen
    gratitude        text[]      not null default '{}',  -- Wofür bin ich dankbar? (max. 3)
    great_day        text[]      not null default '{}',  -- Was würde den Tag großartig machen? (max. 3)
    affirmation      text,                               -- Positive Affirmation des Tages
    morning_done_at  timestamptz,

    -- Abend
    went_well        text[]      not null default '{}',  -- Was lief heute gut? Kleine Erfolge (max. 3)
    learned          text,                               -- Woraus habe ich gelernt? Was hätte besser laufen können?
    mood             smallint,                           -- Stimmung 1 (schwer) … 5 (strahlend)
    energy           smallint,                           -- Energie 1 (leer) … 5 (voller Energie)
    evening_done_at  timestamptz,

    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),

    constraint dailymind_entries_user_date_key unique (user_id, entry_date),
    constraint dailymind_entries_gratitude_chk
        check (cardinality(gratitude) <= 3 and char_length(array_to_string(gratitude, '')) <= 1500),
    constraint dailymind_entries_great_day_chk
        check (cardinality(great_day) <= 3 and char_length(array_to_string(great_day, '')) <= 1500),
    constraint dailymind_entries_went_well_chk
        check (cardinality(went_well) <= 3 and char_length(array_to_string(went_well, '')) <= 1500),
    constraint dailymind_entries_affirmation_chk
        check (affirmation is null or char_length(affirmation) <= 500),
    constraint dailymind_entries_learned_chk
        check (learned is null or char_length(learned) <= 2000),
    constraint dailymind_entries_mood_chk
        check (mood is null or mood between 1 and 5),
    constraint dailymind_entries_energy_chk
        check (energy is null or energy between 1 and 5)
);

comment on table public.dailymind_entries is
    'DailyMind: ein Tagebucheintrag (Morgen- und Abendroutine) pro User und Tag. Strikt privat per RLS.';

-- Archivabfragen: eigene Einträge nach Datum absteigend.
-- (Der Unique-Constraint deckt (user_id, entry_date) bereits ab.)

-- updated_at automatisch pflegen (bestehende Hilfsfunktion aus "core")
drop trigger if exists dailymind_entries_touch_updated_at on public.dailymind_entries;
create trigger dailymind_entries_touch_updated_at
    before update on public.dailymind_entries
    for each row execute function public.overall_touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------
alter table public.dailymind_entries enable row level security;
alter table public.dailymind_entries force row level security;

revoke all on table public.dailymind_entries from anon;
grant select, insert, update, delete on table public.dailymind_entries to authenticated;

drop policy if exists dailymind_entries_select on public.dailymind_entries;
create policy dailymind_entries_select on public.dailymind_entries
    for select to authenticated
    using (user_id = (select auth.uid()) and (select public.dailymind_is_member()));

drop policy if exists dailymind_entries_insert on public.dailymind_entries;
create policy dailymind_entries_insert on public.dailymind_entries
    for insert to authenticated
    with check (user_id = (select auth.uid()) and (select public.dailymind_is_member()));

drop policy if exists dailymind_entries_update on public.dailymind_entries;
create policy dailymind_entries_update on public.dailymind_entries
    for update to authenticated
    using (user_id = (select auth.uid()) and (select public.dailymind_is_member()))
    with check (user_id = (select auth.uid()) and (select public.dailymind_is_member()));

drop policy if exists dailymind_entries_delete on public.dailymind_entries;
create policy dailymind_entries_delete on public.dailymind_entries
    for delete to authenticated
    using (user_id = (select auth.uid()) and (select public.dailymind_is_member()));

commit;

-- ---------------------------------------------------------------------
-- Optional: einen User für DailyMind freischalten (als Admin ausführen)
-- ---------------------------------------------------------------------
-- insert into public.overall_app_access (user_id, app_id, role)
-- select id, 'dailymind', 'member' from auth.users where email = 'name@example.com'
-- on conflict do nothing;
