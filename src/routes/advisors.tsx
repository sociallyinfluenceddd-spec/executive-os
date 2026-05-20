// Toolkit launcher — replaces the old advisor chat layout.
// Old paradigm: chat with one of 6 advisor personas. Cost: ~$0.30/turn API.
// New paradigm: Claude chat lives in claude.ai (free under Pro), execution
// lives in Claude Code via MCP (free under Max). This tab gives Donna:
//   - One-click launchers to each persona's claude.ai Project
//   - Direct execution forms (no LLM cost) for the most-used write actions
//   - Today's signal (spend, open tasks, whispers) in the right rail
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ExternalLink,
  Terminal,
  CheckCircle2,
  DollarSign,
  Mic,
  Plus,
  Lightbulb,
  ListChecks,
  ArrowRight,
} from "lucide-react";
import { DAILY_COST_CAP_USD } from "@/lib/ai-cost-cap";
import { toast } from "sonner";

const searchSchema = z.object({});

export const Route = createFileRoute("/advisors")({
  validateSearch: searchSchema,
  component: ToolkitPage,
});

const NAVY = "#083D77";
const FOREST = "#355834";
const ORANGE = "#E97451";
const SAGE = "#A4B494";
const YELLOW = "#FFC100";
const ROSE = "#DB9C96";

const PERSONAS = [
  { name: "Cleo", role: "CMO Strategist", color: ROSE, hint: "Sales calls, pricing, retainer scoping" },
  { name: "Ren", role: "Content Writer", color: ORANGE, hint: "TikTok scripts in your voice" },
  { name: "Sage", role: "Mentor", color: SAGE, hint: "ND-safe grounding, one-step-at-a-time" },
  { name: "Theo", role: "Decision Coach", color: NAVY, hint: "Cuts through paralysis, picks ONE option" },
  { name: "Vee", role: "Growth Analyst", color: YELLOW, hint: "TikTok performance + competitor signal" },
];

function ToolkitPage() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* MAIN — launchers + quick actions */}
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl px-5 py-6 pb-32 space-y-8">
          <header className="flex items-center justify-between">
            <div>
              <Link to="/today" className="text-xs text-muted-foreground hover:text-foreground">
                ← Today
              </Link>
              <h1 className="text-2xl font-semibold mt-1" style={{ color: NAVY }}>
                Toolkit
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Chat lives in claude.ai. Execution lives in Claude Code. This page is your one-click launcher + direct-action hub.
              </p>
            </div>
          </header>

          <ClaudeChatSection />
          <ClaudeCodeSection />
          <QuickActions userId={user.id} />
        </div>
      </ScrollArea>

      {/* RIGHT RAIL — today's signal */}
      <aside className="hidden w-80 flex-col border-l border-border bg-muted/10 lg:flex">
        <ContextRail userId={user.id} />
      </aside>
    </div>
  );
}

function ClaudeChatSection() {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: NAVY }}>
          Chat with Claude
        </h2>
        <span className="text-[10px] text-muted-foreground">Free under your Pro subscription</span>
      </div>

      <a
        href="https://claude.ai/new"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-4 hover:border-[color:var(--navy)] transition group"
      >
        <div>
          <div className="font-semibold text-foreground">Open Claude.ai</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            New chat — general thinking, drafting, research
          </div>
        </div>
        <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-[color:var(--navy)]" />
      </a>

      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Persona projects
        </div>
        <p className="text-[11px] text-muted-foreground">
          Set these up once at <a className="underline" href="https://claude.ai/projects" target="_blank" rel="noopener noreferrer">claude.ai/projects</a> using the system prompts in the Hub doc. Then bookmark each.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PERSONAS.map((p) => (
            <a
              key={p.name}
              href="https://claude.ai/projects"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-2.5 hover:border-[color:var(--navy)] transition"
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white shrink-0"
                style={{ background: p.color }}
              >
                {p.name.charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-foreground">{p.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">{p.hint}</div>
              </div>
              <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function ClaudeCodeSection() {
  const copyMcpCommand = async () => {
    await navigator.clipboard.writeText("claude").catch(() => {});
    toast.success("Copied: claude", { description: "Paste in your terminal at /Users/donna/AI Automator Builds" });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: FOREST }}>
          Execute with Claude Code
        </h2>
        <span className="text-[10px] text-muted-foreground">Free under your Max subscription · MCP enabled</span>
      </div>

      <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: SAGE, background: "rgba(164,180,148,0.08)" }}>
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4" style={{ color: FOREST }} />
          <div className="font-semibold text-foreground">Run a workflow task in your terminal</div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          The executive-os MCP server exposes all of Maya's executor tools (mark task done, append workflow map, log revenue, query today's activity, run SQL) to Claude Code. Open your terminal, run <code className="rounded bg-muted px-1 py-0.5 text-[11px]">claude</code> in this project directory, and call the tools directly. Every execution counts against your Max plan, not your API balance.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={copyMcpCommand}
            className="text-xs"
          >
            <Terminal className="mr-1.5 h-3 w-3" />
            Copy `claude` command
          </Button>
          <a
            href="/docs/advisors-claude-projects.html"
            target="_blank"
            className="inline-flex items-center gap-1 text-xs text-[color:var(--navy)] hover:underline px-2 py-1.5"
          >
            Persona system prompts <ArrowRight className="h-3 w-3" />
          </a>
        </div>
      </div>
    </section>
  );
}

function QuickActions({ userId }: { userId: string }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: ORANGE }}>
          Quick actions
        </h2>
        <span className="text-[10px] text-muted-foreground">Direct DB writes · no LLM · $0</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MarkTaskDoneCard />
        <LogRevenueCard userId={userId} />
        <QuickCaptureCard userId={userId} />
        <AddArtifactCard userId={userId} />
      </div>
    </section>
  );
}

function MarkTaskDoneCard() {
  const [tasks, setTasks] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("exec_os_workflow_tasks")
        .select("id, title, sort_order")
        .neq("status", "done")
        .neq("status", "skipped")
        .order("sort_order", { ascending: true })
        .limit(30);
      setTasks((data ?? []).map((t: any) => ({ id: t.id, title: t.title })));
    })();
  }, []);

  const markDone = async (id: string, title: string) => {
    if (busy) return;
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("exec_os_workflow_tasks")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", id);
    setBusy(false);
    if (error) {
      toast.error("Couldn't mark done", { description: error.message });
      return;
    }
    toast.success(`✓ ${title}`);
    setTasks((cur) => cur.filter((t) => t.id !== id));
  };

  return (
    <Card icon={<CheckCircle2 className="h-4 w-4" style={{ color: FOREST }} />} title="Mark task done">
      {tasks.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">No open tasks.</p>
      ) : (
        <ul className="space-y-1 max-h-48 overflow-auto">
          {tasks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => void markDone(t.id, t.title)}
                disabled={busy}
                className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted flex items-start gap-2 group"
              >
                <span className="h-3 w-3 rounded-full border border-muted-foreground/50 mt-0.5 shrink-0 group-hover:border-[color:var(--forest)]" />
                <span className="flex-1 truncate">{t.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LogRevenueCard({ userId }: { userId: string }) {
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<string>("manual");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const cents = Math.round(Number.parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      toast.error("Enter a positive amount");
      return;
    }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("exec_os_revenue").insert({
      user_id: userId,
      amount_cents: cents,
      source,
      entry_date: new Date().toISOString().slice(0, 10),
    });
    setBusy(false);
    if (error) {
      toast.error("Couldn't log revenue", { description: error.message });
      return;
    }
    toast.success(`+$${amount} logged`);
    setAmount("");
  };

  return (
    <Card icon={<DollarSign className="h-4 w-4" style={{ color: FOREST }} />} title="Log revenue">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="Amount $"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="text-xs h-8"
          />
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="text-xs h-8 px-2 rounded-md border border-border bg-background"
          >
            <option value="stripe">Stripe</option>
            <option value="cmo_retainer">CMO retainer</option>
            <option value="tiktok">TikTok</option>
            <option value="sponsorship">Sponsorship</option>
            <option value="manual">Manual</option>
            <option value="other">Other</option>
          </select>
        </div>
        <Button type="button" size="sm" onClick={submit} disabled={busy} className="w-full">
          Log
        </Button>
      </div>
    </Card>
  );
}

function QuickCaptureCard({ userId }: { userId: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    const { error } = await supabase.from("exec_os_captures").insert({
      user_id: userId,
      raw_text: t,
      source: "text",
      captured_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) {
      toast.error("Couldn't capture", { description: error.message });
      return;
    }
    toast.success("Captured");
    setText("");
  };

  return (
    <Card icon={<Mic className="h-4 w-4" style={{ color: ORANGE }} />} title="Quick capture">
      <div className="space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Brain dump — gets stored for later extraction"
          rows={3}
          className="text-xs resize-none"
        />
        <Button type="button" size="sm" onClick={submit} disabled={busy || !text.trim()} className="w-full">
          Save
        </Button>
      </div>
    </Card>
  );
}

function AddArtifactCard({ userId }: { userId: string }) {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const t = title.trim();
    const loc = location.trim();
    if (!t || !loc) return;
    setBusy(true);
    const looksLikeUrl = /^https?:\/\//i.test(loc);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("exec_os_artifacts").insert({
      user_id: userId,
      title: t,
      kind: "doc",
      category: "exec_os",
      location_type: looksLikeUrl ? "url" : "file",
      location: loc,
      status: "active",
    });
    setBusy(false);
    if (error) {
      toast.error("Couldn't add", { description: error.message });
      return;
    }
    toast.success("Added to Hub");
    setTitle("");
    setLocation("");
  };

  return (
    <Card icon={<Plus className="h-4 w-4" style={{ color: NAVY }} />} title="Add to Hub">
      <div className="space-y-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="text-xs h-8"
        />
        <Input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="URL or file path"
          className="text-xs h-8"
        />
        <Button type="button" size="sm" onClick={submit} disabled={busy || !title.trim() || !location.trim()} className="w-full">
          Add
        </Button>
      </div>
    </Card>
  );
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <div className="text-xs font-semibold text-foreground">{title}</div>
      </div>
      {children}
    </div>
  );
}

function ContextRail({ userId }: { userId: string }) {
  const [spent, setSpent] = useState(0);
  const [tasks, setTasks] = useState<{ id: string; title: string }[]>([]);
  const [whispers, setWhispers] = useState<{ id: string; kind: string; payload: unknown }[]>([]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    void (async () => {
      const usage = await supabase
        .from("exec_os_ai_usage")
        .select("cost_usd")
        .eq("day", today)
        .eq("user_id", userId);
      setSpent((usage.data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = await (supabase as any)
        .from("exec_os_workflow_tasks")
        .select("id, title")
        .neq("status", "done")
        .neq("status", "skipped")
        .order("sort_order", { ascending: true })
        .limit(8);
      setTasks((t.data ?? []) as { id: string; title: string }[]);

      const w = await supabase
        .from("exec_os_suggestions")
        .select("id, kind, payload")
        .eq("user_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(4);
      setWhispers((w.data ?? []) as never);
    })();
  }, [userId]);

  const pct = Math.min(100, (spent / DAILY_COST_CAP_USD) * 100);
  const overCap = spent >= DAILY_COST_CAP_USD;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 space-y-5">
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
          <span className="flex items-center gap-1">
            <DollarSign className="h-3 w-3" /> AI spend today
          </span>
          <span className="tabular-nums">${spent.toFixed(2)} / ${DAILY_COST_CAP_USD}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full transition-all ${overCap ? "bg-amber-500" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {overCap && (
          <div className="mt-1 text-[10px] text-amber-600">
            Cap hit — Opus turns auto-downgrade to Sonnet.
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
          <ListChecks className="h-3 w-3" /> Open tasks
        </div>
        {tasks.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">All clear.</div>
        ) : (
          <ul className="space-y-1">
            {tasks.map((t) => (
              <li key={t.id} className="text-[11px] text-foreground">
                · {t.title}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Lightbulb className="h-3 w-3" /> Recent whispers
        </div>
        {whispers.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">None.</div>
        ) : (
          <ul className="space-y-1.5">
            {whispers.map((s) => (
              <li key={s.id} className="rounded border border-border bg-background p-2 text-[11px]">
                <div className="font-medium">{s.kind}</div>
                <div className="mt-0.5 line-clamp-3 text-muted-foreground">
                  {typeof s.payload === "object" && s.payload && "summary" in (s.payload as Record<string, unknown>)
                    ? String((s.payload as Record<string, unknown>).summary)
                    : JSON.stringify(s.payload).slice(0, 200)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
