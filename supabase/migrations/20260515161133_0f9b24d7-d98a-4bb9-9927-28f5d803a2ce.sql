CREATE TABLE public.exec_os_ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  model text NOT NULL,
  tier text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  advisor_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX exec_os_ai_usage_user_day_idx ON public.exec_os_ai_usage (user_id, day);

ALTER TABLE public.exec_os_ai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows select ai_usage" ON public.exec_os_ai_usage
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own rows insert ai_usage" ON public.exec_os_ai_usage
  FOR INSERT WITH CHECK (auth.uid() = user_id);