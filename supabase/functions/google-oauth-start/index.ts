// Supabase Edge Function: google-oauth-start
//
// Returns the Google OAuth consent URL for the authenticated user. The
// frontend opens this URL in a new tab; the user grants calendar access;
// Google redirects to google-oauth-callback with an auth code; the
// callback exchanges code for tokens and stores them.
//
// State parameter: we encode the user_id so the callback can attribute
// the returned tokens to the right account. Without this, the callback
// would have no JWT context (Google's redirect doesn't carry auth).

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

// Scopes we request:
//   calendar.events.readonly — read events from any of the user's calendars.
//     Narrower than full /calendar; we don't need write or settings access.
//   userinfo.email — so the callback can record which Google account was
//     connected (Donna has multiple google accounts).
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return json({ error: "Supabase env not configured" }, 500);
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  if (!clientId) {
    return json(
      { error: "GOOGLE_OAUTH_CLIENT_ID secret not set in Lovable Cloud Secrets" },
      500,
    );
  }

  // The redirect_uri must match exactly what was registered in Google
  // Cloud Console (authorized redirect URIs on the OAuth client).
  const redirectUri = `${supabaseUrl}/functions/v1/google-oauth-callback`;

  // State carries the user_id so the callback can attribute tokens.
  // Google echoes it back unchanged. We sign it lightly by also including
  // a short random nonce — full CSRF defense would store nonce server-side,
  // but for a single-user dashboard this is adequate.
  const nonce = crypto.randomUUID().slice(0, 8);
  const state = `${user.id}:${nonce}`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    // access_type=offline + prompt=consent is the only combo that reliably
    // returns a refresh_token. Without prompt=consent, Google omits the
    // refresh_token on subsequent grants for the same scope/client pair.
    access_type: "offline",
    prompt: "consent",
    state,
    include_granted_scopes: "true",
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return json({ url: authUrl });
});
