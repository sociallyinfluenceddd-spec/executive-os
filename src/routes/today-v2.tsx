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
import { useCallback, useEffect, useMemo, useState } from "react";
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

type SectionKey = "schedule" | "brief" | "inbox" | "pipeline" | "money" | "staff" | "one";

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
  const [revenueCents, setRevenueCents] = useState({ today: 0, week: 0, month: 0 });
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

    void (async () => {
      const [cal, em, br, pp, cl, dailyRow, revToday, revWeek, revMonth] = await Promise.all([
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
      });
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
    const meta = (user?.user_metadata ?? {}) as { full_name?: string; first_name?: string };
    if (meta.first_name) return meta.first_name;
    if (meta.full_name) return meta.full_name.split(" ")[0];
    if (user?.email) return user.email.split("@")[0].split(".")[0].split("+")[0].replace(/^./, (c) => c.toUpperCase());
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
        </header>

        <hr className="hairline mb-10" />

        {/* THE ONE */}
        <Section
          k="one"
          title="The One"
          headline={daily?.top_priority ?? "Set yours for today."}
          headlineDim={!daily?.top_priority}
          open={openSection === "one"}
          onToggle={toggle}
        >
          <OneEditor user={user} initial={daily?.top_priority ?? ""} onSaved={reload} />
        </Section>

        <hr className="hairline my-8" />

        {/* SCHEDULE */}
        <Section
          k="schedule"
          title="Schedule"
          headline={
            events.length === 0
              ? "Nothing on the calendar."
              : events.length === 1
                ? "One event today."
                : `${events.length} events today.`
          }
          subhead={upcoming
            ? `Next: ${upcoming.title} at ${new Date(upcoming.start_at!).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`
            : null}
          open={openSection === "schedule"}
          onToggle={toggle}
        >
          {events.length === 0 ? (
            <p className="text-[0.95rem]" style={{ color: "var(--con-charcoal-faint)" }}>—</p>
          ) : (
            <ul className="space-y-3">
              {events.map((e) => {
                const t = e.start_at ? new Date(e.start_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—";
                const isNext = upcoming?.id === e.id;
                return (
                  <li key={e.id} className="flex items-baseline gap-5">
                    <span className="tnum text-[0.875rem] w-20 shrink-0" style={{ color: "var(--con-charcoal-faint)" }}>
                      {t.toLowerCase()}
                    </span>
                    <span className="text-[1rem] flex-1" style={{ color: isNext ? "var(--con-brass-deep)" : "var(--con-charcoal)", fontWeight: isNext ? 500 : 400 }}>
                      {e.title ?? "Untitled"}
                    </span>
                    {e.video_url && (
                      <a href={e.video_url} target="_blank" rel="noreferrer" className="text-[0.8125rem]">
                        Join →
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <hr className="hairline my-8" />

        {/* BRIEF */}
        <Section
          k="brief"
          title="Brief"
          headline={
            brief.length === 0
              ? "Your staff have nothing pending."
              : brief.length === 1
                ? "One item awaiting your review."
                : `${brief.length} items awaiting your review.`
          }
          subhead={
            Object.keys(briefByAgent).length > 0
              ? Object.entries(briefByAgent)
                  .map(([id, c]) => `${AGENT_META[id as keyof typeof AGENT_META]?.name ?? id} · ${c}`)
                  .join("  ·  ")
              : null
          }
          open={openSection === "brief"}
          onToggle={toggle}
          rightActions={
            <BriefRunActions onDone={reload} />
          }
        >
          {brief.length === 0 ? (
            <p className="text-[0.95rem]" style={{ color: "var(--con-charcoal-faint)" }}>
              Quiet morning. Click Run Sage or Run Ren above to wake them.
            </p>
          ) : (
            <ul className="space-y-6">
              {brief.map((o) => (
                <BriefRow key={o.id} output={o} onChanged={reload} />
              ))}
            </ul>
          )}
        </Section>

        <hr className="hairline my-8" />

        {/* INBOX */}
        <Section
          k="inbox"
          title="Inbox"
          headline={
            needsResponseCount === 0 && priorityCount === 0
              ? "Inbox is clear."
              : `${needsResponseCount} awaiting your reply.`
          }
          subhead={priorityCount > 0 ? `${priorityCount} marked priority.` : null}
          open={openSection === "inbox"}
          onToggle={toggle}
        >
          <InboxList emails={emails} />
        </Section>

        <hr className="hairline my-8" />

        {/* PIPELINE */}
        <Section
          k="pipeline"
          title="Pipeline"
          headline={
            pipeline === null
              ? "—"
              : pipeline.hotLeadCount === 0
                ? "No hot leads. Pipeline quiet."
                : `${pipeline.hotLeadCount} hot ${pipeline.hotLeadCount === 1 ? "lead" : "leads"}.`
          }
          subhead={
            pipeline && (pipeline.proposalOutValueCents > 0 || pipeline.activeMrrCents > 0)
              ? [
                  pipeline.proposalOutValueCents > 0 ? `${formatCents(pipeline.proposalOutValueCents)} in proposals` : null,
                  pipeline.activeMrrCents > 0 ? `${formatCents(pipeline.activeMrrCents)}/mo active` : null,
                ].filter(Boolean).join(" · ")
              : null
          }
          open={openSection === "pipeline"}
          onToggle={toggle}
        >
          <PipelineList clients={clients} onChanged={reload} />
        </Section>

        <hr className="hairline my-8" />

        {/* MONEY */}
        <Section
          k="money"
          title="Money"
          headline={
            revenueCents.today > 0
              ? `${formatCents(revenueCents.today)} today.`
              : revenueCents.week > 0
                ? `${formatCents(revenueCents.week)} this week.`
                : "No revenue logged yet."
          }
          subhead={`${formatCents(revenueCents.week)} this week · ${formatCents(revenueCents.month)} MTD`}
          open={openSection === "money"}
          onToggle={toggle}
        >
          <MoneyLog user={user} onLogged={reload} />
        </Section>

        <hr className="hairline my-8" />

        {/* STAFF */}
        <Section
          k="staff"
          title="Staff"
          headline="All six of your agents are at their posts."
          subhead="Cleo, Sage, Ren running on schedule. Maya, Vee, Theo quiet today."
          open={openSection === "staff"}
          onToggle={toggle}
        >
          <StaffActions onChanged={reload} />
        </Section>

        <hr className="hairline mt-10 mb-6" />

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
   STAFF — run-now buttons + agent status table
   ===================================================================== */
function StaffActions({ onChanged }: { onChanged: () => void }) {
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
    <ul className="space-y-3">
      {agents.map((a) => {
        const meta = AGENT_META[a.id as keyof typeof AGENT_META];
        return (
          <li key={a.id} className="flex items-baseline gap-4">
            <span className="small-caps-muted shrink-0" style={{ width: "4rem", color: "var(--con-brass-deep)" }}>
              {meta?.name}
            </span>
            <span className="flex-1 text-[0.9375rem]" style={{ color: "var(--con-charcoal)" }}>
              {a.desc}
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
  );
}
