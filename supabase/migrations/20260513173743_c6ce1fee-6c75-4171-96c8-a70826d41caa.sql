
CREATE TABLE public.exec_os_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  system_prompt text NOT NULL,
  color text NOT NULL,
  avatar_letter text NOT NULL,
  order_index int NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.exec_os_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows select agents" ON public.exec_os_agents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own rows insert agents" ON public.exec_os_agents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update agents" ON public.exec_os_agents FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own rows delete agents" ON public.exec_os_agents FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_agents_updated BEFORE UPDATE ON public.exec_os_agents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_agents_user_order ON public.exec_os_agents(user_id, order_index);

CREATE TABLE public.exec_os_agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id uuid NOT NULL REFERENCES public.exec_os_agents(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.exec_os_agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows select agent_messages" ON public.exec_os_agent_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own rows insert agent_messages" ON public.exec_os_agent_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows delete agent_messages" ON public.exec_os_agent_messages FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_agent_messages_agent_created ON public.exec_os_agent_messages(agent_id, created_at);
