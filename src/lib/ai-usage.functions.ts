import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calcCostUsd, effectiveTier, DAILY_COST_CAP_USD } from "./ai-cost-cap";
import type { ModelTier } from "@/config/advisors";
import { z } from "zod";

// Sum today's spend for the authenticated user (UTC day).
export const getTodaySpend = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ spentUsd: number; capUsd: number; remainingUsd: number }> => {
    const { supabase } = context;
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("exec_os_ai_usage")
      .select("cost_usd")
      .eq("day", today);
    if (error) {
      console.error("[ai-usage] getTodaySpend error", error);
      return { spentUsd: 0, capUsd: DAILY_COST_CAP_USD, remainingUsd: DAILY_COST_CAP_USD };
    }
    const spent = (data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    return { spentUsd: spent, capUsd: DAILY_COST_CAP_USD, remainingUsd: Math.max(0, DAILY_COST_CAP_USD - spent) };
  });

// Resolve effective tier for a request given the cap.
export const resolveTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ requested: z.enum(["opus", "sonnet", "haiku"]) }).parse)
  .handler(async ({ data, context }): Promise<{ tier: ModelTier; downgraded: boolean; spentUsd: number }> => {
    const { supabase } = context;
    const today = new Date().toISOString().slice(0, 10);
    const { data: rows } = await supabase
      .from("exec_os_ai_usage")
      .select("cost_usd")
      .eq("day", today);
    const spent = (rows ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    const { tier, downgraded } = effectiveTier(data.requested as ModelTier, spent);
    return { tier, downgraded, spentUsd: spent };
  });

// Record usage after a completed call.
export const recordUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      model: z.string().min(1).max(100),
      tier: z.enum(["opus", "sonnet", "haiku"]),
      inputTokens: z.number().int().min(0),
      outputTokens: z.number().int().min(0),
      advisorId: z.string().min(1).max(50).optional(),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const cost = calcCostUsd(data.tier as ModelTier, data.inputTokens, data.outputTokens);
    const { error } = await supabase.from("exec_os_ai_usage").insert({
      user_id: userId,
      model: data.model,
      tier: data.tier,
      input_tokens: data.inputTokens,
      output_tokens: data.outputTokens,
      cost_usd: cost,
      advisor_id: data.advisorId ?? null,
    });
    if (error) {
      console.error("[ai-usage] recordUsage error", error);
    }
    return { costUsd: cost };
  });
