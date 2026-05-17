-- Money widget backing table. Tracks revenue across all of Donna's streams
-- (Stripe, Gumroad, CMO retainers, TikTok creator fund, sponsorships, manual,
-- other). Keyed to auth.users; RLS gates each row to its owner.
-- Drop-safe: skipped if already present.

create table if not exists public.exec_os_revenue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  source text not null check (source in (
    'stripe', 'gumroad', 'cmo_retainer', 'tiktok', 'sponsorship', 'manual', 'other'
  )),
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'USD',
  notes text,
  external_id text, -- for future webhook idempotency (Stripe charge id, etc.)
  created_at timestamptz not null default now()
);

create index if not exists exec_os_revenue_user_date_idx
  on public.exec_os_revenue(user_id, entry_date desc);

create index if not exists exec_os_revenue_user_source_idx
  on public.exec_os_revenue(user_id, source);

-- Prevent duplicate webhook inserts once integrations land.
create unique index if not exists exec_os_revenue_external_uniq
  on public.exec_os_revenue(user_id, source, external_id)
  where external_id is not null;

alter table public.exec_os_revenue enable row level security;

create policy "own rows select rev" on public.exec_os_revenue
  for select using (auth.uid() = user_id);
create policy "own rows insert rev" on public.exec_os_revenue
  for insert with check (auth.uid() = user_id);
create policy "own rows update rev" on public.exec_os_revenue
  for update using (auth.uid() = user_id);
create policy "own rows delete rev" on public.exec_os_revenue
  for delete using (auth.uid() = user_id);
