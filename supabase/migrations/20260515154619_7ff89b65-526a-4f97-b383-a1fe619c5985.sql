CREATE TABLE public.feature_interest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature text NOT NULL,
  user_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.feature_interest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can insert feature_interest" ON public.feature_interest FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "authenticated can read feature_interest" ON public.feature_interest FOR SELECT TO authenticated USING (true);