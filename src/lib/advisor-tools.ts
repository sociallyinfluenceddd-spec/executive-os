// Tool registry for advisor chat. Each tool has an Anthropic-compatible schema
// and an executor that runs against the authenticated user's Supabase client.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Authed = SupabaseClient<Database>;

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (input: Record<string, unknown>, ctx: { supabase: Authed; userId: string }) => Promise<unknown>;
}

const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
};

export const ADVISOR_TOOLS: ToolDef[] = [
  {
    name: "query_emails",
    description: "Read the user's recent emails. Filter by kind (needs_response, priority, fyi, meeting) and recency.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["needs_response", "priority", "fyi", "meeting"] },
        since_hours: { type: "number", description: "Only include emails received in the last N hours (default 168)" },
        limit: { type: "number", description: "Max rows (1-50, default 20)" },
      },
    },
    execute: async (input, { supabase }) => {
      const since = new Date(Date.now() - clamp(input.since_hours, 1, 24 * 30, 168) * 3600_000).toISOString();
      let q = supabase
        .from("exec_os_emails")
        .select("id, kind, sender_name, sender_email, subject, snippet, received_at, status")
        .gte("received_at", since)
        .order("received_at", { ascending: false })
        .limit(clamp(input.limit, 1, 50, 20));
      if (typeof input.kind === "string") q = q.eq("kind", input.kind);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { emails: data ?? [] };
    },
  },
  {
    name: "query_calendar",
    description: "Read upcoming or recent calendar events.",
    input_schema: {
      type: "object",
      properties: {
        window: { type: "string", enum: ["today", "next_24h", "next_7d", "past_7d"], description: "Time window (default next_24h)" },
        limit: { type: "number", description: "Max rows (1-50, default 20)" },
      },
    },
    execute: async (input, { supabase }) => {
      const now = new Date();
      const win = input.window ?? "next_24h";
      let from = now, to = new Date(now.getTime() + 86400_000);
      if (win === "today") { from = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z"); to = new Date(from.getTime() + 86400_000); }
      else if (win === "next_7d") { to = new Date(now.getTime() + 7 * 86400_000); }
      else if (win === "past_7d") { from = new Date(now.getTime() - 7 * 86400_000); to = now; }
      const { data, error } = await supabase
        .from("exec_os_calendar_events")
        .select("id, title, start_at, end_at, status, video_url, attendees, location")
        .gte("start_at", from.toISOString())
        .lte("start_at", to.toISOString())
        .order("start_at", { ascending: true })
        .limit(clamp(input.limit, 1, 50, 20));
      if (error) throw new Error(error.message);
      return { events: data ?? [] };
    },
  },
  {
    name: "query_captures",
    description: "Read recent voice/text captures (raw thoughts the user dumped).",
    input_schema: {
      type: "object",
      properties: {
        since_hours: { type: "number" },
        limit: { type: "number" },
      },
    },
    execute: async (input, { supabase }) => {
      const since = new Date(Date.now() - clamp(input.since_hours, 1, 24 * 30, 72) * 3600_000).toISOString();
      const { data, error } = await supabase
        .from("exec_os_captures")
        .select("id, raw_text, source, captured_at, extracted")
        .gte("captured_at", since)
        .order("captured_at", { ascending: false })
        .limit(clamp(input.limit, 1, 50, 20));
      if (error) throw new Error(error.message);
      return { captures: data ?? [] };
    },
  },
  {
    name: "query_daily",
    description: "Read the user's daily-log entries (top priority, energy, must-moves, mood).",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "How many recent days (1-30, default 7)" } },
    },
    execute: async (input, { supabase }) => {
      const { data, error } = await supabase
        .from("exec_os_daily")
        .select("entry_date, energy_level, top_priority, must_move_1, must_move_2, must_move_3, mood, what_moved, what_didnt, blockers")
        .order("entry_date", { ascending: false })
        .limit(clamp(input.days, 1, 30, 7));
      if (error) throw new Error(error.message);
      return { daily: data ?? [] };
    },
  },
  {
    name: "create_task",
    description: "Create a task for the user. Use when the user asks you to remember a TODO or when extracting action items from context.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        due_at: { type: "string", description: "ISO timestamp, optional" },
      },
      required: ["title"],
    },
    execute: async (input, { supabase, userId }) => {
      const title = String(input.title ?? "").slice(0, 500);
      if (!title) throw new Error("title required");
      const { data, error } = await supabase.from("exec_os_tasks").insert({
        user_id: userId,
        title,
        due_at: typeof input.due_at === "string" ? input.due_at : null,
      }).select("id, title, due_at, status").single();
      if (error) throw new Error(error.message);
      return { task: data };
    },
  },
  {
    name: "create_note",
    description: "Save a note for the user. Use to capture insights, decisions, or summaries.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["body"],
    },
    execute: async (input, { supabase, userId }) => {
      const body = String(input.body ?? "").slice(0, 50_000);
      if (!body) throw new Error("body required");
      const tags = Array.isArray(input.tags) ? input.tags.slice(0, 20).map((t) => String(t).slice(0, 50)) : [];
      const { data, error } = await supabase.from("exec_os_notes").insert({
        user_id: userId,
        title: typeof input.title === "string" ? input.title.slice(0, 200) : null,
        body,
        tags,
      }).select("id, title").single();
      if (error) throw new Error(error.message);
      return { note: data };
    },
  },
  {
    name: "create_suggestion",
    description: "Surface a proactive suggestion for the user (e.g. 'reply to X', 'reschedule Y'). Appears in the suggestions feed.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", description: "e.g. reply, reschedule, follow_up, idea" },
        payload: { type: "object", description: "Arbitrary data describing the suggestion" },
      },
      required: ["kind", "payload"],
    },
    execute: async (input, { supabase, userId }) => {
      const { data, error } = await supabase.from("exec_os_suggestions").insert({
        user_id: userId,
        kind: String(input.kind).slice(0, 50),
        payload: (input.payload ?? {}) as any,
      }).select("id, kind").single();
      if (error) throw new Error(error.message);
      return { suggestion: data };
    },
  },

  // ============================================================
  // EXECUTOR TOOLS — Maya / advisor can actually change state
  // ============================================================

  {
    name: "mark_workflow_task_done",
    description:
      "Mark a workflow task as done. Use when the user confirms a task is complete OR when you (the advisor) have just executed the task's claude_prompt successfully. Sets status=done and completed_at=now.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "UUID of the exec_os_workflow_tasks row" },
      },
      required: ["task_id"],
    },
    execute: async (input, { supabase }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data, error } = await db
        .from("exec_os_workflow_tasks")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", String(input.task_id))
        .select("id, title, status, completed_at")
        .single();
      if (error) throw new Error(error.message);
      return { task: data };
    },
  },

  {
    name: "update_workflow_task",
    description:
      "Update a workflow task's status, blocker, or notes. Use to mark in_progress when you start work, blocked when you hit a dependency, etc.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        status: { type: "string", enum: ["pending", "in_progress", "done", "blocked", "skipped"] },
        blocker: { type: "string", description: "If blocked, the reason." },
      },
      required: ["task_id"],
    },
    execute: async (input, { supabase }) => {
      const patch: Record<string, unknown> = {};
      if (typeof input.status === "string") patch.status = input.status;
      if (typeof input.blocker === "string") patch.blocker = input.blocker || null;
      if (input.status === "done") patch.completed_at = new Date().toISOString();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data, error } = await db
        .from("exec_os_workflow_tasks")
        .update(patch)
        .eq("id", String(input.task_id))
        .select("id, title, status, blocker, completed_at")
        .single();
      if (error) throw new Error(error.message);
      return { task: data };
    },
  },

  {
    name: "log_revenue",
    description:
      "Log a revenue entry to the Money widget. Use when the user mentions money landed or you observed a payment in another tool.",
    input_schema: {
      type: "object",
      properties: {
        amount_cents: { type: "number", description: "Amount in cents (e.g. 7500 = $75.00)" },
        source: {
          type: "string",
          enum: ["stripe", "cmo_retainer", "tiktok", "sponsorship", "manual", "other"],
        },
        entry_date: { type: "string", description: "ISO date (YYYY-MM-DD). Defaults to today." },
        notes: { type: "string" },
      },
      required: ["amount_cents", "source"],
    },
    execute: async (input, { supabase, userId }) => {
      const today = new Date().toISOString().slice(0, 10);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data, error } = await db
        .from("exec_os_revenue")
        .insert({
          user_id: userId,
          amount_cents: Math.max(0, Math.round(Number(input.amount_cents) || 0)),
          source: String(input.source),
          entry_date: typeof input.entry_date === "string" ? input.entry_date : today,
          notes: typeof input.notes === "string" ? input.notes : null,
        })
        .select("id, amount_cents, source, entry_date")
        .single();
      if (error) throw new Error(error.message);
      return { entry: data };
    },
  },

  {
    name: "add_artifact",
    description:
      "Add an artifact (doc, dashboard, tool, workflow, migration, spec, note, data) to the Hub registry. Use when the user wants something findable later.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        emoji: { type: "string" },
        kind: {
          type: "string",
          enum: ["workflow", "doc", "dashboard", "tool", "migration", "spec", "note", "data"],
        },
        category: {
          type: "string",
          enum: ["ideafetti", "exec_os", "cmo_business", "socially_influenceddd", "research", "strategy", "tools"],
        },
        location_type: { type: "string", enum: ["url", "file", "embedded", "app_route"] },
        location: { type: "string", description: "URL, file path, or app route" },
        summary: { type: "string" },
      },
      required: ["title", "kind", "category", "location_type", "location"],
    },
    execute: async (input, { supabase, userId }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data, error } = await db
        .from("exec_os_artifacts")
        .insert({
          user_id: userId,
          title: String(input.title).slice(0, 200),
          emoji: typeof input.emoji === "string" ? input.emoji.slice(0, 8) : null,
          kind: String(input.kind),
          category: String(input.category),
          location_type: String(input.location_type),
          location: String(input.location),
          summary: typeof input.summary === "string" ? input.summary.slice(0, 500) : null,
        })
        .select("id, title, kind, category")
        .single();
      if (error) throw new Error(error.message);
      return { artifact: data };
    },
  },

  {
    name: "supabase_execute_sql",
    description:
      "Run arbitrary SQL against one of Donna's Supabase projects via the Management API. Use for: applying migrations, running ad-hoc queries, enabling RLS, creating policies, etc. Project refs Donna uses: 'nsbqluctvubfqrhznhre' (Ideafetti / Idea Bank), 'yjepmihkvvqbgrqfsfzs' (executive-os). Returns the result rows or error. Pair with mark_workflow_task_done when the SQL closes out a workflow task.",
    input_schema: {
      type: "object",
      properties: {
        project_ref: {
          type: "string",
          description: "Supabase project ref (e.g. 'nsbqluctvubfqrhznhre')",
        },
        query: { type: "string", description: "Raw SQL to execute" },
        description: {
          type: "string",
          description: "One-sentence reason for this SQL (logged for audit)",
        },
      },
      required: ["project_ref", "query"],
    },
    execute: async (input) => {
      const pat = process.env.SUPABASE_PAT;
      if (!pat) {
        throw new Error(
          "SUPABASE_PAT not configured. Add it to .dev.vars to enable Maya's executor tools.",
        );
      }
      const projectRef = String(input.project_ref);
      if (!/^[a-z0-9]{20}$/.test(projectRef)) {
        throw new Error(`Invalid project_ref: ${projectRef}`);
      }
      const res = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${pat}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: String(input.query) }),
        },
      );
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Supabase Management API ${res.status}: ${text.slice(0, 500)}`);
      }
      try {
        return { rows: JSON.parse(text), description: input.description ?? null };
      } catch {
        return { raw: text.slice(0, 4000), description: input.description ?? null };
      }
    },
  },
];

export const ANTHROPIC_TOOLS = ADVISOR_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

export function findTool(name: string): ToolDef | undefined {
  return ADVISOR_TOOLS.find((t) => t.name === name);
}
