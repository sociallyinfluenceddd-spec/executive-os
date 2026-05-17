-- Workflows: the action layer. Turns static markdown workflows into
-- live, tickable tasks in the dashboard with embedded Claude Code prompts.
-- Three tables: workflows (the container), phases (sequenced groups),
-- tasks (the actual atoms with status + claude_prompt to dispatch).

create table if not exists public.exec_os_workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  emoji text,
  category text not null check (category in (
    'ideafetti','exec_os','cmo_business','socially_influenceddd','personal'
  )),
  starts_at date,
  ends_at date,
  status text not null default 'active' check (status in (
    'active','parked','archived','done'
  )),
  forcing_function text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists exec_os_workflows_user_status_idx
  on public.exec_os_workflows(user_id, status, sort_order);

create table if not exists public.exec_os_workflow_phases (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.exec_os_workflows(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  goal text,
  starts_at date,
  ends_at date,
  status text not null default 'pending' check (status in (
    'pending','active','done','skipped'
  )),
  sort_order int not null,
  created_at timestamptz not null default now()
);

create index if not exists exec_os_workflow_phases_workflow_idx
  on public.exec_os_workflow_phases(workflow_id, sort_order);

create table if not exists public.exec_os_workflow_tasks (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references public.exec_os_workflow_phases(id) on delete cascade,
  workflow_id uuid not null references public.exec_os_workflows(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  owner text not null default 'donna' check (owner in (
    'donna','claude','lovable','both','external'
  )),
  status text not null default 'pending' check (status in (
    'pending','in_progress','done','blocked','skipped'
  )),
  blocker text,
  time_estimate text,
  dollar_lever text,
  claude_prompt text,
  done_when text,
  completed_at timestamptz,
  sort_order int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists exec_os_workflow_tasks_phase_idx
  on public.exec_os_workflow_tasks(phase_id, sort_order);
create index if not exists exec_os_workflow_tasks_user_status_idx
  on public.exec_os_workflow_tasks(user_id, status);

alter table public.exec_os_workflows enable row level security;
alter table public.exec_os_workflow_phases enable row level security;
alter table public.exec_os_workflow_tasks enable row level security;

drop policy if exists "own rows wf" on public.exec_os_workflows;
create policy "own rows wf" on public.exec_os_workflows
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows wfp" on public.exec_os_workflow_phases;
create policy "own rows wfp" on public.exec_os_workflow_phases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows wft" on public.exec_os_workflow_tasks;
create policy "own rows wft" on public.exec_os_workflow_tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists exec_os_workflows_updated_at on public.exec_os_workflows;
create trigger exec_os_workflows_updated_at
  before update on public.exec_os_workflows
  for each row execute function public.set_updated_at();

drop trigger if exists exec_os_workflow_tasks_updated_at on public.exec_os_workflow_tasks;
create trigger exec_os_workflow_tasks_updated_at
  before update on public.exec_os_workflow_tasks
  for each row execute function public.set_updated_at();
