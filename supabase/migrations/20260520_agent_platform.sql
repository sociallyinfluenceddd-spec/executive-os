-- Agent platform — the shared infrastructure for autonomous AI staff agents.
--
-- Three tables. They support every agent (Maya/Ren/Cleo/Vee/Sage/Theo)
-- without per-agent customization. New agents add a row to exec_os_agent_triggers
-- and a corresponding edge function. Everything else flows through these
-- shared rails.
--
--   exec_os_agent_triggers — configuration: which agent runs, on what cadence,
--                            what it watches. ONE row per agent per user.
--
--   exec_os_agent_runs     — execution history: every time an agent fires,
--                            we log start/end/status/error. Append-only audit.
--
--   exec_os_agent_outputs  — the morning brief queue. Each item is something
--                            an agent produced (a drafted email, a proposal
--                            outline, an outreach DM, a code PR) awaiting
--                            Donna's review. She approves, edits, or rejects.

-- =============================================================================
-- 1. TRIGGERS — per-agent configuration
-- =============================================================================
create table if not exists public.exec_os_agent_triggers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,         -- 'maya', 'ren', 'cleo', 'vee', 'sage', 'theo'
  enabled boolean not null default true,

  -- Cadence: cron expression OR null for on-demand only
  -- e.g. '0 5 * * *' = daily 5am, '0 */4 * * *' = every 4 hours
  cron_schedule text,

  -- Per-agent config blob (e.g. Cleo's ICP filter, Ren's content pillars).
  -- Schema is agent-specific; each edge function knows what to look for.
  config jsonb not null default '{}'::jsonb,

  -- When this agent last ran successfully + next planned run
  last_run_at timestamptz,
  next_run_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, agent_id)
);

alter table public.exec_os_agent_triggers enable row level security;
drop policy if exists "users manage own agent triggers" on public.exec_os_agent_triggers;
create policy "users manage own agent triggers"
  on public.exec_os_agent_triggers
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =============================================================================
-- 2. RUNS — execution history (append-only audit log)
-- =============================================================================
create table if not exists public.exec_os_agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  trigger_id uuid references public.exec_os_agent_triggers(id) on delete set null,

  -- 'scheduled' | 'manual' | 'event'
  trigger_kind text not null default 'scheduled',

  -- 'running' | 'succeeded' | 'failed' | 'no_op' (ran but produced nothing)
  status text not null default 'running',

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  -- Summary the agent writes about what it did this run
  summary text,
  -- Error message if status = 'failed'
  error text,

  -- How many outputs this run produced
  outputs_count int not null default 0,

  -- Cost tracking (LLM tokens, etc.)
  cost_usd numeric(10, 4) not null default 0,
  tokens_in int not null default 0,
  tokens_out int not null default 0,

  -- For agents that read external state at run start, snapshot what they saw
  -- (e.g. inbox count, leads owed follow-up). Helps debug "why did the agent
  -- pick this action this morning."
  context jsonb default '{}'::jsonb
);

create index if not exists idx_exec_os_agent_runs_user_started
  on public.exec_os_agent_runs(user_id, started_at desc);
create index if not exists idx_exec_os_agent_runs_agent
  on public.exec_os_agent_runs(agent_id, started_at desc);

alter table public.exec_os_agent_runs enable row level security;
drop policy if exists "users read own agent runs" on public.exec_os_agent_runs;
create policy "users read own agent runs"
  on public.exec_os_agent_runs
  for select
  using (auth.uid() = user_id);

-- =============================================================================
-- 3. OUTPUTS — the morning brief queue (drafts awaiting review)
-- =============================================================================
create table if not exists public.exec_os_agent_outputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  run_id uuid references public.exec_os_agent_runs(id) on delete set null,

  -- 'draft_email' | 'draft_dm' | 'draft_proposal' | 'draft_content' |
  -- 'follow_up' | 'pr_proposal' | 'decision_recommendation' | 'insight' | etc.
  kind text not null,

  -- Short label for the morning brief list ("Reply to Marie", "DM to John re: lead gen")
  title text not null,

  -- The actual draft / output content. Markdown for emails/posts/proposals.
  body text,

  -- 'pending' | 'approved' | 'rejected' | 'edited' | 'sent' | 'archived'
  status text not null default 'pending',

  -- Optional link to another record this output references
  -- (e.g. a client_id, lead_id, task_id, post_id). Loose FK on purpose —
  -- different agents reference different tables.
  ref_table text,
  ref_id uuid,

  -- Priority for sorting in the morning brief (0 = lowest, 100 = drop-everything)
  priority int not null default 50,

  -- Suggested send/post/ship time (e.g. Cleo's optimal-DM-send-window)
  suggested_at timestamptz,

  -- Action audit
  acted_at timestamptz,
  acted_by text,                 -- 'donna' | 'auto' (if agent self-approved low-risk actions)
  edit_diff text,                -- if Donna edited before approving, store her diff for agent learning

  -- Extra agent-specific metadata
  metadata jsonb default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_exec_os_agent_outputs_user_status
  on public.exec_os_agent_outputs(user_id, status, priority desc, created_at desc);
create index if not exists idx_exec_os_agent_outputs_run
  on public.exec_os_agent_outputs(run_id);

alter table public.exec_os_agent_outputs enable row level security;
drop policy if exists "users manage own agent outputs" on public.exec_os_agent_outputs;
create policy "users manage own agent outputs"
  on public.exec_os_agent_outputs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =============================================================================
-- TRIGGER FUNCTION — keep updated_at fresh on triggers config
-- =============================================================================
create or replace function public.touch_agent_triggers_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists exec_os_agent_triggers_touch on public.exec_os_agent_triggers;
create trigger exec_os_agent_triggers_touch
  before update on public.exec_os_agent_triggers
  for each row execute function public.touch_agent_triggers_updated_at();
