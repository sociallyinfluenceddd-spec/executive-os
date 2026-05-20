// Supabase Edge Function: fetch-calendar-events
//
// Live Google Calendar event reader. Replaces the Make.com → Supabase
// cache pipeline (paused 2026-05-19 after the Single-Events expansion
// bug). The frontend calls this directly when the calendar widget loads
// or the user clicks "Refresh now."
//
// Flow:
//   1. JWT identifies the user
//   2. Look up stored Google tokens in exec_os_google_tokens
//   3. If access_token expired, refresh it (and update the row)
//   4. Call calendar.events.list with timeMin=now, timeMax=now+30d,
//      orderBy=startTime, singleEvents=true — the configuration the
//      Make.com scenario should have had
//   5. Normalize and return events
//
// Why no caching layer: Google Calendar API is fast (~200ms typical) and
// has generous quotas (1M req/day per project). The previous cache table
// (exec_os_calendar_events) created more bugs than it solved — stale
// rows, format mismatches, the entire 2055-date debacle. Live reads
// eliminate that surface area.

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

type GoogleEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { uri?: string; entryPointType?: string }[] };
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string }[];
  recurringEventId?: string;
};

type NormalizedEvent = {
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
};

function normalize(ev: GoogleEvent, calendarEmail: string): NormalizedEvent {
  const isAllDay = !!ev.start?.date && !ev.start?.dateTime;
  // All-day events use `date` (YYYY-MM-DD). Treat midnight local time of
  // that date as the start. Without a tz hint, the frontend interprets it
  // in the user's local zone — which matches Google Calendar's display.
  const start = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00` : null);
  const end = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00` : null);

  // Prefer hangoutLink, fall back to first entry point uri in conferenceData
  const videoUrl =
    ev.hangoutLink ??
    ev.conferenceData?.entryPoints?.find((e) => e.uri?.startsWith("http"))?.uri ??
    null;

  return {
    id: ev.id,
    external_id: ev.id,
    account: calendarEmail,
    title: ev.summary ?? null,
    description: ev.description ?? null,
    start_at: start,
    end_at: end,
    is_all_day: isAllDay,
    location: ev.location ?? null,
    video_url: videoUrl,
    status: ev.status ?? null,
    organizer_email: ev.organizer?.email ?? null,
    attendees: (ev.attendees ?? []).map((a) => ({
      email: a.email,
      name: a.displayName,
      response_status: a.responseStatus,
    })),
    calendar_id: calendarEmail,
    calendar_name: calendarEmail,
  };
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

  // Read tokens via service role (RLS would also allow this for the user,
  // but service role is simpler and avoids a second auth round-trip).
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: tokenRow, error: tokenErr } = await admin
    .from("exec_os_google_tokens")
    .select("access_token, refresh_token, expires_at, google_account_email")
    .eq("user_id", user.id)
    .maybeSingle();
  if (tokenErr) {
    console.error("token lookup failed", tokenErr);
    return json({ error: "Token lookup failed" }, 500);
  }
  if (!tokenRow) {
    return json({ error: "not_connected", message: "Connect Google Calendar in Settings first." }, 400);
  }

  // Refresh access token if it expires in the next 60s (buffer against clock skew)
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

  // Parse query window. Defaults: now → now + 30 days. The frontend can
  // override with ?days=N or ?timeMin/timeMax for the day picker.
  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days");
  const days = daysParam ? Math.min(90, Math.max(1, parseInt(daysParam, 10) || 30)) : 30;
  const timeMin = url.searchParams.get("timeMin") ?? new Date().toISOString();
  const timeMax = url.searchParams.get("timeMax") ?? new Date(Date.now() + days * 86_400_000).toISOString();

  // Google Calendar API: events.list on primary calendar.
  // singleEvents=true expands recurrences. orderBy=startTime requires it.
  // maxResults=250 is the API max — plenty for a 30-day window.
  const eventsUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  eventsUrl.searchParams.set("timeMin", timeMin);
  eventsUrl.searchParams.set("timeMax", timeMax);
  eventsUrl.searchParams.set("singleEvents", "true");
  eventsUrl.searchParams.set("orderBy", "startTime");
  eventsUrl.searchParams.set("maxResults", "250");

  const eventsRes = await fetch(eventsUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!eventsRes.ok) {
    const body = await eventsRes.text();
    console.error("events.list failed", eventsRes.status, body);
    return json({ error: "google_api_failed", status: eventsRes.status, message: body.slice(0, 400) }, 502);
  }
  const eventsData = await eventsRes.json() as { items?: GoogleEvent[] };
  const normalized = (eventsData.items ?? [])
    // Skip cancelled events (Google returns tombstones)
    .filter((ev) => ev.status !== "cancelled")
    .map((ev) => normalize(ev, tokenRow.google_account_email));

  return json({
    account: tokenRow.google_account_email,
    timeMin,
    timeMax,
    count: normalized.length,
    events: normalized,
  });
});
