import { createServerFn } from "@tanstack/react-start";
import type { ModelTier } from "@/config/advisors";
import { ANTHROPIC_MODEL_FALLBACKS } from "@/config/advisors";

interface AnthropicModel {
  id: string;
  display_name: string;
  created_at: string;
}

// Parse "claude-{tier}-{major}-{minor}[-{date}]" → { tier, major, minor, date }
function parseId(id: string): { tier: ModelTier; major: number; minor: number; date: string } | null {
  const m = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-(\d{8}))?$/.exec(id);
  if (!m) return null;
  return {
    tier: m[1] as ModelTier,
    major: parseInt(m[2], 10),
    minor: parseInt(m[3], 10),
    date: m[4] ?? "",
  };
}

function pickLatest(models: AnthropicModel[], tier: ModelTier, minMajor = 4): string | null {
  const candidates = models
    .map((m) => ({ ...m, parsed: parseId(m.id) }))
    .filter((m) => m.parsed && m.parsed.tier === tier && m.parsed.major >= minMajor);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const pa = a.parsed!;
    const pb = b.parsed!;
    if (pa.major !== pb.major) return pb.major - pa.major;
    if (pa.minor !== pb.minor) return pb.minor - pa.minor;
    // Prefer dated alias when minor ties (more specific snapshot)
    return pb.date.localeCompare(pa.date);
  });

  return candidates[0].id;
}

export const resolveLatestAnthropicModels = createServerFn({ method: "GET" }).handler(
  async (): Promise<Record<ModelTier, string>> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn("[anthropic-models] ANTHROPIC_API_KEY missing, using fallbacks");
      return ANTHROPIC_MODEL_FALLBACKS;
    }

    try {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      });
      if (!res.ok) {
        console.error("[anthropic-models] HTTP", res.status, await res.text());
        return ANTHROPIC_MODEL_FALLBACKS;
      }
      const json = (await res.json()) as { data: AnthropicModel[] };
      const resolved: Record<ModelTier, string> = {
        opus: pickLatest(json.data, "opus") ?? ANTHROPIC_MODEL_FALLBACKS.opus,
        sonnet: pickLatest(json.data, "sonnet") ?? ANTHROPIC_MODEL_FALLBACKS.sonnet,
        haiku: pickLatest(json.data, "haiku") ?? ANTHROPIC_MODEL_FALLBACKS.haiku,
      };
      return resolved;
    } catch (err) {
      console.error("[anthropic-models] fetch failed:", err);
      return ANTHROPIC_MODEL_FALLBACKS;
    }
  },
);
