import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Terminal,
  ChevronDown,
  ChevronRight,
  Clock,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

// Workflow tables aren't in generated types yet — added by migration
// 20260517170000_workflows.sql. Untyped alias until types regenerate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wdb = supabase as any;

const NAVY = "#083D77";
const FOREST = "#355834";
const YELLOW = "#FFC100";
const ORANGE = "#E97451";
const SAGE = "#A4B494";

type WorkflowRow = {
  id: string;
  name: string;
  emoji: string | null;
  category: string;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
  forcing_function: string | null;
};

type PhaseRow = {
  id: string;
  workflow_id: string;
  name: string;
  goal: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: "pending" | "active" | "done" | "skipped";
  sort_order: number;
};

type TaskRow = {
  id: string;
  phase_id: string;
  title: string;
  description: string | null;
  owner: "donna" | "claude" | "lovable" | "both" | "external";
  status: "pending" | "in_progress" | "done" | "blocked" | "skipped";
  blocker: string | null;
  time_estimate: string | null;
  dollar_lever: string | null;
  claude_prompt: string | null;
  done_when: string | null;
  completed_at: string | null;
  sort_order: number;
};

const OWNER_LABEL: Record<TaskRow["owner"], string> = {
  donna: "You",
  claude: "Claude",
  lovable: "Lovable",
  both: "You + Claude",
  external: "External",
};

const OWNER_COLOR: Record<TaskRow["owner"], string> = {
  donna: NAVY,
  claude: "#7C3AED",
  lovable: ORANGE,
  both: FOREST,
  external: "#6B7280",
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function WorkflowsWidget() {
  const { user } = useAuth();
  const [workflow, setWorkflow] = useState<WorkflowRow | null | undefined>(undefined);
  const [phases, setPhases] = useState<PhaseRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    // Active workflow (priority: ideafetti category, then sort_order)
    const wRes = await wdb
      .from("exec_os_workflows")
      .select("id, name, emoji, category, starts_at, ends_at, status, forcing_function")
      .eq("status", "active")
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (wRes.error) {
      const msg = (wRes.error.message || "").toLowerCase();
      const code = (wRes.error as { code?: string }).code;
      if (
        code === "42P01" ||
        msg.includes("schema cache") ||
        msg.includes("does not exist") ||
        msg.includes("could not find the table")
      ) {
        setSetupNeeded(true);
        setWorkflow(null);
        return;
      }
      toast.error("Couldn't load workflow", { description: wRes.error.message });
      setWorkflow(null);
      return;
    }

    const wf = wRes.data as WorkflowRow | null;
    setWorkflow(wf);
    setSetupNeeded(false);
    if (!wf) {
      setPhases([]);
      setTasks([]);
      return;
    }

    const [pRes, tRes] = await Promise.all([
      wdb
        .from("exec_os_workflow_phases")
        .select("id, workflow_id, name, goal, starts_at, ends_at, status, sort_order")
        .eq("workflow_id", wf.id)
        .order("sort_order", { ascending: true }),
      wdb
        .from("exec_os_workflow_tasks")
        .select(
          "id, phase_id, title, description, owner, status, blocker, time_estimate, dollar_lever, claude_prompt, done_when, completed_at, sort_order",
        )
        .eq("workflow_id", wf.id)
        .order("sort_order", { ascending: true }),
    ]);

    if (!pRes.error) setPhases((pRes.data ?? []) as PhaseRow[]);
    if (!tRes.error) setTasks((tRes.data ?? []) as TaskRow[]);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  // Pick the "current" phase: first active, then first pending that has not started yet,
  // else the most recent done. Use today's date to decide.
  const currentPhase = useMemo(() => {
    if (!phases.length) return null;
    const t = todayISO();
    // Phase whose starts_at <= today <= ends_at and not done
    const within = phases.find(
      (p) =>
        p.status !== "done" &&
        (!p.starts_at || p.starts_at <= t) &&
        (!p.ends_at || p.ends_at >= t),
    );
    if (within) return within;
    // First pending phase that hasn't started
    const upcoming = phases.find((p) => p.status === "pending");
    if (upcoming) return upcoming;
    // Last active or last done
    return [...phases].reverse().find((p) => p.status === "active") ?? phases[phases.length - 1];
  }, [phases]);

  const phaseTasks = useMemo(() => {
    if (!currentPhase) return [];
    return tasks.filter((t) => t.phase_id === currentPhase.id);
  }, [tasks, currentPhase]);

  const phaseDone = useMemo(
    () => phaseTasks.filter((t) => t.status === "done").length,
    [phaseTasks],
  );

  const phaseProgress = phaseTasks.length > 0 ? phaseDone / phaseTasks.length : 0;

  const totalDone = tasks.filter((t) => t.status === "done").length;
  const totalActive = tasks.length;

  const sendToClaude = useCallback(async (task: TaskRow) => {
    if (!task.claude_prompt) {
      toast.error("No Claude prompt set for this task", {
        description: "Edit the task to add one.",
      });
      return;
    }
    await navigator.clipboard.writeText(task.claude_prompt).catch(() => {});
    toast.success("Prompt copied", {
      description: "Paste into your Claude Code terminal (Cmd+V, Enter).",
      duration: 5000,
    });
  }, []);

  const markDone = useCallback(
    async (task: TaskRow) => {
      const newStatus = task.status === "done" ? "pending" : "done";
      const completed = newStatus === "done" ? new Date().toISOString() : null;
      setTasks((cur) =>
        cur.map((t) =>
          t.id === task.id ? { ...t, status: newStatus, completed_at: completed } : t,
        ),
      );
      const { error } = await wdb
        .from("exec_os_workflow_tasks")
        .update({ status: newStatus, completed_at: completed })
        .eq("id", task.id);
      if (error) {
        toast.error("Couldn't update", { description: error.message });
        void load();
      } else if (newStatus === "done") {
        toast.success("Task complete ✓");
      }
    },
    [load],
  );

  const cycleTaskStatus = useCallback(
    async (task: TaskRow) => {
      const order: TaskRow["status"][] = ["pending", "in_progress", "done", "blocked"];
      const next = order[(order.indexOf(task.status) + 1) % order.length];
      const completed = next === "done" ? new Date().toISOString() : null;
      setTasks((cur) =>
        cur.map((t) =>
          t.id === task.id ? { ...t, status: next, completed_at: completed } : t,
        ),
      );
      const { error } = await wdb
        .from("exec_os_workflow_tasks")
        .update({ status: next, completed_at: completed })
        .eq("id", task.id);
      if (error) {
        toast.error("Couldn't update", { description: error.message });
        void load();
      }
    },
    [load],
  );

  // ---------- Render ----------
  if (workflow === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (setupNeeded) {
    return (
      <div className="text-xs space-y-2">
        <div className="font-medium text-foreground">Workflow tables not deployed yet.</div>
        <div className="text-muted-foreground leading-relaxed">
          The <code className="text-[11px] px-1 rounded bg-muted">exec_os_workflows</code>{" "}
          migration hasn't been applied. Apply it via Lovable's Cloud → SQL editor.
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          className="no-drag h-7 text-xs"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="text-xs text-muted-foreground py-3">
        No active workflow. Seed the Ideafetti 30-day workflow via SQL.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-2.5">
      {/* HEADER: workflow + forcing function */}
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-lg leading-none">{workflow.emoji ?? "🗓"}</span>
          <span className="text-sm font-semibold text-foreground truncate">{workflow.name}</span>
        </div>
        {workflow.forcing_function && (
          <p className="text-[10px] text-muted-foreground italic mt-0.5 leading-tight line-clamp-2">
            {workflow.forcing_function}
          </p>
        )}
      </div>

      {/* CURRENT PHASE */}
      {currentPhase && (
        <div className="border border-border rounded-md p-2 bg-muted/30">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Current phase
              </div>
              <div className="text-xs font-semibold text-foreground truncate">{currentPhase.name}</div>
            </div>
            <div className="text-[10px] tabular-nums text-muted-foreground whitespace-nowrap">
              {phaseDone} / {phaseTasks.length}
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-1.5 h-1 bg-background rounded-full overflow-hidden">
            <div
              className="h-full transition-all"
              style={{
                width: `${phaseProgress * 100}%`,
                background: phaseProgress === 1 ? FOREST : NAVY,
              }}
            />
          </div>
          {currentPhase.goal && (
            <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">
              {currentPhase.goal}
            </p>
          )}
        </div>
      )}

      {/* TASKS */}
      <div className="flex-1 overflow-auto -mx-1 px-1 space-y-1.5">
        {phaseTasks.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No tasks in this phase yet.</p>
        ) : (
          phaseTasks.map((task) => {
            const isDone = task.status === "done";
            const isBlocked = task.status === "blocked";
            const isInProgress = task.status === "in_progress";
            const isExpanded = expandedTaskId === task.id;
            return (
              <div
                key={task.id}
                className={`border border-border rounded-md transition-colors ${
                  isDone ? "bg-muted/20 opacity-60" : "bg-card"
                }`}
              >
                {/* Task row */}
                <div className="flex items-start gap-2 p-2">
                  {/* Status checkbox */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void markDone(task);
                    }}
                    aria-label={isDone ? "Mark as not done" : "Mark as done"}
                    title={isDone ? "Done. Tap to undo." : "Tap when complete."}
                    className={`shrink-0 h-5 w-5 rounded border-2 flex items-center justify-center transition-colors mt-0.5 ${
                      isDone
                        ? "bg-[color:var(--forest)] border-[color:var(--forest)] text-white"
                        : isBlocked
                          ? "border-[color:var(--orange)] bg-[color:var(--orange)]/10"
                          : isInProgress
                            ? "border-[color:var(--yellow)] bg-[color:var(--yellow)]/15"
                            : "border-border hover:border-[color:var(--navy)]"
                    }`}
                  >
                    {isDone && <Check className="h-3 w-3" strokeWidth={3} />}
                    {isBlocked && <AlertCircle className="h-3 w-3" style={{ color: ORANGE }} />}
                    {isInProgress && (
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: YELLOW }}
                      />
                    )}
                  </button>

                  {/* Title + meta + body */}
                  <button
                    type="button"
                    onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex items-start gap-1.5">
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0 mt-1" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0 mt-1" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div
                          className={`text-xs font-medium leading-snug ${
                            isDone ? "line-through text-muted-foreground" : "text-foreground"
                          }`}
                        >
                          {task.title}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span
                            className="inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider"
                            style={{
                              background: OWNER_COLOR[task.owner] + "22",
                              color: OWNER_COLOR[task.owner],
                            }}
                          >
                            {OWNER_LABEL[task.owner]}
                          </span>
                          {task.time_estimate && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <Clock className="h-2.5 w-2.5" />
                              {task.time_estimate}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </div>

                {/* Expanded body */}
                {isExpanded && (
                  <div className="px-2 pb-2 pl-9 space-y-2 border-t border-border/50 pt-2">
                    {task.description && (
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {task.description}
                      </p>
                    )}
                    {task.dollar_lever && (
                      <div className="text-[10px]">
                        <span className="uppercase tracking-wider text-muted-foreground">
                          $ Lever ·{" "}
                        </span>
                        <span style={{ color: FOREST }}>{task.dollar_lever}</span>
                      </div>
                    )}
                    {task.done_when && (
                      <div className="text-[10px]">
                        <span className="uppercase tracking-wider text-muted-foreground">
                          Done when ·{" "}
                        </span>
                        <span className="text-foreground">{task.done_when}</span>
                      </div>
                    )}
                    {task.blocker && (
                      <div className="text-[10px]" style={{ color: ORANGE }}>
                        <span className="uppercase tracking-wider">Blocker · </span>
                        {task.blocker}
                      </div>
                    )}
                    {/* Action buttons */}
                    <div className="flex gap-2 pt-1">
                      {task.claude_prompt && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void sendToClaude(task)}
                          className="no-drag h-7 text-[11px] gap-1"
                          style={{ background: "#7C3AED", color: "white" }}
                        >
                          <Terminal className="h-3 w-3" />
                          Send to Claude
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void cycleTaskStatus(task)}
                        className="no-drag h-7 text-[11px]"
                      >
                        Cycle status
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* FOOTER: overall progress */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50 text-[10px] text-muted-foreground">
        <span>
          {totalDone} / {totalActive} done overall
        </span>
        <span className="flex items-center gap-1">
          <Sparkles className="h-2.5 w-2.5" style={{ color: SAGE }} />
          Tap title to expand · Tap box to complete
        </span>
      </div>
    </div>
  );
}
