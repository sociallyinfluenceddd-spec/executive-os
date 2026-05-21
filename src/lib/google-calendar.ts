// Client helpers for the Google Calendar OAuth + fetch flow.
// Wraps the three edge functions so callers don't need to deal with
// JWT plumbing, popup management, or refresh handling.

import { supabase } from "@/integrations/supabase/client";

export interface NormalizedCalendarEvent {
  id: string;
  external_id: string;
  account: string;
  title: string | null;
  description: string | null;
  start_at: string | null;
  end_at: string | null;
  is_all_day: boolean;
  location: string | null;
  video_url: string | null;
  status: string | null;
  organizer_email: string | null;
  attendees: { email?: string; name?: string; response_status?: string }[];
  calendar_id: string;
  calendar_name: string;
}

export interface GoogleConnectionStatus {
  connected: boolean;
  account: string | null;
  expiresAt: string | null;
  scope: string | null;
}

export interface GoogleAccountRow {
  account: string;
  expiresAt: string;
  scope: string;
  hasGmail: boolean;
}

/**
 * Read ALL connected Google accounts for the current user. Each row has its
 * own access/refresh token pair and scope set.
 */
export async function getGoogleConnections(): Promise<GoogleAccountRow[]> {
  const { data, error } = await supabase
    .from("exec_os_google_tokens")
    .select("google_account_email, expires_at, scope");
  if (error || !data) return [];
  return (data as Array<{ google_account_email: string; expires_at: string; scope: string }>).map((r) => ({
    account: r.google_account_email,
    expiresAt: r.expires_at,
    scope: r.scope,
    hasGmail: r.scope.includes("gmail.readonly"),
  }));
}

/**
 * Legacy single-account view. Returns the first connected account (or
 * not-connected if none). Kept around so older callers don't break.
 */
export async function getGoogleConnection(): Promise<GoogleConnectionStatus> {
  const all = await getGoogleConnections();
  if (all.length === 0) return { connected: false, account: null, expiresAt: null, scope: null };
  const first = all[0];
  return { connected: true, account: first.account, expiresAt: first.expiresAt, scope: first.scope };
}

/**
 * Kicks off the OAuth flow in a popup window. Resolves when the callback
 * posts back via window.postMessage. The popup is created synchronously
 * inside the click handler (otherwise browsers block it).
 */
export async function connectGoogleCalendar(): Promise<{ status: "ok" | "error"; message: string; account?: string }> {
  // Open the popup IMMEDIATELY (browser popup blockers require user-gesture-synchronous open)
  const popup = window.open("about:blank", "google-oauth", "width=520,height=720");
  if (!popup) {
    return { status: "error", message: "Popup blocked. Allow popups for this site and try again." };
  }

  try {
    const { data, error } = await supabase.functions.invoke("google-oauth-start", { body: {} });
    if (error || !data?.url) {
      popup.close();
      return { status: "error", message: error?.message ?? "Could not start OAuth flow." };
    }
    popup.location.href = data.url;
  } catch (e) {
    popup.close();
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }

  // Wait for the callback page to postMessage back. Timeout after 5 min.
  return await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({ status: "error", message: "Authorization timed out." });
    }, 5 * 60 * 1000);

    function onMessage(ev: MessageEvent) {
      const data = ev.data;
      if (!data || data.source !== "executive-os-google-oauth") return;
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve({
        status: data.status === "ok" ? "ok" : "error",
        message: data.message ?? "",
        account: data.account,
      });
    }
    window.addEventListener("message", onMessage);
  });
}

/**
 * Disconnect: delete the stored token row. Note that this does NOT revoke
 * the OAuth grant on Google's side — the user can do that at
 * https://myaccount.google.com/permissions if they want to fully revoke.
 */
export async function disconnectGoogleCalendar(account?: string): Promise<{ ok: boolean; error?: string }> {
  let q = supabase.from("exec_os_google_tokens").delete();
  if (account) {
    q = q.eq("google_account_email", account);
  } else {
    // No account specified = nuke ALL of the caller's tokens. RLS limits this
    // to the caller's own rows.
    q = q.neq("user_id", "00000000-0000-0000-0000-000000000000");
  }
  const { error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Fetch upcoming events live from Google. Default window is now → now+30d.
 * Pass days=1 for "today only" or override timeMin/timeMax for the
 * day-picker case.
 */
export async function fetchCalendarEvents(opts?: {
  days?: number;
  timeMin?: string;
  timeMax?: string;
}): Promise<{ events: NormalizedCalendarEvent[]; account: string | null; error?: string }> {
  const params = new URLSearchParams();
  if (opts?.days) params.set("days", String(opts.days));
  if (opts?.timeMin) params.set("timeMin", opts.timeMin);
  if (opts?.timeMax) params.set("timeMax", opts.timeMax);

  const { data, error } = await supabase.functions.invoke(
    `fetch-calendar-events${params.toString() ? `?${params.toString()}` : ""}`,
    { body: {} },
  );
  if (error) {
    return { events: [], account: null, error: error.message };
  }
  if (data?.error) {
    return { events: [], account: null, error: data.message ?? data.error };
  }
  return { events: (data?.events ?? []) as NormalizedCalendarEvent[], account: data?.account ?? null };
}
