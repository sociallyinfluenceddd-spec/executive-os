import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ADVISORS } from "@/config/advisors";
import { Skeleton } from "@/components/ui/skeleton";

type SuggestionRow = {
  id: string;
  agent_id: string | null;
  kind: string;
  payload: any;
  status: string;
  created_at: string;
};

type AgentLite = { id: string; name: string; color: string | null };

function whisperText(s: SuggestionRow): string {
  const p = s.payload || {};
  return p.message || p.text || p.title || p.summary || `New ${s.kind} suggestion`;
}

export function BenchWhispersWidget() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<SuggestionRow[] | null>(null);
  const [agentMap, setAgentMap] = useState<Record<string, AgentLite>>({});

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ data: sugg }, { data: ag }] = await Promise.all([
        supabase
          .from("exec_os_suggestions")
          .select("id, agent_id, kind, payload, status, created_at")
          .eq("user_id", user.id)
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("exec_os_agents")
          .select("id, name, color")
          .eq("user_id", user.id),
      ]);
      if (cancelled) return;
      const map: Record<string, AgentLite> = {};
      (ag ?? []).forEach((a) => { map[a.id] = a as AgentLite; });
      setAgentMap(map);
      setItems((sugg ?? []) as SuggestionRow[]);
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (!items) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-8 text-sm text-muted-foreground gap-2">
        <Sparkles className="h-5 w-5 opacity-60" />
        <div>No whispers yet.</div>
        <div className="text-xs">Your advisors will surface ideas here as they spot patterns.</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((s) => {
        const agent = s.agent_id ? agentMap[s.agent_id] : undefined;
        const fb = agent ? ADVISORS.find((a) => a.name === agent.name) : undefined;
        const color = agent?.color || fb?.brand_color || "#64748b";
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => agent && navigate({ to: "/advisors", search: { agent: agent.id } })}
            className="w-full text-left rounded-lg border border-border bg-card hover:bg-muted/40 transition p-3 flex gap-3 items-start"
          >
            <div
              className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-white text-xs font-semibold"
              style={{ backgroundColor: color }}
            >
              {agent?.name.slice(0, 1) ?? "?"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold" style={{ color }}>
                {agent?.name ?? "Advisor"} · <span className="text-muted-foreground font-normal">{s.kind}</span>
              </div>
              <div className="text-sm leading-snug line-clamp-2">{whisperText(s)}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
