create table if not exists public.exec_os_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active','paused','done')),
  progress smallint not null default 0 check (progress >= 0 and progress <= 100),
  deadline date,
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists exec_os_projects_user_status_idx on public.exec_os_projects(user_id, status, sort_order);
alter table public.exec_os_projects enable row level security;
create policy "own rows select proj" on public.exec_os_projects for select using (auth.uid() = user_id);
create policy "own rows insert proj" on public.exec_os_projects for insert with check (auth.uid() = user_id);
create policy "own rows update proj" on public.exec_os_projects for update using (auth.uid() = user_id);
create policy "own rows delete proj" on public.exec_os_projects for delete using (auth.uid() = user_id);

create table if not exists public.exec_os_content (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  platform text not null check (platform in ('tiktok','instagram','youtube','twitter','linkedin','substack','other')),
  kind text not null check (kind in ('post','video','short','reel','story','article','script','other')),
  title text,
  url text,
  views bigint check (views is null or views >= 0),
  notes text,
  external_id text,
  created_at timestamptz not null default now()
);
create index if not exists exec_os_content_user_date_idx on public.exec_os_content(user_id, entry_date desc);
create index if not exists exec_os_content_user_platform_idx on public.exec_os_content(user_id, platform);
create unique index if not exists exec_os_content_external_uniq on public.exec_os_content(user_id, platform, external_id) where external_id is not null;
alter table public.exec_os_content enable row level security;
create policy "own rows select content" on public.exec_os_content for select using (auth.uid() = user_id);
create policy "own rows insert content" on public.exec_os_content for insert with check (auth.uid() = user_id);
create policy "own rows update content" on public.exec_os_content for update using (auth.uid() = user_id);
create policy "own rows delete content" on public.exec_os_content for delete using (auth.uid() = user_id);