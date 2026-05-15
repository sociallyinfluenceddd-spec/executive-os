// Supabase Edge Function: ingest-calendar
// Public endpoint guarded by X-Ingest-Token header. Deployed with verify_jwt = false.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Ingest-Token, x-ingest-token",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function text(body: string, status: number) {
  return new Response(body, { status, headers: corsHeaders });
}

interface Payload {
  user_email: string;
  account: string;
  external_id: string;
  title?: string | null;
  description?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  organizer_email?: string | null;
  location?: string | null;
  video_url?: string | null;
  is_all_day?: boolean | null;
  status?: string | null;
  attendees?: Array<{ email?: string; name?: string; response_status?: string }> | null;
  calendar_id?: string | null;
  calendar_name?: string | null;
}

function validate(body: any): { ok: true; data: Payload } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be object" };
  for (const k of ["user_email", "account", "external_id"]) {
    if (typeof body[k] !== "string" || !body[k]) return { ok: false, error: `${k} required` };
  }
  if (body.user_email.length > 320) return { ok: false, error: "user_email too long" };
  if (body.external_id.length > 512) return { ok: false, error: "external_id too long" };
  if (body.account.length > 320) return { ok: false, error: "account too long" };
  return { ok: true, data: body as Payload };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return text("Method not allowed", 405);

  const expected = Deno.env.get("INGEST_TOKEN");
  if (!expected) return text("Server not configured", 500);
  const provided = req.headers.get("x-ingest-token");
  if (!provided || provided !== expected) return text("Unauthorized", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return text("Invalid JSON", 400);
  }

  // Tolerate empty event payloads (Make emits these when a calendar has no upcoming events)
  if (
    body &&
    typeof body === "object" &&
    (typeof (body as any).external_id !== "string" || (body as any).external_id === "")
  ) {
    return json({ status: "skipped", reason: "empty event payload" }, 200);
  }

  const v = validate(body);
  if (!v.ok) return json({ error: "Validation failed", message: v.error }, 400);
  const data = v.data;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) {
    console.error("listUsers error", listErr);
    return text("User lookup failed", 500);
  }
  const user = list.users.find(
    (u) => u.email?.toLowerCase() === data.user_email.toLowerCase(),
  );
  if (!user) return text("User not found", 404);

  const emptyToNull = (v: unknown) =>
    v === "" || v === undefined ? null : v;

  const row = {
    user_id: user.id,
    account: data.account,
    external_id: data.external_id,
    title: emptyToNull(data.title),
    description: emptyToNull(data.description),
    start_at: emptyToNull(data.start_at),
    end_at: emptyToNull(data.end_at),
    organizer_email: emptyToNull(data.organizer_email),
    location: emptyToNull(data.location),
    video_url: emptyToNull(data.video_url),
    is_all_day: data.is_all_day ?? false,
    status: emptyToNull(data.status),
    attendees:
      Array.isArray(data.attendees) && data.attendees.length > 0
        ? data.attendees
        : null,
    calendar_id: emptyToNull(data.calendar_id),
    calendar_name: emptyToNull(data.calendar_name),
  };

  const { data: upserted, error } = await admin
    .from("exec_os_calendar_events")
    .upsert(row, { onConflict: "user_id,external_id" })
    .select("id")
    .single();

  if (error) {
    console.error("upsert error", error);
    return text(error.message, 500);
  }

  return json({ ok: true, id: upserted.id }, 200);
});
