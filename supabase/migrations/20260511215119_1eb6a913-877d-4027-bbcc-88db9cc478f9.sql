
create table public.exec_os_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null default current_date,
  top_priority text,
  must_move_1 text,
  must_move_2 text,
  must_move_3 text,
  energy_level int,
  mood text,
  blockers text,
  what_moved text,
  what_didnt text,
  tomorrow_seed text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entry_date)
);

create table public.exec_os_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  decision_text text not null,
  context text,
  category text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.exec_os_daily enable row level security;
alter table public.exec_os_decisions enable row level security;

create policy "own rows select daily" on public.exec_os_daily for select using (auth.uid() = user_id);
create policy "own rows insert daily" on public.exec_os_daily for insert with check (auth.uid() = user_id);
create policy "own rows update daily" on public.exec_os_daily for update using (auth.uid() = user_id);
create policy "own rows delete daily" on public.exec_os_daily for delete using (auth.uid() = user_id);

create policy "own rows select dec" on public.exec_os_decisions for select using (auth.uid() = user_id);
create policy "own rows insert dec" on public.exec_os_decisions for insert with check (auth.uid() = user_id);
create policy "own rows update dec" on public.exec_os_decisions for update using (auth.uid() = user_id);
create policy "own rows delete dec" on public.exec_os_decisions for delete using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger exec_os_daily_updated_at
before update on public.exec_os_daily
for each row execute function public.set_updated_at();
