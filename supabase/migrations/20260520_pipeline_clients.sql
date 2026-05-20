-- Pipeline + Client layer — the business foundation.
--
-- The 1000x unlock: every other agent (Cleo for sales, future agents for
-- retention/billing/reporting) operates on these tables. The Money widget
-- becomes meaningful when revenue is per-client. The dashboard becomes
-- sellable when "client" is a first-class entity.
--
-- 4 tables, single status field on clients (no separate leads/clients
-- table — one entity flows through the pipeline by status).

-- =============================================================================
-- 1. CLIENTS — one row per human (lead → active → churned, all stages)
-- =============================================================================
create table if not exists public.exec_os_clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Pipeline stage
  status text not null default 'lead'
    check (status in (
      'lead',           -- raw inbound or surfaced by Cleo
      'contacted',      -- first DM/email sent
      'qualified',      -- responded, fits ICP
      'proposal_sent',  -- proposal out, awaiting decision
      'active',         -- closed, paying
      'paused',         -- temporary stop
      'churned',        -- gone
      'lost'            -- pre-close loss (didn't qualify, ghosted, etc.)
    )),

  -- Identity
  name text not null,
  company text,
  title text,                              -- e.g. "Fractional CMO at Loop Labs"
  primary_contact_email text,
  linkedin_url text,

  -- Tagging + classification
  tags text[] default '{}',                -- e.g. {fractional_cmo, ai_curious, austin}
  icp_score numeric(3,2),                  -- 0.00-1.00, how well they match ICP
  source text,                             -- "linkedin_inbound" | "referral" | "cold_outreach" | "tiktok" | etc.

  -- Money
  one_time_value_cents int not null default 0,   -- DWY build fee
  mrr_cents int not null default 0,              -- recurring revenue if active

  -- Linked external customer ids (for revenue auto-log later)
  external_stripe_customer_id text,
  external_ls_customer_id text,

  -- Engagement tracking
  acquired_at timestamptz,                 -- when status went to 'active'
  last_touchpoint_at timestamptz,
  next_action_at timestamptz,              -- when to follow up
  next_action_kind text,                   -- "follow_up" | "send_proposal" | "check_in" | etc.

  -- Free-form
  notes text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_exec_os_clients_user_status
  on public.exec_os_clients(user_id, status, next_action_at nulls last);
create index if not exists idx_exec_os_clients_next_action
  on public.exec_os_clients(user_id, next_action_at)
  where next_action_at is not null and status not in ('churned', 'lost');

alter table public.exec_os_clients enable row level security;
drop policy if exists "users manage own clients" on public.exec_os_clients;
create policy "users manage own clients"
  on public.exec_os_clients for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =============================================================================
-- 2. OUTREACH — touchpoint log (every interaction)
-- =============================================================================
create table if not exists public.exec_os_outreach (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.exec_os_clients(id) on delete cascade,

  channel text not null
    check (channel in ('linkedin', 'email', 'sms', 'call', 'meeting', 'dm', 'other')),
  direction text not null default 'outbound'
    check (direction in ('outbound', 'inbound')),

  subject text,
  body text,

  status text not null default 'drafted'
    check (status in ('drafted', 'queued', 'sent', 'delivered', 'opened', 'replied', 'no_response', 'bounced')),

  -- If an agent drafted this (Cleo etc.), tracks attribution
  generated_by_agent_id text,
  -- Whether human approval was required before send (vs. auto-sent low-risk)
  approval_required boolean not null default true,
  -- Link to the agent_output row that produced this draft (so we can show diff)
  source_agent_output_id uuid references public.exec_os_agent_outputs(id) on delete set null,

  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  replied_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_exec_os_outreach_user_client
  on public.exec_os_outreach(user_id, client_id, created_at desc);
create index if not exists idx_exec_os_outreach_user_status
  on public.exec_os_outreach(user_id, status, sent_at desc);

alter table public.exec_os_outreach enable row level security;
drop policy if exists "users manage own outreach" on public.exec_os_outreach;
create policy "users manage own outreach"
  on public.exec_os_outreach for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =============================================================================
-- 3. PROPOSALS — quotes / scopes sent to prospects
-- =============================================================================
create table if not exists public.exec_os_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.exec_os_clients(id) on delete cascade,

  title text not null,
  scope_summary text,
  body text,                               -- full proposal markdown / html

  one_time_cents int not null default 0,
  mrr_cents int not null default 0,
  retainer_months int,                     -- nullable: months of retainer if proposed

  status text not null default 'draft'
    check (status in ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn')),

  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  expires_at timestamptz,

  -- External proposal tool linkage (PandaDoc, Bonsai, custom HTML, etc.)
  external_url text,
  external_id text,

  generated_by_agent_id text,
  source_agent_output_id uuid references public.exec_os_agent_outputs(id) on delete set null,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_exec_os_proposals_user_client
  on public.exec_os_proposals(user_id, client_id, created_at desc);
create index if not exists idx_exec_os_proposals_status
  on public.exec_os_proposals(user_id, status, sent_at desc);

alter table public.exec_os_proposals enable row level security;
drop policy if exists "users manage own proposals" on public.exec_os_proposals;
create policy "users manage own proposals"
  on public.exec_os_proposals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =============================================================================
-- 4. CLIENT MILESTONES — the 90-day success framework
-- =============================================================================
create table if not exists public.exec_os_client_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.exec_os_clients(id) on delete cascade,

  week_number int not null check (week_number between 1 and 52),
  title text not null,
  description text,

  -- Optional KPI tracking
  kpi_name text,
  target_value numeric,
  actual_value numeric,
  kpi_unit text,                           -- "$", "%", "leads", etc.

  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'completed', 'missed', 'skipped')),

  due_at date,
  completed_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_exec_os_client_milestones_client_week
  on public.exec_os_client_milestones(client_id, week_number);
create index if not exists idx_exec_os_client_milestones_user_due
  on public.exec_os_client_milestones(user_id, due_at)
  where status in ('planned', 'in_progress');

alter table public.exec_os_client_milestones enable row level security;
drop policy if exists "users manage own client milestones" on public.exec_os_client_milestones;
create policy "users manage own client milestones"
  on public.exec_os_client_milestones for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =============================================================================
-- TRIGGER — keep updated_at fresh on clients + proposals
-- =============================================================================
create or replace function public.touch_clients_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists exec_os_clients_touch on public.exec_os_clients;
create trigger exec_os_clients_touch
  before update on public.exec_os_clients
  for each row execute function public.touch_clients_updated_at();

drop trigger if exists exec_os_proposals_touch on public.exec_os_proposals;
create trigger exec_os_proposals_touch
  before update on public.exec_os_proposals
  for each row execute function public.touch_clients_updated_at();
