-- Artifact registry: ONE table for every doc, dashboard, workflow, tool,
-- migration, spec, note, or data file Donna touches across her stack
-- (Exec OS, Ideafetti, CMO consulting, Socially Influenceddd). The /hub
-- route reads from this so she has a single room that knows where
-- everything lives + when she last touched it.

create table if not exists public.exec_os_artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  emoji text,
  kind text not null check (kind in (
    'workflow', 'doc', 'dashboard', 'tool', 'migration', 'spec', 'note', 'data'
  )),
  category text not null check (category in (
    'ideafetti', 'exec_os', 'cmo_business', 'socially_influenceddd',
    'research', 'strategy', 'tools'
  )),
  location_type text not null check (location_type in (
    'url', 'file', 'embedded', 'app_route'
  )),
  location text not null,
  summary text,
  status text not null default 'active' check (status in (
    'active', 'parked', 'archived'
  )),
  is_pinned boolean not null default false,
  sort_order int not null default 0,
  last_touched timestamptz default now(),
  opened_count int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists exec_os_artifacts_user_idx
  on public.exec_os_artifacts(user_id, status, last_touched desc);

create index if not exists exec_os_artifacts_user_category_idx
  on public.exec_os_artifacts(user_id, category, status);

alter table public.exec_os_artifacts enable row level security;

create policy "own rows select art" on public.exec_os_artifacts
  for select using (auth.uid() = user_id);
create policy "own rows insert art" on public.exec_os_artifacts
  for insert with check (auth.uid() = user_id);
create policy "own rows update art" on public.exec_os_artifacts
  for update using (auth.uid() = user_id);
create policy "own rows delete art" on public.exec_os_artifacts
  for delete using (auth.uid() = user_id);

-- Updated_at trigger reusing the existing set_updated_at() function.
drop trigger if exists exec_os_artifacts_updated_at on public.exec_os_artifacts;
create trigger exec_os_artifacts_updated_at
  before update on public.exec_os_artifacts
  for each row execute function public.set_updated_at();

-- Seed Donna's known artifacts. Hardcoded to her user_id so the row appears
-- the moment she opens /hub. If the user_id below isn't a real auth.users row,
-- this insert silently no-ops (FK cascade is set up to handle deletion).
-- IMPORTANT: replace USER_ID with Donna's actual auth.users.id before applying.
-- Find with: select id from auth.users where email = 'sociallyinfluenceddd@gmail.com';
do $$
declare donna_id uuid;
begin
  select id into donna_id from auth.users
    where email = 'sociallyinfluenceddd@gmail.com'
    limit 1;
  if donna_id is null then
    raise notice 'No user found for sociallyinfluenceddd@gmail.com — skipping seed';
    return;
  end if;

  insert into public.exec_os_artifacts
    (user_id, title, emoji, kind, category, location_type, location, summary, is_pinned, sort_order)
  values
    -- Workflows (action layer)
    (donna_id, 'Ideafetti 30-Day Workflow', '🗓', 'workflow', 'ideafetti', 'file',
     '/Users/donna/AI Automator Builds/ideafetti-30-day-workflow.md',
     'Procedural action layer. Week-by-week tasks May 17–Jun 13. Forcing function: 0→1+ paying users.', true, 10),

    -- Dashboards (live state)
    (donna_id, 'Ideafetti Daily Health Check', '🩺', 'dashboard', 'ideafetti', 'file',
     '/Users/donna/AI Automator Builds/ideafetti-daily-health-check.html',
     'Auto-generated daily. Activity metrics, subscription tier breakdown, roadmap status, DB tables.', true, 20),

    (donna_id, 'Ideafetti Full Workflow Map', '🗺', 'doc', 'ideafetti', 'file',
     '/Users/donna/AI Automator Builds/ideafetti-workflow-map.html',
     '6-layer architecture map. Every tool, every step, every gap. Updated by hand after each ship.', true, 30),

    (donna_id, 'Executive OS Dashboard', '🎯', 'dashboard', 'exec_os', 'app_route',
     '/today',
     'This dashboard. Money widget, projects, content pulse, follow-ups, calendar.', true, 5),

    (donna_id, 'Executive OS Public Page', '🌍', 'dashboard', 'exec_os', 'app_route',
     '/open',
     'Public lead-magnet page (requires opt-in via exec_os_public_profile).', false, 40),

    -- Research artifacts
    (donna_id, 'Founder OS Research Deck (PPTX)', '📊', 'doc', 'research', 'file',
     '/Users/donna/AI Automator Builds/founder-os-research/executive-founder-os-research.pptx',
     '17-slide market research deck. 58 dashboards scored across 4 dimensions. Top-5 deep dives.', false, 50),

    (donna_id, 'Founder OS Research Deck (HTML Preview)', '🖼', 'doc', 'research', 'file',
     '/Users/donna/AI Automator Builds/founder-os-research/executive-founder-os-research.html',
     'Browser-viewable version of the deck.', false, 51),

    (donna_id, 'Founder OS Scoring Matrix', '📈', 'data', 'research', 'file',
     '/Users/donna/AI Automator Builds/founder-os-research/scoring-matrix.csv',
     '58 dashboards x 4 dimensions = full evidence trail for the deck.', false, 52),

    -- External tools
    (donna_id, 'Lovable — Executive OS', '✨', 'tool', 'exec_os', 'url',
     'https://lovable.dev/projects/67de2e20-ea5b-429e-b214-92f3937ebf75',
     'Build + deploy interface for this app.', false, 60),

    (donna_id, 'Supabase — Idea Bank (Ideafetti)', '🗄', 'tool', 'ideafetti', 'url',
     'https://supabase.com/dashboard/project/nsbqluctvubfqrhznhre',
     'Ideafetti backend. 28 tables, ~50 edge functions, 21 users.', false, 70),

    (donna_id, 'TikTok — @sociallydonnai', '🎬', 'tool', 'socially_influenceddd', 'url',
     'https://tiktok.com/@sociallydonnai',
     'Content channel. Top of funnel for Ideafetti + CMO consulting.', false, 80),

    (donna_id, 'Beehiiv — Socially Influenced.dd', '📰', 'tool', 'socially_influenceddd', 'url',
     'https://app.beehiiv.com/',
     'Newsletter. Currently Launch tier; Enterprise tier needed for create-post API.', false, 81),

    (donna_id, 'Make.com — Automations', '⚙️', 'tool', 'tools', 'url',
     'https://make.com/',
     'Scenarios for digest trigger + (deprecated) Blotato. 5 scenarios remain.', false, 82),

    (donna_id, 'Blotato — Multi-platform Publishing', '🚀', 'tool', 'tools', 'url',
     'https://my.blotato.com/',
     'Twitter + LinkedIn + 7 other platforms. Auto-publish runs through Blotato.', false, 83);

end $$;
