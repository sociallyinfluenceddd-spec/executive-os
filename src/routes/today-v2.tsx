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

export const Route = createFileRoute("/today-v2")({
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

    void (async () => {
      const [cal, em, br, pp, cl, dailyRow, revToday, revWeek, revMonth, revLastWeek, doneToday, agentToday, streakRows, allAgentOutputs, wfTasksRaw, workflows, phasesRaw, doneThisWeek] = await Promise.all([
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
      ]);
      setEvents((cal ?? []) as CalendarEvent[]);
      setEmails(((em.data ?? []) as EmailFull[]));
      setBrief(br);
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

      // Streak: count consecutive days back from today where >= 1 task was completed
      const streakDates = new Set<string>();
      for (const r of (streakRows.data ?? []) as Array<{ completed_at: string }>) {
        if (r.completed_at) streakDates.add(r.completed_at.slice(0, 10));
      }
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

  return (
    <div className="concierge">
      <div className="max-w-[1100px] mx-auto px-10 py-12 fade-in">
        {/* HEADER */}
        <header className="space-y-5 mb-12">
          <div className="flex items-start justify-between gap-6">
            <div className="small-caps-muted tnum">{longDate.toUpperCase()}</div>
            <div className="flex items-center gap-6">
              {streak > 0 && (
                <span className="small-caps tnum">
                  {streak}-DAY STREAK
                </span>
              )}
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
        </header>

        <div className="h-px mb-8" style={{ backgroundColor: "var(--con-rule)" }} />

        {/* TWO-COLUMN MAIN BODY — each section is its own card */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6 mb-8">

          {/* LEFT COLUMN — To Ship + Schedule + Wins */}
          <div className="space-y-6">

            <div className="con-card">
              <div className="flex items-baseline justify-between mb-4">
                <div className="small-caps">To Ship</div>
                <div className="text-[0.75rem] tnum" style={{ color: "var(--con-charcoal-faint)" }}>
                  {workflowTasks.length} open
                </div>
              </div>
              <WorkflowsList tasks={workflowTasks} onChanged={reload} />
            </div>

            <div className="con-card">
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

            <div className="con-card">
              <div className="flex items-baseline justify-between mb-4">
                <div className="small-caps">Wins</div>
                <div className="text-[0.75rem] tnum" style={{ color: "var(--con-charcoal-faint)" }}>
                  {doneTodayItems.length} today · {doneThisWeekCount} this week
                </div>
              </div>
              <p className="display-tight text-[1.0625rem] mb-4 leading-snug" style={{ color: doneTodayItems.length + approvedToday === 0 && revenueCents.today === 0 && doneThisWeekCount === 0 ? "var(--con-charcoal-faint)" : "var(--con-charcoal)" }}>
                {winsHeadline(doneTodayItems.length, approvedToday, revenueCents.today, doneThisWeekCount)}
              </p>
              <WinsList items={doneTodayItems} weekCount={doneThisWeekCount} weekRevenueCents={revenueCents.week} />
            </div>
          </div>

          {/* RIGHT COLUMN — Brief + Inbox + Pipeline */}
          <div className="space-y-6">

            <div className="con-card">
              <div className="flex items-baseline justify-between mb-4">
                <div className="small-caps">Brief</div>
                <BriefRunActions onDone={reload} />
              </div>
              {brief.length === 0 ? (
                <p className="text-[0.9375rem]" style={{ color: "var(--con-charcoal-faint)" }}>
                  Quiet morning. Run Sage or Ren above to start.
                </p>
              ) : (
                <ul className="space-y-5">
                  {brief.map((o) => (
                    <BriefRow key={o.id} output={o} onChanged={reload} />
                  ))}
                </ul>
              )}
            </div>

            <div className="con-card">
              <div className="flex items-baseline justify-between mb-4">
                <div className="small-caps">Inbox</div>
                <div className="text-[0.75rem] tnum" style={{ color: "var(--con-charcoal-faint)" }}>
                  {priorityCount} priority · {needsResponseCount} need reply
                </div>
              </div>
              <InboxList emails={emails} />
            </div>

            <div className="con-card">
              <div className="flex items-baseline justify-between mb-4">
                <div className="small-caps">Pipeline</div>
                {pipeline && (
                  <div className="text-[0.75rem] tnum" style={{ color: "var(--con-charcoal-faint)" }}>
                    {pipeline.hotLeadCount} hot · {formatCents(pipeline.proposalOutValueCents)} out
                  </div>
                )}
              </div>
              <PipelineList clients={clients} onChanged={reload} />
            </div>
          </div>
        </div>

        {/* FULL-WIDTH BOTTOM — Money + Staff each in their own card */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">

          <div className="con-card">
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
            <MoneyLog user={user} onLogged={reload} />
          </div>

          <div className="con-card">
            <div className="flex items-baseline justify-between mb-4">
              <div className="small-caps">Staff</div>
              <div className="text-[0.75rem]" style={{ color: "var(--con-charcoal-faint)" }}>
                last 7 days
              </div>
            </div>
            <StaffActions onChanged={reload} stats={agentStats} />
          </div>
        </div>

        <footer className="pt-2 flex flex-wrap gap-x-8 gap-y-2 text-[0.75rem]" style={{ color: "var(--con-charcoal-faint)" }}>
          <Link to="/hub">Hub</Link>
          <Link to="/capture">Capture</Link>
          <Link to="/settings">Settings</Link>
          <Link to="/today" className="ml-auto">Old dashboard</Link>
        </footer>
      </div>
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
function WorkflowsList({ tasks, onChanged }: { tasks: WorkflowTask[]; onChanged: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const VISIBLE_CAP = 8;

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

  // Render a flat list capped at VISIBLE_CAP with a phase divider when the
  // workflow/phase changes between rows. Compact: single-line tasks, no
  // descriptions, just title + tiny meta. Click "Show all" to expand.
  const visible = showAll ? tasks : tasks.slice(0, VISIBLE_CAP);
  const hidden = tasks.length - visible.length;

  return (
    <div>
      <ul className="space-y-2">
        {visible.map((t, i) => {
          const prev = i > 0 ? visible[i - 1] : null;
          const showPhaseDivider = !prev || prev.workflow_id !== t.workflow_id || prev.phase_id !== t.phase_id;
          return (
            <Fragment key={t.id}>
              {showPhaseDivider && (
                <li className="pt-3 first:pt-0">
                  <div className="small-caps-muted text-[0.625rem]">
                    {t.workflow_name} · {t.phase_name}
                  </div>
                </li>
              )}
              <li className="flex items-baseline gap-3">
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
                <span className="flex-1 min-w-0 text-[0.9375rem]" style={{ color: "var(--con-charcoal)" }}>
                  {t.title}
                </span>
                {t.time_estimate && (
                  <span className="text-[0.6875rem] tnum shrink-0" style={{ color: "var(--con-charcoal-faint)" }}>
                    {t.time_estimate}
                  </span>
                )}
              </li>
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
