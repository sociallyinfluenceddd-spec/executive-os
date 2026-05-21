// Stripe + LemonSqueezy webhook receiver.
//
// Single endpoint that handles both billing providers. URL pattern:
//   POST /functions/v1/stripe-webhook?provider=stripe
//   POST /functions/v1/stripe-webhook?provider=lemonsqueezy
//
// SECURITY:
//   - Stripe signs with HMAC-SHA256 over "<timestamp>.<rawbody>" using
//     STRIPE_WEBHOOK_SECRET. We verify the t= and v1= fields in
//     Stripe-Signature header.
//   - LemonSqueezy signs with HMAC-SHA256 over the raw body using
//     LS_WEBHOOK_SECRET. Header: X-Signature.
//
// USER MATCHING:
//   - Look up by customer email in exec_os_clients.primary_contact_email
//   - If no match, fall back to DEFAULT_USER_ID env (set to Donna's UUID).
//     That way revenue still logs even before clients are in Pipeline.
//
// EVENT FILTERING (we only insert revenue for these):
//   Stripe: checkout.session.completed, invoice.paid, charge.succeeded
//   LemonSqueezy: order_created, subscription_created, subscription_payment_success
//
// Each successful event inserts ONE row into exec_os_revenue keyed on
// external_id so re-deliveries don't duplicate.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "stripe-signature, x-signature, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const LS_WEBHOOK_SECRET = Deno.env.get("LS_WEBHOOK_SECRET") ?? "";
const DEFAULT_USER_ID = Deno.env.get("DEFAULT_USER_ID") ?? "c0dd70cf-2bc1-454d-851d-1d16f0065ab4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * HMAC-SHA256 sign using Web Crypto. Returns hex string.
 */
async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyStripe(rawBody: string, sigHeader: string): Promise<boolean> {
  if (!STRIPE_WEBHOOK_SECRET) return false;
  // Stripe-Signature: t=<ts>,v1=<hex>
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const ts = parts["t"];
  const expected = parts["v1"];
  if (!ts || !expected) return false;
  const signed = `${ts}.${rawBody}`;
  const actual = await hmacSha256Hex(STRIPE_WEBHOOK_SECRET, signed);
  return timingSafeEqual(actual, expected);
}

async function verifyLemonSqueezy(rawBody: string, sigHeader: string): Promise<boolean> {
  if (!LS_WEBHOOK_SECRET) return false;
  const actual = await hmacSha256Hex(LS_WEBHOOK_SECRET, rawBody);
  return timingSafeEqual(actual, sigHeader);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function resolveUserId(admin: ReturnType<typeof createSb>, email: string | null): Promise<string> {
  if (!email) return DEFAULT_USER_ID;
  const { data } = await admin
    .from("exec_os_clients")
    .select("user_id")
    .ilike("primary_contact_email", email)
    .limit(1)
    .maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? DEFAULT_USER_ID;
}

import { createClient as createSb } from "https://esm.sh/@supabase/supabase-js@2.45.0";

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

interface RevenueInsert {
  user_id: string;
  amount_cents: number;
  currency: string;
  source: string;
  entry_date: string;
  external_id: string;
  notes: string | null;
}

async function processStripeEvent(
  admin: ReturnType<typeof createSb>,
  event: StripeEvent,
): Promise<{ ok: boolean; reason: string }> {
  // Allow-listed event types — anything else is acked but not recorded.
  const allowed = new Set([
    "checkout.session.completed",
    "invoice.paid",
    "charge.succeeded",
  ]);
  if (!allowed.has(event.type)) return { ok: true, reason: `skipped event type: ${event.type}` };

  const obj = event.data.object as Record<string, unknown>;
  let amount_cents = 0;
  let currency = "usd";
  let email: string | null = null;
  let notes: string | null = null;

  if (event.type === "checkout.session.completed") {
    amount_cents = Number(obj.amount_total ?? 0);
    currency = String(obj.currency ?? "usd");
    const cd = obj.customer_details as { email?: string } | undefined;
    email = cd?.email ?? null;
    notes = `Stripe checkout · session ${obj.id}`;
  } else if (event.type === "invoice.paid") {
    amount_cents = Number(obj.amount_paid ?? 0);
    currency = String(obj.currency ?? "usd");
    email = (obj.customer_email as string | undefined) ?? null;
    notes = `Stripe invoice · ${obj.number ?? obj.id}`;
  } else if (event.type === "charge.succeeded") {
    amount_cents = Number(obj.amount ?? 0);
    currency = String(obj.currency ?? "usd");
    const bd = obj.billing_details as { email?: string } | undefined;
    email = bd?.email ?? null;
    notes = `Stripe charge · ${obj.id}`;
  }

  if (amount_cents <= 0) return { ok: true, reason: "zero amount" };

  const user_id = await resolveUserId(admin, email);
  const row: RevenueInsert = {
    user_id,
    amount_cents,
    currency: currency.toLowerCase(),
    source: "stripe",
    entry_date: new Date().toISOString().slice(0, 10),
    external_id: event.id,
    notes,
  };
  const { error } = await admin
    .from("exec_os_revenue")
    .upsert(row, { onConflict: "external_id" });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, reason: `stored ${amount_cents} cents for ${email ?? "unknown"}` };
}

async function processLemonEvent(
  admin: ReturnType<typeof createSb>,
  event: { meta?: { event_name?: string; webhook_id?: string }; data?: { id?: string; attributes?: Record<string, unknown> } },
): Promise<{ ok: boolean; reason: string }> {
  const eventName = event.meta?.event_name ?? "";
  const allowed = new Set(["order_created", "subscription_created", "subscription_payment_success"]);
  if (!allowed.has(eventName)) return { ok: true, reason: `skipped event: ${eventName}` };

  const attrs = (event.data?.attributes ?? {}) as Record<string, unknown>;
  const amount_cents = Number(attrs.total ?? attrs.total_usd ?? attrs.subtotal ?? 0);
  const currency = String(attrs.currency ?? "usd");
  const email = (attrs.user_email as string | undefined) ?? (attrs.customer_email as string | undefined) ?? null;
  if (amount_cents <= 0) return { ok: true, reason: "zero amount" };

  const user_id = await resolveUserId(admin, email);
  const external_id = `ls-${event.data?.id ?? event.meta?.webhook_id ?? Date.now()}`;
  const row: RevenueInsert = {
    user_id,
    amount_cents,
    currency: currency.toLowerCase(),
    source: "lemonsqueezy",
    entry_date: new Date().toISOString().slice(0, 10),
    external_id,
    notes: `LemonSqueezy · ${eventName}`,
  };
  const { error } = await admin
    .from("exec_os_revenue")
    .upsert(row, { onConflict: "external_id" });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, reason: `stored ${amount_cents} cents for ${email ?? "unknown"}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") ?? "stripe";
  const rawBody = await req.text();

  const admin = createSb(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (provider === "stripe") {
      const sigHeader = req.headers.get("stripe-signature") ?? "";
      const verified = await verifyStripe(rawBody, sigHeader);
      if (!verified) return json({ error: "signature_invalid" }, 400);
      const event = JSON.parse(rawBody) as StripeEvent;
      const result = await processStripeEvent(admin, event);
      return json({ ok: result.ok, reason: result.reason }, result.ok ? 200 : 500);
    }

    if (provider === "lemonsqueezy") {
      const sigHeader = req.headers.get("x-signature") ?? "";
      const verified = await verifyLemonSqueezy(rawBody, sigHeader);
      if (!verified) return json({ error: "signature_invalid" }, 400);
      const event = JSON.parse(rawBody);
      const result = await processLemonEvent(admin, event);
      return json({ ok: result.ok, reason: result.reason }, result.ok ? 200 : 500);
    }

    return json({ error: `unknown provider: ${provider}` }, 400);
  } catch (e) {
    console.error("stripe-webhook error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
