// Supabase Edge Function: google-oauth-callback
//
// Public endpoint (verify_jwt = false) because Google redirects users
// here directly — no JWT in that request. Authorization comes from the
// `state` parameter we set in google-oauth-start (encodes user_id +
// nonce). State is echoed by Google unchanged, so we can trust it
// matches the user who initiated the flow.
//
// Steps:
//   1. Parse code + state from query params
//   2. Recover user_id from state
//   3. Exchange code for tokens at Google's token endpoint
//   4. Fetch userinfo to record which Google account was connected
//   5. Upsert into exec_os_google_tokens
//   6. Redirect back to the app's settings page with status

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function html(body: string, status = 200) {
  // Self-closing landing page that posts a message back to the opener
  // and closes itself. This is the cleanest UX when the flow runs in a
  // popup — the parent window listens for the postMessage and updates
  // the Settings UI.
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

function renderResult(status: "ok" | "error", message: string, account?: string) {
  const safeMessage = message.replace(/</g, "&lt;");
  const payload = JSON.stringify({ source: "executive-os-google-oauth", status, message, account });
  return html(`<!doctype html>
<html><head><meta charset="utf-8"><title>Calendar connected</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 2rem; max-width: 32rem; margin: 0 auto; color: #1f2937; }
  .ok { color: #166534; }
  .err { color: #991b1b; }
</style>
</head><body>
<h1 class="${status === "ok" ? "ok" : "err"}">${status === "ok" ? "Calendar connected" : "Connection failed"}</h1>
<p>${safeMessage}</p>
${account ? `<p><strong>Account:</strong> ${account}</p>` : ""}
<p>You can close this window. The dashboard will refresh automatically.</p>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage(${payload}, "*");
    }
  } catch (e) { /* opener may be closed */ }
  setTimeout(() => { try { window.close(); } catch (e) {} }, 2000);
</script>
</body></html>`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return renderResult("error", `Google returned: ${errorParam}`);
  }
  if (!code || !state) {
    return renderResult("error", "Missing code or state in callback URL.");
  }

  const [userId] = state.split(":");
  if (!userId || !userId.match(/^[0-9a-f-]{36}$/)) {
    return renderResult("error", "Invalid state parameter.");
  }

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!clientId || !clientSecret || !supabaseUrl || !serviceKey) {
    return renderResult("error", "Server is missing required secrets.");
  }

  const redirectUri = `${supabaseUrl}/functions/v1/google-oauth-callback`;

  // Step 1: exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("token exchange failed", tokenRes.status, body);
    return renderResult("error", `Token exchange failed: ${body.slice(0, 200)}`);
  }
  const tokenData = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  if (!tokenData.refresh_token) {
    // This happens when the user previously granted consent and Google
    // skipped the consent screen. Our google-oauth-start sets
    // prompt=consent precisely to avoid this, but warn loudly if it ever
    // happens — without refresh_token the integration breaks after 1h.
    return renderResult(
      "error",
      "Google did not return a refresh token. Revoke access at https://myaccount.google.com/permissions and try again.",
    );
  }

  // Step 2: fetch userinfo to know which Google account this is
  const userInfoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userInfoRes.ok) {
    return renderResult("error", "Could not fetch Google userinfo.");
  }
  const userInfo = await userInfoRes.json() as { email?: string };
  const googleAccountEmail = userInfo.email ?? "unknown";

  // Step 3: upsert into exec_os_google_tokens
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
  const { error: upsertErr } = await admin
    .from("exec_os_google_tokens")
    .upsert({
      user_id: userId,
      google_account_email: googleAccountEmail,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      scope: tokenData.scope,
      expires_at: expiresAt,
    }, { onConflict: "user_id" });
  if (upsertErr) {
    console.error("upsert error", upsertErr);
    return renderResult("error", `Failed to save tokens: ${upsertErr.message}`);
  }

  return renderResult("ok", "You can now fetch calendar events directly.", googleAccountEmail);
});
