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
];

export const ANTHROPIC_TOOLS = ADVISOR_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

export function findTool(name: string): ToolDef | undefined {
  return ADVISOR_TOOLS.find((t) => t.name === name);
}
