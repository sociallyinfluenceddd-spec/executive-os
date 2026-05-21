// Maya agent — client-side runner.
//
// Wraps the maya-run edge function. JWT forwarded by supabase-js.

import { supabase } from "@/integrations/supabase/client";

export interface MayaRunResult {
  ok: boolean;
  outputs?: number;
  summary?: string;
  error?: string;
}

/**
 * Trigger Maya manually — picks the highest-leverage pending task and
 * drafts the build focus + approach notes. Same code path as the 5:45am
 * cron, scoped to the calling user.
 */
export async function runMayaNow(): Promise<MayaRunResult> {
  const { data, error } = await supabase.functions.invoke("maya-run", {
    body: { mode: "manual" },
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error ?? "Maya failed" };
  return { ok: true, outputs: data.outputs, summary: data.summary };
}
