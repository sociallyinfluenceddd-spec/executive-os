ALTER TABLE public.exec_os_calendar_events
ADD COLUMN IF NOT EXISTS attendees jsonb;