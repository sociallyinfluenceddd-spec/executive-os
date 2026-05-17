-- Add done-state to the daily top priority so the dashboard can show a
-- check-off action and compute a streak. Defaults to false so existing rows
-- aren't silently marked complete.

alter table public.exec_os_daily
  add column if not exists top_priority_done boolean not null default false;
