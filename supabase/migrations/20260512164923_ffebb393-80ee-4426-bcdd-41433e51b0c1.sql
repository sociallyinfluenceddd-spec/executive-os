CREATE TABLE public.exec_os_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('priority','needs_response','invite','meeting')),
  external_id text,
  sender_name text,
  sender_email text,
  subject text,
  snippet text,
  received_at timestamptz,
  scheduled_at timestamptz,
  attendees jsonb,
  video_url text,
  status text DEFAULT 'unread',
  raw_classification jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX exec_os_emails_user_external_idx
  ON public.exec_os_emails (user_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX exec_os_emails_user_kind_received_idx
  ON public.exec_os_emails (user_id, kind, received_at DESC);

CREATE INDEX exec_os_emails_user_kind_scheduled_idx
  ON public.exec_os_emails (user_id, kind, scheduled_at ASC);

ALTER TABLE public.exec_os_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows select emails" ON public.exec_os_emails
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own rows insert emails" ON public.exec_os_emails
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update emails" ON public.exec_os_emails
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own rows delete emails" ON public.exec_os_emails
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER exec_os_emails_set_updated_at
  BEFORE UPDATE ON public.exec_os_emails
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.exec_os_emails REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.exec_os_emails;