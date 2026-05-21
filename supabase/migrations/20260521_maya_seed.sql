-- Maya — Build Agent: seed trigger row + daily cron schedule.
-- Runs at 5:45am CT (10:45 UTC) — after Sage (5:30) so Maya's directive
-- lands in the Morning Brief alongside the others.

insert into public.exec_os_agent_triggers (user_id, agent_id, enabled, cron_schedule, config)
select
  u.id,
  'maya',
  true,
  '45 10 * * *',  -- 10:45 UTC = 5:45am CT (DST)
  jsonb_build_object(
    'voice', jsonb_build_object(
      'tone', 'ships not advises, warm but direct',
      'forbidden', jsonb_build_array(
        'should', 'must', 'have to', 'synergy', 'leverage',
        'high impact', 'value-add', 'move the needle',
        'em dashes', 'semicolons'
      )
    ),
    'pillars', jsonb_build_array(
      'anchor to real workflow_tasks',
      'one task today, not options',
      'quote dollar_lever and time_estimate verbatim',
      'concrete next step, not vague encouragement'
    )
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
      'maya-daily-545am-ct',
      '45 10 * * *',
      format($cron$
        select net.http_post(
          url := %L || '/functions/v1/maya-run',
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
