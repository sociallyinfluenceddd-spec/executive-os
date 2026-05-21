-- Multi-account Google OAuth tokens.
--
-- v1 of exec_os_google_tokens used user_id as PK, meaning each user could
-- only have ONE Google account connected. Donna has 5: hello@donnabdicenso.com,
-- sociallyinfluenceddd@gmail.com, sociallydonna@gmail.com, ideafetti@gmail.com,
-- donna@dblankstyle.com. The Inbox/Calendar dropdown surfaces all 5 as
-- selectable accounts, but only one was actually pulling email.
--
-- This migration:
--   1. Drops the old user_id-only PK.
--   2. Adds a composite PK on (user_id, google_account_email).
--   3. Adds an index on user_id alone so fetch loops stay cheap.

-- Step 1: drop the existing primary key constraint. We don't know the
-- system-generated constraint name across environments, so use information_schema.
do $$
declare
  v_pk_name text;
begin
  select tc.constraint_name into v_pk_name
  from information_schema.table_constraints tc
  where tc.table_schema = 'public'
    and tc.table_name = 'exec_os_google_tokens'
    and tc.constraint_type = 'PRIMARY KEY';
  if v_pk_name is not null then
    execute format('alter table public.exec_os_google_tokens drop constraint %I', v_pk_name);
  end if;
end $$;

-- Step 2: add the composite PK.
alter table public.exec_os_google_tokens
  add constraint exec_os_google_tokens_pkey
  primary key (user_id, google_account_email);

-- Step 3: keep an index on user_id alone for fast multi-account lookups.
create index if not exists idx_exec_os_google_tokens_user
  on public.exec_os_google_tokens(user_id);
