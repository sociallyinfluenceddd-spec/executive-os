import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Responsive, WidthProvider, type LayoutItem, type ResponsiveLayouts } from "react-grid-layout/legacy";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { useIsMobile } from "@/hooks/use-mobile";
import { DoneForToday } from "@/components/DoneForToday";
import { CaptureModal } from "@/components/CaptureModal";
import { BenchRow } from "@/components/BenchRow";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  Mic,
  Video,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  TrendingUp,
  Inbox,
  CalendarClock,
  Banknote,
  Sparkles,
  FolderKanban,
  MessageCircle,
  Activity,
  Info,
  ChevronLeft,
  ChevronRight,
  Lock,
  LockOpen,
  GripVertical,
  RotateCcw,
} from "lucide-react";

const ResponsiveGridLayout = WidthProvider(Responsive);

// ----- Dashboard layout -----
type WidgetId =
  | "calendar"
  | "inbox"
  | "money"
  | "timeline"
  | "content"
  | "projects"
  | "wellness"
  | "followups"
  | "bench";

const WIDGET_IDS: WidgetId[] = [
  "calendar",
  "inbox",
  "money",
  "timeline",
  "content",
  "projects",
  "wellness",
  "followups",
  "bench",
];

const LG_BASE: LayoutItem[] = [
  { i: "calendar", x: 0, y: 0, w: 8, h: 6, minW: 3, minH: 4 },
  { i: "inbox", x: 8, y: 0, w: 4, h: 6, minW: 3, minH: 4 },
  { i: "money", x: 0, y: 6, w: 4, h: 6, minW: 3, minH: 4 },
  { i: "timeline", x: 0, y: 12, w: 12, h: 4, minW: 6, minH: 3 },
  { i: "content", x: 0, y: 16, w: 6, h: 5, minW: 3, minH: 4 },
  { i: "projects", x: 6, y: 16, w: 6, h: 5, minW: 3, minH: 4 },
  { i: "wellness", x: 0, y: 21, w: 6, h: 5, minW: 3, minH: 4 },
  { i: "followups", x: 6, y: 21, w: 6, h: 5, minW: 3, minH: 4 },
  { i: "bench", x: 0, y: 26, w: 12, h: 6, minW: 6, minH: 5 },
];

const MD_BASE: LayoutItem[] = [
  { i: "calendar", x: 0, y: 0, w: 8, h: 6, minW: 3, minH: 4 },
  { i: "inbox", x: 0, y: 6, w: 4, h: 6, minW: 3, minH: 4 },
  { i: "money", x: 4, y: 6, w: 4, h: 6, minW: 3, minH: 4 },
  { i: "timeline", x: 0, y: 12, w: 8, h: 4, minW: 4, minH: 3 },
  { i: "content", x: 0, y: 16, w: 4, h: 5, minW: 3, minH: 4 },
  { i: "projects", x: 4, y: 16, w: 4, h: 5, minW: 3, minH: 4 },
  { i: "wellness", x: 0, y: 21, w: 4, h: 5, minW: 3, minH: 4 },
  { i: "followups", x: 4, y: 21, w: 4, h: 5, minW: 3, minH: 4 },
  { i: "bench", x: 0, y: 26, w: 8, h: 6, minW: 4, minH: 5 },
];

const MOBILE_ORDER: WidgetId[] = [
  "inbox",
  "calendar",
  "timeline",
  "money",
  "content",
  "projects",
  "followups",
  "wellness",
  "bench",
];

function stackedLayout(cols: number): LayoutItem[] {
  let y = 0;
  return MOBILE_ORDER.map((id) => {
    const base = LG_BASE.find((l) => l.i === id)!;
    const item: LayoutItem = { i: id, x: 0, y, w: cols, h: base.h, minW: 1, minH: base.minH };
    y += base.h;
    return item;
  });
}

function buildLayouts(locks: Record<string, boolean>): ResponsiveLayouts {
  const apply = (arr: LayoutItem[]) =>
    arr.map((l) => ({ ...l, static: !!locks[l.i] }));
  return {
    lg: apply(LG_BASE),
    md: apply(MD_BASE),
    sm: apply(stackedLayout(1)),
  };
}

const DASHBOARD_KEY = "execOs.dashboardLayout.v1";
// Legacy keys (migrated on first load)
const LEGACY_LAYOUTS_KEY = "today_layouts_v1";
const LEGACY_LOCKS_KEY = "today_locks_v1";

type DashboardPersisted = {
  lg?: LayoutItem[];
  md?: LayoutItem[];
  sm?: LayoutItem[];
  locked?: Record<string, boolean>;
};

function loadDashboard(): DashboardPersisted | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DASHBOARD_KEY);
    if (raw) return JSON.parse(raw) as DashboardPersisted;
    // Migrate from legacy keys
    const legacyLayouts = localStorage.getItem(LEGACY_LAYOUTS_KEY);
    const legacyLocks = localStorage.getItem(LEGACY_LOCKS_KEY);
    if (legacyLayouts || legacyLocks) {
      const layouts = legacyLayouts ? (JSON.parse(legacyLayouts) as ResponsiveLayouts) : {};
      const locked = legacyLocks ? (JSON.parse(legacyLocks) as Record<string, boolean>) : {};
      const migrated: DashboardPersisted = { ...layouts, locked };
      try { localStorage.setItem(DASHBOARD_KEY, JSON.stringify(migrated)); } catch {}
      return migrated;
    }
    return null;
  } catch {
    return null;
  }
}

function loadLayouts(): ResponsiveLayouts | null {
  const d = loadDashboard();
  if (!d) return null;
  const { lg, md, sm } = d;
  if (!lg && !md && !sm) return null;
  return { lg, md, sm } as ResponsiveLayouts;
}
function loadLocks(): Record<string, boolean> {
  return loadDashboard()?.locked ?? {};
}
function saveDashboard(layouts: ResponsiveLayouts, locked: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    const payload: DashboardPersisted = {
      lg: layouts.lg as LayoutItem[] | undefined,
      md: layouts.md as LayoutItem[] | undefined,
      sm: layouts.sm as LayoutItem[] | undefined,
      locked,
    };
    localStorage.setItem(DASHBOARD_KEY, JSON.stringify(payload));
  } catch {}
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function dayLabel(d: Date): string {
  const today = startOfDay(new Date());
  const sel = startOfDay(d);
  const diff = Math.round((sel.getTime() - today.getTime()) / 86400_000);
  const fmt = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  if (diff === 0) return `Today · ${fmt}`;
  if (diff === 1) return `Tomorrow · ${fmt}`;
  if (diff === -1) return `Yesterday · ${fmt}`;
  return fmt;
}

export const Route = createFileRoute("/today")({
  component: () => (
    <AppShell wide>
      <TodayPage />
    </AppShell>
  ),
});

const ACCOUNTS = [
  "hello@donnabdicenso.com",
  "sociallyinfluenceddd@gmail.com",
  "sociallydonna@gmail.com",
  "ideafetti@gmail.com",
  "donna@dblankstyle.com",
];

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

type CalendarEventRow = {
  id: string;
  account: string;
  external_id: string;
  title: string | null;
  description: string | null;
  start_at: string | null;
  end_at: string | null;
  organizer_email: string | null;
  location: string | null;
  video_url: string | null;
  is_all_day: boolean | null;
  status: string | null;
  attendees: Array<{ email?: string; name?: string; response_status?: string }> | null;
  calendar_id: string | null;
  calendar_name: string | null;
};

type DailyRow = {
  energy_level: number | null;
  mood: string | null;
  top_priority: string | null;
  entry_date: string;
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const ENERGY_EMOJI: Record<number, { emoji: string; label: string }> = {
  2: { emoji: "😴", label: "Drained" },
  4: { emoji: "😐", label: "Low" },
  6: { emoji: "🙂", label: "Okay" },
  8: { emoji: "⚡", label: "Sharp" },
  10: { emoji: "🔥", label: "On fire" },
};

function energyDisplay(level: number | null) {
  if (level == null) return { emoji: "·", label: "No energy logged" };
  const keys = [2, 4, 6, 8, 10];
  const nearest = keys.reduce((p, c) =>
    Math.abs(c - level) < Math.abs(p - level) ? c : p,
  );
  return ENERGY_EMOJI[nearest];
}

function relTime(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return time;
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

function urgencyDot(iso: string | null): string {
  if (!iso) return "bg-[color:var(--sage)]";
  const ageH = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (ageH > 24) return "bg-[color:var(--rose)]";
  if (ageH > 12) return "bg-[color:var(--yellow)]";
  return "bg-[color:var(--sage)]";
}

const DEFAULT_PROJECTS = [
  { name: "Ideafetti", progress: 62, last_touched_h: 4 },
  { name: "AI Lead Conversion", progress: 38, last_touched_h: 26 },
  { name: "Skool community", progress: 50, last_touched_h: 200 },
  { name: "Content / TikTok", progress: 71, last_touched_h: 12 },
  { name: "Executive OS", progress: 28, last_touched_h: 1 },
];

function TodayPage() {
  // Live clock
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const { user } = useAuth();
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [emailsLoadedAt, setEmailsLoadedAt] = useState<number | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventRow[]>([]);
  const [calendarLoadedAt, setCalendarLoadedAt] = useState<number | null>(null);
  const [daily, setDaily] = useState<DailyRow | null>(null);
  const [dailyLoadedAt, setDailyLoadedAt] = useState<number | null>(null);
  const [energySeries, setEnergySeries] = useState<(number | null)[]>([]);
  const [loggedDays, setLoggedDays] = useState(0);
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  const selectedIsToday = isSameDay(selectedDate, now);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventRow | null>(null);
  const [selectedCalendar, setSelectedCalendar] = useState<string>(() => {
    if (typeof window === "undefined") return "all";
    return window.localStorage.getItem("today.selectedCalendar") || "all";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("today.selectedCalendar", selectedCalendar);
  }, [selectedCalendar]);

  // Dashboard grid layout state
  const isMobileViewport = useIsMobile();
  const [locks, setLocks] = useState<Record<string, boolean>>(() => loadLocks());
  const [layouts, setLayouts] = useState<ResponsiveLayouts>(() => loadLayouts() ?? buildLayouts(loadLocks()));
  useEffect(() => {
    setLayouts((cur) => {
      const next: ResponsiveLayouts = { ...cur };
      (Object.keys(next) as (keyof ResponsiveLayouts)[]).forEach((bp) => {
        const arr = next[bp];
        if (arr) next[bp] = arr.map((l) => ({ ...l, static: !!locks[l.i] }));
      });
      saveDashboard(next, locks);
      return next;
    });
  }, [locks]);
  const onLayoutChange = useCallback((_layout: readonly LayoutItem[], all: ResponsiveLayouts) => {
    setLayouts(all);
    saveDashboard(all, loadLocks());
  }, []);
  const toggleLock = useCallback((id: WidgetId) => {
    setLocks((cur) => ({ ...cur, [id]: !cur[id] }));
  }, []);
  const resetLayout = useCallback(() => {
    const fresh = buildLayouts(locks);
    setLayouts(fresh);
    saveDashboard(fresh, locks);
  }, [locks]);

  const firstName = useMemo(() => {
    const display = (user?.user_metadata?.display_name as string | undefined)?.trim();
    if (display) return display.split(" ")[0];
    return user?.email?.split("@")[0] ?? "";
  }, [user]);

  const loadAll = useCallback(async () => {
    if (!user) return;
    const sevenAgo = new Date();
    sevenAgo.setDate(sevenAgo.getDate() - 6);
    const sevenAgoStr = sevenAgo.toISOString().slice(0, 10);

    const dayStart = startOfDay(selectedDate);
    const dayEnd = addDays(dayStart, 1);

    const [emailsRes, dailyRes, weekRes, calRes] = await Promise.all([
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
        .from("exec_os_daily")
        .select("entry_date,energy_level")
        .eq("user_id", user.id)
        .gte("entry_date", sevenAgoStr)
        .order("entry_date", { ascending: true }),
      supabase
        .from("exec_os_calendar_events")
        .select(
          "id,account,external_id,title,description,start_at,end_at,organizer_email,location,video_url,is_all_day,status,attendees,calendar_id,calendar_name",
        )
        .eq("user_id", user.id)
        .gte("start_at", dayStart.toISOString())
        .lt("start_at", dayEnd.toISOString())
        .order("start_at", { ascending: true }),
    ]);

    setEmails((emailsRes.data as EmailRow[]) ?? []);
    setEmailsLoadedAt(Date.now());
    setDaily((dailyRes.data as DailyRow) ?? null);
    setDailyLoadedAt(Date.now());
    setCalendarEvents((calRes.data as CalendarEventRow[]) ?? []);
    setCalendarLoadedAt(Date.now());

    // Build 7-day series ending today
    const rows = (weekRes.data ?? []) as { entry_date: string; energy_level: number | null }[];
    const map = new Map(rows.map((r) => [r.entry_date, r.energy_level]));
    const series: (number | null)[] = [];
    let logged = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const v = map.get(key) ?? null;
      series.push(v);
      if (v != null) logged++;
    }
    setEnergySeries(series);
    setLoggedDays(logged);
  }, [user, selectedDate]);

  useEffect(() => {
    void loadAll();
  }, [loadAll, refreshTick]);

  // Realtime emails
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("cockpit_emails")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "exec_os_emails" },
        (payload) => {
          setEmailsLoadedAt(Date.now());
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
      supabase.removeChannel(ch);
    };
  }, [user]);

  // Realtime calendar events
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("cockpit_calendar")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "exec_os_calendar_events" },
        (payload) => {
          setCalendarLoadedAt(Date.now());
          setCalendarEvents((cur) => {
            if (payload.eventType === "DELETE") {
              return cur.filter((r) => r.id !== (payload.old as CalendarEventRow).id);
            }
            const next = payload.new as CalendarEventRow;
            // Only keep events for the selected day
            const dayStart = startOfDay(selectedDate);
            const dayEnd = addDays(dayStart, 1);
            const t = next.start_at ? new Date(next.start_at).getTime() : NaN;
            if (!t || t < dayStart.getTime() || t >= dayEnd.getTime()) {
              return cur.filter((r) => r.id !== next.id);
            }
            const idx = cur.findIndex((r) => r.id === next.id);
            const updated =
              idx === -1 ? [...cur, next] : cur.map((r) => (r.id === next.id ? next : r));
            return updated.sort(
              (a, b) =>
                new Date(a.start_at ?? 0).getTime() - new Date(b.start_at ?? 0).getTime(),
            );
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, selectedDate]);

  // Filtered emails
  const filteredEmails = useMemo(
    () =>
      accountFilter === "all"
        ? emails
        : emails.filter((e) => e.account === accountFilter),
    [emails, accountFilter],
  );

  const priorityCount = filteredEmails.filter(
    (e) => e.kind === "priority" && e.status === "unread",
  ).length;
  const needsRespCount = filteredEmails.filter(
    (e) => e.kind === "needs_response" && e.status === "unread",
  ).length;
  const topSenders = useMemo(() => {
    const list = filteredEmails
      .filter((e) => e.kind === "needs_response" && e.status === "unread")
      .sort(
        (a, b) =>
          new Date(b.received_at ?? 0).getTime() - new Date(a.received_at ?? 0).getTime(),
      )
      .slice(0, 3);
    return list;
  }, [filteredEmails]);

  const availableCalendars = useMemo(() => {
    const set = new Set<string>();
    for (const e of calendarEvents) {
      if (e.calendar_name) set.add(e.calendar_name);
    }
    return Array.from(set).sort();
  }, [calendarEvents]);

  const meetingsToday = useMemo(
    () =>
      calendarEvents
        .filter((e) =>
          selectedCalendar === "all" ? true : e.calendar_name === selectedCalendar,
        )
        .slice()
        .sort(
          (a, b) =>
            new Date(a.start_at ?? 0).getTime() - new Date(b.start_at ?? 0).getTime(),
        ),
    [calendarEvents, selectedCalendar],
  );
  const nextMeeting = selectedIsToday
    ? meetingsToday.find(
        (m) => m.start_at && new Date(m.start_at).getTime() > now.getTime(),
      )
    : undefined;
  const nextMeetingMinutes = nextMeeting
    ? Math.round(
        (new Date(nextMeeting.start_at!).getTime() - now.getTime()) / 60000,
      )
    : null;

  const followUps = useMemo(
    () =>
      emails
        .filter(
          (e) =>
            e.kind === "needs_response" &&
            e.status === "unread" &&
            e.received_at &&
            Date.now() - new Date(e.received_at).getTime() > 48 * 3600_000,
        )
        .sort(
          (a, b) =>
            new Date(a.received_at ?? 0).getTime() - new Date(b.received_at ?? 0).getTime(),
        ),
    [emails],
  );

  // Status: stale if any source >1h since last refresh
  const sources: { name: string; ts: number | null; live: boolean }[] = [
    { name: "Inbox (exec_os_emails)", ts: emailsLoadedAt, live: true },
    { name: "Pulse (exec_os_daily)", ts: dailyLoadedAt, live: true },
    { name: "Money (Ideafetti DB)", ts: null, live: false },
    { name: "Calendar (exec_os_calendar_events)", ts: calendarLoadedAt, live: true },
    { name: "Content Pulse (Ideafetti)", ts: null, live: false },
  ];
  const stale = sources.some((s) => s.live && s.ts && Date.now() - s.ts > 3600_000);

  async function setEmailStatus(id: string, status: string) {
    setEmails((cur) => cur.map((r) => (r.id === id ? { ...r, status } : r)));
    await supabase.from("exec_os_emails").update({ status }).eq("id", id);
  }

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const clockLabel = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const energy = energyDisplay(daily?.energy_level ?? null);

  // Energy trend
  const validSeries = energySeries.filter((v): v is number => v != null);
  let trend: "up" | "down" | "flat" | "none" = "none";
  if (validSeries.length >= 2) {
    const d = validSeries[validSeries.length - 1] - validSeries[0];
    if (d > 0.5) trend = "up";
    else if (d < -0.5) trend = "down";
    else trend = "flat";
  }

  return (
    <div className="space-y-3 sm:space-y-4 pb-32">
      {/* HEADER STRIP — sticky */}
      <header className="sticky top-0 z-30 -mx-3 sm:-mx-5 lg:-mx-6 px-3 sm:px-5 lg:px-6 py-3 sm:py-4 bg-background/85 backdrop-blur border-b border-border">
        {/* Mobile: stacked. Desktop: 12-col grid */}
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-12 lg:gap-4 lg:items-center">
          {/* Top row on mobile: clock + data-fresh pill */}
          <div className="flex items-start justify-between gap-3 lg:col-span-3 lg:block">
            <div className="min-w-0">
              <div className="text-3xl lg:text-4xl font-semibold tracking-tight tabular-nums text-foreground">
                {clockLabel}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {greeting()}
                {firstName ? `, ${firstName}` : ""} · {dateLabel}
              </div>
            </div>
            {/* Data fresh pill — visible at top right on mobile only */}
            <button
              type="button"
              onClick={() => setStatusOpen((v) => !v)}
              className="lg:hidden shrink-0 inline-flex items-center gap-2 px-3 min-h-[44px] rounded-full border border-border hover:bg-muted text-xs"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  stale ? "bg-[color:var(--rose)]" : "bg-[color:var(--sage)]"
                }`}
              />
              {stale ? "Stale" : "Fresh"}
            </button>
          </div>

          {/* Energy + mood */}
          <div className="lg:col-span-3 flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[color:var(--yellow)]/15 border border-[color:var(--yellow)]/30 text-xs">
              <span className="text-base leading-none">{energy.emoji}</span>
              <span className="text-foreground font-medium">{energy.label}</span>
            </span>
            {daily?.mood ? (
              <span className="px-2.5 py-1.5 rounded-full bg-muted text-xs text-foreground">
                {daily.mood}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">No mood</span>
            )}
          </div>

          {/* Top priority */}
          <div className="lg:col-span-4 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Top priority
            </div>
            {daily?.top_priority ? (
              <p className="text-sm font-medium text-foreground truncate">
                {daily.top_priority}
              </p>
            ) : (
              <Link
                to="/capture"
                className="text-sm text-[color:var(--navy)] hover:underline inline-flex items-center gap-1"
              >
                Set in Capture <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>

          {/* Status pill (desktop) */}
          <div className="hidden lg:flex lg:col-span-2 lg:justify-end">
            <button
              type="button"
              onClick={() => setStatusOpen((v) => !v)}
              className="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border hover:bg-muted text-xs"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  stale ? "bg-[color:var(--rose)]" : "bg-[color:var(--sage)]"
                }`}
              />
              {stale ? "Stale data" : "Data fresh"}
            </button>
          </div>
        </div>
        {statusOpen && (
          <div className="absolute right-3 sm:right-5 lg:right-6 top-full mt-2 z-40 w-[280px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-card shadow-lg p-3 space-y-2">
            {sources.map((s) => (
              <div
                key={s.name}
                className="flex items-center justify-between text-xs gap-3"
              >
                <span className="flex items-center gap-2 text-foreground">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      !s.live
                        ? "bg-muted-foreground/40"
                        : s.ts && Date.now() - s.ts > 3600_000
                          ? "bg-[color:var(--rose)]"
                          : "bg-[color:var(--sage)]"
                    }`}
                  />
                  {s.name}
                </span>
                <span className="text-muted-foreground">
                  {!s.live ? "not connected" : s.ts ? relTime(new Date(s.ts).toISOString()) : "—"}
                </span>
              </div>
            ))}
            <button
              onClick={() => {
                setRefreshTick((n) => n + 1);
                setStatusOpen(false);
              }}
              className="w-full text-xs text-[color:var(--navy)] hover:underline pt-1"
            >
              Refresh all
            </button>
          </div>
        )}
      </header>

      {/* Draggable / resizable dashboard grid */}
      <div className="flex items-center justify-end gap-2 -mb-1">
        <button
          type="button"
          onClick={resetLayout}
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" /> Reset layout
        </button>
      </div>
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 768, sm: 0 }}
        cols={{ lg: 12, md: 8, sm: 1 }}
        rowHeight={40}
        margin={[16, 16]}
        containerPadding={[0, 0]}
        compactType="vertical"
        draggableHandle=".widget-drag-handle"
        draggableCancel=".no-drag"
        isDraggable={!isMobileViewport}
        isResizable={!isMobileViewport}
        onLayoutChange={onLayoutChange}
      >
        {/* CALENDAR */}
        <div key="calendar" className="relative">
          <Card
            title="Calendar"
            icon={CalendarClock}
            className="h-full overflow-auto"
            dragHandle={!locks.calendar && !isMobileViewport}
            lockId="calendar"
            locked={!!locks.calendar}
            onToggleLock={toggleLock}
            right={
              availableCalendars.length > 1 ? (
                <Select value={selectedCalendar} onValueChange={setSelectedCalendar}>
                  <SelectTrigger className="no-drag h-7 text-xs w-[140px] sm:w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All calendars</SelectItem>
                    {availableCalendars.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null
            }
          >
            <DateNav
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              isToday={selectedIsToday}
            />
            {meetingsToday.length === 0 ? (
              <EmptyState
                text={
                  selectedIsToday
                    ? "Nothing on the calendar today."
                    : "Nothing on the calendar."
                }
              />
            ) : (
              <>
                {nextMeeting && nextMeetingMinutes != null && (
                  <div className="mb-3 p-3 rounded-lg bg-[color:var(--navy)]/5 border border-[color:var(--navy)]/15">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Next in {nextMeetingMinutes}m
                    </div>
                    <div className="text-sm font-medium text-foreground truncate">
                      {nextMeeting.title || "(untitled)"}
                    </div>
                  </div>
                )}
                <ul className="space-y-1">
                  {meetingsToday.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedEvent(m)}
                        className="no-drag w-full flex items-center gap-2 text-xs text-left rounded-md px-2 min-h-[44px] sm:min-h-0 sm:py-1 hover:bg-muted transition-colors"
                      >
                        <span className="tabular-nums text-muted-foreground w-14 shrink-0">
                          {whenLabel(m.start_at)}
                        </span>
                        <span className="truncate text-foreground flex-1">
                          {m.title || "(untitled)"}
                        </span>
                        {m.video_url && (
                          <a
                            href={m.video_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="no-drag text-[color:var(--navy)] shrink-0 p-2 -m-2"
                          >
                            <Video className="h-4 w-4" />
                          </a>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>

        {/* INBOX */}
        <div key="inbox" className="relative">
          <Card
            title="Inbox"
            icon={Inbox}
            className="h-full overflow-auto"
            dragHandle={!locks.inbox && !isMobileViewport}
            lockId="inbox"
            locked={!!locks.inbox}
            onToggleLock={toggleLock}
            right={
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger className="no-drag h-7 text-xs w-[130px] sm:w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {ACCOUNTS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a.split("@")[0]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          >
            <div className="grid grid-cols-2 gap-2 mb-3">
              <BigStat value={priorityCount} label="Priority" />
              <BigStat value={needsRespCount} label="Need response" />
            </div>
            {topSenders.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">Inbox clear. ✨</p>
            ) : (
              <ul className="space-y-1.5">
                {topSenders.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center gap-2 text-xs text-foreground"
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${urgencyDot(e.received_at)}`}
                    />
                    <span className="font-medium truncate">
                      {e.sender_name || e.sender_email || "Unknown"}
                    </span>
                    <span className="text-muted-foreground ml-auto shrink-0">
                      {relTime(e.received_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* MONEY */}
        <div key="money" className="relative">
          <Card
            title="Money"
            icon={Banknote}
            info
            className="h-full overflow-auto"
            dragHandle={!locks.money && !isMobileViewport}
            lockId="money"
            locked={!!locks.money}
            onToggleLock={toggleLock}
          >
            <EmptyState text="No lead data yet. Connecting Ideafetti DB…" />
          </Card>
        </div>

        {/* TIMELINE */}
        <div key="timeline" className="relative">
          <Card
            title="Timeline"
            icon={Activity}
            className="h-full overflow-auto"
            dragHandle={!locks.timeline && !isMobileViewport}
            lockId="timeline"
            locked={!!locks.timeline}
            onToggleLock={toggleLock}
          >
            <DateNav
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              isToday={selectedIsToday}
            />
            <Timeline
              now={now}
              meetings={meetingsToday}
              showNow={selectedIsToday}
              onSelect={setSelectedEvent}
            />
          </Card>
        </div>

        {/* CONTENT PULSE */}
        <div key="content" className="relative">
          <Card
            title="Content pulse"
            icon={Sparkles}
            info
            className="h-full overflow-auto"
            dragHandle={!locks.content && !isMobileViewport}
            lockId="content"
            locked={!!locks.content}
            onToggleLock={toggleLock}
          >
            <EmptyState text="Syncing Ideafetti content data…" />
          </Card>
        </div>

        {/* PROJECTS */}
        <div key="projects" className="relative">
          <Card
            title="Projects"
            icon={FolderKanban}
            className="h-full overflow-auto"
            dragHandle={!locks.projects && !isMobileViewport}
            lockId="projects"
            locked={!!locks.projects}
            onToggleLock={toggleLock}
          >
            <ul className="space-y-3">
              {DEFAULT_PROJECTS.map((p) => {
                const stalled = p.last_touched_h > 168;
                return (
                  <li key={p.name}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-foreground flex items-center gap-2">
                        {p.name}
                        {stalled && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-[color:var(--rose)]/20 text-[color:var(--rose)]">
                            Stalled
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground">
                        {p.last_touched_h < 24
                          ? `${p.last_touched_h}h ago`
                          : `${Math.round(p.last_touched_h / 24)}d ago`}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${p.progress}%`,
                          background:
                            "linear-gradient(90deg, var(--sage), var(--navy))",
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        {/* WELLNESS */}
        <div key="wellness" className="relative">
          <Card
            title="Wellness"
            icon={TrendingUp}
            className="h-full overflow-auto"
            dragHandle={!locks.wellness && !isMobileViewport}
            lockId="wellness"
            locked={!!locks.wellness}
            onToggleLock={toggleLock}
          >
            <div className="flex items-center gap-4 mb-3">
              <Sparkline values={energySeries} />
              <div className="flex flex-col">
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  {trend === "up" && (
                    <ArrowUpRight className="h-3.5 w-3.5 text-[color:var(--sage)]" />
                  )}
                  {trend === "down" && (
                    <ArrowDownRight className="h-3.5 w-3.5 text-[color:var(--rose)]" />
                  )}
                  {trend === "flat" && <Minus className="h-3.5 w-3.5" />}
                  {trend === "none" ? "Not enough data" : `Energy ${trend}`}
                </span>
                <span className="text-xs text-muted-foreground mt-1">
                  Mood: {daily?.mood ?? "—"}
                </span>
                <span className="text-xs text-muted-foreground">
                  Logged {loggedDays}/7 days
                </span>
              </div>
            </div>
          </Card>
        </div>

        {/* FOLLOW-UPS */}
        <div key="followups" className="relative">
          <Card
            title="Follow-ups"
            icon={MessageCircle}
            className="h-full overflow-auto"
            dragHandle={!locks.followups && !isMobileViewport}
            lockId="followups"
            locked={!!locks.followups}
            onToggleLock={toggleLock}
          >
            {followUps.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">All caught up. ✨</p>
            ) : (
              <ul className="divide-y divide-border">
                {followUps.slice(0, 6).map((f) => {
                  const days = Math.floor(
                    (Date.now() - new Date(f.received_at!).getTime()) / 86400_000,
                  );
                  return (
                    <li key={f.id} className="py-2 flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground truncate">
                          {f.sender_name || f.sender_email || "Unknown"}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {f.subject || f.snippet || "(no subject)"}
                        </div>
                        <div className="text-[11px] text-[color:var(--rose)] mt-0.5">
                          {days}d waiting
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="no-drag h-9 sm:h-7 text-xs"
                        onClick={() => setEmailStatus(f.id, "read")}
                      >
                        Replied
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* BENCH */}
        <div key="bench" className="relative">
          <div
            className={`h-full overflow-auto rounded-xl border border-border bg-card p-4 sm:p-5 lg:p-6 ${
              !locks.bench && !isMobileViewport ? "" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-3 mb-2">
              <div
                className={
                  !locks.bench && !isMobileViewport
                    ? "widget-drag-handle cursor-grab active:cursor-grabbing flex-1 -m-2 p-2"
                    : "flex-1"
                }
              >
                <h2 className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Your Bench
                </h2>
              </div>
              <WidgetChrome id="bench" locked={!!locks.bench} onToggle={toggleLock} />
            </div>
            <div className="no-drag">
              <BenchRow
                context={{
                  energy: daily?.energy_level ?? null,
                  topPriority: daily?.top_priority ?? null,
                  priorityEmails: emails.filter(
                    (e) => e.kind === "priority" || e.kind === "needs_response",
                  ).length,
                  meetings: meetingsToday.length,
                }}
              />
            </div>
          </div>
        </div>
      </ResponsiveGridLayout>

      <button
        type="button"
        onClick={() => setCaptureOpen(true)}
        className="fixed bottom-20 sm:bottom-6 right-4 sm:left-6 sm:right-auto z-50 h-14 w-14 rounded-full bg-[color:var(--navy)] text-white shadow-lg flex items-center justify-center hover:opacity-90 transition"
        aria-label="Capture"
      >
        <Mic className="h-6 w-6" />
      </button>

      <DoneForToday />

      <CaptureModal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onCaptured={() => loadAll()}
      />

      <EventDetailSheet
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
}

function Card({
  title,
  icon: Icon,
  children,
  className = "",
  right,
  info = false,
  dragHandle = false,
  lockId,
  locked,
  onToggleLock,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
  right?: React.ReactNode;
  info?: boolean;
  dragHandle?: boolean;
  lockId?: WidgetId;
  locked?: boolean;
  onToggleLock?: (id: WidgetId) => void;
}) {
  const isLocked = !!locked;
  return (
    <section
      className={`group/widget rounded-xl border bg-card p-4 sm:p-5 lg:p-6 transition-colors ${
        isLocked
          ? "border-border"
          : "border-border hover:border-dotted hover:border-[color:var(--navy)]/40"
      } ${className}`}
    >
      <header
        className={`flex items-center justify-between gap-3 mb-4 ${
          dragHandle && !isLocked ? "widget-drag-handle cursor-grab active:cursor-grabbing" : ""
        }`}
      >
        <h2 className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {title}
          {info && (
            <span
              className="no-drag relative group inline-flex"
              tabIndex={0}
              aria-label="What is this?"
            >
              <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
              <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-30 w-56 rounded-md bg-foreground text-background text-[11px] font-normal normal-case tracking-normal px-2 py-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition shadow-lg">
                This panel populates when data starts flowing from Make.com. Setup is automated.
              </span>
            </span>
          )}
        </h2>
        <div className="no-drag flex items-center gap-1">
          {right}
          {lockId && onToggleLock && (
            <WidgetChrome id={lockId} locked={!!locked} onToggle={onToggleLock} />
          )}
        </div>
      </header>
      {children}
    </section>
  );
}

function WidgetChrome({
  id,
  locked,
  onToggle,
}: {
  id: WidgetId;
  locked: boolean;
  onToggle: (id: WidgetId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(id)}
      className="no-drag inline-flex items-center justify-center p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
      aria-label={locked ? "Unlock widget" : "Lock widget"}
      title={locked ? "Unlock widget" : "Lock widget"}
    >
      {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
    </button>
  );
}

function BigStat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
        {label}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="text-xs text-muted-foreground/70 italic py-6 text-center">
      {text}
    </p>
  );
}

function DateNav({
  selectedDate,
  setSelectedDate,
  isToday,
}: {
  selectedDate: Date;
  setSelectedDate: (d: Date) => void;
  isToday: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <span className="text-xs font-medium text-foreground tabular-nums">
        {dayLabel(selectedDate)}
      </span>
      <div className="flex items-center gap-1">
        {!isToday && (
          <button
            type="button"
            onClick={() => setSelectedDate(startOfDay(new Date()))}
            className="px-3 min-h-[44px] sm:min-h-0 sm:h-6 sm:px-2 rounded-md border border-border text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-muted"
          >
            Today
          </button>
        )}
        <button
          type="button"
          aria-label="Previous day"
          onClick={() => setSelectedDate(addDays(selectedDate, -1))}
          className="min-h-[44px] min-w-[44px] sm:h-6 sm:w-6 sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center rounded-md border border-border hover:bg-muted text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Next day"
          onClick={() => setSelectedDate(addDays(selectedDate, 1))}
          className="min-h-[44px] min-w-[44px] sm:h-6 sm:w-6 sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center rounded-md border border-border hover:bg-muted text-muted-foreground"
        >
          <ChevronRight className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        </button>
      </div>
    </div>
  );
}

function Timeline({
  now,
  meetings,
  showNow,
  onSelect,
}: {
  now: Date;
  meetings: CalendarEventRow[];
  showNow: boolean;
  onSelect?: (e: CalendarEventRow) => void;
}) {
  const startH = 0;
  const endH = 24;
  const totalMin = (endH - startH) * 60;
  const nowMin = (now.getHours() - startH) * 60 + now.getMinutes();
  const nowPct = Math.max(0, Math.min(100, (nowMin / totalMin) * 100));

  const hours = [];
  for (let h = startH; h <= endH; h += 3) hours.push(h);

  return (
    <div className="relative">
      {/* Horizontal scroll wrapper for mobile */}
      <div className="overflow-x-auto -mx-1 px-1 pt-5 pb-1">
        <div className="relative min-w-[640px] sm:min-w-0">
          {/* Hour grid */}
          <div className="relative h-20 rounded-lg bg-muted/40 border border-border overflow-hidden">
            {/* Hour ticks */}
            {hours.map((h) => {
              const pct = ((h - startH) / (endH - startH)) * 100;
              const display = h === 24 ? 12 : h % 12 === 0 ? 12 : h % 12;
              return (
                <div
                  key={h}
                  className="absolute top-0 bottom-0 border-l border-border/60"
                  style={{ left: `${pct}%` }}
                >
                  <span className="absolute -top-5 -translate-x-1/2 text-[10px] text-muted-foreground tabular-nums">
                    {display}
                    {h < 12 || h === 24 ? "a" : "p"}
                  </span>
                </div>
              );
            })}

            {/* Meeting blocks */}
            {meetings.map((m) => {
              if (!m.start_at) return null;
              const start = new Date(m.start_at);
              const startMin = (start.getHours() - startH) * 60 + start.getMinutes();
              let durMin = 60;
              if (m.end_at) {
                const end = new Date(m.end_at);
                durMin = Math.max(15, (end.getTime() - start.getTime()) / 60000);
              }
              if (startMin < 0 || startMin > totalMin) return null;
              const left = (startMin / totalMin) * 100;
              const width = Math.max(1, (durMin / totalMin) * 100);
              return (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => onSelect?.(m)}
                  className="absolute top-3 bottom-3 rounded-md bg-[color:var(--sage)]/40 border border-[color:var(--sage)] px-1.5 py-0.5 overflow-hidden text-left hover:bg-[color:var(--sage)]/60 transition-colors cursor-pointer"
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={m.title ?? ""}
                >
                  <span className="text-[10px] text-[color:var(--forest)] truncate block">
                    {m.title || "Mtg"}
                  </span>
                </button>
              );
            })}

            {/* Now line — anchored to the 24h grid, scrolls with it */}
            {showNow && (
              <div
                className="absolute top-0 bottom-0 w-px bg-[color:var(--rose)] z-10"
                style={{ left: `${nowPct}%` }}
              >
                <div className="absolute -top-1 -translate-x-1/2 h-2 w-2 rounded-full bg-[color:var(--rose)]" />
              </div>
            )}
          </div>
        </div>
      </div>
      {meetings.length === 0 && (
        <p className="text-xs text-muted-foreground/70 italic text-center mt-3">
          Nothing on the calendar.
        </p>
      )}
    </div>
  );
}

function Sparkline({ values }: { values: (number | null)[] }) {
  const w = 140;
  const h = 40;
  const max = 10;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * w;
    const y = v == null ? null : h - (v / max) * h;
    return { x, y };
  });
  const path = pts
    .filter((p) => p.y != null)
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y!.toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="shrink-0">
      <path
        d={path}
        fill="none"
        stroke="var(--navy)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {pts.map((p, i) =>
        p.y != null ? (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="var(--sage)" />
        ) : null,
      )}
    </svg>
  );
}

function looksLikeAddress(s: string): boolean {
  // Heuristic: contains a digit and a comma or street keyword, not a URL
  if (/^https?:\/\//i.test(s)) return false;
  return /\d/.test(s) && (/,/.test(s) || /\b(st|street|ave|avenue|rd|road|blvd|drive|dr|lane|ln|way)\b/i.test(s));
}

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

function linkify(text: string): ReactNode[] {
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) => {
    if (/^https?:\/\//i.test(part)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[color:var(--navy)] hover:underline break-words"
        >
          {part}
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function formatRange(startISO: string | null, endISO: string | null, allDay: boolean | null): string {
  if (!startISO) return "";
  const s = new Date(startISO);
  const dateLabel = s.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  if (allDay) return `${dateLabel} · All day`;
  const sT = s.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!endISO) return `${dateLabel} · ${sT}`;
  const e = new Date(endISO);
  const eT = e.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${dateLabel} · ${sT} – ${eT}`;
}

function responseBadgeClass(status: string | undefined): string {
  switch ((status ?? "").toLowerCase()) {
    case "accepted":
      return "bg-[color:var(--sage)]/25 text-[color:var(--forest)] border-[color:var(--sage)]/50";
    case "tentative":
      return "bg-[color:var(--yellow)]/25 text-foreground border-[color:var(--yellow)]/50";
    case "declined":
      return "bg-[color:var(--rose)]/20 text-[color:var(--rose)] border-[color:var(--rose)]/40";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function responseLabel(status: string | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s === "accepted") return "Accepted";
  if (s === "tentative") return "Tentative";
  if (s === "declined") return "Declined";
  return "No response";
}

function EventDetailSheet({
  event,
  onClose,
}: {
  event: CalendarEventRow | null;
  onClose: () => void;
}) {
  const open = event !== null;
  const isMobile = useIsMobile();
  const side = isMobile ? "bottom" : "right";
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side={side}
        className={
          side === "bottom"
            ? "max-h-[85vh] overflow-y-auto rounded-t-xl"
            : "w-full sm:max-w-md overflow-y-auto"
        }
      >
        {event && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="text-xl">
                {event.title || "(untitled)"}
              </SheetTitle>
              <SheetDescription className="text-sm">
                {formatRange(event.start_at, event.end_at, event.is_all_day)}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-5 text-sm">
              {event.location && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Location
                  </div>
                  {/^https?:\/\//i.test(event.location) ? (
                    <a
                      href={event.location}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center min-h-[44px] py-2 text-[color:var(--navy)] hover:underline break-all"
                    >
                      {event.location}
                    </a>
                  ) : looksLikeAddress(event.location) ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center min-h-[44px] py-2 text-[color:var(--navy)] hover:underline break-words"
                    >
                      {event.location}
                    </a>
                  ) : (
                    <p className="text-foreground break-words">{event.location}</p>
                  )}
                </div>
              )}

              {event.video_url && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Video
                  </div>
                  <a
                    href={event.video_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-md bg-[color:var(--navy)] text-[color:var(--paper)] hover:opacity-90 transition-opacity font-medium"
                  >
                    <Video className="h-4 w-4 shrink-0" />
                    Join meeting
                  </a>
                </div>
              )}

              {event.organizer_email && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Organizer
                  </div>
                  <a
                    href={`mailto:${event.organizer_email}`}
                    className="inline-flex items-center min-h-[44px] py-2 text-[color:var(--navy)] hover:underline break-all"
                  >
                    {event.organizer_email}
                  </a>
                </div>
              )}

              {event.description && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Description
                  </div>
                  <p className="text-foreground whitespace-pre-wrap break-words">
                    {linkify(event.description)}
                  </p>
                </div>
              )}

              {event.attendees && event.attendees.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                    Attendees ({event.attendees.length})
                  </div>
                  <ul className="space-y-1.5">
                    {event.attendees.map((a, i) => (
                      <li
                        key={`${a.email ?? a.name ?? "x"}-${i}`}
                        className="flex items-center gap-2 justify-between"
                      >
                        <span className="text-foreground truncate">
                          {a.name || a.email || "Unknown"}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] shrink-0 ${responseBadgeClass(a.response_status)}`}
                        >
                          {responseLabel(a.response_status)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
