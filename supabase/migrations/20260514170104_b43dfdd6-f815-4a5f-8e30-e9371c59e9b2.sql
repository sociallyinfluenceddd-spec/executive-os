CREATE TABLE public.exec_os_calendar_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  account TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  organizer_email TEXT,
  location TEXT,
  video_url TEXT,
  is_all_day BOOLEAN DEFAULT false,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exec_os_calendar_events_user_external_unique UNIQUE (user_id, external_id)
);

ALTER TABLE public.exec_os_calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows select calendar" ON public.exec_os_calendar_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own rows insert calendar" ON public.exec_os_calendar_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update calendar" ON public.exec_os_calendar_events FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own rows delete calendar" ON public.exec_os_calendar_events FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER set_calendar_updated_at BEFORE UPDATE ON public.exec_os_calendar_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_calendar_user_start ON public.exec_os_calendar_events (user_id, start_at);