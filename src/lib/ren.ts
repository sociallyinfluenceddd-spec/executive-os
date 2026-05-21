// Ren agent — client-side runner.
//
// Wraps the ren-run edge function. JWT is forwarded automatically by supabase-js.

import { supabase } from "@/integrations/supabase/client";

export interface RenRunResult {
  ok: boolean;
  outputs?: number;
  summary?: string;
  error?: string;
}

/**
 * Trigger Ren manually — produces 3 TikTok hook drafts.
 * Same code path as the daily 6am cron, just scoped to the calling user.
 */
export async function runRenNow(): Promise<RenRunResult> {
  const { data, error } = await supabase.functions.invoke("ren-run", {
    body: { mode: "manual" },
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error ?? "Ren failed" };
  return { ok: true, outputs: data.outputs, summary: data.summary };
}
