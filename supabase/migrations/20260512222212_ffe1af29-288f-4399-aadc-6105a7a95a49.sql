ALTER TABLE public.exec_os_emails
  ADD CONSTRAINT exec_os_emails_user_external_unique UNIQUE (user_id, external_id);