import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ADVISORS, MODEL_DISPLAY, type ModelTier } from "@/config/advisors";
import { ensureAdvisorsSeeded } from "@/lib/advisor-seed";
import { Skeleton } from "@/components/ui/skeleton";

type AgentRow = {
  id: string;
  name: string;
  role: string;
  color: string | null;
  avatar_letter: string | null;
  avatar_url?: string | null;
  model_tier: string | null;
};

function fallbackFor(name: string) {
  return ADVISORS.find((a) => a.name.toLowerCase() === name.toLowerCase());
}

export function BenchWidget() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentRow[] | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      await ensureAdvisorsSeeded(user.id);
      const { data } = await supabase
        .from("exec_os_agents")
        .select("id, name, role, color, avatar_letter, model_tier")
        .eq("user_id", user.id)
        .eq("enabled", true)
        .order("order_index", { ascending: true });
      if (!cancelled) setAgents((data ?? []) as AgentRow[]);
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (!agents) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[120px] w-[88px] rounded-xl shrink-0" />
        ))}
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center">
        No advisors yet. Visit the Advisors page to set them up.
      </div>
    );
  }

  return (
    <div className="flex gap-5 overflow-x-auto pb-2 -mx-1 px-1">
      {agents.map((a) => {
        const fb = fallbackFor(a.name);
        const color = a.color || fb?.brand_color || "#64748b";
        const tier = (a.model_tier as ModelTier) || fb?.model || "sonnet";
        const initials = (a.avatar_letter || a.name.slice(0, 1)).toUpperCase();
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => navigate({ to: "/advisors", search: { agent: a.id } })}
            aria-label={`Chat with ${a.name}`}
            className="group shrink-0 w-[92px] flex flex-col items-center text-center focus:outline-none"
          >
            <div className="relative">
              <div
                className="h-16 w-16 rounded-full flex items-center justify-center text-white text-xl font-semibold transition-all group-hover:scale-105"
                style={{
                  backgroundColor: color,
                  boxShadow: `0 0 0 2px ${color}`,
                }}
              >
                {initials}
              </div>
              <span
                className="absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-card"
                aria-hidden
              />
            </div>
            <div className="mt-2 text-xs font-semibold leading-tight truncate w-full">
              {a.name}
            </div>
            <div className="text-[10px] text-muted-foreground leading-tight truncate w-full">
              {a.role}
            </div>
            <div
              className="mt-1 text-[9px] uppercase tracking-wider font-semibold rounded px-1.5 py-0.5"
              style={{ color, backgroundColor: `${color}1a` }}
            >
              {MODEL_DISPLAY[tier]}
            </div>
          </button>
        );
      })}
    </div>
  );
}
