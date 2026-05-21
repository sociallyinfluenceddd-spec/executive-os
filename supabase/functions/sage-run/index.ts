// Sage — Focus + Inbox Triage Agent.
//
// MODES:
//   { mode: "scheduled" }   — cron 5:30am CT daily, runs for all enabled triggers
//   { mode: "manual" }      — caller's user only
//
// OUTPUTS PRODUCED PER RUN:
//   1. ONE focus directive (kind='insight', priority=90)
//      Reads tomorrow's calendar + pending tasks + workload pressure.
//      Output: "Tomorrow looks heavy. The ONE thing that matters is X. Cut Y."
//      AUDHD-tuned, blunt but warm, no shame, no should.
//
//   2. INBOX TRIAGE entries (kind='follow_up', priority=50-80 by urgency)
//      Reads exec_os_emails kind='needs_response' from last 7 days.
//      For each, drafts a 2-line reply suggestion + urgency tag.
//      Skips emails where sender_email matches a Pipeline client (Cleo's territory).
//
// VOICE:
//   Blunt but warm. PDA-sensitive. ND-friendly. One next step, not a list.
//   No "should." No shame. Plain language.

import { createClient as createSb, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const SAGE_SYSTEM = `You are Sage, Donna Curtis's focus + triage agent.

Donna has AUDHD: PDA-sensitive, dyslexia, easily overwhelmed. She runs:
  - Ideafetti (her main product)
  - AI Lead Conversion business for fractional CMOs ($7.5K build + $1.5K/mo)

YOUR VOICE:
- Blunt but warm. Plain language. No jargon. No therapy-speak.
- NEVER use "should", "must", "have to" — those are PDA triggers.
- ONE next step, not a list of 5. If she sees 5 things she shuts down.
- Two short sentences beat one long one.
- If she's overloaded, say it directly. Don't sugar-coat.
- No em dashes ever.

YOUR JOB:
You produce TWO kinds of output:

(A) FOCUS DIRECTIVE — the one thing tomorrow.
    - Read tomorrow's calendar load + pending tasks.
    - Name the ONE thing that moves the needle. Just one.
    - If tomorrow is heavy, name what to CUT (specific tasks/meetings).
    - Format: 2-4 sentences max.

(B) INBOX TRIAGE — drafts for emails awaiting reply.
    - One draft per email. 1-2 sentences.
    - Match Donna's voice: warm, direct, no fluff.
    - Tag urgency in the rationale: respond_today / this_week / snooze.
    - If an email is genuinely junk or nudgy, recommend archive.

Return outputs via the appropriate tool call.`;

const FOCUS_TOOL = {
  type: "function",
  function: {
    name: "focus_directive",
    description: "Produce the daily focus directive — one thing that matters tomorrow.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short summary for the Morning Brief list. <60 chars." },
        body: { type: "string", description: "2-4 sentence directive. Names the ONE thing. Names what to cut if heavy." },
        rationale: { type: "string", description: "One sentence: why this is the ONE thing today." },
        priority: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["title", "body", "rationale", "priority"],
      additionalProperties: false,
    },
  },
} as const;

const TRIAGE_TOOL = {
  type: "function",
  function: {
    name: "triage_email",
    description: "Draft a 2-line reply for an email awaiting response.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short label: 'Reply to <Sender> re: <topic>'. <70 chars." },
        body: { type: "string", description: "The 1-2 sentence draft reply." },
        urgency: { type: "string", enum: ["respond_today", "this_week", "snooze", "archive"] },
        rationale: { type: "string", description: "One sentence: why this email matters or doesn't." },
      },
      required: ["title", "body", "urgency", "rationale"],
      additionalProperties: false,
    },
  },
} as const;

interface EmailRow {
  id: string;
  external_id: string | null;
  account: string;
  sender_name: string | null;
  sender_email: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string | null;
}

interface CalendarEvent {
  id: string;
  title: string | null;
  start_at: string | null;
  end_at: string | null;
  attendees: { email?: string }[] | null;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  time_estimate: string | null;
  dollar_lever: string | null;
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

async function callLlm(opts: {
  system: string;
  user: string;
  tools: typeof FOCUS_TOOL[] | typeof TRIAGE_TOOL[];
  toolName: string;
}) {
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
      tools: opts.tools as unknown[],
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
    const parsed = JSON.parse(call.function.arguments);
    return {
      ...parsed,
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
    .insert({ user_id: userId, agent_id: "sage", trigger_id: triggerId, trigger_kind: triggerKind, status: "running" })
    .select("id")
    .single();
  if (runErr || !run) throw new Error(`run insert failed: ${runErr?.message}`);

  let outputs = 0;
  let totalIn = 0;
  let totalOut = 0;
  const errors: string[] = [];

  // Pull context: tomorrow's calendar window + pending tasks + recent emails
  const now = new Date();
  const startOfTomorrow = new Date(now);
  startOfTomorrow.setDate(now.getDate() + 1);
  startOfTomorrow.setHours(0, 0, 0, 0);
  const endOfTomorrow = new Date(startOfTomorrow.getTime() + 86_400_000);

  // Calendar events: we read from exec_os_calendar_events as a best-effort cache.
  // The live calendar fetch happens on the dashboard load path; this function
  // reads whatever was last cached. Acceptable for v1 — Sage isn't sub-second.
  const { data: events } = await sb
    .from("exec_os_calendar_events")
    .select("id, title, start_at, end_at, attendees")
    .eq("user_id", userId)
    .gte("start_at", startOfTomorrow.toISOString())
    .lt("start_at", endOfTomorrow.toISOString())
    .order("start_at", { ascending: true });

  const { data: tasks } = await sb
    .from("exec_os_workflow_tasks")
    .select("id, title, status, time_estimate, dollar_lever")
    .eq("user_id", userId)
    .in("status", ["pending", "in_progress"])
    .order("sort_order", { ascending: true })
    .limit(20);

  // Recent emails needing response. Filter out Pipeline clients (Cleo's job).
  const sevenAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: emails } = await sb
    .from("exec_os_emails")
    .select("id, external_id, account, sender_name, sender_email, subject, snippet, received_at")
    .eq("user_id", userId)
    .eq("kind", "needs_response")
    .eq("status", "unread")
    .gte("received_at", sevenAgo)
    .order("received_at", { ascending: false })
    .limit(10);

  const { data: pipelineEmails } = await sb
    .from("exec_os_clients")
    .select("primary_contact_email")
    .eq("user_id", userId)
    .not("primary_contact_email", "is", null);
  const pipelineDomains = new Set(
    (pipelineEmails ?? []).map((p: { primary_contact_email: string | null }) => (p.primary_contact_email ?? "").toLowerCase()).filter(Boolean),
  );

  const triageEmails = (emails ?? [] as EmailRow[]).filter((e) => {
    const senderEmail = (e.sender_email ?? "").toLowerCase();
    return !pipelineDomains.has(senderEmail);
  }).slice(0, 5);

  // ============================================================
  // (A) FOCUS DIRECTIVE
  // ============================================================
  try {
    const calBlock = (events ?? [] as CalendarEvent[]).map((e) => {
      const t = e.start_at ? new Date(e.start_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "?";
      const attendeeCount = (e.attendees ?? []).length;
      return `- ${t}: ${e.title ?? "(untitled)"}${attendeeCount > 0 ? ` (${attendeeCount} attendees)` : ""}`;
    }).join("\n") || "(nothing scheduled)";

    const taskBlock = (tasks ?? [] as TaskRow[]).map((t) =>
      `- ${t.title}${t.time_estimate ? ` (${t.time_estimate})` : ""}${t.dollar_lever ? ` — $: ${t.dollar_lever}` : ""}`,
    ).join("\n") || "(no open tasks)";

    const userPrompt = `TOMORROW'S CONTEXT (${startOfTomorrow.toLocaleDateString()}):

CALENDAR (${(events ?? []).length} events):
${calBlock}

OPEN TASKS (${(tasks ?? []).length}):
${taskBlock}

Produce ONE focus directive via focus_directive. The ONE thing that matters. If tomorrow is heavy (4+ meetings OR 10+ open tasks), explicitly name what to CUT. Be blunt but warm. ND-tuned.`;

    const focus = await callLlm({
      system: SAGE_SYSTEM,
      user: userPrompt,
      tools: [FOCUS_TOOL],
      toolName: "focus_directive",
    });

    if (focus) {
      const cleanTitle = sanitize(focus.title);
      const cleanBody = sanitize(focus.body);
      const { error: outErr } = await sb.from("exec_os_agent_outputs").insert({
        user_id: userId,
        agent_id: "sage",
        run_id: run.id,
        kind: "insight",
        title: cleanTitle,
        body: cleanBody,
        status: "pending",
        priority: focus.priority ?? 90,
        metadata: {
          rationale: focus.rationale,
          calendar_load: (events ?? []).length,
          task_load: (tasks ?? []).length,
          for_date: startOfTomorrow.toISOString().slice(0, 10),
        },
      });
      if (outErr) errors.push(`focus: ${outErr.message}`);
      else {
        outputs += 1;
        totalIn += focus.tokens_in ?? 0;
        totalOut += focus.tokens_out ?? 0;
      }
    }
  } catch (e) {
    errors.push(`focus: ${(e as Error).message}`);
  }

  // ============================================================
  // (B) INBOX TRIAGE — per email
  // ============================================================
  for (const email of triageEmails) {
    try {
      const triagePrompt = `EMAIL TO TRIAGE:
From: ${email.sender_name ?? "?"} <${email.sender_email ?? "?"}>
Subject: ${email.subject ?? "(no subject)"}
Received: ${email.received_at ?? "?"}
Snippet: ${email.snippet ?? "(no preview)"}

Draft a 1-2 sentence reply via triage_email. Match Donna's voice (warm, direct, no fluff). Tag urgency.`;

      const t = await callLlm({
        system: SAGE_SYSTEM,
        user: triagePrompt,
        tools: [TRIAGE_TOOL],
        toolName: "triage_email",
      });

      if (!t) continue;

      const priority = t.urgency === "respond_today" ? 80 : t.urgency === "this_week" ? 55 : 30;
      const cleanBody = sanitize(t.body);
      const cleanTitle = sanitize(t.title);

      const { error: outErr } = await sb.from("exec_os_agent_outputs").insert({
        user_id: userId,
        agent_id: "sage",
        run_id: run.id,
        kind: "follow_up",
        title: cleanTitle,
        body: cleanBody,
        status: "pending",
        ref_table: "exec_os_emails",
        ref_id: email.id,
        priority,
        metadata: {
          rationale: t.rationale,
          urgency: t.urgency,
          channel: "email",
          sender_email: email.sender_email,
          sender_name: email.sender_name,
          subject: email.subject,
          gmail_url: email.external_id
            ? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email.account)}#all/${email.external_id}`
            : null,
        },
      });
      if (outErr) errors.push(`${email.sender_email}: ${outErr.message}`);
      else {
        outputs += 1;
        totalIn += t.tokens_in ?? 0;
        totalOut += t.tokens_out ?? 0;
      }
    } catch (e) {
      errors.push(`${email.sender_email}: ${(e as Error).message}`);
    }
  }

  const cost = estimateCost(totalIn, totalOut);
  const summary = outputs > 0
    ? `Produced ${outputs} ${outputs === 1 ? "item" : "items"}: 1 focus + ${outputs - 1} triage replies.`
    : "No outputs produced.";

  await sb.from("exec_os_agent_runs").update({
    status: outputs > 0 ? "succeeded" : "no_op",
    finished_at: new Date().toISOString(),
    summary,
    error: errors.length ? errors.join("; ") : null,
    outputs_count: outputs,
    cost_usd: cost,
    tokens_in: totalIn,
    tokens_out: totalOut,
    context: { tomorrow_events: (events ?? []).length, open_tasks: (tasks ?? []).length, triage_emails: triageEmails.length },
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
        .eq("agent_id", "sage")
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
    console.error("sage-run error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
