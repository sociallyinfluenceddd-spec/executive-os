// Daily AI cost cap with auto-downgrade.
// Anthropic pricing per 1M tokens (USD), as of 2026-05.
import type { ModelTier } from "@/config/advisors";

export const DAILY_COST_CAP_USD = 5;

// [input $/Mtok, output $/Mtok]
export const TIER_PRICING: Record<ModelTier, { input: number; output: number }> = {
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 1, output: 5 },
};

export function calcCostUsd(tier: ModelTier, inputTokens: number, outputTokens: number): number {
  const p = TIER_PRICING[tier];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

// If today's spend exceeds the cap and the requested tier is opus, downgrade to sonnet.
export function effectiveTier(requested: ModelTier, spentTodayUsd: number): {
  tier: ModelTier;
  downgraded: boolean;
} {
  if (requested === "opus" && spentTodayUsd >= DAILY_COST_CAP_USD) {
    return { tier: "sonnet", downgraded: true };
  }
  return { tier: requested, downgraded: false };
}
