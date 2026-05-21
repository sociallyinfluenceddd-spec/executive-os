import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, DollarSign, Sparkles, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type DoneEvent = {
  id: string;
  kind: "task" | "revenue" | "artifact";
  title: string;
  detail?: string;
  at: string; // ISO timestamp
};

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function DoneTodayWidget() {
  const [events, setEvents] = useState<DoneEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // forces re-fetch via realtime
  const since = useMemo(() => startOfTodayIso(), []);

  // Realtime: any task moved to done or any new revenue row triggers a refetch.
  useEffect(() => {
    const ch = supabase
      .channel("done_today_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "exec_os_workflow_tasks" }, () => setTick((t) => t + 1))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "exec_os_revenue" }, () => setTick((t) => t + 1))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb = supabase as any;
        const [tasks, revenue] = await Promise.all([
          sb
            .from("exec_os_workflow_tasks")
            .select("id, title, completed_at, dollar_lever")
            .eq("status", "done")
            .gte("completed_at", since)
            .order("completed_at", { ascending: false }),
          supabase
            .from("exec_os_revenue")
            .select("id, amount_cents, source, created_at, notes")
            .gte("created_at", since)
            .order("created_at", { ascending: false }),
        ]);

        const out: DoneEvent[] = [];

        for (const t of tasks.data ?? []) {
          if (!t.completed_at) continue;
          out.push({
            id: `task:${t.id}`,
            kind: "task",
            title: t.title,
            detail: t.dollar_lever ?? undefined,
            at: t.completed_at,
          });
        }
        for (const r of revenue.data ?? []) {
          out.push({
            id: `rev:${r.id}`,
            kind: "revenue",
            title: `+ $${(r.amount_cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })} ${r.source ?? ""}`.trim(),
            detail: r.notes ?? undefined,
            at: r.created_at,
          });
        }

        out.sort((a, b) => (a.at < b.at ? 1 : -1));
        if (!cancelled) setEvents(out);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [since, tick]);

  if (err) {
    return (
      <div className="space-y-2">
        <h2 className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          <CheckCircle2 className="h-3.5 w-3.5" /> Done today
        </h2>
        <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--orange)]">
          <AlertCircle className="h-3 w-3" /> Couldn't load activity log
        </div>
      </div>
    );
  }

  if (events === null) {
    return (
      <div className="space-y-2">
        <h2 className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          <CheckCircle2 className="h-3.5 w-3.5" /> Done today
        </h2>
        <div className="text-[11px] text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="space-y-2">
        <h2 className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          <CheckCircle2 className="h-3.5 w-3.5" /> Done today
        </h2>
        <p className="text-xs text-muted-foreground italic">
          Nothing logged yet today. Complete a workflow task or log revenue to see it here.
        </p>
      </div>
    );
  }

  const taskCount = events.filter((e) => e.kind === "task").length;
  const revenueCents = events
    .filter((e) => e.kind === "revenue")
    .reduce((acc, e) => {
      const m = /\$(\d[\d,]*)/.exec(e.title);
      return acc + (m ? parseInt(m[1].replace(/,/g, ""), 10) * 100 : 0);
    }, 0);

  // Wins encouragement copy — AUDHD dopamine hit. Reframes the count as a
  // motivation tile, not just a number in the corner.
  const winsHeadline = (() => {
    if (taskCount === 0 && revenueCents === 0) return null;
    const bits: string[] = [];
    if (taskCount > 0) bits.push(`${taskCount} ${taskCount === 1 ? "task shipped" : "tasks shipped"}`);
    if (revenueCents > 0) bits.push(`$${(revenueCents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })} logged`);
    return bits.join(" · ");
  })();
  const winsSubcopy = (() => {
    if (taskCount === 0 && revenueCents === 0) return null;
    if (taskCount >= 5 && revenueCents > 0) return "You shipped AND closed. Real day.";
    if (taskCount >= 5) return "Five-plus closes today. Momentum day.";
    if (revenueCents >= 100_000) return "$1K+ logged. Bank that win.";
    if (revenueCents > 0) return "Cash hit the account.";
    if (taskCount >= 3) return "Three tasks down. You're moving.";
    if (taskCount > 0) return "Shipped today. That counts.";
    return null;
  })();

  return (
    <div className="space-y-2 h-full flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          <CheckCircle2 className="h-3.5 w-3.5" /> Done today
        </h2>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-0.5">
            <CheckCircle2 className="h-3 w-3" style={{ color: "var(--forest)" }} /> {taskCount}
          </span>
          {revenueCents > 0 && (
            <span className="inline-flex items-center gap-0.5" style={{ color: "var(--forest)" }}>
              <DollarSign className="h-3 w-3" /> {(revenueCents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
          )}
        </div>
      </div>

      {/* WINS TILE — prominent motivation summary above the list */}
      {winsHeadline && (
        <div
          className="rounded-md px-3 py-2"
          style={{ backgroundColor: "rgba(53, 88, 52, 0.08)", borderLeft: "3px solid var(--forest)" }}
        >
          <div className="text-sm font-semibold" style={{ color: "var(--forest)" }}>
            {winsHeadline}
          </div>
          {winsSubcopy && (
            <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              {winsSubcopy}
            </div>
          )}
        </div>
      )}
      <ul className="space-y-1 overflow-auto flex-1 min-h-0">
        {events.map((e) => (
          <li key={e.id} className="flex items-start gap-2 text-[11px] leading-snug">
            <span className="tabular-nums text-muted-foreground shrink-0 w-12">{fmtTime(e.at)}</span>
            {e.kind === "task" ? (
              <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" style={{ color: "var(--forest)" }} />
            ) : e.kind === "revenue" ? (
              <DollarSign className="h-3 w-3 mt-0.5 shrink-0" style={{ color: "var(--forest)" }} />
            ) : (
              <Sparkles className="h-3 w-3 mt-0.5 shrink-0" style={{ color: "var(--yellow)" }} />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-foreground truncate">{e.title}</div>
              {e.detail && (
                <div className="text-muted-foreground text-[10px] truncate">{e.detail}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
