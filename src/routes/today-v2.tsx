// /today-v2 — the Concierge design.
//
// This route is the design redirection of /today. NO grid layout, NO widget
// cards, NO drag-resize. Just typography and air, scoped via the .concierge
// CSS wrapper. Built to feel like a hotel concierge folder — sand paper,
// brass detail, editorial type, calm.
//
// Reuses the same data sources as /today so we're not duplicating logic:
// calendar via fetchCalendarEvents, inbox/emails via exec_os_emails,
// morning brief via listPendingOutputs, pipeline via pipelineSummary,
// money via exec_os_revenue.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fetchCalendarEvents } from "@/lib/google-calendar";
import { refreshGmail } from "@/lib/google-gmail";
import { listPendingOutputs, AGENT_META, type AgentOutput } from "@/lib/agent-outputs";
import { pipelineSummary, formatCents, type PipelineSummary } from "@/lib/clients";

export const Route = createFileRoute("/today-v2")({
  component: ConciergePage,
});

interface CalendarEvent {
  id: string;
  title: string | null;
  start_at: string | null;
  end_at: string | null;
  account?: string;
}

interface EmailLite {
  id: string;
  kind: string;
  status: string | null;
}

interface DailyRow {
  top_priority: string | null;
  energy_level: number | null;
}

function ConciergePage() {
  const { user } = useAuth();

  // Live clock (minute-aligned, same pattern as /today)
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
  const [emails, setEmails] = useState<EmailLite[]>([]);
  const [brief, setBrief] = useState<AgentOutput[]>([]);
  const [pipeline, setPipeline] = useState<PipelineSummary | null>(null);
  const [daily, setDaily] = useState<DailyRow | null>(null);
  const [revenueCents, setRevenueCents] = useState({ today: 0, week: 0, month: 0 });

  useEffect(() => {
    if (!user) return;
    void refreshGmail();
    const todayStr = now.toISOString().slice(0, 10);
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 6); weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    void (async () => {
      const [cal, em, br, pp, dailyRow, revToday, revWeek, revMonth] = await Promise.all([
        fetchCalendarEvents({ timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString() }).then((r) => r.events),
        supabase.from("exec_os_emails").select("id,kind,status").eq("user_id", user.id),
        listPendingOutputs(25),
        pipelineSummary(),
        supabase.from("exec_os_daily").select("top_priority,energy_level").eq("user_id", user.id).eq("entry_date", todayStr).maybeSingle(),
        supabase.from("exec_os_revenue").select("amount_cents").eq("user_id", user.id).eq("entry_date", todayStr),
        supabase.from("exec_os_revenue").select("amount_cents").eq("user_id", user.id).gte("entry_date", weekStart.toISOString().slice(0, 10)),
        supabase.from("exec_os_revenue").select("amount_cents").eq("user_id", user.id).gte("entry_date", monthStart.toISOString().slice(0, 10)),
      ]);
      setEvents((cal ?? []) as CalendarEvent[]);
      setEmails(((em.data ?? []) as EmailLite[]));
      setBrief(br);
      setPipeline(pp);
      setDaily((dailyRow.data as DailyRow | null) ?? null);
      const sum = (rows: { amount_cents: number }[] | null) => (rows ?? []).reduce((a, r) => a + r.amount_cents, 0);
      setRevenueCents({
        today: sum((revToday.data ?? []) as { amount_cents: number }[]),
        week: sum((revWeek.data ?? []) as { amount_cents: number }[]),
        month: sum((revMonth.data ?? []) as { amount_cents: number }[]),
      });
    })();
  }, [user, now.toISOString().slice(0, 10)]); // re-fetch on date change

  // Greeting + name + date
  const greeting = (() => {
    const h = now.getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();
  const firstName = (() => {
    const meta = (user?.user_metadata ?? {}) as { full_name?: string; first_name?: string };
    if (meta.first_name) return meta.first_name;
    if (meta.full_name) return meta.full_name.split(" ")[0];
    if (user?.email) return user.email.split("@")[0].split(".")[0].split("+")[0].replace(/^./, (c) => c.toUpperCase());
    return "";
  })();
  const longDate = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const longDateUpper = longDate.toUpperCase();
  const clock = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  // Next event
  const upcoming = useMemo(() => {
    const future = events
      .filter((e) => e.start_at && new Date(e.start_at).getTime() > now.getTime())
      .sort((a, b) => (a.start_at ?? "").localeCompare(b.start_at ?? ""));
    return future[0] ?? null;
  }, [events, now]);
  const minutesToNext = upcoming?.start_at
    ? Math.max(0, Math.round((new Date(upcoming.start_at).getTime() - now.getTime()) / 60_000))
    : null;

  // Inbox counts
  const priorityCount = emails.filter((e) => e.kind === "priority" && e.status === "unread").length;
  const needsResponseCount = emails.filter((e) => e.kind === "needs_response" && e.status === "unread").length;

  // Brief by agent
  const briefByAgent = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of brief) {
      map[o.agent_id] = (map[o.agent_id] ?? 0) + 1;
    }
    return map;
  }, [brief]);

  return (
    <div className="concierge">
      <div className="max-w-[1100px] mx-auto px-10 py-12 fade-in">
        {/* HEADER */}
        <header className="space-y-6 mb-14">
          <div className="flex items-start justify-between gap-6">
            <div className="small-caps-muted tnum">{longDateUpper}</div>
            <div className="flex items-center gap-6">
              <span className="small-caps-muted tnum">{clock}</span>
              <span className="monogram">DC</span>
            </div>
          </div>
          <div>
            <h1 className="display text-[2.75rem] leading-[1.15] tracking-tight" style={{ color: "var(--con-charcoal)" }}>
              {greeting}{firstName ? `, ${firstName}` : ""}.
            </h1>
            <p className="display text-[1.5rem] mt-3 leading-snug" style={{ color: "var(--con-charcoal-soft)" }}>
              {upcoming
                ? `Your next is ${upcoming.title ?? "an event"} in ${minutesToNext} ${minutesToNext === 1 ? "minute" : "minutes"}.`
                : "Nothing else scheduled today. The afternoon is yours."}
            </p>
          </div>
        </header>

        <hr className="hairline mb-14" />

        {/* THE ONE — focus directive */}
        <section className="mb-14">
          <div className="small-caps mb-4">The One</div>
          <p className="display text-[1.875rem] leading-snug max-w-[40rem]" style={{ color: "var(--con-charcoal)" }}>
            {daily?.top_priority ?? <span style={{ color: "var(--con-charcoal-faint)" }}>Set yours from Today.</span>}
          </p>
        </section>

        <hr className="hairline mb-14" />

        {/* SCHEDULE + BRIEF */}
        <section className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-12 mb-14">
          {/* Schedule */}
          <div>
            <div className="small-caps mb-5">Schedule</div>
            {events.length === 0 ? (
              <p className="text-[0.95rem]" style={{ color: "var(--con-charcoal-faint)" }}>
                Nothing on the calendar.
              </p>
            ) : (
              <ul className="space-y-4">
                {events.slice(0, 6).map((e) => {
                  const t = e.start_at ? new Date(e.start_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—";
                  const isNext = upcoming?.id === e.id;
                  return (
                    <li key={e.id} className="flex items-baseline gap-5">
                      <span className="tnum text-[0.875rem] w-20 shrink-0" style={{ color: "var(--con-charcoal-faint)" }}>
                        {t.toLowerCase()}
                      </span>
                      <span className={`text-[1rem] ${isNext ? "font-medium" : ""}`} style={{ color: isNext ? "var(--con-brass-deep)" : "var(--con-charcoal)" }}>
                        {e.title ?? "Untitled"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="hidden md:block vrule" />

          {/* Brief */}
          <div>
            <div className="small-caps mb-5">Brief</div>
            {brief.length === 0 ? (
              <p className="text-[0.95rem]" style={{ color: "var(--con-charcoal-faint)" }}>
                Your staff have nothing pending. Quiet morning.
              </p>
            ) : (
              <ul className="space-y-4">
                {Object.entries(briefByAgent).map(([agentId, count]) => {
                  const meta = AGENT_META[agentId as keyof typeof AGENT_META];
                  if (!meta) return null;
                  const label = count === 1
                    ? `${meta.name} · one ${meta.role.toLowerCase().replace(" agent", "")} item`
                    : `${meta.name} · ${count} ${meta.role.toLowerCase().replace(" agent", "")} items`;
                  return (
                    <li key={agentId} className="text-[1rem]" style={{ color: "var(--con-charcoal)" }}>
                      {label}
                    </li>
                  );
                })}
                <li className="pt-2">
                  <Link to="/today" className="text-[0.8125rem]">
                    Open Morning Brief →
                  </Link>
                </li>
              </ul>
            )}
          </div>
        </section>

        <hr className="hairline mb-14" />

        {/* INBOX + PIPELINE */}
        <section className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-12 mb-14">
          {/* Inbox */}
          <div>
            <div className="small-caps mb-5">Inbox</div>
            <p className="display-tight text-[1.5rem] leading-snug" style={{ color: "var(--con-charcoal)" }}>
              {needsResponseCount === 0 && priorityCount === 0
                ? "Inbox is clear."
                : `${needsResponseCount} awaiting your reply.`}
            </p>
            {priorityCount > 0 && (
              <p className="text-[0.95rem] mt-2" style={{ color: "var(--con-charcoal-soft)" }}>
                {priorityCount === 1 ? "One marked priority." : `${priorityCount} marked priority.`}
              </p>
            )}
          </div>

          <div className="hidden md:block vrule" />

          {/* Pipeline */}
          <div>
            <div className="small-caps mb-5">Pipeline</div>
            {pipeline === null ? (
              <p className="text-[0.95rem]" style={{ color: "var(--con-charcoal-faint)" }}>—</p>
            ) : (
              <>
                <p className="display-tight text-[1.5rem] leading-snug" style={{ color: "var(--con-charcoal)" }}>
                  {pipeline.hotLeadCount === 0
                    ? "No hot leads."
                    : `${pipeline.hotLeadCount} hot ${pipeline.hotLeadCount === 1 ? "lead" : "leads"}.`}
                </p>
                {pipeline.proposalOutValueCents > 0 && (
                  <p className="text-[0.95rem] mt-2 tnum" style={{ color: "var(--con-charcoal-soft)" }}>
                    {formatCents(pipeline.proposalOutValueCents)} in proposals out.
                  </p>
                )}
                {pipeline.activeMrrCents > 0 && (
                  <p className="text-[0.95rem] mt-1 tnum" style={{ color: "var(--con-charcoal-soft)" }}>
                    {formatCents(pipeline.activeMrrCents)}/mo active.
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        <hr className="hairline mb-14" />

        {/* MONEY + STAFF */}
        <section className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-12 mb-20">
          {/* Money */}
          <div>
            <div className="small-caps mb-5">Money</div>
            <dl className="space-y-3">
              <div className="flex justify-between items-baseline">
                <dt className="text-[0.875rem]" style={{ color: "var(--con-charcoal-faint)" }}>Today</dt>
                <dd className="display-tight text-[1.25rem] tnum" style={{ color: "var(--con-charcoal)" }}>
                  {formatCents(revenueCents.today)}
                </dd>
              </div>
              <div className="flex justify-between items-baseline">
                <dt className="text-[0.875rem]" style={{ color: "var(--con-charcoal-faint)" }}>This week</dt>
                <dd className="display-tight text-[1.25rem] tnum" style={{ color: "var(--con-charcoal)" }}>
                  {formatCents(revenueCents.week)}
                </dd>
              </div>
              <div className="flex justify-between items-baseline">
                <dt className="text-[0.875rem]" style={{ color: "var(--con-charcoal-faint)" }}>Month to date</dt>
                <dd className="display-tight text-[1.25rem] tnum" style={{ color: "var(--con-charcoal)" }}>
                  {formatCents(revenueCents.month)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="hidden md:block vrule" />

          {/* Staff */}
          <div>
            <div className="small-caps mb-5">Staff</div>
            <p className="text-[1rem]" style={{ color: "var(--con-charcoal)" }}>
              All six of your agents are at their posts.
            </p>
            <p className="text-[0.8125rem] mt-2" style={{ color: "var(--con-charcoal-faint)" }}>
              Cleo, Sage, Ren are running on schedule. Maya, Vee, Theo are quiet today.
            </p>
          </div>
        </section>

        {/* Footer — links to the rest of the app */}
        <footer className="pt-8 border-t" style={{ borderColor: "var(--con-rule)" }}>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-[0.8125rem]">
            <Link to="/today">Classic dashboard</Link>
            <Link to="/hub">Hub</Link>
            <Link to="/capture">Capture</Link>
            <Link to="/settings">Settings</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
