// Seed default advisors if user has none, AND keep config-driven fields in sync
// (model_tier, system_prompt, color, role) for existing rows so changes in
// src/config/advisors.ts propagate without a manual migration.
import { supabase } from "@/integrations/supabase/client";
import { ADVISORS } from "@/config/advisors";

export async function ensureAdvisorsSeeded(userId: string): Promise<void> {
  const { data: existing } = await supabase
    .from("exec_os_agents")
    .select("id, name")
    .eq("user_id", userId);

  const existingByName = new Map((existing ?? []).map((r) => [r.name, r.id as string]));

  // Build rows to insert (advisors not yet present)
  const toInsert = ADVISORS.filter((a) => !existingByName.has(a.name)).map((a, i) => ({
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

  if (toInsert.length > 0) {
    await supabase.from("exec_os_agents").insert(toInsert);
  }

  // Sync config-driven fields on existing rows. This keeps Maya/Cleo on Opus
  // (and the rest on Sonnet) if config changes without requiring users to
  // wipe their advisor rows.
  for (const a of ADVISORS) {
    const id = existingByName.get(a.name);
    if (!id) continue;
    await supabase
      .from("exec_os_agents")
      .update({
        role: a.role,
        system_prompt: a.system_prompt,
        color: a.brand_color,
        avatar_letter: a.avatar_letter,
        model_tier: a.model,
      })
      .eq("id", id);
  }
}
