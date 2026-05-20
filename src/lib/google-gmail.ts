// Gmail refresh — calls the fetch-gmail-emails edge function to live-pull
// Inbox messages from Gmail API and upsert them into exec_os_emails. The
// frontend keeps reading from exec_os_emails as it did before; this is just
// the refresher that replaces the dead Make.com pipeline.

import { supabase } from "@/integrations/supabase/client";

export interface GmailRefreshResult {
  ok: boolean;
  account?: string | null;
  refreshed_at?: string;
  counts?: { priority: number; needs_response: number };
  error?: string;
  errorCode?: string; // "not_connected" | "scope_missing" | "refresh_failed" | "gmail_api_failed"
}

/**
 * Trigger a server-side Gmail refresh. Safe to call on every page load —
 * the edge function upserts by external_id so re-runs don't duplicate.
 * Returns a counts summary so we can surface "X new" in the UI later.
 */
export async function refreshGmail(): Promise<GmailRefreshResult> {
  const { data, error } = await supabase.functions.invoke("fetch-gmail-emails", { body: {} });
  if (error) {
    return { ok: false, error: error.message };
  }
  if (data?.error) {
    return {
      ok: false,
      error: data.message ?? data.error,
      errorCode: data.error,
    };
  }
  return {
    ok: true,
    account: data?.account ?? null,
    refreshed_at: data?.refreshed_at,
    counts: data?.counts,
  };
}
