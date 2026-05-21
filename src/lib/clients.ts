// Pipeline / Client layer helpers.
//
// All CRUD goes through here. The Pipeline widget and (later) Cleo agent
// read/write via these functions instead of touching supabase directly.

import { supabase } from "@/integrations/supabase/client";

// Pipeline stages, ordered as they flow.
export const CLIENT_STATUSES = [
  "lead",
  "contacted",
  "qualified",
  "proposal_sent",
  "active",
  "paused",
  "churned",
  "lost",
] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

// Stage markers are refined unicode symbols, not cartoon emoji. They mostly
// communicate via the color anyway; the symbol is a discrete shape cue.
export const STATUS_META: Record<ClientStatus, { label: string; emoji: string; color: string; pipeline: boolean }> = {
  lead:          { label: "Lead",          emoji: "◔", color: "#A4B494", pipeline: true  },
  contacted:     { label: "Contacted",     emoji: "◑", color: "#DB9C96", pipeline: true  },
  qualified:     { label: "Qualified",     emoji: "◕", color: "#E97451", pipeline: true  },
  proposal_sent: { label: "Proposal out",  emoji: "●", color: "#FFC100", pipeline: true  },
  active:        { label: "Active",        emoji: "◉", color: "#355834", pipeline: false },
  paused:        { label: "Paused",        emoji: "‖", color: "#8899aa", pipeline: false },
  churned:       { label: "Churned",       emoji: "—", color: "#6b7280", pipeline: false },
  lost:          { label: "Lost",          emoji: "✕", color: "#6b7280", pipeline: false },
};

export interface Client {
  id: string;
  user_id: string;
  status: ClientStatus;
  name: string;
  company: string | null;
  title: string | null;
  primary_contact_email: string | null;
  linkedin_url: string | null;
  tags: string[];
  icp_score: number | null;
  source: string | null;
  one_time_value_cents: number;
  mrr_cents: number;
  external_stripe_customer_id: string | null;
  external_ls_customer_id: string | null;
  acquired_at: string | null;
  last_touchpoint_at: string | null;
  next_action_at: string | null;
  next_action_kind: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ClientInsert = Partial<Omit<Client, "id" | "user_id" | "created_at" | "updated_at">> & {
  name: string;
};

export async function listClients(opts?: {
  statuses?: ClientStatus[];
  limit?: number;
}): Promise<Client[]> {
  let query = supabase
    .from("exec_os_clients")
    .select("*")
    .order("next_action_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (opts?.statuses?.length) {
    query = query.in("status", opts.statuses);
  }
  if (opts?.limit) query = query.limit(opts.limit);
  const { data, error } = await query;
  if (error) {
    console.error("listClients failed", error);
    return [];
  }
  return (data ?? []) as Client[];
}

export async function getClient(id: string): Promise<Client | null> {
  const { data } = await supabase
    .from("exec_os_clients")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data as Client | null;
}

export async function createClient(input: ClientInsert): Promise<{ ok: boolean; client?: Client; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  const { data, error } = await supabase
    .from("exec_os_clients")
    .insert({ ...input, user_id: user.id })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, client: data as Client };
}

export async function updateClient(id: string, patch: Partial<Client>): Promise<{ ok: boolean; error?: string }> {
  // Strip non-editable fields
  const { id: _ignore, user_id, created_at, updated_at, ...editable } = patch as any;
  const { error } = await supabase
    .from("exec_os_clients")
    .update(editable)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Move a client to a new pipeline stage, with side effects:
 *  - status → 'active' sets acquired_at if not already set
 *  - status → 'churned'/'lost' clears next_action_at
 */
export async function setClientStatus(id: string, status: ClientStatus): Promise<{ ok: boolean; error?: string }> {
  const patch: Partial<Client> = { status };
  if (status === "active") {
    const existing = await getClient(id);
    if (existing && !existing.acquired_at) {
      patch.acquired_at = new Date().toISOString();
    }
  }
  if (status === "churned" || status === "lost") {
    patch.next_action_at = null;
  }
  return updateClient(id, patch);
}

// =============================================================================
// Pipeline aggregates — for the widget header KPIs
// =============================================================================

export interface PipelineSummary {
  hotLeadCount: number;        // lead + contacted + qualified
  proposalOutValueCents: number; // sum of one_time + mrr from proposal_sent clients
  activeMrrCents: number;      // sum of mrr_cents from active clients
  activeClientCount: number;
  overdueFollowUps: number;    // next_action_at in the past
  todayFollowUps: number;      // next_action_at today
}

export async function pipelineSummary(): Promise<PipelineSummary> {
  const { data, error } = await supabase
    .from("exec_os_clients")
    .select("status, one_time_value_cents, mrr_cents, next_action_at");
  if (error || !data) {
    return {
      hotLeadCount: 0,
      proposalOutValueCents: 0,
      activeMrrCents: 0,
      activeClientCount: 0,
      overdueFollowUps: 0,
      todayFollowUps: 0,
    };
  }
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday.getTime() + 86_400_000);

  let hotLeadCount = 0,
    proposalOutValueCents = 0,
    activeMrrCents = 0,
    activeClientCount = 0,
    overdueFollowUps = 0,
    todayFollowUps = 0;

  for (const c of data as Array<{ status: ClientStatus; one_time_value_cents: number; mrr_cents: number; next_action_at: string | null }>) {
    if (c.status === "lead" || c.status === "contacted" || c.status === "qualified") {
      hotLeadCount++;
    }
    if (c.status === "proposal_sent") {
      proposalOutValueCents += (c.one_time_value_cents ?? 0) + (c.mrr_cents ?? 0);
    }
    if (c.status === "active") {
      activeClientCount++;
      activeMrrCents += c.mrr_cents ?? 0;
    }
    if (c.next_action_at && c.status !== "churned" && c.status !== "lost") {
      const t = new Date(c.next_action_at).getTime();
      if (t < startOfToday.getTime()) overdueFollowUps++;
      else if (t < endOfToday.getTime()) todayFollowUps++;
    }
  }
  return {
    hotLeadCount,
    proposalOutValueCents,
    activeMrrCents,
    activeClientCount,
    overdueFollowUps,
    todayFollowUps,
  };
}

// =============================================================================
// Outreach logging — Cleo writes here when she drafts something; you also
// write here manually when you send something yourself (so the touchpoint
// log is unified).
// =============================================================================

export interface OutreachInput {
  client_id: string | null;
  channel: "linkedin" | "email" | "sms" | "call" | "meeting" | "dm" | "other";
  direction?: "outbound" | "inbound";
  subject?: string | null;
  body?: string | null;
  status?: "drafted" | "queued" | "sent" | "delivered" | "opened" | "replied" | "no_response" | "bounced";
  generated_by_agent_id?: string | null;
  source_agent_output_id?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logOutreach(input: OutreachInput): Promise<{ ok: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  const { error } = await supabase
    .from("exec_os_outreach")
    .insert({ ...input, user_id: user.id });
  if (error) return { ok: false, error: error.message };

  // Bump the client's last_touchpoint_at if linked
  if (input.client_id && (input.status === "sent" || input.direction === "inbound")) {
    await supabase
      .from("exec_os_clients")
      .update({ last_touchpoint_at: new Date().toISOString() })
      .eq("id", input.client_id);
  }
  return { ok: true };
}

// =============================================================================
// Currency formatting helper (used across widget)
// =============================================================================
export function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return "$0";
  const dollars = cents / 100;
  if (dollars >= 10_000) return `$${(dollars / 1000).toFixed(1)}K`;
  if (dollars >= 1000) return `$${dollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${dollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
