import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, ChevronRight, Trophy, Target, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Workflow = {
  id: string;
  name: string;
  emoji: string | null;
  forcing_function: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: string | null;
};

type Phase = {
  id: string;
  workflow_id: string;
  name: string;
  goal: string | null;
  status: string | null;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
};

type Task = {
  id: string;
  phase_id: string | null;
  title: string;
  status: string;
  dollar_lever: string | null;
  blocker: string | null;
  sort_order: number;
  completed_at: string | null;
};

function dayDelta(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = new Date(from + "T00:00:00").getTime();
  const b = new Date(to + "T00:00:00").getTime();
  return Math.round((b - a) / 86400_000);
}

function fmtDateRange(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const sameMonth = s.getMonth() === e.getMonth();
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return sameMonth
    ? `${s.toLocaleDateString(undefined, opts)}–${e.getDate()}`
    : `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
}

export function WorkflowMapStatusView({
  archiveHtml,
}: {
  archiveHtml?: string;
}) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [expandedShipped, setExpandedShipped] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb = supabase as any;
        const wfRes = await sb
          .from("exec_os_workflows")
          .select("id, name, emoji, forcing_function, starts_at, ends_at, status")
          .eq("status", "active")
          .order("sort_order", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!wfRes.data) {
          if (!cancelled) setErr("No active workflow found");
          return;
        }
        const wf = wfRes.data as Workflow;

        const [phasesRes, tasksRes] = await Promise.all([
          sb
            .from("exec_os_workflow_phases")
            .select("id, workflow_id, name, goal, status, starts_at, ends_at, sort_order")
            .eq("workflow_id", wf.id)
            .order("sort_order", { ascending: true }),
          sb
            .from("exec_os_workflow_tasks")
            .select("id, phase_id, title, status, dollar_lever, blocker, sort_order, completed_at")
            .order("sort_order", { ascending: true }),
        ]);

        if (cancelled) return;
        setWorkflow(wf);
        setPhases((phasesRes.data as Phase[]) ?? []);
        setTasks((tasksRes.data as Task[]) ?? []);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pick the active phase: explicit status='active', else first by sort_order
  // where today is within [starts_at, ends_at], else first pending.
  const activePhase = useMemo<Phase | null>(() => {
    if (phases.length === 0) return null;
    const todayStr = new Date().toISOString().slice(0, 10);
    const inWindow = phases.find(
      (p) =>
        p.starts_at &&
        p.ends_at &&
        p.starts_at <= todayStr &&
        todayStr <= p.ends_at,
    );
    if (inWindow) return inWindow;
    const active = phases.find((p) => p.status === "active");
    if (active) return active;
    const pending = phases.find((p) => p.status === "pending");
    return pending ?? phases[0];
  }, [phases]);

  const activePhaseTasks = useMemo(
    () => tasks.filter((t) => t.phase_id === activePhase?.id),
    [tasks, activePhase],
  );

  const doneThisPhase = activePhaseTasks.filter((t) => t.status === "done").length;
  const totalThisPhase = activePhaseTasks.length;
  const pct = totalThisPhase === 0 ? 0 : Math.round((doneThisPhase / totalThisPhase) * 100);

  // Roll forward: if the active phase has no open tasks, surface tasks from
  // the next phase by sort_order so Donna always sees "what to do next".
  const nextActions = useMemo(() => {
    const fromActive = activePhaseTasks.filter(
      (t) => t.status === "pending" || t.status === "in_progress",
    );
    if (fromActive.length > 0) return fromActive.slice(0, 3);
    const activeIdx = phases.findIndex((p) => p.id === activePhase?.id);
    for (let i = activeIdx + 1; i < phases.length; i++) {
      const next = phases[i];
      const open = tasks.filter(
        (t) =>
          t.phase_id === next.id &&
          (t.status === "pending" || t.status === "in_progress"),
      );
      if (open.length > 0) return open.slice(0, 3);
    }
    return [];
  }, [activePhaseTasks, phases, tasks, activePhase]);

  const nextActionsAreFromNextPhase = useMemo(() => {
    if (nextActions.length === 0) return false;
    return nextActions[0].phase_id !== activePhase?.id;
  }, [nextActions, activePhase]);

  const nextActionsPhaseName = useMemo(() => {
    if (!nextActionsAreFromNextPhase || nextActions.length === 0) return null;
    const ph = phases.find((p) => p.id === nextActions[0].phase_id);
    return ph?.name ?? null;
  }, [nextActions, nextActionsAreFromNextPhase, phases]);

  const blockers = useMemo(
    () =>
      tasks.filter((t) => t.status === "blocked" && t.blocker),
    [tasks],
  );

  const inProgress = useMemo(
    () => tasks.filter((t) => t.status === "in_progress"),
    [tasks],
  );

  const recentWins = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "done" && t.completed_at)
        .sort((a, b) => (a.completed_at! < b.completed_at! ? 1 : -1)),
    [tasks],
  );

  // Shipped — all done tasks, grouped by phase, in plan order.
  const shippedByPhase = useMemo(() => {
    const out: { phase: Phase; tasks: Task[] }[] = [];
    for (const p of phases) {
      const done = tasks.filter((t) => t.phase_id === p.id && t.status === "done");
      if (done.length > 0) out.push({ phase: p, tasks: done });
    }
    return out;
  }, [phases, tasks]);

  const daysLeft = useMemo(() => {
    if (!activePhase?.ends_at) return null;
    return dayDelta(new Date().toISOString().slice(0, 10), activePhase.ends_at);
  }, [activePhase]);

  const workflowDaysLeft = useMemo(() => {
    if (!workflow?.ends_at) return null;
    return dayDelta(new Date().toISOString().slice(0, 10), workflow.ends_at);
  }, [workflow]);

  if (err) {
    return (
      <div className="p-4 text-sm text-[color:var(--orange)] flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        {err}
      </div>
    );
  }

  if (!workflow || !activePhase) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="p-5 space-y-6">
      {/* HERO — where you are */}
      <section className="space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Active workflow
        </div>
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          {workflow.emoji && <span>{workflow.emoji}</span>}
          {workflow.name}
        </h2>
        {workflow.forcing_function && (
          <p className="text-xs text-muted-foreground italic leading-relaxed">
            {workflow.forcing_function}
          </p>
        )}
        {workflowDaysLeft != null && (
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {workflowDaysLeft > 0
              ? `${workflowDaysLeft} days left in workflow`
              : workflowDaysLeft === 0
                ? "Last day"
                : `${Math.abs(workflowDaysLeft)} days past end`}
          </div>
        )}
      </section>

      {/* PHASE STRIP — visual map of all phases */}
      <section className="space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Phases
        </div>
        <ol className="flex flex-wrap gap-1.5">
          {phases.map((p) => {
            const isActive = p.id === activePhase.id;
            const phaseDone = tasks.filter(
              (t) => t.phase_id === p.id && t.status === "done",
            ).length;
            const phaseTotal = tasks.filter((t) => t.phase_id === p.id).length;
            const complete = phaseTotal > 0 && phaseDone === phaseTotal;
            return (
              <li
                key={p.id}
                className={`text-[11px] rounded-full px-2.5 py-1 border ${
                  isActive
                    ? "bg-[color:var(--navy)] text-white border-[color:var(--navy)]"
                    : complete
                      ? "bg-[color:var(--sage)]/20 text-[color:var(--forest)] border-[color:var(--sage)]"
                      : "bg-card text-muted-foreground border-border"
                }`}
                title={p.goal ?? ""}
              >
                <span className="font-medium">{p.name}</span>
                {phaseTotal > 0 && (
                  <span className={`ml-1.5 tabular-nums ${isActive ? "text-white/80" : ""}`}>
                    {phaseDone}/{phaseTotal}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* CURRENT PHASE DETAIL — where you are right now */}
      <section className="space-y-3 rounded-xl border border-[color:var(--navy)] bg-[color:var(--navy)]/5 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--navy)] font-medium">
              You are here
            </div>
            <h3 className="text-base font-semibold text-foreground truncate">
              {activePhase.name}
            </h3>
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {fmtDateRange(activePhase.starts_at, activePhase.ends_at)}
            {daysLeft != null && daysLeft >= 0 && (
              <> · {daysLeft}d left</>
            )}
          </div>
        </div>

        {activePhase.goal && (
          <div className="flex items-start gap-2 text-xs text-foreground">
            <Target className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: "var(--navy)" }} />
            <span>{activePhase.goal}</span>
          </div>
        )}

        {totalThisPhase > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Progress</span>
              <span className="tabular-nums">
                {doneThisPhase} / {totalThisPhase} · {pct}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-border overflow-hidden">
              <div
                className="h-full bg-[color:var(--forest)] transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {/* NEXT ACTIONS — what to do right now */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Next up
          </div>
          {nextActionsAreFromNextPhase && nextActionsPhaseName && (
            <div className="text-[10px] text-[color:var(--forest)]">
              ✓ This phase done — pulling from {nextActionsPhaseName}
            </div>
          )}
        </div>
        {nextActions.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No open tasks across remaining phases. You shipped everything in the plan.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {nextActions.map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-2 text-sm rounded-lg border border-border bg-card px-3 py-2"
              >
                <Circle className="h-3.5 w-3.5 mt-1 shrink-0" style={{ color: "var(--navy)" }} />
                <div className="min-w-0 flex-1">
                  <div className="text-foreground">{t.title}</div>
                  {t.dollar_lever && (
                    <div className="text-[11px]" style={{ color: "var(--forest)" }}>
                      $ lever · {t.dollar_lever}
                    </div>
                  )}
                </div>
                {t.status === "in_progress" && (
                  <span className="text-[10px] uppercase tracking-wider text-[color:var(--orange)] font-medium">
                    in progress
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* BLOCKERS */}
      {blockers.length > 0 && (
        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--orange)]">
            Blocked
          </div>
          <ul className="space-y-1">
            {blockers.map((t) => (
              <li key={t.id} className="text-xs text-foreground">
                <span className="font-medium">{t.title}</span>
                <span className="text-muted-foreground"> — {t.blocker}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* IN PROGRESS — tasks actively being worked on */}
      {inProgress.length > 0 && (
        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--orange)" }}>
            In progress · {inProgress.length}
          </div>
          <ul className="space-y-1.5">
            {inProgress.map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-2 text-sm rounded-lg border px-3 py-2"
                style={{ borderColor: "var(--orange)", background: "rgba(233,116,81,0.06)" }}
              >
                <Circle className="h-3.5 w-3.5 mt-1 shrink-0" style={{ color: "var(--orange)" }} />
                <div className="min-w-0 flex-1">
                  <div className="text-foreground">{t.title}</div>
                  {t.dollar_lever && (
                    <div className="text-[11px]" style={{ color: "var(--forest)" }}>
                      $ lever · {t.dollar_lever}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* SHIPPED — proof of motion, grouped by phase, collapsed per-group */}
      {shippedByPhase.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Shipped · {recentWins.length} total
            </div>
          </div>
          <div className="space-y-2">
            {shippedByPhase.map(({ phase, tasks: phaseTasks }) => {
              const isExpanded = expandedShipped[phase.id] ?? phase.id === activePhase.id;
              return (
                <div key={phase.id} className="rounded-lg border border-border bg-card">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedShipped((cur) => ({ ...cur, [phase.id]: !isExpanded }))
                    }
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40"
                  >
                    <span className="flex items-center gap-2 text-xs">
                      <ChevronRight
                        className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      />
                      <span className="font-medium text-foreground">{phase.name}</span>
                    </span>
                    <span
                      className="text-[10px] tabular-nums"
                      style={{ color: "var(--forest)" }}
                    >
                      {phaseTasks.length} shipped
                    </span>
                  </button>
                  {isExpanded && (
                    <ul className="space-y-1 px-3 pb-3 pt-1 border-t border-border/50">
                      {phaseTasks.map((t) => (
                        <li key={t.id} className="flex items-start gap-2 text-xs">
                          <CheckCircle2
                            className="h-3 w-3 mt-0.5 shrink-0"
                            style={{ color: "var(--forest)" }}
                          />
                          <span className="text-foreground line-through opacity-75">
                            {t.title}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ARCHIVE — the old wall of text, collapsed by default */}
      {archiveHtml && archiveHtml.length > 0 && (
        <section className="border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setShowArchive((v) => !v)}
            className="flex w-full items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${showArchive ? "rotate-90" : ""}`}
            />
            <Trophy className="h-3 w-3" />
            <span>Full architecture map + dated update archive</span>
          </button>
          {showArchive && (
            <div
              className="mt-3 text-xs prose-sm max-w-none"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: archiveHtml }}
            />
          )}
        </section>
      )}
    </div>
  );
}
