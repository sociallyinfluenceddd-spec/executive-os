// Sage agent — client-side runner.
//
// Wraps the sage-run edge function. JWT is forwarded automatically by supabase-js.

import { supabase } from "@/integrations/supabase/client";

export interface SageRunResult {
  ok: boolean;
  outputs?: number;
  summary?: string;
  error?: string;
}

/**
 * Trigger Sage manually — produces a focus directive + inbox triage entries.
 * Same code path as the daily 5:30am cron, just scoped to the calling user.
 */
export async function runSageNow(): Promise<SageRunResult> {
  const { data, error } = await supabase.functions.invoke("sage-run", {
    body: { mode: "manual" },
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error ?? "Sage failed" };
  return { ok: true, outputs: data.outputs, summary: data.summary };
}
