import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { DoneForToday } from "@/components/DoneForToday";
import { Button } from "@/components/ui/button";
import { RefreshCw, Video, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/today")({
  component: () => (
    <AppShell>
      <TodayPage />
    </AppShell>
  ),
});

type EmailRow = {
  id: string;
  account: string;
  kind: "priority" | "needs_response" | "invite" | "meeting";
  sender_name: string | null;
  sender_email: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string | null;
  scheduled_at: string | null;
  attendees: unknown;
  video_url: string | null;
  status: string | null;
};

type DailyRow = {
  energy_level: number | null;
  mood: string | null;
  top_priority: string | null;
};

type CaptureRow = {
  id: string;
  raw_text: string;
  captured_at: string;
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${time}`;
}

function urgencyClass(iso: string | null): string {
  if (!iso) return "bg-[color:var(--sage)]";
  const ageH = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (ageH > 24) return "bg-rose-500";
  if (ageH > 12) return "bg-amber-400";
  return "bg-[color:var(--sage)]";
}

function accountChip(account: string): string {
  return account.split("@")[0];
}

const ENERGY_EMOJI: Record<number, string> = {
  2: "😴",
  4: "😐",
  6: "🙂",
  8: "⚡",
  10: "🔥",
};

function energyDisplay(level: number | null): string {
  if (level == null) return "—";
  const keys = [2, 4, 6, 8, 10];
  const nearest = keys.reduce((p, c) => (Math.abs(c - level) < Math.abs(p - level) ? c : p));
  return ENERGY_EMOJI[nearest];
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  );
}

function TodayPage() {
  const { user } = useAuth();
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [daily, setDaily] = useState<DailyRow | null>(null);
  const [latestCapture, setLatestCapture] = useState<CaptureRow | null>(null);
  const [capturesThisWeek, setCapturesThisWeek] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [expandCapture, setExpandCapture] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const firstName = useMemo(() => {
    const display = (user?.user_metadata?.display_name as string | undefined)?.trim();
    if (display) return display.split(" ")[0];
    return user?.email?.split("@")[0] ?? "";
  }, [user]);

  const loadAll = useCallback(async () => {
    if (!user) return;
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const todayStr = new Date().toISOString().slice(0, 10);

    const [emailsRes, dailyRes, captureRes, weekCountRes] = await Promise.all([
      supabase
        .from("exec_os_emails")
        .select(
          "id,account,kind,sender_name,sender_email,subject,snippet,received_at,scheduled_at,attendees,video_url,status",
        )
        .eq("user_id", user.id),
      supabase
        .from("exec_os_daily")
        .select("energy_level,mood,top_priority,entry_date")
        .eq("user_id", user.id)
        .order("entry_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("exec_os_captures")
        .select("id,raw_text,captured_at")
        .eq("user_id", user.id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("exec_os_captures")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("captured_at", weekAgo),
    ]);

    setEmails((emailsRes.data as EmailRow[]) ?? []);
    setDaily((dailyRes.data as DailyRow) ?? null);
    setLatestCapture((captureRes.data as CaptureRow) ?? null);
    setCapturesThisWeek(weekCountRes.count ?? 0);
    setLoaded(true);
    void todayStr;
  }, [user]);

  useEffect(() => {
    void loadAll();
  }, [loadAll, refreshTick]);

  // Realtime subscription for emails
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("today_emails_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "exec_os_emails" },
        (payload) => {
          setEmails((cur) => {
            if (payload.eventType === "DELETE") {
              return cur.filter((r) => r.id !== (payload.old as EmailRow).id);
            }
            const next = payload.new as EmailRow;
            const idx = cur.findIndex((r) => r.id === next.id);
            if (idx === -1) return [next, ...cur];
            const copy = cur.slice();
            copy[idx] = next;
            return copy;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const triage = useMemo(() => {
    return emails
      .filter(
        (e) =>
          (e.kind === "priority" || e.kind === "needs_response") && e.status === "unread",
      )
      .sort(
        (a, b) =>
          new Date(b.received_at ?? 0).getTime() - new Date(a.received_at ?? 0).getTime(),
      )
      .slice(0, 10);
  }, [emails]);

  const meetingsToday = useMemo(
    () =>
      emails
        .filter((e) => e.kind === "meeting" && isToday(e.scheduled_at))
        .sort(
          (a, b) =>
            new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime(),
        ),
    [emails],
  );

  const invites = useMemo(
    () =>
      emails
        .filter((e) => e.kind === "invite" && e.status === "unread")
        .sort(
          (a, b) =>
            new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime(),
        ),
    [emails],
  );

  const needsResponseCount = emails.filter(
    (e) =>
      (e.kind === "priority" || e.kind === "needs_response") && e.status === "unread",
  ).length;
  const meetingsTodayCount = meetingsToday.length;
  const invitesCount = invites.length;

  async function setEmailStatus(id: string, status: string) {
    setEmails((cur) => cur.map((r) => (r.id === id ? { ...r, status } : r)));
    await supabase.from("exec_os_emails").update({ status }).eq("id", id);
  }

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  if (!loaded) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-2/3 bg-muted rounded-md animate-pulse" />
        <div className="h-32 w-full bg-muted rounded-xl animate-pulse" />
        <div className="h-48 w-full bg-muted rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Header strip */}
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{dateLabel}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatChip
            label={`${needsResponseCount} email${needsResponseCount === 1 ? "" : "s"} need response`}
            alert={needsResponseCount > 5}
          />
          <StatChip
            label={`${meetingsTodayCount} meeting${meetingsTodayCount === 1 ? "" : "s"} today`}
          />
          <StatChip
            label={`${invitesCount} invite${invitesCount === 1 ? "" : "s"} awaiting reply`}
          />
          <StatChip
            label={`${capturesThisWeek} capture${capturesThisWeek === 1 ? "" : "s"} this week`}
          />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* LEFT — Triage */}
        <section className="lg:col-span-3 rounded-xl border border-border bg-card p-6">
          <header className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Triage</h2>
            <button
              type="button"
              onClick={() => setRefreshTick((n) => n + 1)}
              className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-muted transition"
              aria-label="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </header>
          <div className="mt-4">
            {triage.length === 0 ? (
              <p className="text-sm text-muted-foreground py-10 text-center">
                Inbox clear. ✨
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {triage.map((r) => (
                  <li key={r.id} className="py-3">
                    <TriageRow row={r} onStatus={(s) => setEmailStatus(r.id, s)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* RIGHT — Today */}
        <div className="lg:col-span-2 space-y-4">
          {/* Meetings today */}
          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Meetings today
            </h3>
            <div className="mt-3">
              {meetingsToday.length === 0 ? (
                <p className="text-xs text-muted-foreground">No meetings today.</p>
              ) : (
                <ul className="space-y-3">
                  {meetingsToday.map((m) => {
                    const attendees = Array.isArray(m.attendees) ? m.attendees.length : 0;
                    return (
                      <li key={m.id} className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-foreground truncate">
                            {m.subject || "(untitled)"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {whenLabel(m.scheduled_at)}
                            {attendees > 0 &&
                              ` · ${attendees} attendee${attendees === 1 ? "" : "s"}`}
                          </div>
                        </div>
                        {m.video_url && (
                          <a
                            href={m.video_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-[color:var(--navy)] hover:underline shrink-0"
                          >
                            <Video className="h-3.5 w-3.5" /> Join
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* Calendar invites */}
          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Calendar invites
            </h3>
            <div className="mt-3">
              {invites.length === 0 ? (
                <p className="text-xs text-muted-foreground">No invites awaiting reply.</p>
              ) : (
                <ul className="space-y-3">
                  {invites.map((i) => (
                    <li key={i.id} className="space-y-2">
                      <div>
                        <div className="text-sm font-medium text-foreground truncate">
                          {i.subject || "(untitled)"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {i.sender_name || i.sender_email || "Organizer"} ·{" "}
                          {whenLabel(i.scheduled_at)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(["accepted", "declined", "maybe"] as const).map((s) => (
                          <Button
                            key={s}
                            size="sm"
                            variant={i.status === s ? "default" : "outline"}
                            className="h-7 text-xs px-2.5"
                            onClick={() => setEmailStatus(i.id, s)}
                          >
                            {s === "accepted" ? "Accept" : s === "declined" ? "Decline" : "Maybe"}
                          </Button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Pulse */}
          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">Pulse</h3>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-2xl leading-none">
                  {energyDisplay(daily?.energy_level ?? null)}
                </span>
                {daily?.mood ? (
                  <span className="px-2.5 py-1 rounded-full bg-muted text-xs text-foreground">
                    {daily.mood}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">No mood logged</span>
                )}
              </div>
              <p className="text-sm text-foreground line-clamp-2">
                {daily?.top_priority || (
                  <span className="text-muted-foreground italic">No priority set yet.</span>
                )}
              </p>
              <Link
                to="/capture"
                className="inline-flex items-center gap-1 text-xs text-[color:var(--navy)] hover:underline"
              >
                Update via Capture <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </section>

          {/* Latest capture */}
          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Latest capture
            </h3>
            <div className="mt-3 space-y-2">
              {latestCapture ? (
                <>
                  <button
                    type="button"
                    onClick={() => setExpandCapture((v) => !v)}
                    className="text-left w-full"
                  >
                    <p
                      className={`text-sm text-foreground ${
                        expandCapture ? "" : "line-clamp-2"
                      }`}
                    >
                      {expandCapture
                        ? latestCapture.raw_text
                        : latestCapture.raw_text.slice(0, 120) +
                          (latestCapture.raw_text.length > 120 ? "…" : "")}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {relativeTime(latestCapture.captured_at)}
                    </p>
                  </button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Nothing captured yet.</p>
              )}
              <Link
                to="/capture"
                className="inline-flex items-center gap-1 text-xs text-[color:var(--navy)] hover:underline"
              >
                Capture another <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </section>
        </div>
      </div>

      <DoneForToday />
    </div>
  );
}

function StatChip({ label, alert }: { label: string; alert?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-xs text-foreground">
      {alert && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />}
      {label}
    </span>
  );
}

function TriageRow({
  row,
  onStatus,
}: {
  row: EmailRow;
  onStatus: (status: string) => void;
}) {
  const mailto = row.sender_email
    ? `mailto:${row.sender_email}?subject=${encodeURIComponent(
        row.subject ? `Re: ${row.subject}` : "Re:",
      )}`
    : undefined;
  return (
    <div className="flex items-start gap-3">
      <span
        className={`mt-2 h-2 w-2 rounded-full shrink-0 ${urgencyClass(row.received_at)}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-foreground truncate">
            {row.sender_name || row.sender_email || "Unknown"}
          </span>
          {row.sender_email && row.sender_name && (
            <span className="text-xs text-muted-foreground truncate">{row.sender_email}</span>
          )}
        </div>
        <div className="text-sm font-semibold text-foreground truncate">
          {row.subject || "(no subject)"}
        </div>
        {row.snippet && (
          <div className="text-xs text-muted-foreground truncate mt-0.5">{row.snippet}</div>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          <span className="text-[11px] text-muted-foreground">
            {relativeTime(row.received_at)}
          </span>
          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            {accountChip(row.account)}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {mailto && (
            <Button asChild size="sm" variant="default" className="h-7 text-xs px-2.5">
              <a href={mailto}>Reply</a>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2.5"
            onClick={() => onStatus("snoozed")}
          >
            Snooze 4h
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs px-2.5 text-muted-foreground"
            onClick={() => onStatus("read")}
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}
