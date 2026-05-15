// Chat window: loads history for a (agent, thread) pair, streams new messages,
// renders text + thinking + tool blocks.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { streamAdvisorReply } from "@/lib/advisor-chat-client";
import { AssistantBlock, type ChatBlock, type ToolEvent } from "./AssistantBlock";
import { Composer } from "./Composer";
import { Badge } from "@/components/ui/badge";
import type { ModelTier } from "@/config/advisors";
import { toast } from "sonner";

interface UIMessage {
  id: string;
  role: "user" | "assistant";
  block: ChatBlock;
  pending?: boolean;
  meta?: { model?: string; costUsd?: number; tier?: ModelTier; downgraded?: boolean };
}

interface ChatWindowProps {
  agentId: string;
  agentName: string;
  agentTier: ModelTier;
  threadId: string | null;
  onThreadCreated: (threadId: string) => void;
}

export function ChatWindow({
  agentId,
  agentName,
  agentTier,
  threadId,
  onThreadCreated,
}: ChatWindowProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Load history when thread changes
  useEffect(() => {
    if (!user) return;
    setLoadingHistory(true);
    setMessages([]);
    if (!threadId) {
      setLoadingHistory(false);
      return;
    }
    supabase
      .from("exec_os_agent_messages")
      .select("id, role, content, reasoning, tool_calls, model, cost_usd")
      .eq("agent_id", agentId)
      .eq("thread_id", threadId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(200)
      .then(({ data }) => {
        setMessages(
          (data ?? [])
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              block: {
                text: m.content ?? "",
                thinking: m.reasoning ?? "",
                tools: Array.isArray(m.tool_calls)
                  ? (m.tool_calls as { id?: string; name?: string; input?: unknown }[]).map(
                      (t) => ({ ...t, status: "done" as const, output: undefined }),
                    )
                  : [],
              },
              meta: { model: m.model ?? undefined, costUsd: Number(m.cost_usd ?? 0) },
            })),
        );
        setLoadingHistory(false);
      });
  }, [agentId, threadId, user]);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const handleSend = useCallback(
    async (
      text: string,
      opts: { boostToOpus: boolean; attachments: File[] },
    ) => {
      if (!user || streaming) return;
      const userMsgId = `u-${Date.now()}`;
      const asstMsgId = `a-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: userMsgId, role: "user", block: { text, thinking: "", tools: [] } },
        { id: asstMsgId, role: "assistant", pending: true, block: { text: "", thinking: "", tools: [] } },
      ]);
      setStreaming(true);

      let activeThreadId = threadId;
      try {
        for await (const ev of streamAdvisorReply({
          agentId,
          threadId: activeThreadId,
          message: text,
          tierOverride: opts.boostToOpus ? "opus" : undefined,
        })) {
          if (ev.type === "thread") {
            activeThreadId = ev.threadId;
            onThreadCreated(ev.threadId);
          } else if (ev.type === "text") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId
                  ? { ...m, block: { ...m.block, text: m.block.text + ev.delta } }
                  : m,
              ),
            );
          } else if (ev.type === "thinking") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId
                  ? { ...m, block: { ...m.block, thinking: m.block.thinking + ev.delta } }
                  : m,
              ),
            );
          } else if (ev.type === "tool_use") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId
                  ? {
                      ...m,
                      block: {
                        ...m.block,
                        tools: [
                          ...m.block.tools,
                          { id: ev.id, name: ev.name, input: ev.input, status: "running" } as ToolEvent,
                        ],
                      },
                    }
                  : m,
              ),
            );
          } else if (ev.type === "tool_result") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId
                  ? {
                      ...m,
                      block: {
                        ...m.block,
                        tools: m.block.tools.map((t) =>
                          t.id === ev.id
                            ? { ...t, output: ev.output, status: "done" as const }
                            : t,
                        ),
                      },
                    }
                  : m,
              ),
            );
          } else if (ev.type === "downgraded") {
            toast.info(`Daily cap hit ($${ev.spentUsd.toFixed(2)}/$${ev.capUsd}) — running on Sonnet.`);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId
                  ? { ...m, meta: { ...m.meta, downgraded: true, tier: ev.to } }
                  : m,
              ),
            );
          } else if (ev.type === "done") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId
                  ? {
                      ...m,
                      pending: false,
                      meta: {
                        ...m.meta,
                        model: ev.model,
                        costUsd: ev.costUsd,
                        tier: ev.tier,
                      },
                    }
                  : m,
              ),
            );
          } else if (ev.type === "error") {
            toast.error(ev.message);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId
                  ? { ...m, pending: false, block: { ...m.block, text: m.block.text || `_Error: ${ev.message}_` } }
                  : m,
              ),
            );
          }
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Stream failed");
      } finally {
        setStreaming(false);
      }
    },
    [agentId, threadId, user, streaming, onThreadCreated],
  );

  const empty = !loadingHistory && messages.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollerRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
          {empty && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              <div className="text-base font-medium text-foreground">Talk to {agentName}</div>
              <p className="mt-1">
                Ask anything. Try a slash command, or reference your inbox, calendar, or daily logs.
              </p>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className="space-y-1">
              {m.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl bg-primary px-3.5 py-2 text-sm text-primary-foreground whitespace-pre-wrap">
                    {m.block.text}
                  </div>
                </div>
              ) : (
                <div>
                  <AssistantBlock block={m.block} />
                  {!m.pending && m.meta?.model && (
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">
                        {m.meta.tier ?? "?"}
                      </Badge>
                      <span className="font-mono">{m.meta.model}</span>
                      {m.meta.costUsd != null && m.meta.costUsd > 0 && (
                        <span>· ${m.meta.costUsd.toFixed(4)}</span>
                      )}
                      {m.meta.downgraded && <span className="text-amber-600">· downgraded</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {streaming && messages[messages.length - 1]?.pending && messages[messages.length - 1]?.block.text === "" && messages[messages.length - 1]?.block.tools.length === 0 && (
            <div className="text-xs text-muted-foreground italic">Thinking…</div>
          )}
        </div>
      </div>

      <Composer agentTier={agentTier} disabled={streaming} onSend={handleSend} />
    </div>
  );
}
