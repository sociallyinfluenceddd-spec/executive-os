-- Server-side Google OAuth tokens for live Calendar API access.
-- Replaces the Make.com calendar pipeline (which was paused 2026-05-19 after
-- the Single-Events expansion bug filled the DB with recurring birthdays
-- spanning decades and burned an entire credit plan in a day).
--
-- Flow:
--   1. Settings UI → google-oauth-start → Google consent screen
--   2. Google → google-oauth-callback (with auth code)
--   3. Callback exchanges code for access_token + refresh_token, upserts here
--   4. fetch-calendar-events uses refresh_token to mint fresh access tokens
--      and call calendar.events.list directly — no Make.com, no cache lag
--
-- Why one row per user (not per account): for now Donna uses a single
-- primary calendar (hello@donnabdicenso.com) via her Google account. When
-- she needs multi-account, we'll add a `google_account_email` column and
-- swap the unique constraint.

create table if not exists public.exec_os_google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_account_email text not null,
  access_token text not null,
  refresh_token text not null,
  scope text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: a user can see/update their own token row, nothing else.
-- Edge functions bypass RLS via service role key, which is how the
-- callback writes and fetch-calendar-events reads. RLS here is just
-- defense-in-depth against accidental client-side queries.
alter table public.exec_os_google_tokens enable row level security;

create policy "users read own google tokens"
  on public.exec_os_google_tokens for select
  using (auth.uid() = user_id);

create policy "users delete own google tokens"
  on public.exec_os_google_tokens for delete
  using (auth.uid() = user_id);

-- updated_at trigger so we can tell when tokens were last refreshed
create or replace function public.touch_google_tokens_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists exec_os_google_tokens_touch on public.exec_os_google_tokens;
create trigger exec_os_google_tokens_touch
  before update on public.exec_os_google_tokens
  for each row execute function public.touch_google_tokens_updated_at();
