-- Seed the Ideafetti 30-Day Workflow (May 17 - Jun 13) as structured rows
-- with self-contained Claude Code prompts in claude_prompt field.
-- Each task can be dispatched to Donna's Claude Code terminal via the
-- WorkflowsWidget's "Send to Claude" button (copies prompt to clipboard).

do $$
declare
  donna_id uuid;
  wf_id uuid;
  p0_id uuid;
  p1_id uuid;
  p2_id uuid;
  p3_id uuid;
  p4_id uuid;
begin
  select id into donna_id from auth.users
    where email = 'sociallyinfluenceddd@gmail.com' limit 1;
  if donna_id is null then raise notice 'no donna'; return; end if;

  -- Idempotency: skip if already seeded
  if exists (select 1 from public.exec_os_workflows where user_id = donna_id and name = 'Ideafetti 30-Day Build') then
    raise notice 'already seeded';
    return;
  end if;

  -- WORKFLOW
  insert into public.exec_os_workflows
    (user_id, name, emoji, category, starts_at, ends_at, status, forcing_function, sort_order)
  values
    (donna_id, 'Ideafetti 30-Day Build', '🗓', 'ideafetti', '2026-05-17', '2026-06-13', 'active',
     '0 paying users. Every task makes 0 → 1+ happen, or ships a proof point that justifies asking.', 10)
  returning id into wf_id;

  -- PHASE 0: Today (security + cleanup)
  insert into public.exec_os_workflow_phases
    (workflow_id, user_id, name, goal, starts_at, ends_at, status, sort_order)
  values
    (wf_id, donna_id, 'Today · Security + cleanup', 'Two quick safety fixes before the 30-day push starts.',
     '2026-05-17', '2026-05-17', 'active', 0)
  returning id into p0_id;

  -- PHASE 1: Week 1 - Ship LinkedIn end-to-end
  insert into public.exec_os_workflow_phases
    (workflow_id, user_id, name, goal, starts_at, ends_at, status, sort_order)
  values
    (wf_id, donna_id, 'Week 1 · Ship LinkedIn end-to-end',
     'A real, autonomously-published LinkedIn post on @sociallydonnai by Sunday May 23.',
     '2026-05-17', '2026-05-23', 'pending', 1)
  returning id into p1_id;

  -- PHASE 2: Week 2 - Recruit 5 beta users
  insert into public.exec_os_workflow_phases
    (workflow_id, user_id, name, goal, starts_at, ends_at, status, sort_order)
  values
    (wf_id, donna_id, 'Week 2 · Recruit 5 beta users',
     '5 named humans onboarded + 5 willingness-to-pay data points by Sun May 30.',
     '2026-05-24', '2026-05-30', 'pending', 2)
  returning id into p2_id;

  -- PHASE 3: Week 3 - Voice profile in onboarding
  insert into public.exec_os_workflow_phases
    (workflow_id, user_id, name, goal, starts_at, ends_at, status, sort_order)
  values
    (wf_id, donna_id, 'Week 3 · Voice profile in onboarding',
     'Every new user feeds 3-5 voice samples in their first 5 minutes. Fixes #1 churn risk.',
     '2026-05-31', '2026-06-06', 'pending', 3)
  returning id into p3_id;

  -- PHASE 4: Week 4 - Cleanup + first paid
  insert into public.exec_os_workflow_phases
    (workflow_id, user_id, name, goal, starts_at, ends_at, status, sort_order)
  values
    (wf_id, donna_id, 'Week 4 · Cleanup + first paid',
     '1+ paying user. 5 Lovable bugs closed. Beehiiv decided. LemonSqueezy proven end-to-end.',
     '2026-06-07', '2026-06-13', 'pending', 4)
  returning id into p4_id;

  -- PHASE 0 TASKS
  insert into public.exec_os_workflow_tasks
    (phase_id, workflow_id, user_id, title, description, owner, time_estimate, dollar_lever, claude_prompt, done_when, sort_order)
  values
    (p0_id, wf_id, donna_id,
     'Enable RLS on debug_logs',
     'The debug_logs table in the Ideafetti Supabase project has RLS disabled. Anyone with the anon key can read or modify every log row. Single-line fix.',
     'claude', '10 min', 'Trust + safety',
     'Connect to the Ideafetti Supabase project (project_id nsbqluctvubfqrhznhre, "Idea Bank"). Use the Supabase MCP to run: ALTER TABLE public.debug_logs ENABLE ROW LEVEL SECURITY; then add a service-role-only SELECT/INSERT policy so internal logging still works but the anon key cannot read. After applying, run list_tables and confirm debug_logs no longer shows the rls_disabled advisory. Report back with the policies you added.',
     'list_tables on Ideafetti project returns no rls_disabled advisory for debug_logs.', 1),
    (p0_id, wf_id, donna_id,
     'Update marketing site integration dates',
     'ideafetti.com still shows "Q1 2025"/"Q2 2025"/"Q3 2025" dates for Notion, Google Docs, Slack, Zapier, Figma, Linear, Airtable, Calendar integrations. It is now May 2026 — visitors notice and bounce.',
     'lovable', '30 min', 'Trust — bounce rate on marketing site',
     'Open the ideafetti.com Lovable project. Edit the integrations section to remove all specific quarter/year dates. Replace each with "On the roadmap" or remove the date pill entirely. Do not change any other section. Verify on the live site that no "Q1 2025" / "Q2 2025" / "Q3 2025" strings remain.',
     'No stale dates visible on ideafetti.com integrations section.', 2);

  -- PHASE 1 TASKS (Week 1)
  insert into public.exec_os_workflow_tasks
    (phase_id, workflow_id, user_id, title, description, owner, time_estimate, dollar_lever, claude_prompt, done_when, sort_order)
  values
    (p1_id, wf_id, donna_id,
     'Deploy local generate edge fn to Supabase',
     'The local supabase/functions/generate/index.ts has unpublished LinkedIn prompts (linkedin_viral + linkedin_founder) authored May 9-10. Until deployed, the LinkedIn button in Lovable falls back to short_script.',
     'claude', '20 min', 'Unblocks the entire LinkedIn pipeline',
     'Navigate to the Ideafetti repo on disk. Authenticate with supabase CLI (supabase link --project-ref nsbqluctvubfqrhznhre if not already). Run: supabase functions deploy generate. After deploy, fetch the new version number via the Supabase MCP list_edge_functions on project nsbqluctvubfqrhznhre and confirm the generate function version incremented. Then test by inserting a content_pieces row with content_type=''linkedin_founder'' and verifying the AI output looks like a LinkedIn post (1300-1500 chars, Justin-Welsh-style hook).',
     'generate edge function version incremented in Supabase + a linkedin_founder test row produced LinkedIn-shaped output.', 1),
    (p1_id, wf_id, donna_id,
     'Verify queued LinkedIn post fires via tick_publish_queue',
     'Content piece a39673ff-79e7-442e-8ca4-4a480b4b20c2 (linkedin_founder) was queued May 10 waiting for cron. Once generate edge fn deploys, pg_cron should pick it up within 60s.',
     'claude', '5 min watching', 'Proves end-to-end LinkedIn pipeline',
     'On the Ideafetti Supabase project nsbqluctvubfqrhznhre, run: select id, platform, schedule_status, is_published, published_url, scheduled_at from public.content_pieces where id = ''a39673ff-79e7-442e-8ca4-4a480b4b20c2''; If is_published is true and published_url contains linkedin.com, the pipeline worked. If still queued/false, check pg_cron logs (select * from cron.job_run_details order by start_time desc limit 5) and the send-to-blotato edge fn logs for that piece.',
     'a39673ff row shows is_published=true with a real LinkedIn URL.', 2),
    (p1_id, wf_id, donna_id,
     'Lovable UI: split LinkedIn tile into tone picker',
     'DashboardFormatPicker.tsx currently has one LinkedIn option. Need two tones (Viral / Founder) mapped to linkedin_viral and linkedin_founder slugs in contentTypes.ts.',
     'lovable', '15 min (1 Lovable prompt)', 'Users need this picker to generate the right tone',
     'In Lovable, ask: "Split the LinkedIn tile in DashboardFormatPicker.tsx into two options: ''LinkedIn Viral'' (slug: linkedin_viral, 💼 emoji, brief: Justin-Welsh-style hook + insight + CTA, 1300-1500 chars) and ''LinkedIn Founder'' (slug: linkedin_founder, 🌱 emoji, brief: build-in-public ND-creator voice, 800-1300 chars). Add both slugs to contentTypes.ts platform mapping (both map to ''linkedin''). Do not change any other UI. Verify both buttons exist in /publish/queue after the change."',
     'Two LinkedIn tone buttons visible in DashboardFormatPicker; both generate LinkedIn-shaped content with distinct tones.', 3),
    (p1_id, wf_id, donna_id,
     'Update Workflow Map HTML banner with LinkedIn LIVE milestone',
     'The manually-maintained HTML map needs a new entry reflecting the LinkedIn end-to-end ship for the week.',
     'donna', '5 min', 'Keeps your reference doc honest',
     'Open the Ideafetti Workflow Map HTML file. Find the Manual Update block near the top. Add a new dated block (May ??) noting: LinkedIn auto-publish LIVE end-to-end — generate edge fn deployed, first auto-post fired via tick_publish_queue, Lovable UI tone picker shipped. Include the LinkedIn post URL once the queued post lands.',
     'Workflow Map HTML reflects this week''s LinkedIn ship with dated entry.', 4);

  -- PHASE 2 TASKS (Week 2)
  insert into public.exec_os_workflow_tasks
    (phase_id, workflow_id, user_id, title, description, owner, time_estimate, dollar_lever, claude_prompt, done_when, sort_order)
  values
    (p2_id, wf_id, donna_id,
     'Build the 20-name beta candidate list',
     'You only need 5 conversions but expect ~25% close rate, so start with 20 named candidates. ND creators, content-overload founders, people you have a thread of trust with.',
     'donna', '1 hour', 'Top-of-funnel for paid validation',
     'Create a spreadsheet (or new exec_os_beta_candidates table — your call) with 20 rows. Each row: name, handle, why-they-fit (one sentence), how-you-know-them, channel-to-DM. Pull from your TikTok followers, Skool, prior network. ND-friendly tip: list 5 then take a 10-min break, then list 5 more.',
     'Spreadsheet or table has 20 rows, each with all 5 fields populated.', 1),
    (p2_id, wf_id, donna_id,
     'Write the beta DM template',
     'One short message (~5 lines): what Ideafetti does, why this person specifically, 90 days free, ask for 30-min onboarding call. Variable: their content niche + one specific friction point you have seen them mention publicly.',
     'donna', '45 min', 'Without a written DM you freelance every reach-out and lose an afternoon per person',
     'Draft a 5-line DM template. Open: name + one specific reference to their work (so it does not feel automated). Middle: what Ideafetti does in one sentence. Close: 90 days free for beta feedback + ask for 30-min onboarding call. Variables to leave in brackets: [name], [their_niche], [specific_friction]. Save it where you can copy-paste fast. Optional: ask Claude in another tab to draft 3 variants and pick the one that sounds most like you.',
     'DM template saved + tested by reading it out loud — does it sound like you, or like a marketer?', 2),
    (p2_id, wf_id, donna_id,
     'Send 20 customized DMs',
     'Pure top-of-funnel work. 12 min per DM if you customize cleanly. Track replies.',
     'donna', '4 hours over the week', 'Direct lever on 5 beta yeses',
     'For each candidate, copy the DM template, fill in [name] + [their_niche] + [specific_friction] from their public content. Send. Log each in your candidates spreadsheet with sent_at timestamp. Track reply status as: sent / replied / scheduled / declined / ghost. Be ruthless about the 12-min budget — if you spend 30+ min researching one person you are doing the wrong job.',
     'All 20 DMs sent and logged.', 3),
    (p2_id, wf_id, donna_id,
     'Onboard the first 5 yeses with the pricing question',
     '5 onboarding calls (30 min each). The single most important question per call: "If Ideafetti shipped exactly this for the next year, what would you pay per month — $0, $19, $29, $69, more?"',
     'donna', '2.5 hours over the week', 'Kills the "pricing is theoretical" gap from your strategy doc',
     'Call script: (1) 5-min intro to Ideafetti, demo the capture flow + Humanizer. (2) Have them log in live and create their first idea. (3) Show them generate-with-humanization on it. (4) THE QUESTION asked literally: "If Ideafetti shipped exactly this for the next year, what would you pay per month — $0, $19, $29, $69, more?" + follow-up: "What would you need to see to pay more?" (5) Get their email + add them with subscription_plan flag = beta_free for 90 days. Log all 5 answers verbatim in a new exec_os_beta_pricing_data table or your candidates spreadsheet.',
     '5 users onboarded with subscription_plan=beta_free + 5 pricing answers logged verbatim.', 4);

  -- PHASE 3 TASKS (Week 3)
  insert into public.exec_os_workflow_tasks
    (phase_id, workflow_id, user_id, title, description, owner, time_estimate, dollar_lever, claude_prompt, done_when, sort_order)
  values
    (p3_id, wf_id, donna_id,
     'Migration: voice_samples table',
     'New table for capturing 3-5 voice samples per user during onboarding. Feeds Humanizer immediately. RLS gated.',
     'claude', '15 min', 'Schema for the feature gate',
     'On the Ideafetti Supabase project nsbqluctvubfqrhznhre, apply this migration via Supabase MCP apply_migration: CREATE TABLE public.voice_samples (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, sample_text text, audio_url text, transcript text, source text not null default ''onboarding'' check (source in (''onboarding'',''manual'',''tiktok_import'',''generated_review'')), created_at timestamptz default now()); plus RLS policies (own rows for all CRUD). Verify by inserting a test row and selecting it back.',
     'voice_samples table exists with RLS + 1 test row inserts and reads successfully.', 1),
    (p3_id, wf_id, donna_id,
     'Lovable UI: 3 voice prompts in onboarding flow',
     'Right after sign-up, show 3 prompts: "What is a thing you say all the time?" / "Paste a tweet/post you wrote that performed well" / "Record 30 seconds explaining your work". Saves to voice_samples + triggers seed-voice-profile edge fn (already deployed).',
     'lovable', '30 min (1 Lovable prompt)', 'Output quality is the moat — voice profile feeds Humanizer',
     'In Lovable, ask: "Add a 3-step voice onboarding flow after first sign-up. Step 1: ''What is a thing you say all the time?'' text input. Step 2: ''Paste a tweet or post you wrote that performed well'' textarea. Step 3: ''Record 30 seconds explaining your work'' — use the existing voice-transcription edge function for capture + transcription. All three save to public.voice_samples with source=''onboarding''. After step 3, invoke the seed-voice-profile edge function with the user_id. Block dashboard access until all 3 steps complete on first sign-up; show a clean skip-and-do-later link too. Do not change existing onboarding for returning users."',
     'New users see 3 voice prompts before dashboard; voice_samples rows + user_voice_profiles row created.', 2),
    (p3_id, wf_id, donna_id,
     'Backfill the 5 beta users with voice samples',
     'Ping each beta user, ask them to paste 3 samples directly. Their next Ideafetti generation should sound visibly more like them.',
     'donna', '50 min total (5 × 10 min)', 'Activates the feature gate for the 5 most important users',
     'For each of the 5 beta users from week 2: send a short DM ("Quick favor for the beta — paste me 3 short things: (1) a phrase you say all the time, (2) a high-performing post you wrote, (3) a tweet that sounds like you talking to a friend. I will train your voice profile from these"). When they reply, insert 3 voice_samples rows for that user_id with source=''manual''. Then re-trigger seed-voice-profile for that user. Verify with a fresh generation that the Humanizer output sounds different from before.',
     'All 5 beta users have ≥3 voice_samples + can demonstrate a generation that sounds like them.', 3);

  -- PHASE 4 TASKS (Week 4)
  insert into public.exec_os_workflow_tasks
    (phase_id, workflow_id, user_id, title, description, owner, time_estimate, dollar_lever, claude_prompt, done_when, sort_order)
  values
    (p4_id, wf_id, donna_id,
     'Fix the 5 unverified Lovable UI bugs from May 8',
     'TikTok-button-on-Twitter-card, idea duplication on save, 4-button row layout, Drafts tab on /publish/queue, Idea Assistant button rename, LIVE/INACTIVE badge mismatch.',
     'lovable', '1 hour (1 Lovable prompt)', 'Trust — users hit these before they ever see Publish Now work',
     'In Lovable, ask: "Fix these 5 known UI bugs in one pass: (1) Twitter content cards show a TikTok-style platform button — should be Twitter-only. (2) Saving an idea sometimes duplicates the card — investigate the save handler and ensure single insert. (3) Content card 4-button row has overflow on narrow screens — wrap or scroll. (4) /publish/queue Drafts tab is empty / not rendering — verify the query for is_published=false AND schedule_status IS NULL. (5) Idea Assistant button needs renaming (current label is stale — check with me on the new label). (6) LIVE/INACTIVE badge on content cards shows INACTIVE for queued posts — should show LIVE when schedule_status=queued and is_published=false. Verify each fix on Donna''s preview before declaring done."',
     'All 5 bugs verified fixed in Lovable preview by Donna.', 1),
    (p4_id, wf_id, donna_id,
     'Make the Beehiiv decision',
     'Three paths: (a) upgrade to Enterprise $300+/mo, (b) commit to manual paste as the official workflow, (c) kill newsletter offering. Each costs differently — pick and commit.',
     'donna', '30 min thinking + 15 min implementing', 'Closes one of your biggest open decision loops',
     'Compare your 5 beta users'' answers to "do you care about newsletter publishing?" If 3+ said yes, upgrade or commit to manual paste. If 0-2 said yes, kill the newsletter offering entirely (remove from marketing site + content type dropdown). Whichever path you pick, update the Workflow Map HTML banner to reflect the decision so it stops being an open loop. If you pick manual paste, document the exact paste workflow in the Hub as a new artifact.',
     'Decision committed in writing + Workflow Map updated + (if killed) newsletter content_type removed from UI.', 2),
    (p4_id, wf_id, donna_id,
     'Ask the 5 beta users to convert to paid',
     'Direct ask 3 weeks in: "I am turning on paid tiers. Which plan?" Whoever says yes — guide them through LemonSqueezy checkout.',
     'donna', '5 × 15 min calls', 'The single biggest number on the whole dashboard — first $1 of MRR',
     'For each of the 5 beta users: send a short DM ("It is week 3. I am turning on paid tiers. Based on what we talked about, you said you would pay [their_amount]. I am offering you that for the first 6 months — usually it is [list_price]. Want to lock it in?"). If they say yes, send them the LemonSqueezy checkout link for their tier. If they say no — ask "What would have to be true for you to pay?" and log the answer. Convert at least 1.',
     '1+ paid user via LemonSqueezy + 4 non-conversion reasons logged.', 3),
    (p4_id, wf_id, donna_id,
     'Verify LemonSqueezy webhook end-to-end with a real event',
     'lemonsqueezy-webhook v172 has never been called with a real LemonSqueezy event. The first paid signup will test it for real.',
     'claude', '0 min if conversion works, 30 min if it does not', 'Validates full revenue plumbing for the first time',
     'When the first paid signup happens, immediately on the Ideafetti Supabase project nsbqluctvubfqrhznhre run: select event_type, processed_at, error_message from public.email_log order by created_at desc limit 5; (or wherever webhook events are logged). Then check: select id, subscription_status, plan_id from public.profiles where id = ''<the_paying_user_id>''. If subscription_status went from ''free'' to ''pro''/''creator''/''team'' and webhook logged successfully, you are done. If anything failed, examine lemonsqueezy-webhook v172 source via get_edge_function and patch.',
     'Paid user''s profile.subscription_status reflects their plan + webhook log shows successful event handling.', 4);

end $$;
