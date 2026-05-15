-- Kitchen + Recipes widget tables.
-- Stores recipes (per meal type, optional schedule + prep notes) and the
-- shopping list. Both keyed to auth.users; RLS lets each user see only
-- their own rows. Drop-safe: skipped if already present.

create table if not exists public.exec_os_kitchen_recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  meal_type text not null check (meal_type in ('breakfast','lunch','dinner','snack')),
  ingredients jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  prep_notes text,
  scheduled_for date,
  source text default 'manual',
  created_at timestamptz not null default now()
);

create index if not exists exec_os_kitchen_recipes_user_scheduled_idx
  on public.exec_os_kitchen_recipes(user_id, scheduled_for);

create table if not exists public.exec_os_kitchen_shopping (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item text not null,
  qty text,
  category text not null default 'Pantry',
  checked boolean not null default false,
  source text default 'manual',
  recipe_id uuid references public.exec_os_kitchen_recipes(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists exec_os_kitchen_shopping_user_checked_idx
  on public.exec_os_kitchen_shopping(user_id, checked, category);

alter table public.exec_os_kitchen_recipes enable row level security;
alter table public.exec_os_kitchen_shopping enable row level security;

create policy "own rows select rec" on public.exec_os_kitchen_recipes for select using (auth.uid() = user_id);
create policy "own rows insert rec" on public.exec_os_kitchen_recipes for insert with check (auth.uid() = user_id);
create policy "own rows update rec" on public.exec_os_kitchen_recipes for update using (auth.uid() = user_id);
create policy "own rows delete rec" on public.exec_os_kitchen_recipes for delete using (auth.uid() = user_id);

create policy "own rows select shp" on public.exec_os_kitchen_shopping for select using (auth.uid() = user_id);
create policy "own rows insert shp" on public.exec_os_kitchen_shopping for insert with check (auth.uid() = user_id);
create policy "own rows update shp" on public.exec_os_kitchen_shopping for update using (auth.uid() = user_id);
create policy "own rows delete shp" on public.exec_os_kitchen_shopping for delete using (auth.uid() = user_id);
