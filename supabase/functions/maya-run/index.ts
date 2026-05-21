// Maya — Build Agent.
//
// Maya owns the To Ship queue. She runs at 5:45am CT daily and produces
// outputs into the Brief that turn the static task list into a live agent
// surface:
//
//   1. ONE focus directive (kind='insight', priority=85) — names THE
//      highest-leverage task to ship today, with time estimate + the
//      dollar lever it pulls. Anchored verbatim to a real workflow_task.
//
//   2. UP TO 3 build approach notes (kind='pr_proposal', priority=60)
//      — for tasks with a non-empty claude_prompt field, draft a
//      one-paragraph approach summary Donna can review before sending
//      to Claude. Saves cold-start cost on Ideafetti build tasks.
//
// VOICE:
//   "You ship features — you don't advise." Bias toward specificity.
//   Reference the actual task title verbatim. Warm but direct. No fluff.
//   Hard rule: never invent priorities. If no pending tasks → return
//   a quiet-day directive: "Queue is empty. Pick what feeds you next."

import { createClient as createSb, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAYA_SYSTEM = `You are Maya, Donna Curtis's technical co-founder and build agent.

Donna runs:
  - Ideafetti (her main product, Supabase + Make automations)
  - AI Lead Conversion business for fractional CMOs
She is ND (AUDHD), bootstrapped. She doesn't want options; she wants the
ONE thing to ship next, with the approach already drafted.

============================================================
ANTI-HALLUCINATION (HIGHEST PRIORITY)
============================================================
- You will be given a list of REAL pending workflow_tasks. Anchor your
  output to those specifically. Quote the task title verbatim in your
  body.
- NEVER invent tasks. NEVER reference work that isn't in the list.
- If the pending-task list is empty, produce a quiet-day directive.

============================================================
VOICE
============================================================
- You ship, you don't advise. Warm but direct. Plain language.
- Two short sentences beat one long one.
- NEVER use: "should", "must", "have to", "synergy", em dashes, semicolons.
- Bias toward dollar levers and time estimates Donna already wrote into
  the task — quote them back at her so she sees the leverage.
- Forbidden vague phrases: "high impact", "value-add", "move the needle",
  "leverage", "low-hanging fruit".

============================================================
JOB
============================================================
You produce TWO kinds of output:

(A) FOCUS DIRECTIVE — the one task that matters today.
    - Body: 2-4 sentences. Names the task verbatim. Mentions time
      estimate and dollar lever if they exist. Suggests where to start
      (e.g. "Open the SQL editor in Lovable and paste the migration first").
    - Forbidden body content: vague encouragement, options, "you could".

(B) BUILD APPROACH NOTES — for tasks that have a claude_prompt field,
    draft a one-paragraph approach summary Donna can review before
    triggering Claude. Each note references one specific task.

Return outputs via the appropriate function tool.`;

const FOCUS_TOOL = {
  type: "function",
  function: {
    name: "build_focus",
    description: "Produce the daily build focus — one task to ship today.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short label for the Morning Brief. <70 chars." },
        body: { type: "string", description: "2-4 sentences. Quotes the task title verbatim." },
        rationale: { type: "string", description: "One sentence: why this task is the one." },
        task_id: { type: "string", description: "The id of the task you picked. Must come from the list provided." },
        priority: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["title", "body", "rationale", "task_id", "priority"],
      additionalProperties: false,
    },
  },
} as const;

const APPROACH_TOOL = {
  type: "function",
  function: {
    name: "build_approach",
    description: "Draft a build approach note for one task with a claude_prompt.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short label, <70 chars. e.g. 'Approach: Auto-log revenue webhook'." },
        body: { type: "string", description: "One paragraph (3-5 sentences). Concrete steps." },
        rationale: { type: "string", description: "One sentence: why this approach." },
        task_id: { type: "string", description: "id of the task this approach is for." },
        priority: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["title", "body", "rationale", "task_id", "priority"],
      additionalProperties: false,
    },
  },
} as const;

interface TaskRow {
  id: string;
  title: string;
  status: string;
  time_estimate: string | null;
  dollar_lever: string | null;
  claude_prompt: string | null;
  workflow_id: string;
  phase_id: string;
  sort_order: number;
}

function estimateCost(tokensIn: number, tokensOut: number): number {
  return ((tokensIn * 0.075) + (tokensOut * 0.30)) / 1_000_000;
}

function sanitize(s: string): string {
  return s
    .replace(/\s+[—–]\s+/g, ". ")
    .replace(/[—–]/g, ", ")
    .replace(/;\s*/g, ". ")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function callLlm<T>(opts: {
  system: string;
  user: string;
  tools: unknown[];
  toolName: string;
}): Promise<{ data: T; tokens_in: number; tokens_out: number } | null> {
  if (!LOVABLE_KEY) throw new Error("LOVABLE_API_KEY not configured");
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      tools: opts.tools,
      tool_choice: { type: "function", function: { name: opts.toolName } },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI gateway error ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) return null;
  try {
    return {
      data: JSON.parse(call.function.arguments),
      tokens_in: data?.usage?.prompt_tokens ?? 0,
      tokens_out: data?.usage?.completion_tokens ?? 0,
    };
  } catch (e) {
    console.error("parse error", e);
    return null;
  }
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
    .insert({ user_id: userId, agent_id: "maya", trigger_id: triggerId, trigger_kind: triggerKind, status: "running" })
    .select("id")
    .single();
  if (runErr || !run) throw new Error(`run insert failed: ${runErr?.message}`);

  let outputs = 0;
  let totalIn = 0;
  let totalOut = 0;
  const errors: string[] = [];

  // Pull pending tasks + workflow/phase context
  const { data: tasksRaw } = await sb
    .from("exec_os_workflow_tasks")
    .select("id, title, status, time_estimate, dollar_lever, claude_prompt, workflow_id, phase_id, sort_order")
    .eq("user_id", userId)
    .in("status", ["pending", "in_progress"])
    .order("sort_order", { ascending: true })
    .limit(40);

  const tasks = (tasksRaw ?? []) as TaskRow[];
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // ============================================================
  // (A) BUILD FOCUS — one task to ship today
  // ============================================================
  if (tasks.length === 0) {
    // Quiet-day path — no LLM call needed
    const { error: outErr } = await sb.from("exec_os_agent_outputs").insert({
      user_id: userId,
      agent_id: "maya",
      run_id: run.id,
      kind: "insight",
      title: "Queue is empty",
      body: "Nothing in your To Ship queue right now. Pick what feeds you next: close a Pipeline lead, draft a TikTok hook, or take real rest.",
      status: "pending",
      priority: 60,
      metadata: { rationale: "No pending tasks across any active workflow.", quiet_day: true },
    });
    if (!outErr) outputs += 1;
  } else {
    try {
      const taskBlock = tasks.map((t, i) => {
        const bits: string[] = [`${i + 1}. [id=${t.id}] "${t.title}"`];
        if (t.time_estimate) bits.push(`   time: ${t.time_estimate}`);
        if (t.dollar_lever) bits.push(`   lever: ${t.dollar_lever}`);
        if (t.claude_prompt) bits.push(`   has_claude_prompt: yes`);
        return bits.join("\n");
      }).join("\n\n");

      const userPrompt = `PENDING TASKS (${tasks.length} total):

${taskBlock}

Pick the ONE task to ship today. Anchor your body verbatim to that task's title. Mention its time_estimate and dollar_lever if they exist. The task_id field must match an id from the list above.`;

      const result = await callLlm<{
        title: string;
        body: string;
        rationale: string;
        task_id: string;
        priority: number;
      }>({
        system: MAYA_SYSTEM,
        user: userPrompt,
        tools: [FOCUS_TOOL],
        toolName: "build_focus",
      });

      if (result) {
        // Validate that task_id is real
        const referenced = taskMap.get(result.data.task_id);
        if (!referenced) {
          errors.push(`focus: invalid task_id ${result.data.task_id}`);
        } else {
          const cleanBody = sanitize(result.data.body);
          const cleanTitle = sanitize(result.data.title);
          const { error: outErr } = await sb.from("exec_os_agent_outputs").insert({
            user_id: userId,
            agent_id: "maya",
            run_id: run.id,
            kind: "insight",
            title: cleanTitle,
            body: cleanBody,
            status: "pending",
            ref_table: "exec_os_workflow_tasks",
            ref_id: referenced.id,
            priority: result.data.priority ?? 85,
            metadata: {
              rationale: result.data.rationale,
              task_title: referenced.title,
              time_estimate: referenced.time_estimate,
              dollar_lever: referenced.dollar_lever,
            },
          });
          if (outErr) errors.push(`focus: ${outErr.message}`);
          else {
            outputs += 1;
            totalIn += result.tokens_in;
            totalOut += result.tokens_out;
          }
        }
      }
    } catch (e) {
      errors.push(`focus: ${(e as Error).message}`);
    }
  }

  // ============================================================
  // (B) BUILD APPROACH NOTES — for tasks with claude_prompt set
  // ============================================================
  const promptedTasks = tasks.filter((t) => t.claude_prompt && t.claude_prompt.trim()).slice(0, 3);
  for (const t of promptedTasks) {
    try {
      const userPrompt = `TASK: "${t.title}"
${t.time_estimate ? `Time estimate: ${t.time_estimate}` : ""}
${t.dollar_lever ? `Dollar lever: ${t.dollar_lever}` : ""}

Donna already wrote this prompt for Claude:
---
${t.claude_prompt}
---

Draft a one-paragraph approach summary (3-5 sentences) that names concrete steps. End with what file or table is touched first. Quote the task title in the body. task_id MUST equal "${t.id}".`;

      const result = await callLlm<{
        title: string;
        body: string;
        rationale: string;
        task_id: string;
        priority: number;
      }>({
        system: MAYA_SYSTEM,
        user: userPrompt,
        tools: [APPROACH_TOOL],
        toolName: "build_approach",
      });

      if (!result) continue;
      if (result.data.task_id !== t.id) {
        errors.push(`approach: task_id mismatch for ${t.id}`);
        continue;
      }

      const cleanBody = sanitize(result.data.body);
      const cleanTitle = sanitize(result.data.title);
      const { error: outErr } = await sb.from("exec_os_agent_outputs").insert({
        user_id: userId,
        agent_id: "maya",
        run_id: run.id,
        kind: "pr_proposal",
        title: cleanTitle,
        body: cleanBody,
        status: "pending",
        ref_table: "exec_os_workflow_tasks",
        ref_id: t.id,
        priority: result.data.priority ?? 60,
        metadata: {
          rationale: result.data.rationale,
          task_title: t.title,
          claude_prompt: t.claude_prompt,
        },
      });
      if (outErr) errors.push(`approach ${t.id}: ${outErr.message}`);
      else {
        outputs += 1;
        totalIn += result.tokens_in;
        totalOut += result.tokens_out;
      }
    } catch (e) {
      errors.push(`approach ${t.id}: ${(e as Error).message}`);
    }
  }

  const cost = estimateCost(totalIn, totalOut);
  const summary = outputs === 0
    ? "Maya produced nothing. " + (errors.join("; ") || "no pending tasks")
    : `Picked ${tasks.length > 0 ? "1 focus" : "quiet-day directive"} + ${promptedTasks.length} approach notes.`;

  await sb.from("exec_os_agent_runs").update({
    status: outputs > 0 ? "succeeded" : "no_op",
    finished_at: new Date().toISOString(),
    summary,
    error: errors.length ? errors.join("; ") : null,
    outputs_count: outputs,
    cost_usd: cost,
    tokens_in: totalIn,
    tokens_out: totalOut,
    context: { pending_tasks: tasks.length, prompted_tasks: promptedTasks.length },
  }).eq("id", run.id);

  if (triggerId) {
    await sb.from("exec_os_agent_triggers").update({ last_run_at: new Date().toISOString() }).eq("id", triggerId);
  }

  return { outputs, tokensIn: totalIn, tokensOut: totalOut, summary };
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
        .eq("agent_id", "maya")
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
    console.error("maya-run error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
