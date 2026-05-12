// Supabase Edge Function: ingest-email
// Public endpoint guarded by X-Ingest-Token header. Deployed with --no-verify-jwt.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ALLOWED_ACCOUNTS = new Set([
  "hello@donnabdicenso.com",
  "sociallyinfluenceddd@gmail.com",
  "sociallydonna@gmail.com",
  "ideafetti@gmail.com",
  "donna@dblankstyle.com",
]);

const ALLOWED_KINDS = new Set(["priority", "needs_response", "invite", "meeting"]);

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
  kind: string;
  external_id: string;
  sender_name?: string | null;
  sender_email?: string | null;
  subject?: string | null;
  snippet?: string | null;
  received_at?: string | null;
  scheduled_at?: string | null;
  attendees?: unknown;
  video_url?: string | null;
  raw_classification?: unknown;
}

function validate(body: any): { ok: true; data: Payload } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be object" };
  const required = ["user_email", "account", "kind", "external_id"];
  for (const k of required) {
    if (typeof body[k] !== "string" || !body[k]) return { ok: false, error: `${k} required` };
  }
  if (!ALLOWED_ACCOUNTS.has(body.account)) return { ok: false, error: "invalid account" };
  if (!ALLOWED_KINDS.has(body.kind)) return { ok: false, error: "invalid kind" };
  if (body.user_email.length > 320) return { ok: false, error: "user_email too long" };
  if (body.external_id.length > 512) return { ok: false, error: "external_id too long" };
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

  const v = validate(body);
  if (!v.ok) return json({ error: "Validation failed", message: v.error }, 400);
  const data = v.data;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Find user by email
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) {
    console.error("listUsers error", listErr);
    return text("User lookup failed", 500);
  }
  const user = list.users.find(
    (u) => u.email?.toLowerCase() === data.user_email.toLowerCase(),
  );
  if (!user) return text("User not found", 404);

  const row = {
    user_id: user.id,
    account: data.account,
    kind: data.kind,
    external_id: data.external_id,
    sender_name: data.sender_name ?? null,
    sender_email: data.sender_email ?? null,
    subject: data.subject ?? null,
    snippet: data.snippet ?? null,
    received_at: data.received_at ?? null,
    scheduled_at: data.scheduled_at ?? null,
    attendees: data.attendees ?? null,
    video_url: data.video_url ?? null,
    raw_classification: data.raw_classification ?? null,
  };

  const { data: upserted, error } = await admin
    .from("exec_os_emails")
    .upsert(row, { onConflict: "user_id,external_id" })
    .select()
    .single();

  if (error) {
    console.error("upsert error", error);
    return text(error.message, 500);
  }

  return json(upserted, 200);
});
