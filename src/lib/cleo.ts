// Cleo agent — client-side runners.
//
// Wraps the cleo-run edge function. All calls authenticated via the user's
// JWT (passed automatically by supabase-js). Returns a friendly shape.

import { supabase } from "@/integrations/supabase/client";

export interface CleoRunResult {
  ok: boolean;
  outputs?: number;
  summary?: string;
  error?: string;
  output_id?: string | null;
  client_id?: string | null;
}

async function invoke(payload: Record<string, unknown>): Promise<CleoRunResult> {
  const { data, error } = await supabase.functions.invoke("cleo-run", { body: payload });
  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data?.ok) {
    return { ok: false, error: data?.error ?? "Cleo failed" };
  }
  return data as CleoRunResult;
}

/**
 * Run Cleo for the whole pipeline — finds all clients needing action and
 * drafts outreach for each. Returns a summary string.
 */
export function runCleoNow(): Promise<CleoRunResult> {
  return invoke({ mode: "manual" });
}

/**
 * Run Cleo for a single client. Used by the "Cleo Now" button on each row
 * in the Pipeline widget.
 */
export function runCleoForClient(clientId: string): Promise<CleoRunResult> {
  return invoke({ mode: "single", client_id: clientId });
}

/**
 * Paste a LinkedIn URL → Cleo creates a 'lead' client and drafts first-touch
 * outreach in one shot. Optional notes (name, title, context) help Cleo since
 * v1 doesn't scrape LinkedIn.
 */
export function runCleoCold(opts: {
  linkedinUrl: string;
  notes?: string;
}): Promise<CleoRunResult> {
  return invoke({ mode: "cold", linkedin_url: opts.linkedinUrl, notes: opts.notes });
}
