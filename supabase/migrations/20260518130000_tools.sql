-- Tools / stack inventory. Separate from exec_os_artifacts (which is for
-- documents/dashboards/workflows you produced) — this tracks the external
-- services you use. Surfaced in the Hub's Stack tab. Each row is meant to
-- answer: what does it do, why do I have it, where am I using it, what
-- does it cost, and what's its priority in my stack.

create table if not exists public.exec_os_tools (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  emoji text,
  category text not null default 'other' check (category in (
    'productivity','ai','social','analytics','payments','automation',
    'design','dev','hosting','communication','data','other'
  )),
  purpose text,
  why_kept text,
  usage_notes text,
  -- Subscription
  subscription_cost_cents int default 0,
  subscription_cycle text default 'monthly' check (subscription_cycle in (
    'monthly','annual','free','one_time','usage_based','unknown'
  )),
  subscription_status text default 'active' check (subscription_status in (
    'active','trialing','paused','canceled','churning','unknown'
  )),
  next_renewal_at date,
  -- Stack-level metadata
  priority int default 3 check (priority between 1 and 5),
  status text default 'active' check (status in (
    'active','evaluating','sunsetting','retired'
  )),
  url text,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists exec_os_tools_user_priority_idx
  on public.exec_os_tools (user_id, priority, status);

alter table public.exec_os_tools enable row level security;

drop policy if exists "own rows tools" on public.exec_os_tools;
create policy "own rows tools" on public.exec_os_tools
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists exec_os_tools_updated_at on public.exec_os_tools;
create trigger exec_os_tools_updated_at
  before update on public.exec_os_tools
  for each row execute function public.set_updated_at();

-- Migrate the 6 external-tool entries that are sitting in exec_os_artifacts
-- (TikTok, Lovable Executive OS, Make.com, Beehiiv, Blotato, Supabase Idea
-- Bank). They were never really artifacts — they were stack references in
-- the wrong table.
insert into public.exec_os_tools (
  user_id, name, emoji, category, purpose, url, status, priority
)
select
  user_id,
  title,
  emoji,
  case
    when title ilike '%tiktok%' then 'social'
    when title ilike '%lovable%' then 'dev'
    when title ilike '%make%' then 'automation'
    when title ilike '%beehiiv%' then 'communication'
    when title ilike '%blotato%' then 'social'
    when title ilike '%supabase%' then 'data'
    else 'other'
  end,
  coalesce(summary, ''),
  location,
  'active',
  3
from public.exec_os_artifacts
where location_type = 'url'
  and (
    title ilike '%tiktok%' or title ilike '%lovable%' or title ilike '%make%' or
    title ilike '%beehiiv%' or title ilike '%blotato%' or title ilike '%supabase%'
  )
on conflict do nothing;

-- Now delete those rows from artifacts since they live in tools now.
delete from public.exec_os_artifacts
where location_type = 'url'
  and (
    title ilike '%tiktok%' or title ilike '%lovable%' or title ilike '%make%' or
    title ilike '%beehiiv%' or title ilike '%blotato%' or title ilike '%supabase%'
  );
