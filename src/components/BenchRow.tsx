import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";

export type Agent = {
  id: string;
  name: string;
  role: string;
  system_prompt: string;
  color: string;
  avatar_letter: string;
  order_index: number;
  enabled: boolean;
};

export const SEED_AGENTS: Omit<Agent, "id" | "enabled">[] = [
  {
    name: "Maya",
    role: "Ideafetti Co-founder",
    color: "#083D77",
    avatar_letter: "M",
    order_index: 1,
    system_prompt:
      "You are Maya, Donna's technical co-founder for Ideafetti. You ship features — you don't advise. You know Ideafetti's Supabase schema (profiles, ideas, content_pieces, daily_digests, user_voice_profiles, etc.) and Make automations. When Donna asks 'what should I build', you propose specific concrete next features with technical detail. You're warm but direct. You have opinions. You always end with: 'Want me to draft the migration / edge function / prompt?'",
  },
  {
    name: "Ren",
    role: "Content Writer",
    color: "#E97451",
    avatar_letter: "R",
    order_index: 2,
    system_prompt:
      "You are Ren, Donna's content writer. You write TikTok scripts in HER voice: ND founder, AI-influencer, building in public. Her 4 content pillars: AI tools / ND life / building a business / behind-the-scenes vulnerability. Her tone: relatable, slightly chaotic, no corporate polish. You turn her brain dumps into scroll-stopping scripts with clear hook + middle + payoff. Never use 'literally', 'game-changer', 'amazing'. Always offer 3 hook variations.",
  },
  {
    name: "Vee",
    role: "Growth Analyst",
    color: "#FFC100",
    avatar_letter: "V",
    order_index: 3,
    system_prompt:
      "You are Vee, Donna's growth analyst. You analyze her TikTok performance, identify what's working, surface competitor moves in the ND/AI/founder space. When she asks 'how am I doing', you give her: top 3 posts last 7 days (views, engagement rate, completion), her 7-day trend, 3 concrete content directions to test next. You're a data person who tells the truth even when it's not flattering.",
  },
  {
    name: "Cleo",
    role: "CMO Strategist",
    color: "#DB9C96",
    avatar_letter: "C",
    order_index: 4,
    system_prompt:
      "You are Cleo, Donna's CMO strategist for her AI Lead Conversion business (target: fractional CMOs, $7.5K build + $1.5K/mo retainer). You help her: qualify inbound leads, prep for sales calls, price proposals, write retainer scopes, handle pricing pushback. You're an experienced sales operator. You'd rather Donna lose a bad-fit lead than discount.",
  },
  {
    name: "Sage",
    role: "Mentor",
    color: "#A4B494",
    avatar_letter: "S",
    order_index: 5,
    system_prompt:
      "You are Sage, Donna's mentor. She has AUDHD — PDA-sensitive, dyslexia, easily overwhelmed. When she's spiraling, you ground her: ONE next step, not a list. You never use shame, never use should. You're blunt but warm. Plain language. You ask 'what's the smallest version of this you'd be willing to do?' a lot. You're not a therapist — you redirect serious mental health stuff.",
  },
  {
    name: "Theo",
    role: "Decision Coach",
    color: "#355834",
    avatar_letter: "T",
    order_index: 6,
    system_prompt:
      "You are Theo, Donna's decision coach. You cut through paralysis. When she presents a decision, you: (1) restate the decision in plain English, (2) name the constraint (time / money / energy / values) that actually matters most, (3) eliminate options that violate the constraint, (4) recommend ONE choice with one-line rationale. You never list pros/cons (those increase paralysis). You commit.",
  },
];

export type AgentContext = {
  energy?: number | null;
  topPriority?: string | null;
  priorityEmails?: number;
  meetings?: number;
};

type FullContext = AgentContext & { date: string; latestCapture: string | null };

function buildContextBlock(ctx: AgentContext): string {
  return `Current dashboard context: today is ${ctx.date}. Donna's latest capture: ${
    ctx.latestCapture ?? "(none)"
  }. Current energy: ${ctx.energy ?? "(unset)"}. Top priority: ${
    ctx.topPriority ?? "(unset)"
  }. Inbox: ${ctx.priorityEmails ?? 0} priority emails, ${ctx.meetings ?? 0} meetings today.`;
}

export function BenchRow({ context }: { context: AgentContext }) {
  const { user } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [openAgent, setOpenAgent] = useState<Agent | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("exec_os_agents")
      .select("*")
      .eq("user_id", user.id)
      .order("order_index");
    if (!data || data.length === 0) {
      // seed
      const rows = SEED_AGENTS.map((a) => ({ ...a, user_id: user.id }));
      const { data: inserted } = await supabase
        .from("exec_os_agents")
        .insert(rows)
        .select("*");
      setAgents((inserted ?? []) as Agent[]);
    } else {
      setAgents(data.filter((a: Agent) => a.enabled) as Agent[]);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
        Your bench
      </h3>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 lg:overflow-visible lg:flex-wrap">
        {agents.length === 0 ? (
          <div className="text-sm text-muted-foreground">Add your first avatar</div>
        ) : (
          agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setOpenAgent(a)}
              className="relative shrink-0 w-24 h-[120px] rounded-2xl bg-[color:var(--sage)]/15 hover:scale-[1.03] transition flex flex-col items-center justify-start pt-3 px-2 text-center"
              aria-label={`Chat with ${a.name}`}
            >
              <div
                className="h-14 w-14 rounded-full flex items-center justify-center text-white text-xl font-semibold"
                style={{ backgroundColor: a.color }}
              >
                {a.avatar_letter}
              </div>
              <div className="mt-1 text-sm font-semibold text-[color:var(--navy)] truncate w-full">
                {a.name}
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight truncate w-full">
                {a.role}
              </div>
              <MessageCircle className="absolute bottom-1.5 right-1.5 h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ))
        )}
      </div>

      {openAgent && (
        <AgentDrawer
          agent={openAgent}
          context={context}
          onClose={() => setOpenAgent(null)}
        />
      )}
    </section>
  );
}

type Msg = { role: "user" | "assistant"; content: string };

function AgentDrawer({
  agent,
  context,
  onClose,
}: {
  agent: Agent;
  context: AgentContext;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("exec_os_agent_messages")
      .select("role,content")
      .eq("agent_id", agent.id)
      .eq("user_id", user.id)
      .order("created_at")
      .then(({ data }) => {
        if (data) setMessages(data as Msg[]);
      });
  }, [agent.id, user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending || !user) return;
    setInput("");
    const userMsg: Msg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setSending(true);

    await supabase.from("exec_os_agent_messages").insert({
      user_id: user.id,
      agent_id: agent.id,
      role: "user",
      content: text,
    });

    let assistantSoFar = "";
    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, content: assistantSoFar } : m,
          );
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            systemPrompt: agent.system_prompt,
            contextBlock: buildContextBlock(context),
            messages: next.map(({ role, content }) => ({ role, content })),
          }),
        },
      );

      if (!resp.ok || !resp.body) {
        if (resp.status === 429) {
          upsertAssistant("⚠️ Rate limited. Please try again in a moment.");
        } else if (resp.status === 402) {
          upsertAssistant("⚠️ Lovable AI credits exhausted. Add credits in Settings → Workspace → Usage.");
        } else {
          upsertAssistant("⚠️ Failed to reach the AI gateway.");
        }
        setSending(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        if (d) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") {
            done = true;
            break;
          }
          try {
            const parsed = JSON.parse(json);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) upsertAssistant(content);
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      if (assistantSoFar) {
        await supabase.from("exec_os_agent_messages").insert({
          user_id: user.id,
          agent_id: agent.id,
          role: "assistant",
          content: assistantSoFar,
        });
      }
    } catch (e) {
      console.error("agent chat failed", e);
      upsertAssistant("⚠️ Something went wrong.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-black/30"
        onClick={onClose}
        aria-label="Close drawer"
      />
      <div className="w-full sm:w-[450px] h-full bg-card border-l border-border flex flex-col shadow-xl">
        <header className="flex items-center gap-3 p-4 border-b border-border">
          <div
            className="h-10 w-10 rounded-full flex items-center justify-center text-white font-semibold"
            style={{ backgroundColor: agent.color }}
          >
            {agent.avatar_letter}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[color:var(--navy)]">{agent.name}</div>
            <div className="text-xs text-muted-foreground truncate">{agent.role}</div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              Start a conversation with {agent.name}.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "ml-auto bg-[color:var(--navy)] text-white"
                  : "bg-muted text-foreground"
              }`}
            >
              {m.content}
            </div>
          ))}
          {sending && messages[messages.length - 1]?.role === "user" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
            </div>
          )}
        </div>

        <div className="p-3 border-t border-border flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={`Message ${agent.name}…`}
            className="min-h-[44px] max-h-32 resize-none"
            rows={1}
          />
          <Button
            onClick={send}
            disabled={sending || !input.trim()}
            size="icon"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
