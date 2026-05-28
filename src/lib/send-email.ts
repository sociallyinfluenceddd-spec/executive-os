// Client wrapper for the send-gmail edge function.
//
// Sends a real email through the user's connected Gmail. JWT is forwarded
// automatically by supabase-js. Only called from an explicit "Send" click.

import { supabase } from "@/integrations/supabase/client";

export interface SendEmailResult {
  ok: boolean;
  from?: string;
  to?: string;
  /** Distinguishes "you're connected read-only" from other failures so the
   *  UI can prompt a reconnect instead of a generic error. */
  needsReconnect?: boolean;
  error?: string;
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  body: string;
  fromAccount?: string;
  outputId?: string;
}): Promise<SendEmailResult> {
  const { data, error } = await supabase.functions.invoke("send-gmail", { body: args });
  if (error) {
    // Edge function non-2xx responses surface here; the JSON body is attached
    // to error.context for FunctionsHttpError. Best-effort parse for scope.
    let parsed: { error?: string; message?: string } | null = null;
    try {
      // @ts-expect-error context is present on FunctionsHttpError
      parsed = await error.context?.json?.();
    } catch { /* ignore */ }
    if (parsed?.error === "scope_missing") {
      return { ok: false, needsReconnect: true, error: parsed.message };
    }
    return { ok: false, error: parsed?.message ?? error.message };
  }
  if (!data?.ok) {
    if (data?.error === "scope_missing") return { ok: false, needsReconnect: true, error: data.message };
    return { ok: false, error: data?.message ?? data?.error ?? "Send failed" };
  }
  return { ok: true, from: data.from, to: data.to };
}
