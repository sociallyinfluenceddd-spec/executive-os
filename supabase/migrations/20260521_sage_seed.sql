-- Sage — Focus + Inbox Triage Agent: seed trigger row + daily cron schedule.
--
-- Runs at 5:30 AM CT daily (10:30 UTC during DST). Slightly later than
-- Cleo (5am CT) so Cleo's drafts are already in the Morning Brief when
-- Sage produces the focus directive.

insert into public.exec_os_agent_triggers (user_id, agent_id, enabled, cron_schedule, config)
select
  u.id,
  'sage',
  true,
  '30 10 * * *',  -- 10:30 UTC = 5:30am CT (DST) / 4:30am CT (standard)
  jsonb_build_object(
    'voice_examples', jsonb_build_array(
      'blunt but warm',
      'one next step, not a list',
      'no shame, no should, no must',
      'plain language',
      'PDA-sensitive'
    ),
    'pillars', jsonb_build_array(
      'anti-overwhelm',
      'AUDHD-tuned',
      'focus on ONE thing per day'
    )
  )
from auth.users u
on conflict (user_id, agent_id) do update set
  enabled = excluded.enabled,
  cron_schedule = excluded.cron_schedule,
  config = excluded.config,
  updated_at = now();

-- Schedule the cron job (idempotent — replaces by jobname).
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
      'sage-daily-530am-ct',
      '30 10 * * *',
      format($cron$
        select net.http_post(
          url := %L || '/functions/v1/sage-run',
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
