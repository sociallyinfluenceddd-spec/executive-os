import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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

// exec_os_projects isn't in the Supabase-generated types yet — added by
// migration 20260517140000_projects_content.sql. Route calls through the
// untyped alias until types are regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdb = supabase as any;

const NAVY = "#083D77";
const FOREST = "#355834";
const ORANGE = "#E97451";
const SAGE = "#A4B494";
const YELLOW = "#FFC100";

type Status = "active" | "paused" | "done";

type ProjectRow = {
  id: string;
  name: string;
  status: Status;
  progress: number; // 0-100
  deadline: string | null;
  notes: string | null;
  sort_order: number;
  updated_at: string;
};

const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  paused: "Paused",
  done: "Done",
};

const STATUS_COLOR: Record<Status, string> = {
  active: NAVY,
  paused: SAGE,
  done: FOREST,
};

function daysUntil(iso: string | null): { label: string; tone: "good" | "soon" | "overdue" | "none" } {
  if (!iso) return { label: "", tone: "none" };
  const due = new Date(iso + "T00:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((due - today.getTime()) / 86_400_000);
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, tone: "overdue" };
  if (diff === 0) return { label: "due today", tone: "soon" };
  if (diff <= 3) return { label: `${diff}d left`, tone: "soon" };
  if (diff <= 14) return { label: `${diff}d left`, tone: "good" };
  return { label: iso.slice(5), tone: "good" };
}

export function ProjectsWidget() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [progress, setProgress] = useState("0");
  const [deadline, setDeadline] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await pdb
      .from("exec_os_projects")
      .select("id, name, status, progress, deadline, notes, sort_order, updated_at")
      .order("status", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("updated_at", { ascending: false });
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
        setRows([]);
        return;
      }
      toast.error("Couldn't load projects", { description: error.message });
      setRows([]);
      return;
    }
    setSetupNeeded(false);
    setRows((data ?? []) as ProjectRow[]);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setName("");
    setStatus("active");
    setProgress("0");
    setDeadline("");
  };

  const submit = async () => {
    if (!user) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name required");
      return;
    }
    const pct = Math.max(0, Math.min(100, Number.parseInt(progress, 10) || 0));
    setBusy(true);
    const { error } = await pdb.from("exec_os_projects").insert({
      user_id: user.id,
      name: trimmed,
      status,
      progress: pct,
      deadline: deadline || null,
      sort_order: (rows?.length ?? 0) + 1,
    });
    setBusy(false);
    if (error) {
      toast.error("Couldn't save", { description: error.message });
      return;
    }
    toast.success("Added");
    resetForm();
    setAdding(false);
    void load();
  };

  const setProgressFor = async (id: string, pct: number) => {
    const prev = rows ?? [];
    setRows(prev.map((r) => (r.id === id ? { ...r, progress: pct } : r)));
    const { error } = await pdb.from("exec_os_projects").update({ progress: pct }).eq("id", id);
    if (error) {
      toast.error("Couldn't update", { description: error.message });
      setRows(prev);
    }
  };

  const cycleStatus = async (row: ProjectRow) => {
    const order: Status[] = ["active", "paused", "done"];
    const next = order[(order.indexOf(row.status) + 1) % order.length];
    const prev = rows ?? [];
    setRows(prev.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    const { error } = await pdb.from("exec_os_projects").update({ status: next }).eq("id", row.id);
    if (error) {
      toast.error("Couldn't update", { description: error.message });
      setRows(prev);
    }
  };

  const remove = async (id: string) => {
    const prev = rows ?? [];
    setRows(prev.filter((r) => r.id !== id));
    const { error } = await pdb.from("exec_os_projects").delete().eq("id", id);
    if (error) {
      toast.error("Couldn't delete", { description: error.message });
      setRows(prev);
    }
  };

  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  if (setupNeeded) {
    return (
      <div className="text-xs space-y-2">
        <div className="font-medium text-foreground">Projects table not deployed yet.</div>
        <div className="text-muted-foreground leading-relaxed">
          The <code className="text-[11px] px-1 rounded bg-muted">exec_os_projects</code>{" "}
          migration hasn't been applied. Once it lands, this widget tracks your active builds.
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

  const active = rows.filter((r) => r.status === "active").length;
  const total = rows.length;
  const visible = rows.filter((r) => r.status !== "done").slice(0, 8);

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-baseline gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Active</div>
          <div className="text-2xl font-semibold tabular-nums text-foreground">{active}</div>
        </div>
        <div className="text-[11px] text-muted-foreground">of {total} total</div>
      </div>

      {adding ? (
        <div className="border border-border rounded-md p-2.5 space-y-2 bg-muted/30 no-drag">
          <Input
            type="text"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="no-drag h-8 text-sm"
          />
          <div className="grid grid-cols-3 gap-2">
            <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
              <SelectTrigger className="no-drag h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["active", "paused", "done"] as Status[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min="0"
              max="100"
              step="5"
              placeholder="%"
              value={progress}
              onChange={(e) => setProgress(e.target.value)}
              className="no-drag h-8 text-sm"
            />
            <Input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="no-drag h-8 text-sm"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdding(false);
                resetForm();
              }}
              className="no-drag h-7 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={busy || !name.trim()}
              className="no-drag h-7 text-xs"
              style={{ backgroundColor: NAVY, color: "white" }}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAdding(true)}
          className="no-drag h-7 text-xs self-start"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add project
        </Button>
      )}

      <div className="flex-1 overflow-auto -mx-1 px-1">
        {visible.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            {total === 0
              ? "No projects yet. Add your first one to start tracking."
              : "No active or paused projects. ✨"}
          </p>
        ) : (
          <ul className="space-y-2.5">
            {visible.map((p) => {
              const due = daysUntil(p.deadline);
              return (
                <li key={p.id} className="group">
                  <div className="flex items-center gap-2 text-xs mb-1">
                    <button
                      type="button"
                      onClick={() => cycleStatus(p)}
                      className="no-drag shrink-0 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-opacity hover:opacity-80"
                      style={{ background: STATUS_COLOR[p.status] + "22", color: STATUS_COLOR[p.status] }}
                      title="Cycle status"
                    >
                      {STATUS_LABEL[p.status]}
                    </button>
                    <span className="font-medium text-foreground flex-1 truncate">{p.name}</span>
                    {due.label && (
                      <span
                        className="shrink-0 text-[10px]"
                        style={{
                          color:
                            due.tone === "overdue" ? ORANGE : due.tone === "soon" ? YELLOW : "#6B6B6B",
                        }}
                      >
                        {due.label}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      className="no-drag opacity-0 group-hover:opacity-100 transition-opacity p-1 -m-1 text-muted-foreground hover:text-[color:var(--orange)]"
                      aria-label="Delete project"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={p.progress}
                      onChange={(e) => setProgressFor(p.id, Number(e.target.value))}
                      className="no-drag flex-1 h-1.5 accent-[color:var(--navy)]"
                      title={`${p.progress}%`}
                    />
                    <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-right">
                      {p.progress}%
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
