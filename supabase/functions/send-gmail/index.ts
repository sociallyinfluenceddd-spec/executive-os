// Supabase Edge Function: send-gmail
//
// Sends a real email through the user's connected Gmail account. Triggered
// by an explicit click in the dashboard (the "Send" button on a Cleo email
// draft) — never autonomously. JWT required: the user must be the one asking.
//
// Flow:
//   1. Verify the caller's JWT.
//   2. Look up the user's Google tokens. Pick the account to send FROM
//      (fromAccount if given, else the first connected account).
//   3. Refresh the access token if it's expired.
//   4. Require the gmail.send (or gmail.modify) scope — if the user only
//      granted gmail.readonly, return scope_missing so the UI can prompt a
//      re-authorize.
//   5. Build an RFC 2822 message, base64url-encode it, POST to Gmail's
//      messages.send endpoint.
//
// Returns { ok: true, from } on success so the UI can confirm which inbox
// the message actually left from.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

// Encode a UTF-8 string to base64url (Gmail's required encoding for raw).
function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// RFC 2822 "encoded-word" for non-ASCII subjects so they don't get mangled.
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
}

function buildMime(to: string, from: string, subject: string, body: string): string {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
  ];
  // CRLF line endings per RFC 2822, blank line between headers and body.
  return headers.join("\r\n") + "\r\n\r\n" + body.replace(/\n/g, "\r\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
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

  let payload: { to?: string; subject?: string; body?: string; fromAccount?: string; outputId?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const to = (payload.to ?? "").trim();
  const subject = (payload.subject ?? "").trim();
  const body = payload.body ?? "";
  if (!to || !/@/.test(to)) return json({ error: "missing_recipient", message: "No valid recipient email." }, 400);
  if (!body.trim()) return json({ error: "empty_body", message: "Nothing to send — body is empty." }, 400);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tokenRows, error: tokenErr } = await admin
    .from("exec_os_google_tokens")
    .select("access_token, refresh_token, expires_at, google_account_email, scope")
    .eq("user_id", user.id);
  if (tokenErr) {
    console.error("token lookup failed", tokenErr);
    return json({ error: "Token lookup failed" }, 500);
  }
  if (!tokenRows || tokenRows.length === 0) {
    return json({ error: "not_connected", message: "Connect a Google account in Settings first." }, 400);
  }

  // Pick the account to send FROM. Match fromAccount if provided; else first.
  const rows = tokenRows as Array<{
    access_token: string; refresh_token: string; expires_at: string;
    google_account_email: string; scope: string;
  }>;
  const tok = (payload.fromAccount
    ? rows.find((r) => r.google_account_email === payload.fromAccount)
    : null) ?? rows[0];

  // The whole point: require send capability. readonly-only can't send.
  if (!tok.scope.includes("gmail.send") && !tok.scope.includes("gmail.modify")) {
    return json({
      error: "scope_missing",
      message: "This account is connected read-only. Reconnect it in Settings to grant send access.",
      from: tok.google_account_email,
    }, 403);
  }

  // Refresh if expiring within 60s.
  let accessToken = tok.access_token;
  const expMs = new Date(tok.expires_at).getTime();
  if (Date.now() > expMs - 60_000) {
    try {
      const fresh = await refreshAccessToken(tok.refresh_token, clientId, clientSecret);
      accessToken = fresh.access_token;
      await admin
        .from("exec_os_google_tokens")
        .update({
          access_token: accessToken,
          expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
        })
        .eq("user_id", user.id)
        .eq("google_account_email", tok.google_account_email);
    } catch (e) {
      console.error("refresh failed", e);
      return json({ error: "refresh_failed", message: "Could not refresh Google token. Reconnect in Settings." }, 500);
    }
  }

  const raw = base64UrlEncode(buildMime(to, tok.google_account_email, subject, body));
  const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!sendRes.ok) {
    const errText = await sendRes.text();
    console.error("gmail send failed", sendRes.status, errText.slice(0, 300));
    return json({ error: "send_failed", message: `Gmail rejected the send (${sendRes.status}).` }, 502);
  }
  const sent = await sendRes.json() as { id?: string; threadId?: string };

  // Best-effort: mark the linked agent output as sent so the Brief updates.
  if (payload.outputId) {
    await admin
      .from("exec_os_agent_outputs")
      .update({ status: "sent", acted_at: new Date().toISOString(), acted_by: "donna" })
      .eq("id", payload.outputId)
      .eq("user_id", user.id);
  }

  return json({ ok: true, from: tok.google_account_email, to, message_id: sent.id ?? null });
});
