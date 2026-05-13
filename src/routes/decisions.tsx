import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SavedChip } from "@/components/SavedChip";

export const Route = createFileRoute("/decisions")({
  component: () => (
    <AppShell>
      <DecisionsPage />
    </AppShell>
  ),
});

const CATEGORIES = ["Hire", "Money", "Product", "Client", "Personal", "Other"];

type Decision = {
  id: string;
  decision_text: string;
  context: string | null;
  category: string | null;
  decided_at: string;
};

function relativeTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function weekKey(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const startOfWeek = (date: Date) => {
    const c = new Date(date);
    const day = (c.getDay() + 6) % 7; // Mon=0
    c.setHours(0, 0, 0, 0);
    c.setDate(c.getDate() - day);
    return c;
  };
  const w = startOfWeek(d);
  const cw = startOfWeek(now);
  const diffDays = Math.round((cw.getTime() - w.getTime()) / 86400000);
  if (diffDays === 0) return "This week";
  if (diffDays === 7) return "Last week";
  return `Week of ${w.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function DecisionsPage() {
  const { user } = useAuth();
  const [list, setList] = useState<Decision[] | null>(null);
  const [text, setText] = useState("");
  const [context, setContext] = useState("");
  const [category, setCategory] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("exec_os_decisions")
      .select("id,decision_text,context,category,decided_at")
      .eq("user_id", user.id)
      .order("decided_at", { ascending: false });
    setList(data ?? []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !text.trim()) return;
    setSubmitting(true);
    const { error } = await supabase.from("exec_os_decisions").insert({
      user_id: user.id,
      decision_text: text.trim(),
      context: context.trim() || null,
      category: category || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setText("");
    setContext("");
    setCategory("");
    load();
  };

  const grouped = useMemo(() => {
    if (!list) return [];
    const map = new Map<string, Decision[]>();
    for (const d of list) {
      const k = weekKey(d.decided_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(d);
    }
    return Array.from(map.entries());
  }, [list]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Decisions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          A record of what you chose, and why.
        </p>
      </header>

      {/* Logger */}
      <form
        onSubmit={submit}
        className="rounded-xl border border-border bg-card p-6 space-y-4"
      >
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Log a decision
        </Label>
        <Textarea
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What did you decide?"
          className="min-h-[80px] resize-none"
        />
        <Textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Context (optional)"
          className="min-h-[60px] resize-none"
        />
        <div className="flex gap-3 items-center">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="submit"
            disabled={!text.trim() || submitting}
            className="ml-auto"
          >
            {submitting ? "Logging…" : "Log"}
          </Button>
        </div>
      </form>

      {/* List */}
      <div className="space-y-6">
        {list === null ? (
          <>
            <div className="h-20 bg-muted rounded-xl animate-pulse" />
            <div className="h-20 bg-muted rounded-xl animate-pulse" />
          </>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No decisions logged yet.
          </p>
        ) : (
          grouped.map(([week, items]) => (
            <div key={week} className="space-y-3">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground px-1">
                {week}
              </h2>
              <div className="space-y-2">
                {items.map((d) => (
                  <DecisionItem key={d.id} d={d} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DecisionItem({ d }: { d: Decision }) {
  return (
    <Collapsible>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <CollapsibleTrigger className="w-full text-left p-5 group">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm leading-relaxed">{d.decision_text}</p>
            {d.context ? (
              <ChevronDown className="h-4 w-4 mt-1 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            ) : null}
          </div>
          <div className="flex items-center gap-2 mt-3">
            {d.category ? (
              <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-md bg-[color:var(--sage)]/20 text-[color:var(--forest)]">
                {d.category}
              </span>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {relativeTime(d.decided_at)}
            </span>
          </div>
        </CollapsibleTrigger>
        {d.context ? (
          <CollapsibleContent>
            <div className="px-5 pb-5 -mt-1 text-sm text-muted-foreground whitespace-pre-wrap border-t border-border pt-4">
              {d.context}
            </div>
          </CollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  );
}
