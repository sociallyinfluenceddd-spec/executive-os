// Client helpers for the agent platform — Morning Brief.
//
// All 6 agents (Maya, Ren, Cleo, Vee, Sage, Theo) write to the same
// exec_os_agent_outputs table. The Morning Brief widget reads from there.
// One widget, all agents, no per-agent widget proliferation.

import { supabase } from "@/integrations/supabase/client";

export type AgentId = "maya" | "ren" | "cleo" | "vee" | "sage" | "theo";

export type OutputKind =
  | "draft_email"
  | "draft_dm"
  | "draft_proposal"
  | "draft_content"
  | "follow_up"
  | "pr_proposal"
  | "decision_recommendation"
  | "insight";

export type OutputStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "edited"
  | "sent"
  | "archived";

export interface AgentOutput {
  id: string;
  user_id: string;
  agent_id: AgentId;
  run_id: string | null;
  kind: OutputKind;
  title: string;
  body: string | null;
  status: OutputStatus;
  ref_table: string | null;
  ref_id: string | null;
  priority: number;
  suggested_at: string | null;
  acted_at: string | null;
  acted_by: string | null;
  edit_diff: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  // Joined from exec_os_clients when ref_table='exec_os_clients'.
  // Populated by listPendingOutputs via a second fetch.
  client?: {
    id: string;
    name: string;
    company: string | null;
    title: string | null;
    linkedin_url: string | null;
    primary_contact_email: string | null;
    status: string;
  } | null;
}

/**
 * Fetch pending outputs for the morning brief, sorted by priority then recency.
 * Default limit 25 — agents that produce more than that should self-rank.
 */
export async function listPendingOutputs(limit = 25): Promise<AgentOutput[]> {
  const { data, error } = await supabase
    .from("exec_os_agent_outputs")
    .select("*")
    .eq("status", "pending")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listPendingOutputs failed", error);
    return [];
  }
  const outputs = (data ?? []) as AgentOutput[];

  // Bulk-fetch linked clients so each row can show channel/contact/role/status.
  const clientIds = Array.from(
    new Set(
      outputs
        .filter((o) => o.ref_table === "exec_os_clients" && o.ref_id)
        .map((o) => o.ref_id as string),
    ),
  );

  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from("exec_os_clients")
      .select("id, name, company, title, linkedin_url, primary_contact_email, status")
      .in("id", clientIds);
    const byId = new Map((clients ?? []).map((c: any) => [c.id, c]));
    for (const o of outputs) {
      if (o.ref_table === "exec_os_clients" && o.ref_id) {
        o.client = (byId.get(o.ref_id) ?? null) as AgentOutput["client"];
      }
    }
  }

  return outputs;
}

/**
 * Count pending outputs (for the header badge on the Morning Brief widget).
 */
export async function countPendingOutputs(): Promise<number> {
  const { count } = await supabase
    .from("exec_os_agent_outputs")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

/**
 * Approve an output. The agent (or a follow-up function) is expected to
 * read approved rows and actually take the action (send the email, post
 * the DM, ship the PR). This function just flips the bit.
 */
export async function approveOutput(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("exec_os_agent_outputs")
    .update({
      status: "approved",
      acted_at: new Date().toISOString(),
      acted_by: "donna",
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Reject an output. The reason (optional) gets stored in edit_diff so the
 * agent can learn from why drafts get rejected.
 */
export async function rejectOutput(
  id: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("exec_os_agent_outputs")
    .update({
      status: "rejected",
      acted_at: new Date().toISOString(),
      acted_by: "donna",
      edit_diff: reason ?? null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Save an edited body and mark as approved. We store both the new body
 * and a diff (old vs new) in edit_diff so the agent can learn how Donna
 * actually writes things vs how the model drafts them.
 */
export async function approveWithEdits(
  id: string,
  newBody: string,
  originalBody: string,
): Promise<{ ok: boolean; error?: string }> {
  // Lightweight diff representation — store both sides; the agent can
  // diff them however it wants. Avoid heavy diff library on the client.
  const editDiff = JSON.stringify({ original: originalBody, edited: newBody });
  const { error } = await supabase
    .from("exec_os_agent_outputs")
    .update({
      body: newBody,
      status: "edited",
      acted_at: new Date().toISOString(),
      acted_by: "donna",
      edit_diff: editDiff,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Archive an output (don't act on it, but don't reject either — useful
 * for "good idea, not relevant right now" cases).
 */
export async function archiveOutput(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("exec_os_agent_outputs")
    .update({
      status: "archived",
      acted_at: new Date().toISOString(),
      acted_by: "donna",
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Agent metadata — used by the widget for icons, brand colors, labels.
 * Mirrors the advisor config but trimmed to what the widget needs.
 */
export const AGENT_META: Record<AgentId, { name: string; role: string; brand_color: string; emoji: string }> = {
  maya: { name: "Maya", role: "Build Agent", brand_color: "#083D77", emoji: "🔨" },
  ren: { name: "Ren", role: "Content Agent", brand_color: "#E97451", emoji: "✍️" },
  cleo: { name: "Cleo", role: "Sales Agent", brand_color: "#DB9C96", emoji: "💼" },
  vee: { name: "Vee", role: "Insights Agent", brand_color: "#FFC100", emoji: "📈" },
  sage: { name: "Sage", role: "Focus Agent", brand_color: "#A4B494", emoji: "🌿" },
  theo: { name: "Theo", role: "Decision Agent", brand_color: "#355834", emoji: "🎯" },
};

/**
 * Output kind labels for the UI.
 */
export const KIND_LABEL: Record<OutputKind, string> = {
  draft_email: "Email draft",
  draft_dm: "DM draft",
  draft_proposal: "Proposal draft",
  draft_content: "Content draft",
  follow_up: "Follow-up",
  pr_proposal: "Code PR",
  decision_recommendation: "Decision",
  insight: "Insight",
};
