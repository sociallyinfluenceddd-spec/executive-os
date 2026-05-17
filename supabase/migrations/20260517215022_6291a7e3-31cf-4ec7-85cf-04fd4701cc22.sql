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
drop policy if exists "anon read opted-in profiles" on public.exec_os_public_profile;
create policy "anon read opted-in profiles" on public.exec_os_public_profile for select using (share_revenue = true or share_content = true or share_clients = true);
drop policy if exists "own row all" on public.exec_os_public_profile;
create policy "own row all" on public.exec_os_public_profile for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select on public.exec_os_public_profile to anon;
create or replace view public.public_revenue_monthly with (security_invoker = true) as select r.user_id, date_trunc('month', r.entry_date)::date as month, sum(r.amount_cents)::bigint as amount_cents, count(*)::int as entries from public.exec_os_revenue r join public.exec_os_public_profile p on p.user_id = r.user_id where p.share_revenue = true group by r.user_id, date_trunc('month', r.entry_date);
grant select on public.public_revenue_monthly to anon;