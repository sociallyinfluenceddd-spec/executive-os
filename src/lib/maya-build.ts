// Client wrapper for the maya-build edge function.
//
// Dispatches the Claude Autonomous Task workflow: Claude Code builds the task
// and opens a PR. Called from the "Build it" action on a To Ship task.

import { supabase } from "@/integrations/supabase/client";

export interface MayaBuildResult {
  ok: boolean;
  actionsUrl?: string;
  /** True when GITHUB_DISPATCH_TOKEN isn't set yet — UI can guide setup. */
  notConfigured?: boolean;
  error?: string;
}

export async function dispatchBuild(args: { taskId?: string; prompt: string }): Promise<MayaBuildResult> {
  const { data, error } = await supabase.functions.invoke("maya-build", { body: args });
  if (error) {
    let parsed: { error?: string; message?: string } | null = null;
    try {
      // @ts-expect-error context present on FunctionsHttpError
      parsed = await error.context?.json?.();
    } catch { /* ignore */ }
    if (parsed?.error === "not_configured") return { ok: false, notConfigured: true, error: parsed.message };
    return { ok: false, error: parsed?.message ?? error.message };
  }
  if (!data?.ok) {
    if (data?.error === "not_configured") return { ok: false, notConfigured: true, error: data.message };
    return { ok: false, error: data?.message ?? data?.error ?? "Build dispatch failed" };
  }
  return { ok: true, actionsUrl: data.actions_url };
}
