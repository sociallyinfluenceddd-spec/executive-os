// Tools / stack inventory. Surfaces every external service Donna pays for or
// uses, with the metadata that answers: what does it do, why do I have it,
// where am I using it, what does it cost, what's its priority. Lives as the
// "Stack" tab inside /hub. Backed by exec_os_tools.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus, Save, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

// exec_os_tools isn't in generated types yet — added by migration
// 20260518130000_tools.sql. Untyped alias until types regenerate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tdb = supabase as any;

const NAVY = "#083D77";
const SAGE = "#A4B494";
const FOREST = "#355834";
const ROSE = "#DB9C96";
const ORANGE = "#E97451";
const YELLOW = "#FFC100";

type Category =
  | "productivity"
  | "ai"
  | "social"
  | "analytics"
  | "payments"
  | "automation"
  | "design"
  | "dev"
  | "hosting"
  | "communication"
  | "data"
  | "other";

type SubscriptionCycle =
  | "monthly"
  | "annual"
  | "free"
  | "one_time"
  | "usage_based"
  | "unknown";

type SubscriptionStatus =
  | "active"
  | "trialing"
  | "paused"
  | "canceled"
  | "churning"
  | "unknown";

type Status = "active" | "evaluating" | "sunsetting" | "retired";

type Tool = {
  id: string;
  name: string;
  emoji: string | null;
  category: Category;
  purpose: string | null;
  why_kept: string | null;
  usage_notes: string | null;
  subscription_cost_cents: number;
  subscription_cycle: SubscriptionCycle;
  subscription_status: SubscriptionStatus;
  next_renewal_at: string | null;
  priority: number;
  status: Status;
  url: string | null;
  last_used_at: string | null;
};

const CATEGORY_LABEL: Record<Category, string> = {
  productivity: "Productivity",
  ai: "AI",
  social: "Social",
  analytics: "Analytics",
  payments: "Payments",
  automation: "Automation",
  design: "Design",
  dev: "Dev",
  hosting: "Hosting",
  communication: "Communication",
  data: "Data",
  other: "Other",
};

const CATEGORY_COLOR: Record<Category, string> = {
  productivity: NAVY,
  ai: "#7C3AED",
  social: ROSE,
  analytics: YELLOW,
  payments: FOREST,
  automation: ORANGE,
  design: ROSE,
  dev: NAVY,
  hosting: "#6B7280",
  communication: SAGE,
  data: NAVY,
  other: "#6B7280",
};

const PRIORITY_LABEL: Record<number, string> = {
  1: "Critical",
  2: "High",
  3: "Medium",
  4: "Low",
  5: "Nice to have",
};

const PRIORITY_COLOR: Record<number, string> = {
  1: "#dc2626",
  2: ORANGE,
  3: YELLOW,
  4: SAGE,
  5: "#9ca3af",
};

const STATUS_BADGE_COLOR: Record<Status, string> = {
  active: FOREST,
  evaluating: YELLOW,
  sunsetting: ORANGE,
  retired: "#6b7280",
};

function formatCost(cents: number, cycle: SubscriptionCycle): string {
  if (cycle === "free") return "Free";
  if (cents === 0) return "—";
  const dollars = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  if (cycle === "monthly") return `$${dollars}/mo`;
  if (cycle === "annual") return `$${dollars}/yr`;
  if (cycle === "one_time") return `$${dollars}`;
  if (cycle === "usage_based") return `~$${dollars} (usage)`;
  return `$${dollars}`;
}

function monthlySpend(t: Tool): number {
  if (t.subscription_status !== "active" && t.subscription_status !== "trialing") return 0;
  const c = t.subscription_cost_cents;
  if (t.subscription_cycle === "monthly") return c;
  if (t.subscription_cycle === "annual") return Math.round(c / 12);
  return 0;
}

export function StackTab() {
  const { user } = useAuth();
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Partial<Tool>>>({});

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await tdb
      .from("exec_os_tools")
      .select(
        "id, name, emoji, category, purpose, why_kept, usage_notes, subscription_cost_cents, subscription_cycle, subscription_status, next_renewal_at, priority, status, url, last_used_at",
      )
      .order("priority", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      const msg = (error.message || "").toLowerCase();
      const code = (error as { code?: string }).code;
      if (
        code === "42P01" ||
        msg.includes("schema cache") ||
        msg.includes("does not exist") ||
        msg.includes("could not find the table")
      ) {
        setSetupNeeded(true);
        setTools([]);
        return;
      }
      toast.error("Couldn't load tools", { description: error.message });
      setTools([]);
      return;
    }
    setSetupNeeded(false);
    setTools((data ?? []) as Tool[]);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalMonthlySpend = useMemo(() => {
    if (!tools) return 0;
    return tools.reduce((sum, t) => sum + monthlySpend(t), 0);
  }, [tools]);

  const draftFor = (t: Tool): Partial<Tool> => drafts[t.id] ?? {};
  const fieldOf = <K extends keyof Tool>(t: Tool, k: K): Tool[K] =>
    (drafts[t.id]?.[k] ?? t[k]) as Tool[K];

  const setDraftField = <K extends keyof Tool>(
    id: string,
    field: K,
    value: Tool[K],
  ) => {
    setDrafts((cur) => ({ ...cur, [id]: { ...(cur[id] ?? {}), [field]: value } }));
  };

  const save = async (t: Tool) => {
    const patch = drafts[t.id];
    if (!patch || Object.keys(patch).length === 0) {
      toast.info("No changes to save");
      return;
    }
    const { error } = await tdb.from("exec_os_tools").update(patch).eq("id", t.id);
    if (error) {
      toast.error("Save failed", { description: error.message });
      return;
    }
    toast.success("Saved");
    setDrafts((cur) => {
      const next = { ...cur };
      delete next[t.id];
      return next;
    });
    void load();
  };

  const remove = async (t: Tool) => {
    if (!window.confirm(`Remove "${t.name}" from your stack?`)) return;
    const { error } = await tdb.from("exec_os_tools").delete().eq("id", t.id);
    if (error) {
      toast.error("Delete failed", { description: error.message });
      return;
    }
    toast.success("Removed");
    setExpandedId(null);
    void load();
  };

  const addNew = async () => {
    if (!user) return;
    const { data, error } = await tdb
      .from("exec_os_tools")
      .insert({
        user_id: user.id,
        name: "New tool",
        emoji: "🛠",
        category: "other",
        priority: 3,
        status: "active",
        subscription_status: "active",
        subscription_cycle: "monthly",
        subscription_cost_cents: 0,
      })
      .select("id")
      .single();
    if (error) {
      toast.error("Couldn't add", { description: error.message });
      return;
    }
    toast.success("Added — fill in the details");
    await load();
    setExpandedId(data?.id ?? null);
  };

  if (setupNeeded) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm">
        <div className="font-medium text-foreground mb-2">Stack table not deployed yet.</div>
        <div className="text-muted-foreground leading-relaxed mb-3">
          Apply migration{" "}
          <code className="text-[11px] px-1 rounded bg-muted">
            20260518130000_tools.sql
          </code>{" "}
          via Lovable Cloud → SQL editor.
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  if (tools === null) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Top bar: monthly spend KPI + Add */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {tools.length} {tools.length === 1 ? "tool" : "tools"} ·{" "}
          <span className="text-foreground font-medium">
            ${(totalMonthlySpend / 100).toFixed(0)}/mo
          </span>{" "}
          tracked spend
        </div>
        <Button onClick={() => void addNew()} size="sm" variant="outline" className="gap-1">
          <Plus className="h-3.5 w-3.5" />
          Add tool
        </Button>
      </div>

      {tools.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No tools yet. Add the services you pay for or use.
        </div>
      ) : (
        <div className="space-y-2">
          {tools.map((t) => {
            const isExpanded = expandedId === t.id;
            const hasUnsaved = !!drafts[t.id] && Object.keys(drafts[t.id]!).length > 0;
            return (
              <div
                key={t.id}
                className="border border-border rounded-lg bg-card overflow-hidden"
              >
                {/* COLLAPSED HEADER ROW */}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : t.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 text-left"
                >
                  <span className="text-2xl shrink-0">{t.emoji ?? "🛠"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground truncate">
                        {t.name}
                      </span>
                      <span
                        className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium"
                        style={{
                          background: `${CATEGORY_COLOR[t.category]}22`,
                          color: CATEGORY_COLOR[t.category],
                        }}
                      >
                        {CATEGORY_LABEL[t.category]}
                      </span>
                      <span
                        className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium"
                        style={{
                          background: `${PRIORITY_COLOR[t.priority]}22`,
                          color: PRIORITY_COLOR[t.priority],
                        }}
                      >
                        P{t.priority} {PRIORITY_LABEL[t.priority]}
                      </span>
                      {t.status !== "active" && (
                        <Badge variant="outline" className="text-[10px]" style={{ color: STATUS_BADGE_COLOR[t.status] }}>
                          {t.status}
                        </Badge>
                      )}
                    </div>
                    {t.purpose && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {t.purpose}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatCost(t.subscription_cost_cents, t.subscription_cycle)}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {/* EXPANDED BODY */}
                {isExpanded && (
                  <div className="border-t border-border p-4 space-y-3 bg-muted/20">
                    {/* Row 1: name + emoji + url */}
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-2">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                          Emoji
                        </label>
                        <Input
                          value={fieldOf(t, "emoji") ?? ""}
                          onChange={(e) => setDraftField(t.id, "emoji", e.target.value || null)}
                          className="text-center"
                          maxLength={4}
                        />
                      </div>
                      <div className="col-span-6">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                          Name
                        </label>
                        <Input
                          value={fieldOf(t, "name") ?? ""}
                          onChange={(e) => setDraftField(t.id, "name", e.target.value)}
                        />
                      </div>
                      <div className="col-span-4">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                          Category
                        </label>
                        <Select
                          value={fieldOf(t, "category")}
                          onValueChange={(v) => setDraftField(t.id, "category", v as Category)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                              <SelectItem key={c} value={c}>
                                {CATEGORY_LABEL[c]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Purpose / Why / Usage */}
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                        Purpose — what does it do?
                      </label>
                      <Input
                        value={fieldOf(t, "purpose") ?? ""}
                        onChange={(e) => setDraftField(t.id, "purpose", e.target.value || null)}
                        placeholder="One-line description"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                        Why kept — why is it on the stack?
                      </label>
                      <Textarea
                        value={fieldOf(t, "why_kept") ?? ""}
                        onChange={(e) => setDraftField(t.id, "why_kept", e.target.value || null)}
                        rows={2}
                        placeholder="What does it unlock that you couldn't do without it?"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                        Usage notes — where + how are you using it?
                      </label>
                      <Textarea
                        value={fieldOf(t, "usage_notes") ?? ""}
                        onChange={(e) => setDraftField(t.id, "usage_notes", e.target.value || null)}
                        rows={2}
                        placeholder="Which workflows/products it connects to. Frequency of use."
                      />
                    </div>

                    {/* Subscription block */}
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-3">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                          Cost ($)
                        </label>
                        <Input
                          type="number"
                          step="0.01"
                          value={(fieldOf(t, "subscription_cost_cents") ?? 0) / 100}
                          onChange={(e) =>
                            setDraftField(
                              t.id,
                              "subscription_cost_cents",
                              Math.round((Number(e.target.value) || 0) * 100),
                            )
                          }
                        />
                      </div>
                      <div className="col-span-3">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                          Cycle
                        </label>
                        <Select
                          value={fieldOf(t, "subscription_cycle")}
                          onValueChange={(v) =>
                            setDraftField(t.id, "subscription_cycle", v as SubscriptionCycle)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="monthly">Monthly</SelectItem>
                            <SelectItem value="annual">Annual</SelectItem>
                            <SelectItem value="free">Free</SelectItem>
                            <SelectItem value="one_time">One-time</SelectItem>
                            <SelectItem value="usage_based">Usage-based</SelectItem>
                            <SelectItem value="unknown">Unknown</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-3">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                          Sub status
                        </label>
                        <Select
                          value={fieldOf(t, "subscription_status")}
                          onValueChange={(v) =>
                            setDraftField(t.id, "subscription_status", v as SubscriptionStatus)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="trialing">Trialing</SelectItem>
                            <SelectItem value="paused">Paused</SelectItem>
                            <SelectItem value="canceled">Canceled</SelectItem>
                            <SelectItem value="churning">Churning</SelectItem>
                            <SelectItem value="unknown">Unknown</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-3">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                          Renewal
                        </label>
                        <Input
                          type="date"
                          value={fieldOf(t, "next_renewal_at") ?? ""}
                          onChange={(e) =>
                            setDraftField(t.id, "next_renewal_at", e.target.value || null)
                          }
                        />
                      </div>
                    </div>

                    {/* Priority + Status + URL */}
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-3">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                          Priority
                        </label>
                        <Select
                          value={String(fieldOf(t, "priority"))}
                          onValueChange={(v) => setDraftField(t.id, "priority", Number(v))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5].map((p) => (
                              <SelectItem key={p} value={String(p)}>
                                P{p} — {PRIORITY_LABEL[p]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-3">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                          Stack status
                        </label>
                        <Select
                          value={fieldOf(t, "status")}
                          onValueChange={(v) => setDraftField(t.id, "status", v as Status)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="evaluating">Evaluating</SelectItem>
                            <SelectItem value="sunsetting">Sunsetting</SelectItem>
                            <SelectItem value="retired">Retired</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-6">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                          URL
                        </label>
                        <div className="flex gap-1">
                          <Input
                            value={fieldOf(t, "url") ?? ""}
                            onChange={(e) =>
                              setDraftField(t.id, "url", e.target.value || null)
                            }
                            placeholder="https://..."
                          />
                          {t.url && (
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              onClick={() => window.open(t.url!, "_blank", "noopener")}
                              title="Open in new tab"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action row */}
                    <div className="flex items-center justify-between pt-2 border-t border-border">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void remove(t)}
                        className="text-[color:var(--rose)] hover:bg-[color:var(--rose)]/10 gap-1 text-xs"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void save(t)}
                        disabled={!hasUnsaved}
                        className="gap-1"
                        style={{ background: NAVY, color: "white" }}
                      >
                        <Save className="h-3.5 w-3.5" />
                        Save changes
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
