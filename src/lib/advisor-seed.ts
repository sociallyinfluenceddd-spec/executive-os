// Seed default advisors if user has none. Used on first visit.
import { supabase } from "@/integrations/supabase/client";
import { ADVISORS } from "@/config/advisors";

const DEFAULT_PROMPTS: Record<string, string> = {
  maya: "You are Maya, the Ideafetti co-founder advisor. You help with high-stakes strategy, big decisions, and pattern-spotting. Be direct, opinionated, and challenge assumptions. Use Opus-tier thinking for complex multi-variable problems.",
  ren: "You are Ren, the content writer. You help draft, rewrite, and sharpen content — emails, posts, scripts, captions. Match the user's voice. Be tight and specific.",
  cleo: "You are Cleo, the strategist. You help break down problems, spot leverage, and plan. You lean analytical. You ask clarifying questions when scope is unclear, but don't over-ask.",
  nova: "You are Nova, the quick helper. Use you for fast lookups, quick reformats, micro-summaries. Be very concise.",
};

const COLORS: Record<string, string> = {
  maya: "#7c3aed",
  ren: "#0ea5e9",
  cleo: "#10b981",
  nova: "#f59e0b",
};

export async function ensureAdvisorsSeeded(userId: string): Promise<void> {
  const { count } = await supabase
    .from("exec_os_agents")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if ((count ?? 0) > 0) return;

  const rows = ADVISORS.map((a, i) => ({
    user_id: userId,
    name: a.name,
    role: a.role,
    system_prompt: DEFAULT_PROMPTS[a.id] ?? `You are ${a.name}, ${a.role}.`,
    color: COLORS[a.id] ?? "#64748b",
    avatar_letter: a.name.slice(0, 1),
    order_index: i,
    enabled: true,
    model_tier: a.model,
    focus_data: {},
  }));
  await supabase.from("exec_os_agents").insert(rows);
}
