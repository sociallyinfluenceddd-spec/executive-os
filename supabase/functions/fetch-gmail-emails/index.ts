// Supabase Edge Function: fetch-gmail-emails
//
// Live Gmail reader + classifier. Replaces the Make.com → Supabase pipeline
// that was paused 2026-05-19 after every POST returned HTTP 400 "kind
// required" while Make marked the run Success.
//
// Flow:
//   1. JWT identifies the user
//   2. Look up stored Google tokens in exec_os_google_tokens
//   3. Refresh access_token if expired
//   4. Query Gmail API for two buckets:
//        - is:important is:inbox newer_than:14d   → kind='priority'
//        - is:unread is:inbox -is:important newer_than:14d → kind='needs_response'
//   5. For each message, fetch headers (From, Subject, Date, Snippet)
//   6. Upsert into exec_os_emails keyed on (user_id, external_id=gmail message id)
//   7. Return summary { priorityCount, needsResponseCount, refreshed_at }
//
// The Inbox widget continues reading from exec_os_emails directly. This
// function is the writer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    headers?: { name: string; value: string }[];
  };
  internalDate?: string;
};

interface EmailUpsert {
  user_id: string;
  account: string;
  external_id: string;
  kind: "priority" | "needs_response" | "invite" | "meeting";
  sender_name: string | null;
  sender_email: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string | null;
  status: string;
}

async function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Refresh failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return await res.json() as { access_token: string; expires_in: number; scope?: string };
}

/**
 * Parse a "From" header like '"Marie Chen" <marie@acme.co>' → { name, email }.
 * Falls back gracefully on weird formats.
 */
function parseFrom(value: string): { name: string | null; email: string | null } {
  if (!value) return { name: null, email: null };
  const match = value.match(/^\s*(?:"?([^"<]+?)"?\s*)?<\s*([^>]+?)\s*>\s*$/);
  if (match) {
    return { name: (match[1] ?? "").trim() || null, email: (match[2] ?? "").trim() || null };
  }
  // Bare email — "alice@example.com"
  if (/@/.test(value)) return { name: null, email: value.trim() };
  return { name: value.trim() || null, email: null };
}

function header(msg: GmailMessage, name: string): string | null {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

/**
 * Fetch metadata for a list of message IDs in parallel. Uses Gmail's
 * "messages.get?format=metadata" to keep payloads small (just headers).
 */
async function fetchMessages(ids: string[], accessToken: string): Promise<GmailMessage[]> {
  const out: GmailMessage[] = [];
  // Throttle to ~10 concurrent so we don't trip Gmail rate limits
  const concurrency = 10;
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const fetched = await Promise.all(
      batch.map(async (id) => {
        const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
        url.searchParams.set("format", "metadata");
        // Only the headers we actually need — cheaper than full metadata
        for (const h of ["From", "Subject", "Date"]) {
          url.searchParams.append("metadataHeaders", h);
        }
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          console.error(`messages.get failed for ${id}: ${res.status}`);
          return null;
        }
        return await res.json() as GmailMessage;
      }),
    );
    for (const m of fetched) if (m) out.push(m);
  }
  return out;
}

/**
 * List message IDs matching a Gmail query. Capped at 30 per bucket for the
 * Inbox widget — Donna doesn't need 100 priority emails staring at her.
 */
async function listMessageIds(query: string, accessToken: string, max = 30): Promise<string[]> {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(max));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`messages.list failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json() as { messages?: { id: string }[] };
  return (data.messages ?? []).map((m) => m.id);
}

function toUpsert(
  msg: GmailMessage,
  userId: string,
  account: string,
  kind: EmailUpsert["kind"],
): EmailUpsert {
  const fromRaw = header(msg, "From") ?? "";
  const { name, email } = parseFrom(fromRaw);
  const subject = header(msg, "Subject");
  const date = header(msg, "Date");
  const receivedAt = date
    ? new Date(date).toISOString()
    : msg.internalDate
      ? new Date(parseInt(msg.internalDate, 10)).toISOString()
      : null;
  return {
    user_id: userId,
    account,
    external_id: msg.id,
    kind,
    sender_name: name,
    sender_email: email,
    subject,
    snippet: msg.snippet ?? null,
    received_at: receivedAt,
    status: msg.labelIds?.includes("UNREAD") ? "unread" : "read",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!supabaseUrl || !supabaseAnonKey || !serviceKey || !clientId || !clientSecret) {
    return json({ error: "Server not configured (missing env)" }, 500);
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: tokenRow, error: tokenErr } = await admin
    .from("exec_os_google_tokens")
    .select("access_token, refresh_token, expires_at, google_account_email, scope")
    .eq("user_id", user.id)
    .maybeSingle();
  if (tokenErr) {
    console.error("token lookup failed", tokenErr);
    return json({ error: "Token lookup failed" }, 500);
  }
  if (!tokenRow) {
    return json({ error: "not_connected", message: "Connect Google in Settings first." }, 400);
  }

  // Check that the stored token actually has Gmail scope. If it was granted
  // before we added gmail.readonly, Donna needs to reconnect.
  const scopeStr = (tokenRow as { scope?: string }).scope ?? "";
  if (!scopeStr.includes("gmail.readonly")) {
    return json({
      error: "scope_missing",
      message: "Google connection is missing Gmail permission. Disconnect + reconnect Google in Settings to grant Gmail read access.",
    }, 400);
  }

  // Refresh access token if it expires in the next 60s
  let accessToken = tokenRow.access_token;
  const expiresAt = new Date(tokenRow.expires_at).getTime();
  if (Date.now() > expiresAt - 60_000) {
    try {
      const fresh = await refreshAccessToken(tokenRow.refresh_token, clientId, clientSecret);
      accessToken = fresh.access_token;
      const newExpiresAt = new Date(Date.now() + fresh.expires_in * 1000).toISOString();
      await admin
        .from("exec_os_google_tokens")
        .update({ access_token: accessToken, expires_at: newExpiresAt })
        .eq("user_id", user.id);
    } catch (e) {
      console.error("refresh failed", e);
      return json({ error: "refresh_failed", message: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  // Fetch two buckets in parallel
  let priorityIds: string[] = [];
  let needsResponseIds: string[] = [];
  try {
    [priorityIds, needsResponseIds] = await Promise.all([
      listMessageIds("is:important is:inbox newer_than:14d", accessToken, 30),
      listMessageIds("is:unread is:inbox -is:important newer_than:14d", accessToken, 30),
    ]);
  } catch (e) {
    console.error("gmail list failed", e);
    return json({ error: "gmail_api_failed", message: e instanceof Error ? e.message : String(e) }, 502);
  }

  // De-dupe: a message in both buckets gets the higher-priority kind
  const priorityIdSet = new Set(priorityIds);
  const needsResponseUnique = needsResponseIds.filter((id) => !priorityIdSet.has(id));

  const account = tokenRow.google_account_email;

  // Fetch metadata for all messages
  const [priorityMsgs, needsResponseMsgs] = await Promise.all([
    fetchMessages(priorityIds, accessToken),
    fetchMessages(needsResponseUnique, accessToken),
  ]);

  const upserts: EmailUpsert[] = [
    ...priorityMsgs.map((m) => toUpsert(m, user.id, account, "priority")),
    ...needsResponseMsgs.map((m) => toUpsert(m, user.id, account, "needs_response")),
  ];

  if (upserts.length > 0) {
    const { error: upErr } = await admin
      .from("exec_os_emails")
      .upsert(upserts, { onConflict: "user_id,external_id" });
    if (upErr) {
      console.error("emails upsert failed", upErr);
      return json({ error: "upsert_failed", message: upErr.message }, 500);
    }
  }

  // Best-effort: prune emails older than 30 days from these two kinds so the
  // table doesn't grow unbounded. Email widget only ever shows recent stuff.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  await admin
    .from("exec_os_emails")
    .delete()
    .eq("user_id", user.id)
    .in("kind", ["priority", "needs_response"])
    .lt("received_at", thirtyDaysAgo);

  return json({
    account,
    refreshed_at: new Date().toISOString(),
    counts: {
      priority: priorityMsgs.length,
      needs_response: needsResponseMsgs.length,
    },
  });
});
