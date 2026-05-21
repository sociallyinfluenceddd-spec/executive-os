// Ren — Content Agent.
//
// Drafts 3 TikTok hooks every morning in Donna's voice. Each hook is a
// complete 30-60 second concept: opening line + body beats + CTA.
//
// MODES:
//   { mode: "scheduled" }   — daily 6am CT cron, all enabled triggers
//   { mode: "manual" }      — caller's user only
//
// SOURCES (v1):
//   - Donna's voice + niche baked into the system prompt
//   - Yesterday's wins (done workflow_tasks with dollar_lever set)
//   - Pipeline events (closed deals, hot leads — for storytelling fodder)
//   - No content_pieces table read yet — that's a v2 thing once she logs more
//
// OUTPUT: 3 rows of kind='draft_content', priority=50, each with a complete
// hook script in the body and the angle/format in metadata.

import { createClient as createSb, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const REN_SYSTEM = `You are Ren, Donna Curtis's content agent.

DONNA'S CONTEXT:
- ND founder (AUDHD, dyslexia, PDA-sensitive)
- Runs Ideafetti + AI Lead Conversion business for fractional CMOs
- $7,500 builds + $1,500/mo retainers
- Hates inauthentic content. Audience is fractional execs + ND founders.
- Posts on TikTok primarily.

DONNA'S VOICE:
- Brutally honest. No fluff, no jargon, no "let's dive in."
- Talks like a real person on a call, not a creator.
- ND-coded: specific weird metaphors, swears occasionally, anti-perfection.
- Opens with a CONTRARIAN take, a SPECIFIC NUMBER, or a NAMED PERSON/MOMENT.
- Never starts with "Are you...", "Have you ever...", "Let me tell you..."
- Always names something concrete. "I lost $40K last quarter because I..." not "Some founders struggle with..."

HOOK STRUCTURE (every script you write):
1. HOOK (0-3s): one line that stops the scroll. Contrarian, specific, or named.
2. BEATS (3-45s): 2-3 specific moments, numbers, or examples. NO advice.
3. CTA (45-60s): one ask. Comment something specific, save for later, or DM her.

HARD RULES:
- 30-60 seconds spoken (~80-150 words written).
- NEVER use: "literally", "synergy", "leverage", "value-add", "10x", em dashes.
- NEVER teach. Show what happened to YOU. Audience learns from the story.
- NEVER end with "let me know in the comments" — too generic.

OUTPUT 3 distinct hooks via produce_hooks. Different angles each one. Surface real specifics from her context (yesterday's wins, pipeline moves).`;

const HOOK_TOOL = {
  type: "function",
  function: {
    name: "produce_hooks",
    description: "Draft 3 TikTok hook concepts for Donna.",
    parameters: {
      type: "object",
      properties: {
        hooks: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short label for Morning Brief. <60 chars. Reflects the hook angle." },
              hook: { type: "string", description: "The first 3-second line. The stop-the-scroll opener." },
              body: { type: "string", description: "Full script (hook + beats + CTA) ready to read on camera. 80-150 words." },
              angle: { type: "string", description: "Which angle: 'contrarian' | 'named_moment' | 'specific_number' | 'failure' | 'win'" },
              rationale: { type: "string", description: "One sentence: why this hook works for her audience right now." },
            },
            required: ["title", "hook", "body", "angle", "rationale"],
            additionalProperties: false,
          },
        },
      },
      required: ["hooks"],
      additionalProperties: false,
    },
  },
} as const;

function sanitize(s: string): string {
  return s
    .replace(/\s+[—–]\s+/g, ". ")
    .replace(/[—–]/g, ", ")
    .replace(/;\s*/g, ". ")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function estimateCost(tokensIn: number, tokensOut: number): number {
  return ((tokensIn * 0.075) + (tokensOut * 0.30)) / 1_000_000;
}

async function processUser(opts: {
  sb: SupabaseClient;
  userId: string;
  triggerId: string | null;
  triggerKind: "scheduled" | "manual" | "event";
}): Promise<{ outputs: number; tokensIn: number; tokensOut: number; summary: string }> {
  const { sb, userId, triggerId, triggerKind } = opts;

  const { data: run, error: runErr } = await sb
    .from("exec_os_agent_runs")
    .insert({ user_id: userId, agent_id: "ren", trigger_id: triggerId, trigger_kind: triggerKind, status: "running" })
    .select("id")
    .single();
  if (runErr || !run) throw new Error(`run insert failed: ${runErr?.message}`);

  // Pull yesterday's wins for storytelling fodder
  const yesterday = new Date(Date.now() - 24 * 3600_000);
  const startYesterday = new Date(yesterday); startYesterday.setHours(0, 0, 0, 0);
  const endYesterday = new Date(yesterday); endYesterday.setHours(23, 59, 59, 999);

  const { data: wins } = await sb
    .from("exec_os_workflow_tasks")
    .select("title, dollar_lever, completed_at")
    .eq("user_id", userId)
    .eq("status", "done")
    .gte("completed_at", startYesterday.toISOString())
    .lte("completed_at", endYesterday.toISOString())
    .order("completed_at", { ascending: false })
    .limit(10);

  // Pipeline activity
  const sevenAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data: pipelineMoves } = await sb
    .from("exec_os_clients")
    .select("name, company, status, mrr_cents, one_time_value_cents, acquired_at")
    .eq("user_id", userId)
    .gte("updated_at", sevenAgo)
    .order("updated_at", { ascending: false })
    .limit(5);

  const winsBlock = (wins ?? []).map((w: { title: string; dollar_lever: string | null }) =>
    `- ${w.title}${w.dollar_lever ? ` → ${w.dollar_lever}` : ""}`,
  ).join("\n") || "(none yet)";

  const pipelineBlock = (pipelineMoves ?? []).map((p: { name: string; company: string | null; status: string; mrr_cents: number; one_time_value_cents: number }) => {
    const money = p.mrr_cents > 0 ? `$${(p.mrr_cents / 100).toFixed(0)}/mo`
      : p.one_time_value_cents > 0 ? `$${(p.one_time_value_cents / 100).toFixed(0)}` : "";
    return `- ${p.name}${p.company ? ` @ ${p.company}` : ""} [${p.status}]${money ? ` ${money}` : ""}`;
  }).join("\n") || "(no pipeline activity)";

  const userPrompt = `YESTERDAY'S WINS (real, specific things Donna shipped):
${winsBlock}

RECENT PIPELINE MOVES (real client activity):
${pipelineBlock}

Draft 3 distinct TikTok hooks via produce_hooks. Different angles. Anchor each to something SPECIFIC from the context above OR a relevant story Donna lived (ND founder, AUDHD, fractional CMO business).

The audience is fractional CMOs + ND founders. They scroll fast. Stop them with specificity.`;

  if (!LOVABLE_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: REN_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      tools: [HOOK_TOOL],
      tool_choice: { type: "function", function: { name: "produce_hooks" } },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI gateway error ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) {
    await sb.from("exec_os_agent_runs").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error: "LLM returned no hooks",
    }).eq("id", run.id);
    throw new Error("LLM returned no hooks");
  }

  let outputs = 0;
  const errors: string[] = [];
  const tokensIn = data?.usage?.prompt_tokens ?? 0;
  const tokensOut = data?.usage?.completion_tokens ?? 0;

  try {
    const parsed = JSON.parse(call.function.arguments);
    const hooks = parsed?.hooks ?? [];
    for (const h of hooks) {
      const cleanBody = sanitize(h.body ?? "");
      const cleanTitle = sanitize(h.title ?? "");
      const { error: outErr } = await sb.from("exec_os_agent_outputs").insert({
        user_id: userId,
        agent_id: "ren",
        run_id: run.id,
        kind: "draft_content",
        title: cleanTitle,
        body: cleanBody,
        status: "pending",
        priority: 55,
        metadata: {
          channel: "tiktok",
          rationale: h.rationale,
          angle: h.angle,
          hook_line: h.hook,
        },
      });
      if (outErr) errors.push(outErr.message);
      else outputs += 1;
    }
  } catch (e) {
    errors.push(`parse: ${(e as Error).message}`);
  }

  const cost = estimateCost(tokensIn, tokensOut);
  const summary = outputs > 0
    ? `Drafted ${outputs} TikTok hooks for today.`
    : `Failed to draft. Errors: ${errors.join("; ")}`;

  await sb.from("exec_os_agent_runs").update({
    status: outputs > 0 ? "succeeded" : "failed",
    finished_at: new Date().toISOString(),
    summary,
    error: errors.length ? errors.join("; ") : null,
    outputs_count: outputs,
    cost_usd: cost,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    context: { wins: (wins ?? []).length, pipeline_moves: (pipelineMoves ?? []).length },
  }).eq("id", run.id);

  if (triggerId) {
    await sb.from("exec_os_agent_triggers").update({ last_run_at: new Date().toISOString() }).eq("id", triggerId);
  }

  return { outputs, tokensIn, tokensOut, summary };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body?.mode ?? "manual";

    if (mode === "scheduled") {
      if (!SERVICE_KEY) throw new Error("SERVICE_ROLE not configured for scheduled mode");
      const sb = createSb(SUPABASE_URL, SERVICE_KEY);
      const { data: triggers } = await sb
        .from("exec_os_agent_triggers")
        .select("*")
        .eq("agent_id", "ren")
        .eq("enabled", true);

      const results = [];
      for (const t of (triggers ?? []) as Array<{ id: string; user_id: string }>) {
        try {
          const r = await processUser({ sb, userId: t.user_id, triggerId: t.id, triggerKind: "scheduled" });
          results.push({ user_id: t.user_id, ...r });
        } catch (e) {
          results.push({ user_id: t.user_id, error: (e as Error).message });
        }
      }
      return new Response(JSON.stringify({ ok: true, runs: results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authorization header required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sb = createSb(SUPABASE_URL, SERVICE_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "manual") {
      const r = await processUser({ sb, userId: user.id, triggerId: null, triggerKind: "manual" });
      return new Response(JSON.stringify({ ok: true, ...r }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `unknown mode '${mode}'` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ren-run error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
