-- Link advisor threads to workflow tasks so "Run with Claude" on the same
-- task picks up where Donna left off instead of minting a fresh thread each
-- time. One thread per (agent, task) pair.

alter table public.exec_os_agent_threads
  add column if not exists task_id uuid
    references public.exec_os_workflow_tasks(id) on delete set null;

create index if not exists exec_os_agent_threads_task_idx
  on public.exec_os_agent_threads (task_id)
  where task_id is not null;

-- Unique partial index: at most one non-archived thread per (agent, task)
-- so concurrent opens don't race to create duplicates.
create unique index if not exists exec_os_agent_threads_agent_task_uq
  on public.exec_os_agent_threads (agent_id, task_id)
  where task_id is not null and archived = false;
