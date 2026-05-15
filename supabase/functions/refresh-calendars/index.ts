// Supabase Edge Function: refresh-calendars
//
// Triggers the Make.com calendar-sync scenarios on demand so Donna can
// pull fresh calendar events without waiting for the daily 5am cron.
//
// Authentication: the function is protected by verify_jwt = true (set in
// supabase/config.toml) so only authenticated Lovable users can hit it.
//
// Talks to Make's REST API using a personal API token stored as the
// MAKE_API_TOKEN secret in Lovable Cloud Secrets (scope: scenarios:run).

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

// Calendar-sync scenario IDs (Make.com, us2 region).
// Donna's primary account + ideafetti account. If Donna adds more
// calendars later, drop their scenario IDs in here.
const CALENDAR_SCENARIO_IDS = [
  "5067108", // donna@donnabdicenso.com
  "5072163", // hello@ideafetti.com
];

const MAKE_API_BASE = "https://us2.make.com/api/v2";

type ScenarioResult =
  | { id: string; ok: true; execution_id?: string | number }
  | { id: string; ok: false; status: number; error: string };

async function runScenario(id: string, token: string): Promise<ScenarioResult> {
  try {
    const res = await fetch(`${MAKE_API_BASE}/scenarios/${id}/run`, {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        id,
        ok: false,
        status: res.status,
        error: body.slice(0, 240),
      };
    }
    // Make returns 200 with { executionId } or 202 Accepted with no body.
    let executionId: string | number | undefined;
    try {
      const data = await res.json();
      executionId = data?.executionId ?? data?.execution?.id;
    } catch {
      /* 202 with empty body is fine */
    }
    return { id, ok: true, execution_id: executionId };
  } catch (err) {
    return {
      id,
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Confirm caller is authenticated (verify_jwt=true gives us a user via
  // the Authorization header; we also double-check here).
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

  const token = Deno.env.get("MAKE_API_TOKEN");
  if (!token) {
    return json(
      { error: "MAKE_API_TOKEN secret not set in Lovable Cloud Secrets" },
      500,
    );
  }

  const started = Date.now();
  const results = await Promise.all(
    CALENDAR_SCENARIO_IDS.map((id) => runScenario(id, token)),
  );
  const ok = results.every((r) => r.ok);

  return json(
    {
      ok,
      duration_ms: Date.now() - started,
      results,
    },
    ok ? 200 : 207, // 207 Multi-Status if any failed
  );
});
