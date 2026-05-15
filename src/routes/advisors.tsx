// Three-column advisor workspace.
// Left: thread list for current advisor + advisor switcher
// Middle: ChatWindow (Outlet)
// Right: ContextPanel (focus_data, recent suggestions, tasks, today's spend)
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ensureAdvisorsSeeded } from "@/lib/advisor-seed";
import { ChatWindow } from "@/components/advisors/ChatWindow";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, MessageSquare, Trash2, Lightbulb, ListChecks, DollarSign } from "lucide-react";
import { DAILY_COST_CAP_USD } from "@/lib/ai-cost-cap";
import { Link } from "@tanstack/react-router";
import type { ModelTier } from "@/config/advisors";

const searchSchema = z.object({
  agent: z.string().uuid().optional(),
  thread: z.string().uuid().optional(),
});

export const Route = createFileRoute("/advisors")({
  validateSearch: searchSchema,
  component: AdvisorsPage,
});

interface AgentRow {
  id: string;
  name: string;
  role: string;
  color: string;
  avatar_letter: string;
  model_tier: ModelTier;
  focus_data: Record<string, unknown>;
}
interface ThreadRow {
  id: string;
  agent_id: string;
  title: string | null;
  last_message_at: string | null;
}

function AdvisorsPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ from: "/advisors" });
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [seeded, setSeeded] = useState(false);

  // Redirect if not authed
  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [user, authLoading, navigate]);

  // Seed advisors then load
  useEffect(() => {
    if (!user) return;
    ensureAdvisorsSeeded(user.id).then(() => setSeeded(true));
  }, [user]);

  useEffect(() => {
    if (!user || !seeded) return;
    supabase
      .from("exec_os_agents")
      .select("id, name, role, color, avatar_letter, model_tier, focus_data")
      .eq("user_id", user.id)
      .eq("enabled", true)
      .order("order_index", { ascending: true })
      .then(({ data }) => {
        const list = (data ?? []) as AgentRow[];
        setAgents(list);
        if (!search.agent && list[0]) {
          navigate({ to: "/advisors", search: { agent: list[0].id }, replace: true });
        }
      });
  }, [user, seeded, search.agent, navigate]);

  const activeAgent = useMemo(
    () => agents.find((a) => a.id === search.agent) ?? null,
    [agents, search.agent],
  );

  const loadThreads = useCallback(() => {
    if (!user || !activeAgent) return;
    supabase
      .from("exec_os_agent_threads")
      .select("id, agent_id, title, last_message_at")
      .eq("agent_id", activeAgent.id)
      .eq("user_id", user.id)
      .eq("archived", false)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(50)
      .then(({ data }) => setThreads((data ?? []) as ThreadRow[]));
  }, [user, activeAgent]);

  useEffect(() => loadThreads(), [loadThreads]);

  const handleSelectAgent = (agentId: string) => {
    navigate({ to: "/advisors", search: { agent: agentId } });
  };
  const handleSelectThread = (threadId: string | undefined) => {
    if (!activeAgent) return;
    navigate({
      to: "/advisors",
      search: { agent: activeAgent.id, thread: threadId },
    });
  };
  const handleNewThread = () => handleSelectThread(undefined);
  const handleDeleteThread = async (threadId: string) => {
    await supabase.from("exec_os_agent_threads").delete().eq("id", threadId);
    if (search.thread === threadId) handleSelectThread(undefined);
    loadThreads();
  };

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* LEFT COLUMN — advisors + threads */}
      <aside className="flex w-72 flex-col border-r border-border bg-muted/20">
        <div className="border-b border-border p-3">
          <div className="flex items-center justify-between">
            <Link to="/today" className="text-xs font-medium text-muted-foreground hover:text-foreground">
              ← Today
            </Link>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Advisors
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => handleSelectAgent(a.id)}
                className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition ${
                  activeAgent?.id === a.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-accent"
                }`}
              >
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: a.color }}
                >
                  {a.avatar_letter}
                </span>
                {a.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-3 pt-3 pb-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Threads
          </span>
          <Button size="icon-sm" variant="ghost" onClick={handleNewThread} title="New thread">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-0.5 px-2 pb-3">
            <div
              className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs ${
                !search.thread ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              }`}
              onClick={handleNewThread}
            >
              <Plus className="h-3 w-3" /> New conversation
            </div>
            {threads.map((t) => (
              <div
                key={t.id}
                className={`group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs ${
                  search.thread === t.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                }`}
                onClick={() => handleSelectThread(t.id)}
              >
                <MessageSquare className="h-3 w-3 shrink-0 opacity-60" />
                <span className="flex-1 truncate">{t.title || "Untitled"}</span>
                <button
                  type="button"
                  className="opacity-0 transition group-hover:opacity-60 hover:!opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDeleteThread(t.id);
                  }}
                  title="Delete thread"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </aside>

      {/* MIDDLE — chat */}
      <section className="flex flex-1 flex-col overflow-hidden">
        {activeAgent ? (
          <>
            <header className="flex items-center justify-between border-b border-border px-4 py-2">
              <div className="flex items-center gap-2">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: activeAgent.color }}
                >
                  {activeAgent.avatar_letter}
                </span>
                <div className="leading-tight">
                  <div className="text-sm font-semibold">{activeAgent.name}</div>
                  <div className="text-[11px] text-muted-foreground">{activeAgent.role}</div>
                </div>
              </div>
              <Badge variant="secondary" className="text-[10px] uppercase">
                {activeAgent.model_tier}
              </Badge>
            </header>
            <div className="flex-1 overflow-hidden">
              <ChatWindow
                agentId={activeAgent.id}
                agentName={activeAgent.name}
                agentTier={activeAgent.model_tier}
                threadId={search.thread ?? null}
                onThreadCreated={(id) => handleSelectThread(id)}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select an advisor to start
          </div>
        )}
      </section>

      {/* RIGHT — context */}
      <aside className="hidden w-80 flex-col border-l border-border bg-muted/10 lg:flex">
        <ContextPanel agent={activeAgent} userId={user.id} />
      </aside>
    </div>
  );
}

interface ContextProps {
  agent: AgentRow | null;
  userId: string;
}
function ContextPanel({ agent, userId }: ContextProps) {
  const [spent, setSpent] = useState(0);
  const [suggestions, setSuggestions] = useState<{ id: string; kind: string; payload: unknown }[]>([]);
  const [tasks, setTasks] = useState<{ id: string; title: string; status: string }[]>([]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    supabase
      .from("exec_os_ai_usage")
      .select("cost_usd")
      .eq("day", today)
      .eq("user_id", userId)
      .then(({ data }) =>
        setSpent((data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)),
      );

    let q = supabase
      .from("exec_os_suggestions")
      .select("id, kind, payload")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(6);
    if (agent) q = q.eq("agent_id", agent.id);
    q.then(({ data }) => setSuggestions((data ?? []) as never));

    supabase
      .from("exec_os_tasks")
      .select("id, title, status")
      .eq("user_id", userId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(8)
      .then(({ data }) => setTasks((data ?? []) as never));
  }, [agent, userId]);

  const pct = Math.min(100, (spent / DAILY_COST_CAP_USD) * 100);
  const overCap = spent >= DAILY_COST_CAP_USD;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
          <span className="flex items-center gap-1">
            <DollarSign className="h-3 w-3" /> Today
          </span>
          <span>${spent.toFixed(3)} / ${DAILY_COST_CAP_USD}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full transition-all ${overCap ? "bg-amber-500" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {overCap && (
          <div className="mt-1 text-[10px] text-amber-600">
            Cap hit — Opus turns auto-downgrade to Sonnet.
          </div>
        )}
      </div>

      {agent && agent.focus_data && Object.keys(agent.focus_data).length > 0 && (
        <div className="mb-4">
          <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            Focus
          </div>
          <pre className="rounded border border-border bg-background p-2 text-[11px]">
            {JSON.stringify(agent.focus_data, null, 2)}
          </pre>
        </div>
      )}

      <div className="mb-4">
        <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Lightbulb className="h-3 w-3" /> Recent whispers
        </div>
        {suggestions.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">None yet.</div>
        ) : (
          <ul className="space-y-1.5">
            {suggestions.map((s) => (
              <li key={s.id} className="rounded border border-border bg-background p-2 text-[11px]">
                <div className="font-medium">{s.kind}</div>
                <div className="mt-0.5 line-clamp-3 text-muted-foreground">
                  {typeof s.payload === "object" && s.payload && "summary" in (s.payload as Record<string, unknown>)
                    ? String((s.payload as Record<string, unknown>).summary)
                    : JSON.stringify(s.payload).slice(0, 200)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
          <ListChecks className="h-3 w-3" /> Open tasks
        </div>
        {tasks.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">No open tasks.</div>
        ) : (
          <ul className="space-y-1">
            {tasks.map((t) => (
              <li key={t.id} className="text-[11px] text-foreground">
                · {t.title}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
