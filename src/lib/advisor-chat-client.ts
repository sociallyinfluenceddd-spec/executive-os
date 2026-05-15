// Client helper to consume the SSE stream from /api/chat/stream.
import { supabase } from "@/integrations/supabase/client";
import type { AdvisorStreamEvent } from "./advisor-chat-core";

export async function* streamAdvisorReply(input: {
  agentId: string;
  threadId?: string | null;
  message: string;
  tierOverride?: "opus" | "sonnet" | "haiku";
}): AsyncGenerator<AdvisorStreamEvent, void, unknown> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) {
    yield { type: "error", message: "Not signed in" };
    return;
  }

  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    yield { type: "error", message: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const json = line.slice(5).trim();
        if (!json) continue;
        try {
          yield JSON.parse(json) as AdvisorStreamEvent;
        } catch {
          // ignore malformed
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
