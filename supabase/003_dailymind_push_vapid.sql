-- =====================================================================
-- DailyMind – VAPID-Schlüssel für Web Push im Vault
-- ---------------------------------------------------------------------
-- Rein additiv: nur eine neue Funktion, keine Tabellenänderung.
--
-- Die Edge Function "dailymind-push" erzeugt beim ersten Start ein
-- Schlüsselpaar und übergibt es hier. Gibt es schon eines, bleibt das alte
-- (sonst wären alle bestehenden Geräte-Abos ungültig). Zurück kommt immer
-- das gespeicherte Paar. So muss niemand Schlüssel erzeugen oder abtippen.
-- =====================================================================

create or replace function public.dailymind_push_vapid(p_public text, p_private text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dailymind_push_vapid'));
    if not exists (select 1 from vault.secrets where name = 'dailymind_vapid_private') then
        perform vault.create_secret(p_public, 'dailymind_vapid_public', 'DailyMind: öffentlicher VAPID-Schlüssel');
        perform vault.create_secret(p_private, 'dailymind_vapid_private', 'DailyMind: privater VAPID-Schlüssel');
    end if;
    return jsonb_build_object(
        'public_key',  (select decrypted_secret from vault.decrypted_secrets where name = 'dailymind_vapid_public'),
        'private_key', (select decrypted_secret from vault.decrypted_secrets where name = 'dailymind_vapid_private'));
end;
$$;

revoke all on function public.dailymind_push_vapid(text, text) from public, anon, authenticated;
grant execute on function public.dailymind_push_vapid(text, text) to service_role;
