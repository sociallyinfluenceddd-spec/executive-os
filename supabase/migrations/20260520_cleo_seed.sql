-- Cleo — Sales Agent: seed trigger row + daily cron schedule.
--
-- This migration:
--   1. Ensures pg_cron + pg_net extensions exist (idempotent).
--   2. Seeds one exec_os_agent_triggers row per existing user for agent_id='cleo'.
--      Runs at 5am America/Chicago daily (10:00 UTC during DST, 11:00 UTC otherwise
--      — we use 10:00 UTC; close enough for v1).
--   3. Registers a pg_cron job that POSTs to the cleo-run edge function.
--
-- Re-running is safe: ON CONFLICT for the seed row, cron.schedule replaces by name.

-- 1. Required extensions for HTTP-from-cron
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Seed Cleo trigger for every existing user (Donna for now, future users later)
insert into public.exec_os_agent_triggers (user_id, agent_id, enabled, cron_schedule, config)
select
  u.id,
  'cleo',
  true,
  '0 10 * * *',  -- 10:00 UTC = 5am CT (DST) / 4am CT (standard)
  jsonb_build_object(
    'voice_examples', jsonb_build_array(
      'no jargon, peer tone',
      'lead with one specific observation',
      'never circle back / touch base / leverage'
    ),
    'icp', jsonb_build_object(
      'role', 'fractional CMO',
      'avoid', jsonb_build_array('agency owner', 'enterprise marketing director')
    )
  )
from auth.users u
on conflict (user_id, agent_id) do update set
  enabled = excluded.enabled,
  cron_schedule = excluded.cron_schedule,
  config = excluded.config,
  updated_at = now();

-- 3. Schedule the cron job. pg_cron's "schedule" replaces by jobname.
-- It calls the cleo-run edge function with mode=scheduled, authenticated via
-- the service role key stored in Supabase Vault / settings.
--
-- NOTE: this requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be
-- accessible as DB settings. If your Supabase project hasn't exposed them
-- as DB GUCs, swap these settings(...) calls for hardcoded values in a
-- one-off SQL run instead. (Lovable-managed projects typically have them.)

do $$
declare
  v_url text := current_setting('app.settings.supabase_url', true);
  v_key text := current_setting('app.settings.service_role_key', true);
begin
  -- Fallback to standard Supabase GUCs if app.settings.* not set
  if v_url is null or v_url = '' then
    begin
      v_url := current_setting('supabase.url', true);
    exception when others then v_url := null; end;
  end if;
  if v_key is null or v_key = '' then
    begin
      v_key := current_setting('supabase.service_role_key', true);
    exception when others then v_key := null; end;
  end if;

  -- Only schedule the cron if we successfully resolved URL + key. If not,
  -- Donna will set this up manually in the Supabase dashboard's Cron UI.
  if v_url is not null and v_key is not null then
    perform cron.schedule(
      'cleo-daily-5am-ct',
      '0 10 * * *',
      format($cron$
        select net.http_post(
          url := %L || '/functions/v1/cleo-run',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || %L
          ),
          body := jsonb_build_object('mode', 'scheduled')
        );
      $cron$, v_url, v_key)
    );
  end if;
end $$;
