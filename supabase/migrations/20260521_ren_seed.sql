-- Ren — Content Agent: seed trigger row + daily cron schedule.
-- Runs 6am CT (11 UTC) — after Cleo (5am) and Sage (5:30am) so the
-- Morning Brief has the full overnight queue ready by 6.

insert into public.exec_os_agent_triggers (user_id, agent_id, enabled, cron_schedule, config)
select
  u.id,
  'ren',
  true,
  '0 11 * * *',  -- 11 UTC = 6am CT (DST) / 5am CT (standard)
  jsonb_build_object(
    'voice', jsonb_build_object(
      'tone', 'brutally honest, ND-coded, no jargon',
      'forbidden', jsonb_build_array('literally', 'synergy', 'leverage', '10x', 'value-add', 'em dashes'),
      'hook_style', 'contrarian + specific + named'
    ),
    'audience', jsonb_build_array('fractional CMOs', 'ND founders'),
    'platform', 'tiktok',
    'hooks_per_run', 3
  )
from auth.users u
on conflict (user_id, agent_id) do update set
  enabled = excluded.enabled,
  cron_schedule = excluded.cron_schedule,
  config = excluded.config,
  updated_at = now();

do $$
declare
  v_url text := current_setting('app.settings.supabase_url', true);
  v_key text := current_setting('app.settings.service_role_key', true);
begin
  if v_url is null or v_url = '' then
    begin v_url := current_setting('supabase.url', true);
    exception when others then v_url := null; end;
  end if;
  if v_key is null or v_key = '' then
    begin v_key := current_setting('supabase.service_role_key', true);
    exception when others then v_key := null; end;
  end if;

  if v_url is not null and v_key is not null then
    perform cron.schedule(
      'ren-daily-6am-ct',
      '0 11 * * *',
      format($cron$
        select net.http_post(
          url := %L || '/functions/v1/ren-run',
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
