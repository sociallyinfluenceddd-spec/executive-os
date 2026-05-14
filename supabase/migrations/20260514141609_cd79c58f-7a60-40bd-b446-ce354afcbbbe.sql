DELETE FROM public.exec_os_agents
WHERE id NOT IN (
  SELECT (ARRAY_AGG(id ORDER BY created_at ASC))[1]
  FROM public.exec_os_agents
  GROUP BY user_id, name
);

ALTER TABLE public.exec_os_agents
  ADD CONSTRAINT exec_os_agents_user_name_unique UNIQUE (user_id, name);