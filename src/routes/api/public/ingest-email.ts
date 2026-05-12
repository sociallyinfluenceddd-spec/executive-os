import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ALLOWED_ACCOUNTS = [
  "hello@donnabdicenso.com",
  "sociallyinfluenceddd@gmail.com",
  "sociallydonna@gmail.com",
  "ideafetti@gmail.com",
  "donna@dblankstyle.com",
];

const Schema = z.object({
  user_email: z.string().email().max(320),
  account: z.enum(ALLOWED_ACCOUNTS as [string, ...string[]]),
  kind: z.enum(["priority", "needs_response", "invite", "meeting"]),
  external_id: z.string().min(1).max(512),
  sender_name: z.string().max(255).optional().nullable(),
  sender_email: z.string().max(320).optional().nullable(),
  subject: z.string().max(998).optional().nullable(),
  snippet: z.string().max(2000).optional().nullable(),
  received_at: z.string().datetime().optional().nullable(),
  scheduled_at: z.string().datetime().optional().nullable(),
  attendees: z.any().optional().nullable(),
  video_url: z.string().url().max(2048).optional().nullable(),
  raw_classification: z.any().optional().nullable(),
});

export const Route = createFileRoute("/api/public/ingest-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.INGEST_TOKEN;
        if (!expected) {
          return new Response("Server not configured", { status: 500 });
        }
        const provided = request.headers.get("x-ingest-token");
        if (!provided || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const parsed = Schema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "Validation failed", details: parsed.error.flatten() },
            { status: 400 },
          );
        }
        const data = parsed.data;

        // Look up user_id by email
        const { data: list, error: listErr } =
          await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
        if (listErr) {
          return new Response("User lookup failed", { status: 500 });
        }
        const user = list.users.find(
          (u) => u.email?.toLowerCase() === data.user_email.toLowerCase(),
        );
        if (!user) {
          return new Response("User not found", { status: 404 });
        }

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

        const { data: upserted, error } = await supabaseAdmin
          .from("exec_os_emails")
          .upsert(row, { onConflict: "user_id,external_id" })
          .select()
          .single();

        if (error) {
          console.error("ingest-email upsert error", error);
          return new Response(error.message, { status: 500 });
        }

        return Response.json(upserted, { status: 200 });
      },
    },
  },
});
