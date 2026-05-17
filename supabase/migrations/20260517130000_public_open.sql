-- Public proof page (`/open`) backing tables + views.
-- Opt-in: a user's data only appears publicly if they have a row in
-- exec_os_public_profile with the corresponding share_* flag = true.
-- Default deny.

create table if not exists public.exec_os_public_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  tagline text,
  cta_label text default 'Book a discovery call',
  cta_url text,
  share_revenue boolean not null default false,
  share_content boolean not null default false,
  share_clients boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.exec_os_public_profile enable row level security;

-- Anyone (including anon) can read profiles that have opted in.
-- We expose the row in the SELECT policy only when at least one share flag is on;
-- this avoids leaking display_name for users who registered but never opted in.
drop policy if exists "anon read opted-in profiles" on public.exec_os_public_profile;
create policy "anon read opted-in profiles" on public.exec_os_public_profile
  for select using (
    share_revenue = true or share_content = true or share_clients = true
  );

drop policy if exists "own row all" on public.exec_os_public_profile;
create policy "own row all" on public.exec_os_public_profile
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select on public.exec_os_public_profile to anon;

-- Monthly revenue aggregate. The view filters by the profile's share_revenue flag,
-- so users who haven't opted in are silently excluded — anon can hit the view
-- safely.
create or replace view public.public_revenue_monthly
with (security_invoker = true) as
select
  r.user_id,
  date_trunc('month', r.entry_date)::date as month,
  sum(r.amount_cents)::bigint as amount_cents,
  count(*)::int as entries
from public.exec_os_revenue r
join public.exec_os_public_profile p on p.user_id = r.user_id
where p.share_revenue = true
group by r.user_id, date_trunc('month', r.entry_date);

grant select on public.public_revenue_monthly to anon;

-- For the future content/clients tiles, plug similar views in here once those
-- tables exist (exec_os_content_metrics, exec_os_cmo_clients, etc.). The
-- pattern: join through exec_os_public_profile, filter on the matching
-- share_* flag, aggregate, grant select to anon.
