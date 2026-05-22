// /today-v2 — the Concierge dashboard.
//
// This is the real workspace, not a billboard. Each section collapses to
// a one-line headline. Click it → expands inline to show the actual list
// AND the action buttons (copy message, mark sent, open in Gmail, run
// agent, log revenue, etc.). Only one section is open at a time → calm.
//
// Design language: .concierge scope. Sand background, brass accents,
// Fraunces serif headlines, Inter body, tabular numerals. No widget
// cards. Hairline rules instead of borders.

import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { StudioShell } from "@/components/StudioShell";
import { TimersAlarmsMenu } from "@/components/header/TimersAlarmsMenu";
import { ExternalLink, Copy, Check, X, Edit3, Archive, RefreshCw, Plus, Target, PenLine, Loader2, Sparkles, ChevronRight, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fetchCalendarEvents } from "@/lib/google-calendar";
import { refreshGmail } from "@/lib/google-gmail";
import {
  listPendingOutputs,
  approveOutput,
  rejectOutput,
  approveWithEdits,
  archiveOutput,
  AGENT_META,
  KIND_LABEL,
  type AgentOutput,
} from "@/lib/agent-outputs";
import { listClients, pipelineSummary, formatCents, STATUS_META, type Client, type PipelineSummary } from "@/lib/clients";
import { reissueDraft, runCleoForClient } from "@/lib/cleo";
import { runSageNow } from "@/lib/sage";
import { runRenNow } from "@/lib/ren";
import { runMayaNow } from "@/lib/maya";

export const Route = createFileRoute("/today")({
  component: ConciergePage,
});

type SectionKey = "schedule" | "brief" | "inbox" | "pipeline" | "money" | "staff" | "one" | "wins" | "workflows";

interface WorkflowTask {
  id: string;
  title: string;
  status: string;
  time_estimate: string | null;
  dollar_lever: string | null;
  workflow_id: string;
  workflow_name: string;
  phase_id: string;
  phase_name: string;
  sort_order: number;
}

interface CalendarEvent {
  id: string;
  title: string | null;
  start_at: string | null;
  end_at: string | null;
  account?: string;
  location?: string;
  video_url?: string | null;
}

interface EmailFull {
  id: string;
  account: string;
  external_id: string | null;
  kind: string;
  sender_name: string | null;
  sender_email: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string | null;
  status: string | null;
}

interface DailyRow {
  top_priority: string | null;
  energy_level: number | null;
}

function ConciergePage() {
  const { user } = useAuth();
  const [openSection, setOpenSection] = useState<SectionKey | null>(null);
  const toggle = (k: SectionKey) => setOpenSection(openSection === k ? null : k);

  // Live clock
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const msUntilNextMinute = 60_000 - (Date.now() % 60_000) + 50;
      timeoutId = setTimeout(() => { setNow(new Date()); schedule(); }, msUntilNextMinute);
    };
    schedule();
    const onFocus = () => { setNow(new Date()); };
    window.addEventListener("focus", onFocus);
    return () => { if (timeoutId) clearTimeout(timeoutId); window.removeEventListener("focus", onFocus); };
  }, []);

  // Data state
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [emails, setEmails] = useState<EmailFull[]>([]);
  const [brief, setBrief] = useState<AgentOutput[]>([]);
  const [pipeline, setPipeline] = useState<PipelineSummary | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [daily, setDaily] = useState<DailyRow | null>(null);
  const [revenueCents, setRevenueCents] = useState({ today: 0, week: 0, month: 0, lastWeek: 0 });

  // Gamification state
  const [doneTodayItems, setDoneTodayItems] = useState<Array<{ id: string; title: string; dollar_lever: string | null; completed_at: string }>>([]);
  const [doneThisWeekCount, setDoneThisWeekCount] = useState(0);
  const [approvedToday, setApprovedToday] = useState(0);
  const [sentToday, setSentToday] = useState(0);
  const [streak, setStreak] = useState(0);
  const [agentStats, setAgentStats] = useState<Record<string, { drafted: number; sent: number }>>({});

  // Workflows — active workflow's pending tasks (the daily build queue)
  const [workflowTasks, setWorkflowTasks] = useState<WorkflowTask[]>([]);
  // Maya's pending outputs — pulled out of Brief and applied to the To Ship
  // surface directly. Maya doesn't talk in Brief; she annotates the build queue.
  const [mayaOutputs, setMayaOutputs] = useState<AgentOutput[]>([]);

  // Visualization data
  const [habitGrid, setHabitGrid] = useState<boolean[]>([]); // last 30 days, true if any task done
  const [taskBars, setTaskBars] = useState<number[]>([]); // last 7 days, count of done tasks per day
  const [revenueSeries, setRevenueSeries] = useState<number[]>([]); // last 14 days, cents per day

  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick((t) => t + 1);

  useEffect(() => {
    if (!user) return;
    void refreshGmail();
    const todayStr = now.toISOString().slice(0, 10);
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 6); weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    // For streak + velocity comparisons
    const lastWeekStart = new Date(); lastWeekStart.setDate(lastWeekStart.getDate() - 13); lastWeekStart.setHours(0, 0, 0, 0);
    const lastWeekEnd = new Date(weekStart);

    // For 14-day revenue sparkline
    const fourteenAgoIso = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);

    void (async () => {
      const [cal, em, br, pp, cl, dailyRow, revToday, revWeek, revMonth, revLastWeek, doneToday, agentToday, streakRows, allAgentOutputs, wfTasksRaw, workflows, phasesRaw, doneThisWeek, revDaily] = await Promise.all([
        fetchCalendarEvents({ timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString() }).then((r) => r.events),
        supabase
          .from("exec_os_emails")
          .select("id,account,external_id,kind,sender_name,sender_email,subject,snippet,received_at,status")
          .eq("user_id", user.id),
        listPendingOutputs(25),
        pipelineSummary(),
        listClients({ statuses: ["lead", "contacted", "qualified", "proposal_sent", "active"], limit: 20 }),
        supabase.from("exec_os_daily").select("top_priority,energy_level").eq("user_id", user.id).eq("entry_date", todayStr).maybeSingle(),
        supabase.from("exec_os_revenue").select("amount_cents").eq("user_id", user.id).eq("entry_date", todayStr),
        supabase.from("exec_os_revenue").select("amount_cents").eq("user_id", user.id).gte("entry_date", weekStart.toISOString().slice(0, 10)),
        supabase.from("exec_os_revenue").select("amount_cents").eq("user_id", user.id).gte("entry_date", monthStart.toISOString().slice(0, 10)),
        supabase.from("exec_os_revenue").select("amount_cents").eq("user_id", user.id).gte("entry_date", lastWeekStart.toISOString().slice(0, 10)).lt("entry_date", lastWeekEnd.toISOString().slice(0, 10)),
        // Today's completed workflow tasks (for Wins section + score)
        supabase
          .from("exec_os_workflow_tasks")
          .select("id, title, dollar_lever, completed_at")
          .eq("user_id", user.id)
          .eq("status", "done")
          .gte("completed_at", dayStart.toISOString())
          .lt("completed_at", dayEnd.toISOString())
          .order("completed_at", { ascending: false }),
        // Today's approved + sent agent outputs (for score)
        supabase
          .from("exec_os_agent_outputs")
          .select("status, acted_at")
          .eq("user_id", user.id)
          .gte("acted_at", dayStart.toISOString())
          .in("status", ["approved", "edited", "sent"]),
        // Streak — last 30 days of completed task dates
        supabase
          .from("exec_os_workflow_tasks")
          .select("completed_at")
          .eq("user_id", user.id)
          .eq("status", "done")
          .gte("completed_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
          .order("completed_at", { ascending: false }),
        // All agent outputs from last 7 days — for per-agent box scores
        supabase
          .from("exec_os_agent_outputs")
          .select("agent_id, status")
          .eq("user_id", user.id)
          .gte("created_at", weekStart.toISOString()),
        // Open workflow tasks across all active workflows
        supabase
          .from("exec_os_workflow_tasks")
          .select("id, title, status, time_estimate, dollar_lever, workflow_id, phase_id, sort_order")
          .eq("user_id", user.id)
          .in("status", ["pending", "in_progress"])
          .order("sort_order", { ascending: true })
          .limit(40),
        // Workflows + phases lookup (so we can show readable names on each task)
        supabase
          .from("exec_os_workflows")
          .select("id, name")
          .eq("user_id", user.id)
          .eq("status", "active"),
        supabase
          .from("exec_os_workflow_phases")
          .select("id, name, workflow_id")
          .eq("user_id", user.id),
        // This week's completed task count — for broader Wins context
        supabase
          .from("exec_os_workflow_tasks")
          .select("id")
          .eq("user_id", user.id)
          .eq("status", "done")
          .gte("completed_at", weekStart.toISOString()),
        // Revenue over the last 14 days (daily) — for the Money sparkline
        supabase
          .from("exec_os_revenue")
          .select("amount_cents, entry_date")
          .eq("user_id", user.id)
          .gte("entry_date", fourteenAgoIso)
          .order("entry_date", { ascending: true }),
      ]);
      setEvents((cal ?? []) as CalendarEvent[]);
      setEmails(((em.data ?? []) as EmailFull[]));
      // Split Maya outputs off — they belong on the To Ship card, not Brief.
      // Maya's "today's ship" pick (kind=insight) becomes the highlighted task
      // at the top of To Ship; her approach notes (kind=pr_proposal) attach
      // inline to their task row.
      const mayaOuts = br.filter((o) => o.agent_id === "maya");
      const briefMinusMaya = br.filter((o) => o.agent_id !== "maya");
      setBrief(briefMinusMaya);
      setMayaOutputs(mayaOuts);
      setPipeline(pp);
      setClients(cl);
      setDaily((dailyRow.data as DailyRow | null) ?? null);
      const sum = (rows: { amount_cents: number }[] | null) => (rows ?? []).reduce((a, r) => a + r.amount_cents, 0);
      setRevenueCents({
        today: sum((revToday.data ?? []) as { amount_cents: number }[]),
        week: sum((revWeek.data ?? []) as { amount_cents: number }[]),
        month: sum((revMonth.data ?? []) as { amount_cents: number }[]),
        lastWeek: sum((revLastWeek.data ?? []) as { amount_cents: number }[]),
      });

      // Gamification derives
      setDoneTodayItems(((doneToday.data ?? []) as Array<{ id: string; title: string; dollar_lever: string | null; completed_at: string }>));
      setDoneThisWeekCount(((doneThisWeek.data ?? []) as Array<{ id: string }>).length);

      // Workflow tasks — join phase + workflow names client-side for readability
      const wfMap = new Map<string, string>(((workflows.data ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name]));
      const phaseMap = new Map<string, { name: string; workflow_id: string }>(
        ((phasesRaw.data ?? []) as Array<{ id: string; name: string; workflow_id: string }>).map((p) => [p.id, { name: p.name, workflow_id: p.workflow_id }]),
      );
      const tasks: WorkflowTask[] = ((wfTasksRaw.data ?? []) as Array<{
        id: string; title: string; status: string; time_estimate: string | null;
        dollar_lever: string | null; workflow_id: string; phase_id: string; sort_order: number;
      }>).map((t) => {
        const phase = phaseMap.get(t.phase_id);
        return {
          ...t,
          workflow_name: wfMap.get(t.workflow_id) ?? "Workflow",
          phase_name: phase?.name ?? "Phase",
        };
      });
      setWorkflowTasks(tasks);

      const aRows = (agentToday.data ?? []) as Array<{ status: string }>;
      setApprovedToday(aRows.filter((r) => r.status === "approved" || r.status === "edited").length);
      setSentToday(aRows.filter((r) => r.status === "sent").length);

      // Build a "tasks completed per day" map from the last 30 days
      const tasksByDay: Map<string, number> = new Map();
      for (const r of (streakRows.data ?? []) as Array<{ completed_at: string }>) {
        if (!r.completed_at) continue;
        const k = r.completed_at.slice(0, 10);
        tasksByDay.set(k, (tasksByDay.get(k) ?? 0) + 1);
      }
      const streakDates = new Set(tasksByDay.keys());

      // Streak: count consecutive days back from today where >= 1 task was completed
      let streakCount = 0;
      const cursor = new Date();
      cursor.setHours(0, 0, 0, 0);
      while (streakDates.has(cursor.toISOString().slice(0, 10))) {
        streakCount += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
      // If today has no completions yet, still count yesterday's streak.
      if (streakCount === 0) {
        cursor.setDate(cursor.getDate() - 1);
        while (streakDates.has(cursor.toISOString().slice(0, 10))) {
          streakCount += 1;
          cursor.setDate(cursor.getDate() - 1);
        }
      }
      setStreak(streakCount);

      // Habit grid — last 30 days, true if any task done
      const habit: boolean[] = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        habit.push(streakDates.has(d.toISOString().slice(0, 10)));
      }
      setHabitGrid(habit);

      // Task bars — last 7 days, count of tasks completed per day
      const bars: number[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        bars.push(tasksByDay.get(d.toISOString().slice(0, 10)) ?? 0);
      }
      setTaskBars(bars);

      // Revenue sparkline — last 14 days, cents per day
      const revByDay: Map<string, number> = new Map();
      for (const r of (revDaily.data ?? []) as Array<{ amount_cents: number; entry_date: string }>) {
        const k = r.entry_date;
        revByDay.set(k, (revByDay.get(k) ?? 0) + r.amount_cents);
      }
      const rev: number[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        rev.push(revByDay.get(d.toISOString().slice(0, 10)) ?? 0);
      }
      setRevenueSeries(rev);

      // Per-agent box scores: drafted = total outputs (any status); sent = approved/edited/sent
      const stats: Record<string, { drafted: number; sent: number }> = {};
      for (const r of (allAgentOutputs.data ?? []) as Array<{ agent_id: string; status: string }>) {
        if (!stats[r.agent_id]) stats[r.agent_id] = { drafted: 0, sent: 0 };
        stats[r.agent_id].drafted += 1;
        if (r.status === "approved" || r.status === "edited" || r.status === "sent") {
          stats[r.agent_id].sent += 1;
        }
      }
      setAgentStats(stats);
    })();
  }, [user, now.toISOString().slice(0, 10), reloadTick]);

  // Greeting + name + date
  const greeting = (() => {
    const h = now.getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();
  const firstName = (() => {
    const meta = (user?.user_metadata ?? {}) as { full_name?: string; first_name?: string; name?: string };
    if (meta.first_name) return meta.first_name;
    if (meta.full_name) return meta.full_name.split(" ")[0];
    if (meta.name) return meta.name.split(" ")[0];
    // Email handle fallback — ONLY if it looks like a real name (short,
    // alphabetic, no obvious handle markers). Otherwise drop the name.
    if (user?.email) {
      const handle = user.email.split("@")[0].split(".")[0].split("+")[0];
      const looksLikeName = /^[a-z]{2,12}$/i.test(handle) && !/(^hello$|^info$|^team$|socially|ideafetti|noreply)/i.test(handle);
      if (looksLikeName) return handle.replace(/^./, (c) => c.toUpperCase());
    }
    return "";
  })();
  const longDate = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const clock = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  // Derived
  const upcoming = useMemo(() => {
    const future = events
      .filter((e) => e.start_at && new Date(e.start_at).getTime() > now.getTime())
      .sort((a, b) => (a.start_at ?? "").localeCompare(b.start_at ?? ""));
    return future[0] ?? null;
  }, [events, now]);
  const minutesToNext = upcoming?.start_at
    ? Math.max(0, Math.round((new Date(upcoming.start_at).getTime() - now.getTime()) / 60_000))
    : null;
  const priorityCount = emails.filter((e) => e.kind === "priority" && e.status === "unread").length;
  const needsResponseCount = emails.filter((e) => e.kind === "needs_response" && e.status === "unread").length;
  const briefByAgent = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of brief) map[o.agent_id] = (map[o.agent_id] ?? 0) + 1;
    return map;
  }, [brief]);

  // Build the right-rail content for the shell
  const railContent = (
    <>
      <div className="small-caps mb-3">
        {now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
      </div>
      <MiniCalendar today={now} events={events} />

      <div className="small-caps mt-8 mb-3">Today's events</div>
      {events.length === 0 ? (
        <p className="text-[0.8125rem]" style={{ color: "var(--con-ink-faint)" }}>
          Nothing scheduled.
        </p>
      ) : (
        <ul className="space-y-2">
          {events.slice(0, 5).map((e) => {
            const t = e.start_at ? new Date(e.start_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—";
            const isNext = upcoming?.id === e.id;
            return (
              <li key={e.id} className="flex items-baseline gap-2">
                <span className="tnum text-[0.75rem] shrink-0" style={{ color: "var(--con-ink-faint)" }}>
                  {t.toLowerCase()}
                </span>
                <span className="text-[0.8125rem]" style={{ color: isNext ? "var(--con-navy)" : "var(--con-ink)" }}>
                  {e.title}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="small-caps mt-8 mb-3">Quick</div>
      <div className="space-y-1.5 text-[0.8125rem]">
        <Link to="/capture" className="block py-1.5 px-2 rounded-md hover:bg-[var(--con-hover)]" style={{ color: "var(--con-ink)" }}>
          + Capture a thought
        </Link>
        <Link to="/hub" className="block py-1.5 px-2 rounded-md hover:bg-[var(--con-hover)]" style={{ color: "var(--con-ink)" }}>
          + Add a lead
        </Link>
      </div>
    </>
  );

  return (
    <StudioShell rail={railContent}>
      <div className="fade-in">
        {/* HEADER */}
        <header className="space-y-5 mb-10">
          <div className="flex items-start justify-between gap-6">
            <div className="small-caps-muted tnum">{longDate.toUpperCase()}</div>
            <div className="flex items-center gap-5">
              {streak > 0 && (
                <span className="small-caps tnum">
                  {streak}-DAY STREAK
                </span>
              )}
              <TimersAlarmsMenu />
              <span className="small-caps-muted tnum">{clock}</span>
              <span className="monogram">DC</span>
            </div>
          </div>
          <div>
            <h1 className="display text-[2.5rem] leading-[1.15] tracking-tight" style={{ color: "var(--con-charcoal)" }}>
              {greeting}{firstName ? `, ${firstName}` : ""}.
            </h1>
            <p className="display text-[1.375rem] mt-2 leading-snug" style={{ color: "var(--con-charcoal-soft)" }}>
              {upcoming
                ? `Your next is ${upcoming.title ?? "an event"} in ${minutesToNext} ${minutesToNext === 1 ? "minute" : "minutes"}.`
                : "Nothing else scheduled today. The afternoon is yours."}
            </p>
          </div>

          {/* TODAY'S SCORE — the gamification stat line. Reads like a magazine
              box score. Tabular numerals throughout. Brass accent on numbers. */}
          <div className="pt-3 flex flex-wrap items-baseline gap-x-8 gap-y-2 text-[0.8125rem]">
            <span className="small-caps-muted">Today</span>
            <Stat n={doneTodayItems.length} label={doneTodayItems.length === 1 ? "task shipped" : "tasks shipped"} />
            <Stat n={approvedToday} label={approvedToday === 1 ? "draft approved" : "drafts approved"} />
            {sentToday > 0 && <Stat n={sentToday} label={sentToday === 1 ? "message sent" : "messages sent"} />}
            <StatMoney cents={revenueCents.today} label="logged" />
          </div>

          {/* HABIT GRID — last 30 days. Filled brass square = shipped at least
              one task. Faint outline = didn't ship. Reads like a private
              quantified-self log. */}
          {habitGrid.length > 0 && (
            <div className="pt-2 flex items-center gap-4">
              <span className="small-caps-muted">Last 30</span>
              <HabitGrid days={habitGrid} />
            </div>
          )}
        </header>

        <div className="h-px mb-8" style={{ backgroundColor: "var(--con-rule)" }} />

        {/* PIPELINE — full-width horizontal hero. Donut + stage legend + money
            kpis + client list all readable side-by-side. */}
        <div className="con-card tint-forest mb-6">
          <div className="flex items-baseline justify-between mb-5">
            <div className="small-caps">Pipeline</div>
            {pipeline && (
              <div className="flex items-center gap-6 text-[0.75rem]" style={{ color: "var(--con-ink-faint)" }}>
                <span><span className="tnum font-semibold" style={{ color: "var(--con-ink)" }}>{pipeline.todayFollowUps + pipeline.overdueFollowUps}</span> follow-ups due</span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-8 items-start mb-5">
            {/* Donut */}
            <div className="shrink-0">
              <PipelineDonut clients={clients} />
            </div>
            {/* Stage legend */}
            <PipelineStageLegend clients={clients} />
            {/* Money KPIs */}
            {pipeline && (
              <div className="flex gap-6 shrink-0 pl-6" style={{ borderLeft: "1px solid var(--con-rule)" }}>
                <div>
                  <div className="big-num-sm" style={{ color: "var(--con-forest)" }}>
                    {formatCents(pipeline.proposalOutValueCents)}
                  </div>
                  <div className="text-[0.6875rem] mt-1" style={{ color: "var(--con-ink-faint)" }}>out</div>
                </div>
                <div>
                  <div className="big-num-sm" style={{ color: "var(--con-forest)" }}>
                    {formatCents(pipeline.activeMrrCents)}
                    <span className="text-[0.875rem] font-normal" style={{ color: "var(--con-ink-faint)" }}>/mo</span>
                  </div>
                  <div className="text-[0.6875rem] mt-1" style={{ color: "var(--con-ink-faint)" }}>active</div>
                </div>
              </div>
            )}
          </div>
          {/* Client list */}
          <div className="pt-4" style={{ borderTop: "1px solid var(--con-rule)" }}>
            <PipelineList clients={clients} onChanged={reload} />
          </div>
        </div>

        {/* TWO-COLUMN MAIN BODY — each section is its own card */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6 mb-8">

          {/* LEFT COLUMN — To Ship + Schedule + Wins */}
          <div className="space-y-6">

            <div className="con-card tint-yellow">
              <div className="flex items-baseline justify-between mb-4">
                <div className="flex items-baseline gap-3">
                  <div className="small-caps">To Ship</div>
                  <span
                    className="text-[0.625rem] uppercase tracking-[0.14em] font-semibold px-2 py-0.5 rounded-full"
                    style={{ color: "var(--con-navy)", backgroundColor: "rgba(8, 61, 119, 0.08)" }}
                    title="Maya is your build agent. Tasks here are her territory."
                  >
                    Maya
                  </span>
                </div>
                <div className="flex items-baseline gap-4">
                  <RunMayaButton onDone={reload} />
                  <div className="big-num-sm" style={{ color: "var(--con-brass-deep)" }}>
                    {workflowTasks.length}
                  </div>
                </div>
              </div>
              <WorkflowsList
                tasks={workflowTasks}
                mayaOutputs={mayaOutputs}
                onChanged={reload}
              />
            </div>

            <div className="con-card tint-rose">
              <div className="flex items-baseline justify-between mb-4">
                <div className="small-caps">Schedule</div>
                {upcoming && minutesToNext !== null && (
                  <div className="text-[0.75rem] tnum" style={{ color: "var(--con-brass-deep)" }}>
                    next in {minutesToNext}m
                  </div>
                )}
              </div>
              {events.length === 0 ? (
                <p className="text-[0.9375rem]" style={{ color: "var(--con-charcoal-faint)" }}>
                  Nothing on the calendar today.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {events.map((e) => {
                    const t = e.start_at ? new Date(e.start_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—";
                    const isNext = upcoming?.id === e.id;
                    return (
                      <li key={e.id} className="flex items-baseline gap-4">
                        <span className="tnum text-[0.8125rem] w-16 shrink-0" style={{ color: "var(--con-charcoal-faint)" }}>
                          {t.toLowerCase()}
                        </span>
                        <span className="text-[0.9375rem] flex-1" style={{ color: isNext ? "var(--con-brass-deep)" : "var(--con-charcoal)", fontWeight: isNext ? 600 : 400 }}>
                          {e.title ?? "Untitled"}
                        </span>
                        {e.video_url && (
                          <a href={e.video_url} target="_blank" rel="noreferrer" className="text-[0.75rem] shrink-0">
                            Join →
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="con-card tint-sage">
              <div className="flex items-baseline justify-between mb-4">
                <div className="small-caps">Wins</div>
                <div className="big-num-sm" style={{ color: "var(--con-forest)" }}>
                  {doneTodayItems.length}
                </div>
              </div>
              <p className="display-tight text-[1.0625rem] mb-4 leading-snug" style={{ color: doneTodayItems.length + approvedToday === 0 && revenueCents.today === 0 && doneThisWeekCount === 0 ? "var(--con-charcoal-faint)" : "var(--con-charcoal)" }}>
                {winsHeadline(doneTodayItems.length, approvedToday, revenueCents.today, doneThisWeekCount)}
              </p>
              {taskBars.length > 0 && (
                <div className="mb-4">
                  <TaskBars values={taskBars} />
                </div>
              )}
              <WinsList items={doneTodayItems} weekCount={doneThisWeekCount} weekRevenueCents={revenueCents.week} />
            </div>
          </div>

          {/* RIGHT COLUMN — Brief + Inbox + Pipeline */}
          <div className="space-y-6">

            <div className="con-card tint-cream" id="brief">
              <div className="flex items-baseline justify-between mb-4">
                <div className="small-caps">Brief</div>
                <BriefRunActions onDone={reload} />
              </div>
              <BriefTabs brief={brief} onChanged={reload} />
            </div>

            <div className="con-card tint-orange">
              <div className="flex items-baseline justify-between mb-4">
                <div className="small-caps">Inbox</div>
                <div className="big-num-sm" style={{ color: "var(--con-orange)" }}>
                  {priorityCount + needsResponseCount}
                </div>
              </div>
              <p className="text-[0.75rem] tnum mb-3" style={{ color: "var(--con-charcoal-faint)" }}>
                {priorityCount} priority · {needsResponseCount} need reply
              </p>
              <InboxList emails={emails} />
            </div>

          </div>
        </div>

        {/* FULL-WIDTH BOTTOM — Money + Staff each in their own card */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">

          <div className="con-card tint-yellow">
            <div className="flex items-baseline justify-between mb-4">
              <div className="small-caps">Money</div>
              {(() => {
                const delta = revenueCents.lastWeek > 0
                  ? Math.round(((revenueCents.week - revenueCents.lastWeek) / revenueCents.lastWeek) * 100)
                  : null;
                if (delta === null) return null;
                return (
                  <div className="text-[0.75rem] tnum" style={{ color: delta > 0 ? "var(--con-brass-deep)" : "var(--con-charcoal-faint)" }}>
                    {delta > 0 ? `↑ ${delta}%` : delta < 0 ? `↓ ${Math.abs(delta)}%` : "flat"} vs last week
                  </div>
                );
              })()}
            </div>
            <div className="flex items-baseline gap-6 mb-4">
              <div>
                <p className="display-tight text-[1.75rem] tnum" style={{ color: "var(--con-charcoal)" }}>
                  {formatCents(revenueCents.today)}
                </p>
                <p className="text-[0.75rem] mt-0.5" style={{ color: "var(--con-charcoal-faint)" }}>today</p>
              </div>
              <div>
                <p className="display-tight text-[1.25rem] tnum" style={{ color: "var(--con-charcoal-soft)" }}>
                  {formatCents(revenueCents.week)}
                </p>
                <p className="text-[0.75rem] mt-0.5" style={{ color: "var(--con-charcoal-faint)" }}>this week</p>
              </div>
              <div>
                <p className="display-tight text-[1.25rem] tnum" style={{ color: "var(--con-charcoal-soft)" }}>
                  {formatCents(revenueCents.month)}
                </p>
                <p className="text-[0.75rem] mt-0.5" style={{ color: "var(--con-charcoal-faint)" }}>MTD</p>
              </div>
            </div>
            {revenueSeries.length > 0 && (
              <div className="mb-4">
                <Sparkline values={revenueSeries} />
                <div className="flex justify-between mt-1 text-[0.625rem]" style={{ color: "var(--con-charcoal-faint)" }}>
                  <span>14 days ago</span>
                  <span>today</span>
                </div>
              </div>
            )}
            <MoneyLog user={user} onLogged={reload} />
          </div>

          <div className="con-card tint-sage">
            <div className="flex items-baseline justify-between mb-4">
              <div className="small-caps">Staff</div>
              <div className="text-[0.75rem]" style={{ color: "var(--con-charcoal-faint)" }}>
                last 7 days
              </div>
            </div>
            <StaffActions onChanged={reload} stats={agentStats} />
          </div>
        </div>

      </div>
    </StudioShell>
  );
}

/* =====================================================================
   MINI CALENDAR — month grid for the right rail
   ===================================================================== */
function MiniCalendar({ today, events }: { today: Date; events: CalendarEvent[] }) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const eventDays = new Set(
    events.map((e) => (e.start_at ? new Date(e.start_at).getDate() : null)).filter((d): d is number => d !== null),
  );
  const cells: Array<number | null> = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const todayDate = today.getDate();
  return (
    <div className="grid grid-cols-7 gap-1 text-[0.6875rem] tnum">
      {["S","M","T","W","T","F","S"].map((l, i) => (
        <div key={i} className="text-center pb-1 font-medium" style={{ color: "var(--con-charcoal-faint)" }}>
          {l}
        </div>
      ))}
      {cells.map((d, i) => {
        if (d === null) return <div key={i} />;
        const isToday = d === todayDate;
        const hasEvent = eventDays.has(d);
        return (
          <div
            key={i}
            className="aspect-square flex items-center justify-center rounded-full relative"
            style={{
              backgroundColor: isToday ? "var(--con-navy)" : "transparent",
              color: isToday ? "var(--con-cream)" : "var(--con-charcoal)",
              fontWeight: isToday ? 600 : 400,
            }}
          >
            {d}
            {hasEvent && !isToday && (
              <span
                className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full"
                style={{ backgroundColor: "var(--con-brass-deep)" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* =====================================================================
   Section — the collapse-to-headline, expand-to-content shell.
   ===================================================================== */
function Section({
  k,
  title,
  headline,
  headlineDim,
  subhead,
  open,
  onToggle,
  rightActions,
  children,
}: {
  k: SectionKey;
  title: string;
  headline: string;
  headlineDim?: boolean;
  subhead?: string | null;
  open: boolean;
  onToggle: (k: SectionKey) => void;
  rightActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={() => onToggle(k)}
        className="w-full text-left flex items-baseline gap-6 group"
        aria-expanded={open}
      >
        <span className="small-caps shrink-0" style={{ width: "5.5rem" }}>{title}</span>
        <span className="flex-1 min-w-0">
          <span
            className="display-tight text-[1.375rem] leading-snug block"
            style={{ color: headlineDim ? "var(--con-charcoal-faint)" : "var(--con-charcoal)" }}
          >
            {headline}
          </span>
          {subhead && (
            <span className="text-[0.875rem] block mt-1" style={{ color: "var(--con-charcoal-soft)" }}>
              {subhead}
            </span>
          )}
        </span>
        <span className="shrink-0 mt-1 transition-transform" style={{ color: "var(--con-charcoal-faint)", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>
          <ChevronRight className="h-4 w-4" />
        </span>
      </button>
      {open && (
        <div className="mt-6 ml-[5.5rem] pr-2 fade-in">
          {rightActions && <div className="mb-4 flex justify-end">{rightActions}</div>}
          {children}
        </div>
      )}
    </section>
  );
}

/* =====================================================================
   THE ONE — inline editor for today's top priority
   ===================================================================== */
function OneEditor({ user, initial, onSaved }: { user: { id: string } | null; initial: string; onSaved: () => void }) {
  const [val, setVal] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setVal(initial); }, [initial]);
  const save = async () => {
    if (!user) return;
    setSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("exec_os_daily")
      .upsert({ user_id: user.id, entry_date: today, top_priority: val.trim() || null }, { onConflict: "user_id,entry_date" });
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("Top priority saved."); onSaved(); }
  };
  return (
    <div className="space-y-3 max-w-[40rem]">
      <textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        rows={2}
        placeholder="What's the ONE thing that matters today?"
        className="w-full text-[1.125rem] leading-relaxed bg-transparent border-0 border-b focus:outline-none resize-none display-tight"
        style={{ borderColor: "var(--con-rule)", color: "var(--con-charcoal)", fontFamily: "Fraunces, serif" }}
      />
      <div className="flex justify-end gap-3">
        <button onClick={save} disabled={saving} className="text-[0.8125rem]" style={{ color: "var(--con-brass-deep)" }}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/* =====================================================================
   BRIEF — one row per agent output, with action buttons inline
   ===================================================================== */
function BriefRunActions({ onDone }: { onDone: () => void }) {
  // Maya is NOT in Brief — she owns the To Ship card. Trigger her from there.
  const [busy, setBusy] = useState<"sage" | "ren" | null>(null);
  const run = async (k: "sage" | "ren") => {
    setBusy(k);
    try {
      const r = k === "sage" ? await runSageNow() : await runRenNow();
      if (r.ok) {
        toast.success(r.summary ?? `${k} done.`);
        onDone();
      } else {
        toast.error(r.error ?? `${k} failed`);
      }
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex items-center gap-4 text-[0.8125rem]">
      <button onClick={() => run("sage")} disabled={busy !== null} className="inline-flex items-center gap-1.5" style={{ color: "var(--con-brass-deep)" }}>
        {busy === "sage" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Target className="h-3 w-3" />}
        Run Sage
      </button>
      <button onClick={() => run("ren")} disabled={busy !== null} className="inline-flex items-center gap-1.5" style={{ color: "var(--con-brass-deep)" }}>
        {busy === "ren" ? <Loader2 className="h-3 w-3 animate-spin" /> : <PenLine className="h-3 w-3" />}
        Run Ren
      </button>
    </div>
  );
}

/**
 * Standalone Run Maya button for the To Ship card header. Same code path
 * as Run Maya in the Brief card — picks the highest-leverage task and
 * drafts the build focus + approach notes into the Brief.
 */
function RunMayaButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const click = async () => {
    setBusy(true);
    try {
      const r = await runMayaNow();
      if (r.ok) {
        toast.success(r.summary ?? "Maya picked the next ship.");
        onDone();
      } else {
        toast.error(r.error ?? "Maya failed");
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={click}
      disabled={busy}
      className="text-[0.75rem] inline-flex items-center gap-1.5"
      style={{ color: "var(--con-navy)" }}
      title="Have Maya pick today's task and draft the approach"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
      Ask Maya
    </button>
  );
}

/**
 * Brief tabs — one tab per agent. Click a tab to see only that agent's
 * drafts. Default tab is whichever agent has the most pending items.
 * Keeps the card tight; each agent gets focused review space.
 */
function BriefTabs({ brief, onChanged }: { brief: AgentOutput[]; onChanged: () => void }) {
  // Group by agent_id
  const byAgent = useMemo(() => {
    const map: Record<string, AgentOutput[]> = {};
    for (const o of brief) {
      if (!map[o.agent_id]) map[o.agent_id] = [];
      map[o.agent_id].push(o);
    }
    return map;
  }, [brief]);

  const agents = Object.keys(byAgent).sort((a, b) => byAgent[b].length - byAgent[a].length);
  const [active, setActive] = useState<string | null>(null);
  const activeAgent = active && byAgent[active] ? active : agents[0] ?? null;

  if (brief.length === 0 || !activeAgent) {
    return (
      <p className="text-[0.9375rem]" style={{ color: "var(--con-charcoal-faint)" }}>
        Quiet morning. Run Sage or Ren above to start.
      </p>
    );
  }

  return (
    <div>
      {/* Tab row — only shown when there's more than one agent with output */}
      {agents.length > 1 && (
        <div
          className="flex items-center gap-5 mb-5 pb-3 border-b"
          style={{ borderColor: "var(--con-rule)" }}
        >
          {agents.map((id) => {
            const meta = AGENT_META[id as keyof typeof AGENT_META];
            const count = byAgent[id].length;
            const isActive = id === activeAgent;
            return (
              <button
                key={id}
                onClick={() => setActive(id)}
                className="text-[0.6875rem] uppercase tracking-[0.22em] font-medium pb-1 transition-colors"
                style={{
                  color: isActive ? "var(--con-charcoal)" : "var(--con-charcoal-faint)",
                  borderBottom: isActive ? "2px solid var(--con-brass-deep)" : "2px solid transparent",
                  marginBottom: "-13px",
                }}
              >
                {meta?.name ?? id}{" "}
                <span className="tnum" style={{ color: isActive ? "var(--con-brass-deep)" : "inherit" }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active agent's drafts */}
      <ul className="space-y-5">
        {byAgent[activeAgent].map((o) => (
          <BriefRow key={o.id} output={o} onChanged={onChanged} />
        ))}
      </ul>
    </div>
  );
}

function BriefRow({ output, onChanged }: { output: AgentOutput; onChanged: () => void }) {
  const meta = AGENT_META[output.agent_id];
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(output.body ?? "");
  const [busy, setBusy] = useState(false);
  const rationale = (output.metadata?.rationale as string | undefined) ?? "";
  const channel = (output.metadata?.channel as string | undefined) ?? "";
  const clientName =
    (output.metadata?.client_name as string | undefined) ??
    output.client?.name ??
    "";
  const gmailUrl = (output.metadata?.gmail_url as string | undefined) ?? null;
  const clientLinkedin = output.client?.linkedin_url ?? null;
  const sendUrl = gmailUrl ?? clientLinkedin ?? null;

  const onCopy = () => {
    if (!output.body) return;
    navigator.clipboard.writeText(output.body).then(() => toast.success("Copied. Paste into your channel."));
  };
  const onApprove = async () => {
    setBusy(true);
    const r = await approveOutput(output.id);
    setBusy(false);
    if (r.ok) { toast.success("Marked sent."); onChanged(); }
    else toast.error(r.error ?? "Could not mark sent.");
  };
  const onReject = async () => {
    setBusy(true);
    const r = await rejectOutput(output.id);
    setBusy(false);
    if (r.ok) { toast.success("Rejected."); onChanged(); }
    else toast.error(r.error ?? "Could not reject.");
  };
  const onArchive = async () => {
    setBusy(true);
    const r = await archiveOutput(output.id);
    setBusy(false);
    if (r.ok) { toast.success("Archived."); onChanged(); }
    else toast.error(r.error ?? "Could not archive.");
  };
  const saveEdit = async () => {
    setBusy(true);
    const r = await approveWithEdits(output.id, editVal, output.body ?? "");
    setBusy(false);
    if (r.ok) { toast.success("Saved your edits."); setEditing(false); onChanged(); }
    else toast.error(r.error ?? "Could not save.");
  };
  const onRegenerate = async () => {
    if (!output.ref_id || output.agent_id !== "cleo") return;
    setBusy(true);
    const r = await reissueDraft(output.id, output.ref_id);
    setBusy(false);
    if (r.ok) { toast.success("Cleo drafted a fresh version."); onChanged(); }
    else toast.error(r.error ?? "Regenerate failed.");
  };

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left flex items-baseline gap-4 group"
      >
        <span className="small-caps-muted shrink-0" style={{ width: "4rem", color: "var(--con-brass-deep)" }}>
          {meta?.name ?? output.agent_id}
        </span>
        <span className="flex-1 min-w-0">
          <span className="text-[1rem] block" style={{ color: "var(--con-charcoal)" }}>
            {output.title}
          </span>
          {clientName && (
            <span className="text-[0.8125rem] block mt-0.5" style={{ color: "var(--con-charcoal-faint)" }}>
              {KIND_LABEL[output.kind] ?? output.kind}{channel ? ` · ${channel}` : ""} · {clientName}
            </span>
          )}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 mt-1.5 transition-transform" style={{ color: "var(--con-charcoal-faint)", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>
      {expanded && (
        <div className="mt-4 ml-[4rem] space-y-4">
          {rationale && (
            <p className="text-[0.875rem] italic" style={{ color: "var(--con-charcoal-soft)" }}>
              Why now: {rationale}
            </p>
          )}
          {editing ? (
            <div className="space-y-3">
              <textarea
                value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                rows={6}
                className="w-full text-[0.9375rem] leading-relaxed bg-transparent border rounded-md p-3"
                style={{ borderColor: "var(--con-rule)", color: "var(--con-charcoal)" }}
              />
              <div className="flex gap-4 text-[0.8125rem]">
                <button onClick={saveEdit} disabled={busy} style={{ color: "var(--con-brass-deep)" }}>Save & approve</button>
                <button onClick={() => { setEditing(false); setEditVal(output.body ?? ""); }} style={{ color: "var(--con-charcoal-faint)" }}>Cancel</button>
              </div>
            </div>
          ) : (
            <pre className="text-[0.9375rem] leading-relaxed whitespace-pre-wrap font-sans" style={{ color: "var(--con-charcoal)", fontFamily: "Inter, sans-serif" }}>
              {output.body || <em style={{ color: "var(--con-charcoal-faint)" }}>No body.</em>}
            </pre>
          )}
          {!editing && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-[0.8125rem]">
              {output.body && (
                <button onClick={onCopy} className="inline-flex items-center gap-1.5" style={{ color: "var(--con-brass-deep)" }}>
                  <Copy className="h-3 w-3" /> Copy
                </button>
              )}
              {sendUrl && (
                <a href={sendUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5">
                  <ExternalLink className="h-3 w-3" /> Open
                </a>
              )}
              <button onClick={onApprove} disabled={busy} className="inline-flex items-center gap-1.5" style={{ color: "var(--con-brass-deep)" }}>
                <Check className="h-3 w-3" /> Mark sent
              </button>
              <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5" style={{ color: "var(--con-charcoal-soft)" }}>
                <Edit3 className="h-3 w-3" /> Edit
              </button>
              {output.agent_id === "cleo" && output.ref_id && (
                <button onClick={onRegenerate} disabled={busy} className="inline-flex items-center gap-1.5" style={{ color: "var(--con-charcoal-soft)" }}>
                  <RefreshCw className="h-3 w-3" /> Regenerate
                </button>
              )}
              <button onClick={onReject} disabled={busy} className="inline-flex items-center gap-1.5" style={{ color: "var(--con-charcoal-faint)" }}>
                <X className="h-3 w-3" /> Reject
              </button>
              <button onClick={onArchive} disabled={busy} className="inline-flex items-center gap-1.5" style={{ color: "var(--con-charcoal-faint)" }}>
                <Archive className="h-3 w-3" /> Archive
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/* =====================================================================
   INBOX — top emails per bucket, click → open in Gmail
   ===================================================================== */
function InboxList({ emails }: { emails: EmailFull[] }) {
  const priority = emails.filter((e) => e.kind === "priority" && e.status === "unread")
    .sort((a, b) => new Date(b.received_at ?? 0).getTime() - new Date(a.received_at ?? 0).getTime())
    .slice(0, 8);
  const needs = emails.filter((e) => e.kind === "needs_response" && e.status === "unread")
    .sort((a, b) => new Date(b.received_at ?? 0).getTime() - new Date(a.received_at ?? 0).getTime())
    .slice(0, 8);

  const RowSet = ({ title, items }: { title: string; items: EmailFull[] }) => {
    if (items.length === 0) return null;
    return (
      <div>
        <div className="small-caps-muted mb-3">{title}</div>
        <ul className="space-y-3">
          {items.map((e) => {
            const url = e.external_id && e.account
              ? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(e.account)}#all/${e.external_id}`
              : null;
            const t = e.received_at ? relTime(e.received_at) : "—";
            return (
              <li key={e.id}>
                <a
                  href={url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-baseline gap-4 group hover:opacity-100"
                  style={{ color: "var(--con-charcoal)" }}
                >
                  <span className="text-[0.875rem] flex-1 min-w-0">
                    <span className="font-medium">{e.sender_name || e.sender_email || "Unknown"}</span>
                    {e.subject && (
                      <>
                        <span style={{ color: "var(--con-charcoal-faint)" }}> · </span>
                        <span style={{ color: "var(--con-charcoal-soft)" }}>{e.subject}</span>
                      </>
                    )}
                  </span>
                  <span className="tnum text-[0.75rem] shrink-0" style={{ color: "var(--con-charcoal-faint)" }}>{t}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <RowSet title="Priority" items={priority} />
      <RowSet title="Need response" items={needs} />
      {priority.length === 0 && needs.length === 0 && (
        <p className="text-[0.95rem]" style={{ color: "var(--con-charcoal-faint)" }}>No unread mail.</p>
      )}
    </div>
  );
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

/* =====================================================================
   PIPELINE — list of active clients with inline Cleo draft action
   ===================================================================== */
function PipelineList({ clients, onChanged }: { clients: Client[]; onChanged: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const onCleo = async (id: string) => {
    setBusyId(id);
    const r = await runCleoForClient(id);
    setBusyId(null);
    if (r.ok) { toast.success(r.summary ?? "Cleo drafted."); onChanged(); }
    else toast.error(r.error ?? "Cleo failed.");
  };
  if (clients.length === 0) {
    return <p className="text-[0.95rem]" style={{ color: "var(--con-charcoal-faint)" }}>No leads or clients yet. Add one from the Hub.</p>;
  }
  return (
    <ul className="space-y-3">
      {clients.map((c) => {
        const meta = STATUS_META[c.status];
        return (
          <li key={c.id} className="flex items-baseline gap-4">
            <span className="text-[0.75rem] shrink-0" style={{ width: "5.5rem", color: meta.color }}>
              {meta.label}
            </span>
            <span className="flex-1 min-w-0 text-[0.9375rem]" style={{ color: "var(--con-charcoal)" }}>
              {c.name}
              {c.company && <span style={{ color: "var(--con-charcoal-soft)" }}> @ {c.company}</span>}
              {c.mrr_cents > 0 && <span className="tnum ml-2" style={{ color: "var(--con-charcoal-soft)" }}>· {formatCents(c.mrr_cents)}/mo</span>}
            </span>
            <button
              onClick={() => onCleo(c.id)}
              disabled={busyId === c.id || c.status === "churned" || c.status === "lost"}
              className="text-[0.75rem] shrink-0 inline-flex items-center gap-1"
              style={{ color: "var(--con-brass-deep)" }}
            >
              {busyId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Cleo
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* =====================================================================
   MONEY — inline log revenue form
   ===================================================================== */
function MoneyLog({ user, onLogged }: { user: { id: string } | null; onLogged: () => void }) {
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("stripe");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!user) return;
    const cents = Math.round((parseFloat(amount) || 0) * 100);
    if (cents <= 0) { toast.error("Enter a positive amount."); return; }
    setSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from("exec_os_revenue").insert({
      user_id: user.id, amount_cents: cents, currency: "usd", source, entry_date: today,
      notes: `Logged manually`,
    });
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success(`Logged ${formatCents(cents)}.`); setAmount(""); onLogged(); }
  };
  return (
    <div className="space-y-4 max-w-[28rem]">
      <p className="text-[0.875rem]" style={{ color: "var(--con-charcoal-soft)" }}>
        Quick log — Stripe + LemonSqueezy webhooks will auto-fill once wired.
      </p>
      <div className="flex items-baseline gap-3">
        <span className="display-tight text-[1.5rem]" style={{ color: "var(--con-charcoal-faint)" }}>$</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          placeholder="0"
          className="flex-1 display-tight text-[1.5rem] bg-transparent border-0 border-b focus:outline-none tnum"
          style={{ borderColor: "var(--con-rule)", color: "var(--con-charcoal)" }}
        />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="text-[0.875rem] bg-transparent border-0 border-b focus:outline-none"
          style={{ borderColor: "var(--con-rule)", color: "var(--con-charcoal-soft)" }}
        >
          <option value="stripe">Stripe</option>
          <option value="lemonsqueezy">LemonSqueezy</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="text-[0.8125rem] inline-flex items-center gap-1.5" style={{ color: "var(--con-brass-deep)" }}>
          <Plus className="h-3 w-3" />
          {saving ? "Logging…" : "Log revenue"}
        </button>
      </div>
    </div>
  );
}

/* =====================================================================
   STAFF — agent box scores (drafted/sent/hit-rate) + run-now buttons
   ===================================================================== */
function StaffActions({
  onChanged,
  stats,
}: {
  onChanged: () => void;
  stats: Record<string, { drafted: number; sent: number }>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const runner = useCallback(async (k: "sage" | "ren") => {
    setBusy(k);
    try {
      const r = k === "sage" ? await runSageNow() : await runRenNow();
      if (r.ok) { toast.success(r.summary ?? "Done."); onChanged(); }
      else toast.error(r.error ?? "Failed.");
    } finally {
      setBusy(null);
    }
  }, [onChanged]);
  const agents = [
    { id: "cleo", desc: "Drafts outreach into the Brief at 5am daily.", run: null as null | (() => void) },
    { id: "sage", desc: "Names the One Thing for tomorrow at 5:30am.", run: () => runner("sage") },
    { id: "ren", desc: "Drafts three TikTok hooks at 6am.", run: () => runner("ren") },
    { id: "vee", desc: "Quiet today. No analytics source wired yet.", run: null },
    { id: "maya", desc: "Quiet today. Ideafetti build agent (next milestone).", run: null },
    { id: "theo", desc: "Quiet today. Decision agent (next milestone).", run: null },
  ];
  return (
    <div className="space-y-6">
      <p className="text-[0.8125rem]" style={{ color: "var(--con-charcoal-soft)" }}>
        Last 7 days · drafted / sent / hit-rate
      </p>
      <ul className="space-y-4">
        {agents.map((a) => {
          const meta = AGENT_META[a.id as keyof typeof AGENT_META];
          const s = stats[a.id] ?? { drafted: 0, sent: 0 };
          const hit = s.drafted > 0 ? Math.round((s.sent / s.drafted) * 100) : 0;
          const hasActivity = s.drafted > 0;
          return (
            <li key={a.id} className="flex items-baseline gap-4">
              <span className="small-caps-muted shrink-0" style={{ width: "4rem", color: "var(--con-brass-deep)" }}>
                {meta?.name}
              </span>
              <span className="flex-1 min-w-0">
                <span className="text-[0.9375rem] block" style={{ color: "var(--con-charcoal)" }}>
                  {a.desc}
                </span>
                {hasActivity && (
                  <span className="text-[0.75rem] block mt-1 tnum" style={{ color: "var(--con-charcoal-soft)" }}>
                    <span className="font-medium" style={{ color: "var(--con-brass-deep)" }}>{s.drafted}</span> drafted
                    <span style={{ color: "var(--con-charcoal-faint)" }}>  ·  </span>
                    <span className="font-medium" style={{ color: "var(--con-brass-deep)" }}>{s.sent}</span> sent
                    <span style={{ color: "var(--con-charcoal-faint)" }}>  ·  </span>
                    <span className="font-medium" style={{ color: hit >= 50 ? "var(--con-brass-deep)" : "var(--con-charcoal-soft)" }}>{hit}%</span> hit
                  </span>
                )}
              </span>
              {a.run && (
                <button
                  onClick={a.run}
                  disabled={busy !== null}
                  className="text-[0.75rem] inline-flex items-center gap-1 shrink-0"
                  style={{ color: "var(--con-brass-deep)" }}
                >
                  {busy === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Run now
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* =====================================================================
   GAMIFICATION PRIMITIVES — score chips + wins list + headline helpers
   ===================================================================== */

function Stat({ n, label }: { n: number; label: string }) {
  if (n <= 0) {
    return (
      <span style={{ color: "var(--con-charcoal-faint)" }}>
        <span className="tnum">0</span> {label}
      </span>
    );
  }
  return (
    <span style={{ color: "var(--con-charcoal)" }}>
      <span className="tnum font-medium" style={{ color: "var(--con-brass-deep)" }}>{n}</span> {label}
    </span>
  );
}

function StatMoney({ cents, label }: { cents: number; label: string }) {
  const isZero = cents <= 0;
  return (
    <span style={{ color: isZero ? "var(--con-charcoal-faint)" : "var(--con-charcoal)" }}>
      <span
        className="tnum font-medium"
        style={{ color: isZero ? "var(--con-charcoal-faint)" : "var(--con-brass-deep)" }}
      >
        {formatCents(cents)}
      </span>{" "}
      {label}
    </span>
  );
}

/**
 * The "Wins" section headline. AUDHD-tuned: blunt but warm.
 * Now broader — if today is empty, falls back to this week's stats so
 * Donna never sees just "Nothing logged" when she shipped 10 yesterday.
 */
function winsHeadline(tasks: number, drafts: number, revenueCents: number, weekTasks: number): string {
  // Today has activity → today-focused headline
  if (revenueCents > 0 && tasks >= 5) return `${tasks} shipped, ${formatCents(revenueCents)} closed. Real day.`;
  if (revenueCents > 0) return `${formatCents(revenueCents)} closed today. Bank that win.`;
  if (tasks >= 5) return `${tasks} shipped. Momentum day.`;
  if (tasks >= 3 && drafts >= 2) return `${tasks} shipped, ${drafts} drafts cleared. Good rhythm.`;
  if (tasks >= 3) return `${tasks} tasks down. You're moving.`;
  if (tasks > 0 && drafts > 0) return `${tasks} shipped, ${drafts} drafts cleared.`;
  if (tasks > 0) return `${tasks} ${tasks === 1 ? "task" : "tasks"} shipped today. That counts.`;
  if (drafts > 0) return `${drafts} ${drafts === 1 ? "draft" : "drafts"} cleared from the Brief.`;
  // Today empty → fall back to this week's pace so it doesn't feel demoralizing
  if (weekTasks >= 10) return `${weekTasks} shipped this week. Keep going.`;
  if (weekTasks >= 5) return `${weekTasks} shipped this week. Add one today.`;
  if (weekTasks > 0) return `${weekTasks} ${weekTasks === 1 ? "task" : "tasks"} shipped this week.`;
  return "Slow start. Pick one small thing.";
}

function winsSubcopy(tasks: number, drafts: number, revenueCents: number, streak: number, weekTasks: number, weekRev: number): string | null {
  const bits: string[] = [];
  if (streak >= 3) bits.push(`${streak}-day streak`);
  if (weekTasks > 0 && tasks < weekTasks) bits.push(`${weekTasks} this week`);
  if (weekRev > 0 && revenueCents < weekRev) bits.push(`${formatCents(weekRev)} closed this week`);
  if (bits.length === 0) return null;
  return bits.join("  ·  ") + ".";
}

function WinsList({ items, weekCount, weekRevenueCents }: { items: Array<{ id: string; title: string; dollar_lever: string | null; completed_at: string }>; weekCount: number; weekRevenueCents: number }) {
  if (items.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-[0.95rem]" style={{ color: "var(--con-charcoal-faint)" }}>
          Nothing shipped yet today. Open To Ship above and mark one done.
        </p>
        {(weekCount > 0 || weekRevenueCents > 0) && (
          <p className="text-[0.875rem]" style={{ color: "var(--con-charcoal-soft)" }}>
            This week so far: <span className="tnum font-medium" style={{ color: "var(--con-brass-deep)" }}>{weekCount}</span>{" "}
            {weekCount === 1 ? "task" : "tasks"}
            {weekRevenueCents > 0 && (
              <>
                {" · "}
                <span className="tnum font-medium" style={{ color: "var(--con-brass-deep)" }}>{formatCents(weekRevenueCents)}</span> closed
              </>
            )}
            .
          </p>
        )}
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((t) => {
        const time = new Date(t.completed_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        return (
          <li key={t.id} className="flex items-baseline gap-4">
            <span className="tnum text-[0.75rem] shrink-0" style={{ width: "4rem", color: "var(--con-charcoal-faint)" }}>
              {time.toLowerCase()}
            </span>
            <span className="flex-1 text-[0.9375rem]" style={{ color: "var(--con-charcoal)" }}>
              {t.title}
              {t.dollar_lever && (
                <span className="text-[0.8125rem] block mt-0.5" style={{ color: "var(--con-charcoal-soft)" }}>
                  {t.dollar_lever}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* =====================================================================
   WORKFLOWS — the build queue. Pending tasks across active workflows.
   Click a checkbox → marks done, updates Done Today + Wins immediately.
   ===================================================================== */
function WorkflowsList({
  tasks,
  mayaOutputs,
  onChanged,
}: {
  tasks: WorkflowTask[];
  mayaOutputs: AgentOutput[];
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const VISIBLE_CAP = 8;

  // Maya's pick (kind=insight) → the task to ship today.
  // Maya's approach notes (kind=pr_proposal) → keyed by task id.
  const pickOutput = mayaOutputs.find((o) => o.kind === "insight") ?? null;
  const pickTaskId = pickOutput?.ref_id ?? null;
  const approachByTaskId = useMemo(() => {
    const m = new Map<string, AgentOutput>();
    for (const o of mayaOutputs) {
      if (o.kind === "pr_proposal" && o.ref_id) m.set(o.ref_id, o);
    }
    return m;
  }, [mayaOutputs]);

  if (tasks.length === 0) {
    return (
      <p className="text-[0.95rem]" style={{ color: "var(--con-charcoal-faint)" }}>
        No open tasks. Add one from the Hub or via Capture.
      </p>
    );
  }

  const markDone = async (id: string) => {
    setBusyId(id);
    const { error } = await supabase
      .from("exec_os_workflow_tasks")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", id);
    setBusyId(null);
    if (error) toast.error(error.message);
    else { toast.success("Shipped."); onChanged(); }
  };

  const dismissOutput = async (id: string) => {
    await supabase
      .from("exec_os_agent_outputs")
      .update({ status: "archived", acted_at: new Date().toISOString(), acted_by: "donna" })
      .eq("id", id);
    onChanged();
  };

  // Sort Maya's pick to the top so the eye lands on today's ship first.
  const sortedTasks = useMemo(() => {
    if (!pickTaskId) return tasks;
    const pick = tasks.find((t) => t.id === pickTaskId);
    if (!pick) return tasks;
    return [pick, ...tasks.filter((t) => t.id !== pickTaskId)];
  }, [tasks, pickTaskId]);

  const visible = showAll ? sortedTasks : sortedTasks.slice(0, VISIBLE_CAP);
  const hidden = sortedTasks.length - visible.length;

  return (
    <div>
      <ul className="space-y-2">
        {visible.map((t, i) => {
          const prev = i > 0 ? visible[i - 1] : null;
          const showPhaseDivider = !prev || prev.workflow_id !== t.workflow_id || prev.phase_id !== t.phase_id;
          const isPick = t.id === pickTaskId;
          const approach = approachByTaskId.get(t.id) ?? null;
          const isExpanded = expandedId === t.id;
          return (
            <Fragment key={t.id}>
              {showPhaseDivider && (
                <li className="pt-3 first:pt-0">
                  <div className="small-caps-muted text-[0.625rem]">
                    {t.workflow_name} · {t.phase_name}
                  </div>
                </li>
              )}
              {isPick && pickOutput && (
                <li
                  className="text-[0.625rem] uppercase tracking-[0.18em] font-semibold inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full"
                  style={{ color: "var(--con-navy)", backgroundColor: "rgba(8, 61, 119, 0.08)" }}
                >
                  Today's ship · Maya
                </li>
              )}
              <li
                className="flex items-baseline gap-3"
                style={isPick ? { borderLeft: "2px solid var(--con-navy)", paddingLeft: "0.5rem", marginLeft: "-0.625rem" } : undefined}
              >
                <button
                  onClick={() => markDone(t.id)}
                  disabled={busyId === t.id}
                  className="shrink-0 mt-0.5 inline-flex items-center justify-center h-4 w-4 rounded-sm border transition-colors hover:bg-[var(--con-sand-warm)]"
                  style={{ borderColor: "var(--con-rule)" }}
                  aria-label="Mark done"
                  title="Mark done"
                >
                  {busyId === t.id && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                </button>
                <span
                  className="flex-1 min-w-0 text-[0.9375rem]"
                  style={{ color: "var(--con-charcoal)", fontWeight: isPick ? 600 : 400 }}
                >
                  {t.title}
                </span>
                {approach && (
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : t.id)}
                    className="text-[0.6875rem] inline-flex items-center gap-1 shrink-0"
                    style={{ color: "var(--con-navy)" }}
                    title="Maya's approach"
                  >
                    {isExpanded ? "Hide" : "Approach"}
                  </button>
                )}
                {t.time_estimate && (
                  <span className="text-[0.6875rem] tnum shrink-0" style={{ color: "var(--con-charcoal-faint)" }}>
                    {t.time_estimate}
                  </span>
                )}
              </li>
              {isPick && pickOutput?.body && (
                <li
                  className="text-[0.8125rem] leading-relaxed pl-7"
                  style={{ color: "var(--con-charcoal-soft)", paddingRight: "0.25rem" }}
                >
                  {pickOutput.body}
                  <button
                    onClick={() => dismissOutput(pickOutput.id)}
                    className="ml-2 text-[0.6875rem]"
                    style={{ color: "var(--con-charcoal-faint)" }}
                    title="Dismiss Maya's pick"
                  >
                    dismiss
                  </button>
                </li>
              )}
              {approach && isExpanded && (
                <li
                  className="text-[0.8125rem] leading-relaxed pl-7 mt-1"
                  style={{ color: "var(--con-charcoal-soft)" }}
                >
                  {approach.body}
                  <button
                    onClick={() => dismissOutput(approach.id)}
                    className="ml-2 text-[0.6875rem]"
                    style={{ color: "var(--con-charcoal-faint)" }}
                    title="Dismiss approach"
                  >
                    dismiss
                  </button>
                </li>
              )}
            </Fragment>
          );
        })}
      </ul>
      {hidden > 0 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="text-[0.8125rem] mt-4"
          style={{ color: "var(--con-brass-deep)" }}
        >
          Show all {tasks.length} →
        </button>
      )}
      {showAll && tasks.length > VISIBLE_CAP && (
        <button
          onClick={() => setShowAll(false)}
          className="text-[0.8125rem] mt-4"
          style={{ color: "var(--con-charcoal-faint)" }}
        >
          Show less
        </button>
      )}
    </div>
  );
}

/* =====================================================================
   VISUALIZATIONS — pure SVG, Concierge palette, no chart libraries.
   ===================================================================== */

/**
 * Habit grid — 30 squares in a row. Filled brass square = at least one
 * task completed that day. Faint outline = nothing logged. Reads like a
 * quantified-self log in a private journal.
 */
function HabitGrid({ days }: { days: boolean[] }) {
  const size = 9;
  const gap = 3;
  const w = days.length * (size + gap) - gap;
  return (
    <svg width={w} height={size} aria-label={`Last ${days.length} days activity`}>
      {days.map((shipped, i) => (
        <rect
          key={i}
          x={i * (size + gap)}
          y={0}
          width={size}
          height={size}
          rx={1.5}
          fill={shipped ? "var(--con-brass-deep)" : "transparent"}
          stroke={shipped ? "var(--con-brass-deep)" : "var(--con-rule)"}
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}

/**
 * Revenue sparkline — a soft area chart for 14 days of daily revenue.
 * Brass line, faint fill underneath. Width is responsive; height fixed.
 */
function Sparkline({ values }: { values: number[] }) {
  const W = 320;
  const H = 48;
  const padding = 2;
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const stepX = (W - padding * 2) / Math.max(1, values.length - 1);
  const points = values.map((v, i) => {
    const x = padding + i * stepX;
    const y = H - padding - (v / max) * (H - padding * 2);
    return [x, y] as const;
  });
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L ${points[points.length - 1][0].toFixed(2)} ${H - padding} L ${points[0][0].toFixed(2)} ${H - padding} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} aria-label="14-day revenue trend">
      <path d={area} fill="var(--con-brass-deep)" opacity={0.08} />
      <path d={line} stroke="var(--con-brass-deep)" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {points.map(([x, y], i) => {
        const isToday = i === points.length - 1;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={isToday ? 2.5 : 1.25}
            fill={isToday ? "var(--con-brass-deep)" : "var(--con-brass)"}
          />
        );
      })}
    </svg>
  );
}

/**
 * Task-per-day bars — 7 thin bars showing how many tasks completed each
 * day. Today's bar is brass, prior days are faint. Quick rhythm read.
 */
function TaskBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const labels = (() => {
    const out: string[] = [];
    for (let i = values.length - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push(d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 1));
    }
    return out;
  })();
  return (
    <div>
      <div className="flex items-end gap-2 h-12">
        {values.map((v, i) => {
          const isToday = i === values.length - 1;
          const h = Math.max(2, Math.round((v / max) * 48));
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1">
              <div
                className="w-full rounded-sm"
                style={{
                  height: `${h}px`,
                  backgroundColor: isToday ? "var(--con-brass-deep)" : "var(--con-brass)",
                  opacity: isToday ? 1 : 0.35,
                }}
                title={`${v} tasks`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        {labels.map((l, i) => (
          <div
            key={i}
            className="flex-1 text-center text-[0.625rem]"
            style={{ color: i === values.length - 1 ? "var(--con-brass-deep)" : "var(--con-charcoal-faint)" }}
          >
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Pipeline donut — distribution of clients across pipeline stages.
 * Each stage is a colored arc, sized by client count.
 * Pure SVG, no chart library. Sized for hero placement in the Pipeline card.
 */
function PipelineDonut({ clients }: { clients: Client[] }) {
  const stageColors: Record<string, string> = {
    lead: "var(--con-sage)",
    contacted: "var(--con-rose)",
    qualified: "var(--con-orange)",
    proposal_sent: "var(--con-yellow)",
    active: "var(--con-forest)",
    paused: "#A8A8A8",
    churned: "#C4C4C4",
    lost: "#D4D4D4",
  };
  const stageOrder = ["lead", "contacted", "qualified", "proposal_sent", "active", "paused", "churned", "lost"];

  // Count clients per stage
  const counts: Record<string, number> = {};
  for (const c of clients) counts[c.status] = (counts[c.status] ?? 0) + 1;
  const total = clients.length;

  const size = 96;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  // Empty pipeline → render dashed outline
  if (total === 0) {
    return (
      <svg width={size} height={size} aria-label="Pipeline distribution">
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="var(--con-rule)"
          strokeWidth={stroke}
          strokeDasharray="3 4"
        />
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          style={{ fontSize: "0.75rem", fill: "var(--con-ink-faint)" }}
        >
          empty
        </text>
      </svg>
    );
  }

  // Build arcs
  let cumulative = 0;
  const arcs = stageOrder
    .filter((s) => (counts[s] ?? 0) > 0)
    .map((s) => {
      const count = counts[s];
      const pct = count / total;
      const arc = {
        stage: s,
        color: stageColors[s] ?? "#999",
        offset: cumulative,
        length: pct * circumference,
        count,
      };
      cumulative += pct * circumference;
      return arc;
    });

  return (
    <svg width={size} height={size} aria-label="Pipeline distribution" style={{ transform: "rotate(-90deg)" }}>
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke="var(--con-rule)"
        strokeWidth={stroke}
        opacity={0.3}
      />
      {arcs.map((a, i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={a.color}
          strokeWidth={stroke}
          strokeDasharray={`${a.length} ${circumference}`}
          strokeDashoffset={-a.offset}
          strokeLinecap="butt"
        />
      ))}
      {/* Center number — unrotate via inner group so text reads upright */}
      <g transform={`rotate(90 ${cx} ${cy})`}>
        <text
          x={cx}
          y={cy + 2}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{
            fontSize: "1.25rem",
            fontWeight: 700,
            fill: "var(--con-ink)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {total}
        </text>
      </g>
    </svg>
  );
}

/**
 * Stage legend — counts per stage with a colored dot. Designed to sit
 * next to PipelineDonut so the donut's colors are decoded immediately.
 * Stages with 0 clients are hidden so the legend stays tight.
 */
function PipelineStageLegend({ clients }: { clients: Client[] }) {
  const stages: Array<{ id: string; color: string; label: string }> = [
    { id: "lead", color: "var(--con-sage)", label: "Lead" },
    { id: "contacted", color: "var(--con-rose)", label: "Contacted" },
    { id: "qualified", color: "var(--con-orange)", label: "Qualified" },
    { id: "proposal_sent", color: "var(--con-yellow)", label: "Proposal" },
    { id: "active", color: "var(--con-forest)", label: "Active" },
    { id: "paused", color: "#A8A8A8", label: "Paused" },
  ];
  const counts: Record<string, number> = {};
  for (const c of clients) counts[c.status] = (counts[c.status] ?? 0) + 1;
  const visible = stages.filter((s) => (counts[s.id] ?? 0) > 0);

  if (visible.length === 0) {
    return (
      <div className="flex-1 min-w-0">
        <p className="text-[0.875rem]" style={{ color: "var(--con-ink-faint)" }}>
          No clients yet. Add one to start the pipeline.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex-1 min-w-0 space-y-1.5">
      {visible.map((s) => (
        <li key={s.id} className="flex items-center gap-2.5 text-[0.8125rem]">
          <span
            className="shrink-0 rounded-full"
            style={{ width: 9, height: 9, backgroundColor: s.color }}
          />
          <span className="flex-1" style={{ color: "var(--con-ink)" }}>
            {s.label}
          </span>
          <span className="tnum font-semibold" style={{ color: "var(--con-ink)" }}>
            {counts[s.id]}
          </span>
        </li>
      ))}
    </ul>
  );
}
