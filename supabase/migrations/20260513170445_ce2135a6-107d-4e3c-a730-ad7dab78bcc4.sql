CREATE TABLE public.exec_os_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  raw_text text NOT NULL,
  source text NOT NULL DEFAULT 'text',
  captured_at timestamptz NOT NULL DEFAULT now(),
  extracted jsonb,
  routed_to text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.exec_os_captures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows select captures" ON public.exec_os_captures
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own rows insert captures" ON public.exec_os_captures
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update captures" ON public.exec_os_captures
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own rows delete captures" ON public.exec_os_captures
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX exec_os_captures_user_captured_idx
  ON public.exec_os_captures (user_id, captured_at DESC);