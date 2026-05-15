// Thin server-fn wrapper over runAdvisorChat.
// The streaming UI uses /api/chat/stream (TSS server route with SSE) directly;
// this server function is kept for completeness / non-streaming callers.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runAdvisorChat, type AdvisorStreamEvent } from "./advisor-chat-core";

const InputSchema = z.object({
  agentId: z.string().uuid(),
  threadId: z.string().uuid().nullable().optional(),
  message: z.string().min(1).max(20_000),
  tierOverride: z.enum(["opus", "sonnet", "haiku"]).optional(),
});

export const runAdvisorTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(InputSchema.parse)
  .handler(async ({ data, context }) => {
    const events: unknown[] = [];
    for await (const ev of runAdvisorChat(context.supabase, context.userId, data)) {
      events.push(ev);
    }
    return { events: events as AdvisorStreamEvent[] };
  });
