-- =====================================================================
-- DailyMind – Push-Erinnerungen für Morgen- und Abendroutine
-- ---------------------------------------------------------------------
-- Rein additiv: legt nur NEUE Tabellen, Funktionen und einen Cron-Job an.
-- public.dailymind_entries und alle anderen bestehenden Tabellen bleiben
-- unverändert. Kein drop table, kein truncate, kein rename.
--
-- Ablauf:
--   * Einstellungen pro User (an/aus + Uhrzeit für Morgen und Abend,
--     Zeitzone) in dailymind_push_settings.
--   * Jedes Gerät, das Benachrichtigungen erlaubt, landet mit seinem
--     Web-Push-Abo in dailymind_push_subscriptions.
--   * pg_cron ruft alle 5 Minuten die Edge Function "dailymind-push" auf.
--     Die holt sich über dailymind_push_claim() die fälligen Erinnerungen
--     (markiert sie dabei als gesendet) und verschickt sie per Web Push.
--   * Ist die Routine an dem Tag schon begonnen, kommt keine Erinnerung.
--
-- Das Skript ist idempotent und kann im SQL-Editor ausgeführt werden.
-- =====================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

begin;

-- ---------------------------------------------------------------------
-- 1. Einstellungen: eine Zeile pro User
-- ---------------------------------------------------------------------
create table if not exists public.dailymind_push_settings (
    user_id            uuid        primary key default auth.uid()
                                   references auth.users (id) on delete cascade,
    morning_enabled    boolean     not null default false,
    morning_time       time        not null default '07:30',
    evening_enabled    boolean     not null default false,
    evening_time       time        not null default '21:00',
    timezone           text        not null default 'Europe/Berlin',
    -- Lokales Datum der letzten Erinnerung, damit pro Tag höchstens eine kommt
    morning_last_sent  date,
    evening_last_sent  date,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    constraint dailymind_push_settings_tz_len_chk check (char_length(timezone) <= 64)
);

comment on table public.dailymind_push_settings is
    'DailyMind: Push-Erinnerungen (an/aus, Uhrzeit, Zeitzone) pro User.';

drop trigger if exists dailymind_push_settings_touch_updated_at on public.dailymind_push_settings;
create trigger dailymind_push_settings_touch_updated_at
    before update on public.dailymind_push_settings
    for each row execute function public.overall_touch_updated_at();

-- Ungültige Zeitzonen würden den Cron-Lauf für alle abbrechen, daher beim Speichern prüfen
create or replace function public.dailymind_push_settings_check_tz()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
    if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
        raise exception 'Unbekannte Zeitzone: %', new.timezone using errcode = '22023';
    end if;
    return new;
end;
$$;

revoke all on function public.dailymind_push_settings_check_tz() from public, anon, authenticated;

drop trigger if exists dailymind_push_settings_check_tz on public.dailymind_push_settings;
create trigger dailymind_push_settings_check_tz
    before insert or update of timezone on public.dailymind_push_settings
    for each row execute function public.dailymind_push_settings_check_tz();

alter table public.dailymind_push_settings enable row level security;
alter table public.dailymind_push_settings force row level security;

revoke all on table public.dailymind_push_settings from anon, authenticated;
grant select on table public.dailymind_push_settings to authenticated;
-- *_last_sent pflegt nur der Server
grant insert (user_id, morning_enabled, morning_time, evening_enabled, evening_time, timezone),
      update (user_id, morning_enabled, morning_time, evening_enabled, evening_time, timezone)  -- user_id für upsert, RLS hält ihn bei auth.uid()
    on table public.dailymind_push_settings to authenticated;

drop policy if exists dailymind_push_settings_select on public.dailymind_push_settings;
create policy dailymind_push_settings_select on public.dailymind_push_settings
    for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists dailymind_push_settings_insert on public.dailymind_push_settings;
create policy dailymind_push_settings_insert on public.dailymind_push_settings
    for insert to authenticated
    with check (user_id = (select auth.uid()) and (select public.dailymind_is_member()));

drop policy if exists dailymind_push_settings_update on public.dailymind_push_settings;
create policy dailymind_push_settings_update on public.dailymind_push_settings
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()) and (select public.dailymind_is_member()));

-- ---------------------------------------------------------------------
-- 2. Web-Push-Abos: eine Zeile pro Gerät/Browser
-- ---------------------------------------------------------------------
create table if not exists public.dailymind_push_subscriptions (
    id          uuid        primary key default gen_random_uuid(),
    user_id     uuid        not null references auth.users (id) on delete cascade,
    endpoint    text        not null,
    p256dh      text        not null,
    auth        text        not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    constraint dailymind_push_subscriptions_endpoint_key unique (endpoint),
    constraint dailymind_push_subscriptions_endpoint_chk
        check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
    constraint dailymind_push_subscriptions_keys_chk
        check (char_length(p256dh) <= 200 and char_length(auth) <= 100)
);

create index if not exists dailymind_push_subscriptions_user_idx
    on public.dailymind_push_subscriptions (user_id);

comment on table public.dailymind_push_subscriptions is
    'DailyMind: Web-Push-Abos der Geräte. Anlegen nur über dailymind_save_push_subscription().';

alter table public.dailymind_push_subscriptions enable row level security;
alter table public.dailymind_push_subscriptions force row level security;

revoke all on table public.dailymind_push_subscriptions from anon, authenticated;
grant select, delete on table public.dailymind_push_subscriptions to authenticated;

drop policy if exists dailymind_push_subscriptions_select on public.dailymind_push_subscriptions;
create policy dailymind_push_subscriptions_select on public.dailymind_push_subscriptions
    for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists dailymind_push_subscriptions_delete on public.dailymind_push_subscriptions;
create policy dailymind_push_subscriptions_delete on public.dailymind_push_subscriptions
    for delete to authenticated
    using (user_id = (select auth.uid()));

-- Gerät für den angemeldeten User speichern. Meldet sich auf demselben Browser
-- jemand anderes an, geht das Abo an diesen User über.
create or replace function public.dailymind_save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
    if (select auth.uid()) is null or not public.dailymind_is_member() then
        raise exception 'Kein Zugriff auf DailyMind' using errcode = '42501';
    end if;
    insert into public.dailymind_push_subscriptions (user_id, endpoint, p256dh, auth)
    values ((select auth.uid()), p_endpoint, p_p256dh, p_auth)
    on conflict (endpoint) do update
        set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, updated_at = now();
end;
$$;

revoke all on function public.dailymind_save_push_subscription(text, text, text) from public, anon;
grant execute on function public.dailymind_save_push_subscription(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Fällige Erinnerungen abholen (nur für die Edge Function)
-- ---------------------------------------------------------------------
-- Gemeinsames Geheimnis zwischen Cron-Job und dieser Funktion. Wird hier
-- zufällig erzeugt und liegt nur im Vault, muss also nirgends eingetragen werden.
do $$
begin
    if not exists (select 1 from vault.secrets where name = 'dailymind_push_secret') then
        perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'dailymind_push_secret',
                                    'DailyMind: Cron-Aufruf der Edge Function dailymind-push');
    end if;
end;
$$;

-- Liefert pro fälliger Erinnerung und Gerät eine Zeile und merkt sich den Tag
-- als gesendet. Fällig heißt: eingeschaltet, lokale Uhrzeit liegt in der Stunde
-- nach der gewählten Zeit, heute noch nicht gesendet, Routine noch nicht begonnen,
-- User hat (noch) Zugang zu DailyMind.
create or replace function public.dailymind_push_claim(p_secret text)
returns table (user_id uuid, kind text, endpoint text, p256dh text, auth text)
language plpgsql
security definer
set search_path to ''
as $$
#variable_conflict use_column
begin
    if p_secret is null or p_secret is distinct from
       (select decrypted_secret from vault.decrypted_secrets where name = 'dailymind_push_secret') then
        raise exception 'forbidden' using errcode = '42501';
    end if;
    -- Zwei gleichzeitige Läufe dürfen nicht doppelt senden
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('dailymind_push_claim')) then
        return;
    end if;

    return query
    with local as (
        select s.*, (now() at time zone s.timezone) as local_now
        from public.dailymind_push_settings s
    ),
    due as (
        select l.user_id, k.kind, l.local_now::date as local_day
        from local l
        cross join lateral (values
            ('morning', l.morning_enabled, l.morning_time, l.morning_last_sent),
            ('evening', l.evening_enabled, l.evening_time, l.evening_last_sent)
        ) as k (kind, enabled, at, last_sent)
        where k.enabled
          and l.local_now::time - k.at between interval '0' and interval '59 minutes'
          and k.last_sent is distinct from l.local_now::date
          and (exists (select 1 from public.overall_app_access a where a.user_id = l.user_id and a.app_id = 'dailymind')
               or exists (select 1 from public.overall_profiles p where p.id = l.user_id and p.role = 'admin'))
          and not exists (
              select 1 from public.dailymind_entries e
              where e.user_id = l.user_id and e.entry_date = l.local_now::date
                and (case k.kind when 'morning' then e.morning_done_at else e.evening_done_at end) is not null)
    ),
    mark_morning as (
        update public.dailymind_push_settings s set morning_last_sent = d.local_day
        from due d where d.kind = 'morning' and d.user_id = s.user_id
    ),
    mark_evening as (
        update public.dailymind_push_settings s set evening_last_sent = d.local_day
        from due d where d.kind = 'evening' and d.user_id = s.user_id
    )
    select d.user_id, d.kind, p.endpoint, p.p256dh, p.auth
    from due d
    join public.dailymind_push_subscriptions p on p.user_id = d.user_id;
end;
$$;

revoke all on function public.dailymind_push_claim(text) from public, anon, authenticated;
grant execute on function public.dailymind_push_claim(text) to service_role;

commit;

-- ---------------------------------------------------------------------
-- 4. Cron: alle 5 Minuten die Edge Function anstoßen
-- ---------------------------------------------------------------------
-- cron.schedule mit gleichem Namen ersetzt einen vorhandenen Job.
select cron.schedule(
    'dailymind-push',
    '*/5 * * * *',
    $cron$
    select net.http_post(
        url     := 'https://syaonnedmidaipwjjmio.supabase.co/functions/v1/dailymind-push',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-dailymind-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dailymind_push_secret')),
        body    := '{}'::jsonb,
        timeout_milliseconds := 20000
    );
    $cron$
);

-- Abschalten (z. B. zum Testen): select cron.unschedule('dailymind-push');
