// Advisor chat — Anthropic streaming + tool use, with daily cost cap and persistence.
//
// Streams structured deltas back to the client:
//   { type: "text", delta: string }
//   { type: "thinking", delta: string }
//   { type: "tool_use", id, name, input }
//   { type: "tool_result", id, output }
//   { type: "downgraded", from: "opus", to: "sonnet" }
//   { type: "done", messageId, model, inputTokens, outputTokens, costUsd }
//   { type: "error", message }

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveLatestAnthropicModels } from "./anthropic-models.functions";
import { ANTHROPIC_MODEL_FALLBACKS, type ModelTier } from "@/config/advisors";
import { calcCostUsd, effectiveTier, DAILY_COST_CAP_USD } from "./ai-cost-cap";
import { ANTHROPIC_TOOLS, findTool } from "./advisor-tools";

const MAX_TOOL_ITERATIONS = 8;
const MAX_OUTPUT_TOKENS = 4096;

interface AnthropicContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

const InputSchema = z.object({
  agentId: z.string().uuid(),
  threadId: z.string().uuid().nullable().optional(),
  message: z.string().min(1).max(20_000),
});

export const streamAdvisorChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(InputSchema.parse)
  .handler(async function* ({ data, context }) {
    const { supabase, userId } = context;

    // --- Load agent config ---
    const { data: agent, error: agentErr } = await supabase
      .from("exec_os_agents")
      .select("id, name, role, system_prompt, model_tier")
      .eq("id", data.agentId)
      .single();
    if (agentErr || !agent) {
      yield { type: "error", message: "Agent not found" };
      return;
    }

    // --- Resolve effective tier (cost cap) ---
    const today = new Date().toISOString().slice(0, 10);
    const { data: usageRows } = await supabase
      .from("exec_os_ai_usage")
      .select("cost_usd")
      .eq("day", today);
    const spentToday = (usageRows ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    const requestedTier = (agent.model_tier ?? "sonnet") as ModelTier;
    const { tier, downgraded } = effectiveTier(requestedTier, spentToday);
    if (downgraded) {
      yield { type: "downgraded", from: requestedTier, to: tier, spentUsd: spentToday, capUsd: DAILY_COST_CAP_USD };
    }

    // --- Resolve model id (live, with fallback) ---
    let modelId = ANTHROPIC_MODEL_FALLBACKS[tier];
    try {
      const resolved = await resolveLatestAnthropicModels();
      modelId = resolved[tier] ?? modelId;
    } catch (e) {
      console.warn("[advisor-chat] model resolution failed, using fallback", e);
    }

    // --- Load thread history ---
    let threadId = data.threadId ?? null;
    if (!threadId) {
      const { data: thread } = await supabase
        .from("exec_os_agent_threads")
        .insert({ user_id: userId, agent_id: agent.id, title: data.message.slice(0, 80), last_message_at: new Date().toISOString() })
        .select("id")
        .single();
      threadId = thread?.id ?? null;
    }

    const { data: history } = await supabase
      .from("exec_os_agent_messages")
      .select("role, content, tool_calls, tool_results")
      .eq("agent_id", agent.id)
      .eq("user_id", userId)
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(40);

    const messages: AnthropicMessage[] = [];
    for (const m of history ?? []) {
      if (m.role === "user" || m.role === "assistant") {
        messages.push({ role: m.role, content: m.content });
      }
    }

    // Persist user message
    await supabase.from("exec_os_agent_messages").insert({
      user_id: userId,
      agent_id: agent.id,
      thread_id: threadId,
      role: "user",
      content: data.message,
    });
    messages.push({ role: "user", content: data.message });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      yield { type: "error", message: "ANTHROPIC_API_KEY not configured" };
      return;
    }

    // --- Tool loop ---
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let assistantText = "";
    let assistantThinking = "";
    let lastAssistantBlocks: AnthropicContentBlock[] = [];

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const body = {
        model: modelId,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: agent.system_prompt,
        messages,
        tools: ANTHROPIC_TOOLS,
        stream: true,
      };

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        console.error("[advisor-chat] anthropic error", res.status, errText);
        yield { type: "error", message: `Anthropic ${res.status}: ${errText.slice(0, 200)}` };
        return;
      }

      // Parse SSE stream, accumulating content blocks
      const blocks: AnthropicContentBlock[] = [];
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      let stopReason: string | null = null;

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let evt: Record<string, unknown>;
            try { evt = JSON.parse(payload); } catch { continue; }
            const t = evt.type as string;

            if (t === "content_block_start") {
              const idx = evt.index as number;
              blocks[idx] = { ...(evt.content_block as AnthropicContentBlock) };
              if (blocks[idx].type === "tool_use") blocks[idx].input = {};
            } else if (t === "content_block_delta") {
              const idx = evt.index as number;
              const delta = evt.delta as { type: string; text?: string; thinking?: string; partial_json?: string };
              const block = blocks[idx];
              if (!block) continue;
              if (delta.type === "text_delta" && delta.text) {
                block.text = (block.text ?? "") + delta.text;
                assistantText += delta.text;
                yield { type: "text", delta: delta.text };
              } else if (delta.type === "thinking_delta" && delta.thinking) {
                block.thinking = (block.thinking ?? "") + delta.thinking;
                assistantThinking += delta.thinking;
                yield { type: "thinking", delta: delta.thinking };
              } else if (delta.type === "input_json_delta" && delta.partial_json) {
                (block as { _raw?: string })._raw = ((block as { _raw?: string })._raw ?? "") + delta.partial_json;
              }
            } else if (t === "content_block_stop") {
              const idx = evt.index as number;
              const block = blocks[idx];
              if (block?.type === "tool_use") {
                const raw = (block as { _raw?: string })._raw ?? "{}";
                try { block.input = JSON.parse(raw); } catch { block.input = {}; }
                delete (block as { _raw?: string })._raw;
              }
            } else if (t === "message_delta") {
              const usage = (evt.usage as { input_tokens?: number; output_tokens?: number }) ?? {};
              if (usage.input_tokens) totalInputTokens += usage.input_tokens;
              if (usage.output_tokens) totalOutputTokens += usage.output_tokens;
              const delta = evt.delta as { stop_reason?: string };
              if (delta?.stop_reason) stopReason = delta.stop_reason;
            } else if (t === "message_start") {
              const msg = evt.message as { usage?: { input_tokens?: number } };
              if (msg?.usage?.input_tokens) totalInputTokens += msg.usage.input_tokens;
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      lastAssistantBlocks = blocks.filter(Boolean);
      messages.push({ role: "assistant", content: lastAssistantBlocks });

      if (stopReason !== "tool_use") break;

      // --- Execute tool calls ---
      const toolUseBlocks = lastAssistantBlocks.filter((b) => b.type === "tool_use");
      const toolResults: AnthropicContentBlock[] = [];
      for (const tu of toolUseBlocks) {
        yield { type: "tool_use", id: tu.id, name: tu.name, input: tu.input };
        const tool = findTool(tu.name ?? "");
        let output: unknown;
        if (!tool) {
          output = { error: `Unknown tool: ${tu.name}` };
        } else {
          try {
            output = await tool.execute(tu.input ?? {}, { supabase, userId });
          } catch (e) {
            output = { error: e instanceof Error ? e.message : "Tool execution failed" };
          }
        }
        yield { type: "tool_result", id: tu.id, output };
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(output),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    // --- Persist assistant message + usage ---
    const costUsd = calcCostUsd(tier, totalInputTokens, totalOutputTokens);
    const { data: saved } = await supabase
      .from("exec_os_agent_messages")
      .insert({
        user_id: userId,
        agent_id: agent.id,
        thread_id: threadId,
        role: "assistant",
        content: assistantText,
        reasoning: assistantThinking || null,
        tool_calls: lastAssistantBlocks.filter((b) => b.type === "tool_use") as unknown as Record<string, unknown>,
        model: modelId,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        cost_usd: costUsd,
      })
      .select("id")
      .single();

    await supabase.from("exec_os_ai_usage").insert({
      user_id: userId,
      model: modelId,
      tier,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      cost_usd: costUsd,
      advisor_id: agent.id,
    });

    if (threadId) {
      await supabase
        .from("exec_os_agent_threads")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", threadId);
    }

    yield {
      type: "done",
      messageId: saved?.id ?? null,
      threadId,
      model: modelId,
      tier,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd,
    };
  });
