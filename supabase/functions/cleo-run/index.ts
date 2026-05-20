// Cleo — Sales Agent.
//
// MODES:
//   { mode: "scheduled" }              — cron trigger: scan all enabled cleo
//                                          triggers across users; for each user,
//                                          find clients with next_action_at due
//                                          and draft outreach for them.
//   { mode: "manual" }                  — run for the calling user only; same
//                                          logic as scheduled but scoped.
//   { mode: "single", client_id }       — draft outreach for one specific client
//                                          (the "Cleo Now" button in Pipeline).
//   { mode: "cold", linkedin_url, notes? } — research-and-draft for a fresh
//                                          LinkedIn URL not yet in pipeline.
//                                          Creates a 'lead' client row + drafts.
//
// AUTH:
//   - "scheduled" mode requires SERVICE_ROLE_KEY (the cron caller).
//   - "manual" / "single" / "cold" use the caller's JWT; auth.uid() must match.
//
// OUTPUTS:
//   For each client needing action, Cleo produces ONE row in
//   exec_os_agent_outputs of the appropriate kind:
//     lead          → draft_dm           (cold outreach)
//     contacted     → follow_up          (nudge if no reply in N days)
//     qualified     → draft_dm           (push to call / proposal)
//     proposal_sent → follow_up          (check-in on proposal)
//     active        → follow_up          (relationship maintenance)
//
// Everything links via ref_table='exec_os_clients' + ref_id=client.id.

import { createClient as createSb, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CLEO_SYSTEM = `You are Cleo — Donna Curtis's CMO strategist and sales agent.

Donna runs an AI Lead Conversion business targeting fractional CMOs:
  - Build: $7,500 one-time
  - Retainer: $1,500/mo
She is ND (AUDHD), bootstrapped, books few sales calls, hates pushy outreach.

YOUR VOICE:
- Warm, direct, no jargon. Sounds like a peer, not a salesperson.
- Short. 2–4 sentences for DMs. Never the LinkedIn cliché ("Hope you're doing well!").
- Lead with one specific observation about THEM (their role / company / recent move).
- Open a loop, don't pitch. End with a low-friction question.
- NEVER use: "circle back", "touch base", "synergy", "leverage", "deck", em dashes, "—".

YOUR JOB:
You draft outreach. Donna reviews and sends. You never claim to send anything yourself.
Each draft is a discrete message ready to copy-paste into LinkedIn or email.

Return your output via the draft_outreach function only.`;

const DRAFT_TOOL = {
  type: "function",
  function: {
    name: "draft_outreach",
    description: "Draft a single piece of outreach for a specific client/lead.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "One-line label for the Morning Brief list. Example: 'DM Marie re: fractional CMO retainer'. <70 chars.",
        },
        body: {
          type: "string",
          description: "The actual draft message Donna will copy-paste. Markdown allowed but rarely needed.",
        },
        channel: {
          type: "string",
          enum: ["linkedin", "email", "sms"],
          description: "Which channel this draft is for.",
        },
        rationale: {
          type: "string",
          description: "One sentence: why this person, why this message, why now. For Donna's review.",
        },
        priority: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "0=fyi, 50=normal, 80=hot, 95=drop-everything (e.g. proposal expiring today).",
        },
      },
      required: ["title", "body", "channel", "rationale", "priority"],
      additionalProperties: false,
    },
  },
} as const;

interface ClientRow {
  id: string;
  user_id: string;
  status: string;
  name: string;
  company: string | null;
  title: string | null;
  linkedin_url: string | null;
  notes: string | null;
  source: string | null;
  one_time_value_cents: number;
  mrr_cents: number;
  next_action_at: string | null;
  next_action_kind: string | null;
  last_touchpoint_at: string | null;
  tags: string[] | null;
}

interface DraftResult {
  title: string;
  body: string;
  channel: "linkedin" | "email" | "sms";
  rationale: string;
  priority: number;
  tokens_in?: number;
  tokens_out?: number;
}

/**
 * Decide what KIND of outreach a client needs based on their pipeline status.
 * Returns null when there's nothing reasonable to draft (e.g. churned, lost).
 */
function plannedKindFor(status: string): { kind: string; intent: string } | null {
  switch (status) {
    case "lead":
      return { kind: "draft_dm", intent: "First-touch outreach. They are a new lead Donna hasn't contacted yet. Goal: open a conversation, surface that you noticed them specifically." };
    case "contacted":
      return { kind: "follow_up", intent: "Polite second touch. Donna reached out, no reply. Goal: reframe with a different angle, do NOT guilt-trip." };
    case "qualified":
      return { kind: "draft_dm", intent: "Move them toward a call or proposal. They're warm. Goal: propose the next concrete step — book a call, share scope, send proposal." };
    case "proposal_sent":
      return { kind: "follow_up", intent: "Proposal is out. Goal: gentle check-in, ask if any questions, name a specific decision they'd need to make to move forward." };
    case "active":
      return { kind: "follow_up", intent: "Active client. Goal: relationship maintenance — share a relevant insight, win, or proactive heads-up. Not a sales nudge." };
    default:
      return null;
  }
}

/**
 * Call Lovable AI gateway with the draft tool. Returns the parsed function call.
 */
async function llmDraft(opts: {
  client: ClientRow;
  intent: string;
  extraContext?: string;
}): Promise<DraftResult | null> {
  if (!LOVABLE_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const c = opts.client;
  const userBlock = `CLIENT TO DRAFT FOR:
- Name: ${c.name}
- Company: ${c.company ?? "?"}
- Title: ${c.title ?? "?"}
- LinkedIn: ${c.linkedin_url ?? "?"}
- Pipeline status: ${c.status}
- Source: ${c.source ?? "?"}
- Tags: ${(c.tags ?? []).join(", ") || "—"}
- Existing value: ${c.mrr_cents > 0 ? `$${(c.mrr_cents / 100).toFixed(0)}/mo MRR` : ""}${c.one_time_value_cents > 0 ? ` + $${(c.one_time_value_cents / 100).toFixed(0)} one-time` : ""}
- Last touchpoint: ${c.last_touchpoint_at ?? "never"}
- Next action: ${c.next_action_kind ?? "follow_up"} (was due ${c.next_action_at ?? "—"})
- Notes from Donna: ${c.notes ?? "—"}

DRAFTING INTENT:
${opts.intent}
${opts.extraContext ? `\nADDITIONAL CONTEXT FROM DONNA:\n${opts.extraContext}` : ""}

Draft ONE message via the draft_outreach function. Pick the channel that fits: LinkedIn if they came from LinkedIn or have a LinkedIn URL, email otherwise.`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: CLEO_SYSTEM },
        { role: "user", content: userBlock },
      ],
      tools: [DRAFT_TOOL],
      tool_choice: { type: "function", function: { name: "draft_outreach" } },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error("llmDraft gateway error", resp.status, text);
    throw new Error(`AI gateway error ${resp.status}`);
  }

  const data = await resp.json();
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) return null;
  try {
    const parsed = JSON.parse(call.function.arguments);
    return {
      ...parsed,
      tokens_in: data?.usage?.prompt_tokens ?? 0,
      tokens_out: data?.usage?.completion_tokens ?? 0,
    } as DraftResult;
  } catch (e) {
    console.error("llmDraft parse error", e);
    return null;
  }
}

/**
 * Cheap cost estimate for Gemini Flash via Lovable gateway. Adjust if pricing
 * changes. Numbers in USD per million tokens.
 */
function estimateCost(tokensIn: number, tokensOut: number): number {
  const inUsdPerM = 0.075;
  const outUsdPerM = 0.30;
  return ((tokensIn * inUsdPerM) + (tokensOut * outUsdPerM)) / 1_000_000;
}

/**
 * Process one user: find all clients that need action, draft for each,
 * write outputs + run row.
 */
async function processUser(opts: {
  sb: SupabaseClient;
  userId: string;
  triggerId: string | null;
  triggerKind: "scheduled" | "manual" | "event";
}): Promise<{ outputs: number; tokensIn: number; tokensOut: number; summary: string }> {
  const { sb, userId, triggerId, triggerKind } = opts;

  // Create the run row
  const { data: run, error: runErr } = await sb
    .from("exec_os_agent_runs")
    .insert({
      user_id: userId,
      agent_id: "cleo",
      trigger_id: triggerId,
      trigger_kind: triggerKind,
      status: "running",
    })
    .select("id")
    .single();
  if (runErr || !run) throw new Error(`run insert failed: ${runErr?.message}`);

  // Find clients due for outreach. We treat "due" as: next_action_at <= now+24h,
  // OR no last_touchpoint_at and status='lead', OR status='proposal_sent' and
  // proposal sent >5 days ago (we'll use last_touchpoint_at as proxy for v1).
  const nowIso = new Date().toISOString();
  const tomorrowIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const fiveDaysAgoIso = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();

  const { data: dueByAction } = await sb
    .from("exec_os_clients")
    .select("*")
    .eq("user_id", userId)
    .lte("next_action_at", tomorrowIso)
    .not("next_action_at", "is", null)
    .not("status", "in", "(churned,lost)");

  const { data: untouchedLeads } = await sb
    .from("exec_os_clients")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "lead")
    .is("last_touchpoint_at", null);

  const { data: staleProposals } = await sb
    .from("exec_os_clients")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "proposal_sent")
    .lte("last_touchpoint_at", fiveDaysAgoIso);

  // De-dupe by id
  const byId = new Map<string, ClientRow>();
  for (const c of [...(dueByAction ?? []), ...(untouchedLeads ?? []), ...(staleProposals ?? [])]) {
    byId.set((c as ClientRow).id, c as ClientRow);
  }
  const queue = Array.from(byId.values());

  let outputs = 0;
  let totalIn = 0;
  let totalOut = 0;
  const errors: string[] = [];

  for (const client of queue) {
    const plan = plannedKindFor(client.status);
    if (!plan) continue;

    try {
      const draft = await llmDraft({ client, intent: plan.intent });
      if (!draft) continue;

      const { error: outErr } = await sb.from("exec_os_agent_outputs").insert({
        user_id: userId,
        agent_id: "cleo",
        run_id: run.id,
        kind: plan.kind,
        title: draft.title,
        body: draft.body,
        status: "pending",
        ref_table: "exec_os_clients",
        ref_id: client.id,
        priority: draft.priority ?? 50,
        metadata: {
          channel: draft.channel,
          rationale: draft.rationale,
          client_name: client.name,
          client_status: client.status,
        },
      });
      if (outErr) {
        errors.push(`${client.name}: ${outErr.message}`);
      } else {
        outputs += 1;
        totalIn += draft.tokens_in ?? 0;
        totalOut += draft.tokens_out ?? 0;
      }
    } catch (e) {
      errors.push(`${client.name}: ${(e as Error).message}`);
    }
  }

  const cost = estimateCost(totalIn, totalOut);
  const summary = outputs > 0
    ? `Drafted ${outputs} ${outputs === 1 ? "message" : "messages"} across ${queue.length} ${queue.length === 1 ? "client" : "clients"} needing action.`
    : queue.length > 0
      ? `Found ${queue.length} clients but drafted nothing. Errors: ${errors.join("; ")}`
      : "No clients needed outreach today. Pipeline quiet — go close the ones already in proposal.";

  await sb
    .from("exec_os_agent_runs")
    .update({
      status: outputs > 0 ? "succeeded" : "no_op",
      finished_at: new Date().toISOString(),
      summary,
      error: errors.length ? errors.join("; ") : null,
      outputs_count: outputs,
      cost_usd: cost,
      tokens_in: totalIn,
      tokens_out: totalOut,
      context: { queue_size: queue.length, now: nowIso },
    })
    .eq("id", run.id);

  // Update trigger last_run_at if scheduled
  if (triggerId) {
    await sb
      .from("exec_os_agent_triggers")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", triggerId);
  }

  return { outputs, tokensIn: totalIn, tokensOut: totalOut, summary };
}

/**
 * Run Cleo for a SINGLE client (the "Cleo Now" button).
 */
async function processSingle(opts: {
  sb: SupabaseClient;
  userId: string;
  clientId: string;
  triggerKind: "manual";
}): Promise<{ output_id: string | null; summary: string }> {
  const { sb, userId, clientId, triggerKind } = opts;

  const { data: client, error: cerr } = await sb
    .from("exec_os_clients")
    .select("*")
    .eq("id", clientId)
    .eq("user_id", userId)
    .single();
  if (cerr || !client) throw new Error("client not found or not yours");

  const plan = plannedKindFor((client as ClientRow).status);
  if (!plan) {
    return { output_id: null, summary: `Cleo doesn't draft for status=${(client as ClientRow).status}.` };
  }

  const { data: run } = await sb
    .from("exec_os_agent_runs")
    .insert({
      user_id: userId,
      agent_id: "cleo",
      trigger_kind: triggerKind,
      status: "running",
    })
    .select("id")
    .single();

  const draft = await llmDraft({ client: client as ClientRow, intent: plan.intent });
  if (!draft) {
    await sb.from("exec_os_agent_runs").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error: "LLM returned no draft",
    }).eq("id", run!.id);
    throw new Error("LLM returned no draft");
  }

  const { data: out, error: oerr } = await sb.from("exec_os_agent_outputs").insert({
    user_id: userId,
    agent_id: "cleo",
    run_id: run?.id ?? null,
    kind: plan.kind,
    title: draft.title,
    body: draft.body,
    status: "pending",
    ref_table: "exec_os_clients",
    ref_id: (client as ClientRow).id,
    priority: draft.priority ?? 50,
    metadata: {
      channel: draft.channel,
      rationale: draft.rationale,
      client_name: (client as ClientRow).name,
      client_status: (client as ClientRow).status,
      on_demand: true,
    },
  }).select("id").single();
  if (oerr) throw new Error(`output insert failed: ${oerr.message}`);

  const cost = estimateCost(draft.tokens_in ?? 0, draft.tokens_out ?? 0);
  await sb.from("exec_os_agent_runs").update({
    status: "succeeded",
    finished_at: new Date().toISOString(),
    summary: `Drafted ${plan.kind} for ${(client as ClientRow).name}.`,
    outputs_count: 1,
    cost_usd: cost,
    tokens_in: draft.tokens_in ?? 0,
    tokens_out: draft.tokens_out ?? 0,
  }).eq("id", run!.id);

  return { output_id: out!.id, summary: `Drafted ${draft.channel} message for ${(client as ClientRow).name} — check Morning Brief.` };
}

/**
 * Cold-research mode: paste a LinkedIn URL (+ optional notes), Cleo creates a
 * 'lead' client row and drafts first-touch outreach.
 *
 * V1 limitation: no actual LinkedIn scraping (no API access). Cleo drafts
 * based on the URL + any notes Donna provides. You can paste a name/title
 * into notes for now.
 */
async function processCold(opts: {
  sb: SupabaseClient;
  userId: string;
  linkedinUrl: string;
  notes?: string;
}): Promise<{ client_id: string; output_id: string | null; summary: string }> {
  const { sb, userId, linkedinUrl, notes } = opts;

  // Try to extract a name from the URL slug: linkedin.com/in/marie-smith-12345
  const slug = linkedinUrl.split("/in/")[1]?.split("/")[0] ?? "";
  const guessedName = slug
    .split("-")
    .filter((p) => !/^\d+$/.test(p))
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ")
    .trim() || "New lead";

  const { data: client, error: cerr } = await sb
    .from("exec_os_clients")
    .insert({
      user_id: userId,
      name: guessedName,
      linkedin_url: linkedinUrl,
      status: "lead",
      source: "linkedin_outbound",
      notes: notes ?? null,
    })
    .select("*")
    .single();
  if (cerr || !client) throw new Error(`client create failed: ${cerr?.message}`);

  const single = await processSingle({
    sb,
    userId,
    clientId: (client as ClientRow).id,
    triggerKind: "manual",
  });

  return {
    client_id: (client as ClientRow).id,
    output_id: single.output_id,
    summary: `Added ${guessedName} as a lead and drafted first-touch outreach.`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body?.mode ?? "manual";

    if (mode === "scheduled") {
      // CRON path — must be service-role authenticated
      if (!SERVICE_KEY) throw new Error("SERVICE_ROLE not configured for scheduled mode");
      const sb = createSb(SUPABASE_URL, SERVICE_KEY);

      const { data: triggers } = await sb
        .from("exec_os_agent_triggers")
        .select("*")
        .eq("agent_id", "cleo")
        .eq("enabled", true);

      const results: any[] = [];
      for (const t of (triggers ?? []) as Array<{ id: string; user_id: string }>) {
        try {
          const r = await processUser({
            sb,
            userId: t.user_id,
            triggerId: t.id,
            triggerKind: "scheduled",
          });
          results.push({ user_id: t.user_id, ...r });
        } catch (e) {
          results.push({ user_id: t.user_id, error: (e as Error).message });
        }
      }

      return new Response(JSON.stringify({ ok: true, runs: results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // All other modes need the caller's JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authorization header required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sb = createSb(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "manual") {
      const r = await processUser({
        sb,
        userId: user.id,
        triggerId: null,
        triggerKind: "manual",
      });
      return new Response(JSON.stringify({ ok: true, ...r }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "single") {
      const clientId = body?.client_id;
      if (!clientId) throw new Error("client_id required for single mode");
      const r = await processSingle({
        sb,
        userId: user.id,
        clientId,
        triggerKind: "manual",
      });
      return new Response(JSON.stringify({ ok: true, ...r }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "cold") {
      const linkedinUrl = body?.linkedin_url;
      if (!linkedinUrl) throw new Error("linkedin_url required for cold mode");
      const r = await processCold({
        sb,
        userId: user.id,
        linkedinUrl,
        notes: body?.notes,
      });
      return new Response(JSON.stringify({ ok: true, ...r }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `unknown mode '${mode}'` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("cleo-run error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
