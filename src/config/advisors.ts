// Advisor model tiers. IDs are resolved live from Anthropic's /v1/models
// endpoint by src/lib/anthropic-models.functions.ts (resolveLatestAnthropicModels).
// The constants below are last-known-good fallbacks — refreshed 2026-05-15.

export type ModelTier = "opus" | "sonnet" | "haiku";

export const ANTHROPIC_MODEL_FALLBACKS: Record<ModelTier, string> = {
  opus: "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
};

export type AdvisorId = "maya" | "ren" | "cleo" | "nova";

export interface AdvisorConfig {
  id: AdvisorId;
  name: string;
  role: string;
  model: ModelTier;
}

export const ADVISORS: AdvisorConfig[] = [
  { id: "maya", name: "Maya", role: "Ideafetti Co-founder", model: "opus" },
  { id: "ren", name: "Ren", role: "Content Writer", model: "sonnet" },
  { id: "cleo", name: "Cleo", role: "Strategist", model: "opus" },
  { id: "nova", name: "Nova", role: "Quick Helper", model: "haiku" },
];
