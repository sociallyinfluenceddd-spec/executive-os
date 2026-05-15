-- ============ Extend exec_os_agents ============
ALTER TABLE public.exec_os_agents
  ADD COLUMN IF NOT EXISTS model_tier text NOT NULL DEFAULT 'sonnet',
  ADD COLUMN IF NOT EXISTS focus_data jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.exec_os_agents
  DROP CONSTRAINT IF EXISTS exec_os_agents_model_tier_check;
ALTER TABLE public.exec_os_agents
  ADD CONSTRAINT exec_os_agents_model_tier_check
  CHECK (model_tier IN ('opus','sonnet','haiku'));

-- ============ Extend exec_os_agent_messages ============
ALTER TABLE public.exec_os_agent_messages
  ADD COLUMN IF NOT EXISTS thread_id uuid,
  ADD COLUMN IF NOT EXISTS tool_calls jsonb,
  ADD COLUMN IF NOT EXISTS tool_results jsonb,
  ADD COLUMN IF NOT EXISTS reasoning text,
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS input_tokens integer,
  ADD COLUMN IF NOT EXISTS output_tokens integer,
  ADD COLUMN IF NOT EXISTS cost_usd numeric(10,6);

CREATE INDEX IF NOT EXISTS exec_os_agent_messages_thread_idx
  ON public.exec_os_agent_messages (user_id, agent_id, thread_id, created_at);

-- ============ exec_os_agent_threads ============
CREATE TABLE IF NOT EXISTS public.exec_os_agent_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  title text,
  last_message_at timestamptz,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exec_os_agent_threads_user_agent_idx
  ON public.exec_os_agent_threads (user_id, agent_id, last_message_at DESC);
ALTER TABLE public.exec_os_agent_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows select threads" ON public.exec_os_agent_threads FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own rows insert threads" ON public.exec_os_agent_threads FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update threads" ON public.exec_os_agent_threads FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own rows delete threads" ON public.exec_os_agent_threads FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER exec_os_agent_threads_set_updated_at BEFORE UPDATE ON public.exec_os_agent_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ exec_os_suggestions ============
CREATE TABLE IF NOT EXISTS public.exec_os_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id uuid,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exec_os_suggestions_user_status_idx
  ON public.exec_os_suggestions (user_id, status, created_at DESC);
ALTER TABLE public.exec_os_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows select suggestions" ON public.exec_os_suggestions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own rows insert suggestions" ON public.exec_os_suggestions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update suggestions" ON public.exec_os_suggestions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own rows delete suggestions" ON public.exec_os_suggestions FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER exec_os_suggestions_set_updated_at BEFORE UPDATE ON public.exec_os_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ exec_os_weekly_summaries ============
CREATE TABLE IF NOT EXISTS public.exec_os_weekly_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  week_start date NOT NULL,
  summary text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);
ALTER TABLE public.exec_os_weekly_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows select weekly" ON public.exec_os_weekly_summaries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own rows insert weekly" ON public.exec_os_weekly_summaries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update weekly" ON public.exec_os_weekly_summaries FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own rows delete weekly" ON public.exec_os_weekly_summaries FOR DELETE USING (auth.uid() = user_id);

-- ============ exec_os_notes ============
CREATE TABLE IF NOT EXISTS public.exec_os_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id uuid,
  title text,
  body text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exec_os_notes_user_idx ON public.exec_os_notes (user_id, created_at DESC);
ALTER TABLE public.exec_os_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows select notes" ON public.exec_os_notes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own rows insert notes" ON public.exec_os_notes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update notes" ON public.exec_os_notes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own rows delete notes" ON public.exec_os_notes FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER exec_os_notes_set_updated_at BEFORE UPDATE ON public.exec_os_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ exec_os_tasks ============
CREATE TABLE IF NOT EXISTS public.exec_os_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id uuid,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  due_at timestamptz,
  source_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.exec_os_tasks
  DROP CONSTRAINT IF EXISTS exec_os_tasks_status_check;
ALTER TABLE public.exec_os_tasks
  ADD CONSTRAINT exec_os_tasks_status_check
  CHECK (status IN ('open','in_progress','done','cancelled'));
CREATE INDEX IF NOT EXISTS exec_os_tasks_user_status_idx ON public.exec_os_tasks (user_id, status, due_at);
ALTER TABLE public.exec_os_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows select tasks" ON public.exec_os_tasks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own rows insert tasks" ON public.exec_os_tasks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update tasks" ON public.exec_os_tasks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own rows delete tasks" ON public.exec_os_tasks FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER exec_os_tasks_set_updated_at BEFORE UPDATE ON public.exec_os_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();