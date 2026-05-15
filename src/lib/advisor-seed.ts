// Seed default advisors if user has none. Used on first visit.
import { supabase } from "@/integrations/supabase/client";
import { ADVISORS } from "@/config/advisors";

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
    system_prompt: a.system_prompt,
    color: a.brand_color,
    avatar_letter: a.avatar_letter,
    order_index: i,
    enabled: true,
    model_tier: a.model,
    focus_data: {},
  }));
  await supabase.from("exec_os_agents").insert(rows);
}
