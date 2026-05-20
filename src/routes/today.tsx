import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Responsive, WidthProvider, type LayoutItem, type ResponsiveLayouts } from "react-grid-layout/legacy";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { useIsMobile } from "@/hooks/use-mobile";
import { DoneForToday } from "@/components/DoneForToday";
import { CaptureModal } from "@/components/CaptureModal";

import { BenchWidget } from "@/components/widgets/bench";
import { BenchWhispersWidget } from "@/components/widgets/bench_whispers";
import { MorningBriefWidget } from "@/components/widgets/morning_brief";
import { PipelineWidget } from "@/components/widgets/pipeline";
import { usePersonalization, isDarkColor } from "@/lib/personalization";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ACTIVE_WIDGETS_KEY,
  DEFAULT_ACTIVE_WIDGETS,
  AUTO_APPEND_WIDGETS,
  AUTO_APPEND_KEY,
  AUTO_REMOVE_WIDGETS,
  AUTO_REMOVE_KEY,
  DEFAULT_WIDGET_SIZE,
  defaultSizeFor,
} from "@/config/widgets";
import { WidgetLibrarySheet } from "@/components/WidgetLibrarySheet";
import { TopPriorityWidget } from "@/components/widgets/top_priority";
import { VoiceCaptureWidget } from "@/components/widgets/voice_capture";
import { DoneTodayWidget } from "@/components/widgets/done_today";
import { FollowUpsWidget } from "@/components/widgets/follow_ups";
import { TimersAlarmsWidget } from "@/components/widgets/timers_alarms";
import { TimersAlarmsMenu } from "@/components/header/TimersAlarmsMenu";
import { KitchenRecipesWidget } from "@/components/widgets/kitchen_recipes";
import { MoneyWidget } from "@/components/widgets/money";
import { ProjectsWidget } from "@/components/widgets/projects";
import { ContentPulseWidget } from "@/components/widgets/content_pulse";
import { WorkflowsWidget } from "@/components/widgets/workflows";
import { ACCOUNTS } from "@/config/accounts";
import { relTime, whenLabel } from "@/lib/time";
import { fetchCalendarEvents } from "@/lib/google-calendar";
import { refreshGmail } from "@/lib/google-gmail";
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
  Briefcase,
  FolderKanban,
  MessageCircle,
  Activity,
  AlarmClock,
  ChefHat,
  RefreshCw,
  Info,
  ChevronLeft,
  ChevronRight,
  Lock,
  LockOpen,
  GripVertical,
  RotateCcw,
  Plus,
  Pencil,
  X,
  LayoutGrid,
  Users,
} from "lucide-react";

const ResponsiveGridLayout = WidthProvider(Responsive);

// ----- Dashboard layout -----
type WidgetId =
  | "calendar"
  | "inbox"
  | "money"
  | "timeline"
  | "content_pulse"
  | "projects"
  | "follow_ups"
  | "bench"
  | "top_priority"
  | "voice_capture"
  | "bench_whispers"
  | "morning_brief"
  | "pipeline"
  | "timers_alarms"
  | "kitchen_recipes"
  | "workflows"
  | "workflows_exec_os"
  | "done_today";

// Clean non-overlapping layout. y values stack cleanly so react-grid-layout
// doesn't auto-shift things into the next free row creating huge gaps.
// Top of screen — Workflow + Calendar/Inbox stack (the action layer).
// Then Timeline strip. Then Money/Projects/ContentPulse trio. Then
// Follow-ups + Bench Whispers row. Then Bench (advisors). Then
// Timers + Kitchen. Voice/Done/TopPriority kept for users who re-enable.
// Heights right-sized to fit each widget's DEFAULT content (empty / day-one
// state) without internal scroll. Widgets with overflow-auto on their list
// container only scroll once Donna adds enough rows to warrant it.
// rowHeight = 40px, margin = 16px between rows. Pixel height of h=N is
// (N*40) + ((N-1)*16). Reference: h=4 ≈ 208px, h=5 ≈ 264px, h=6 ≈ 320px,
// h=7 ≈ 376px, h=8 ≈ 432px.
const LG_BASE: LayoutItem[] = [
  { i: "workflows",        x: 0,  y: 0,  w: 6,  h: 8, minW: 4, minH: 6 },
  { i: "workflows_exec_os",x: 6,  y: 0,  w: 6,  h: 8, minW: 4, minH: 6 },
  { i: "pipeline",         x: 0,  y: 8,  w: 12, h: 8, minW: 6, minH: 6 },
  { i: "morning_brief",    x: 0,  y: 16, w: 12, h: 7, minW: 6, minH: 5 },
  { i: "calendar",         x: 0,  y: 23, w: 6,  h: 5, minW: 3, minH: 4 },
  { i: "inbox",            x: 6,  y: 8,  w: 6,  h: 3, minW: 3, minH: 3 },
  { i: "done_today",       x: 0,  y: 13, w: 12, h: 6, minW: 6, minH: 4 },
  { i: "money",           x: 0,  y: 19, w: 4,  h: 5, minW: 3, minH: 4 },
  { i: "projects",        x: 4,  y: 19, w: 4,  h: 5, minW: 3, minH: 4 },
  { i: "content_pulse",   x: 8,  y: 19, w: 4,  h: 5, minW: 3, minH: 4 },
  { i: "follow_ups",      x: 0,  y: 24, w: 6,  h: 5, minW: 3, minH: 4 },
  { i: "bench_whispers",  x: 6,  y: 24, w: 6,  h: 5, minW: 3, minH: 4 },
  { i: "bench",           x: 0,  y: 29, w: 12, h: 4, minW: 6, minH: 4 },
  { i: "timers_alarms",   x: 0,  y: 33, w: 6,  h: 5, minW: 3, minH: 4 },
  { i: "kitchen_recipes", x: 6,  y: 33, w: 6,  h: 6, minW: 3, minH: 5 },
  { i: "top_priority",    x: 0,  y: 39, w: 12, h: 3, minW: 4, minH: 2 },
  { i: "voice_capture",   x: 0,  y: 42, w: 4,  h: 4, minW: 3, minH: 3 },
  { i: "timeline",        x: 4,  y: 42, w: 8,  h: 4, minW: 6, minH: 3 },
];

const MD_BASE: LayoutItem[] = [
  { i: "workflows",        x: 0,  y: 0,  w: 8,  h: 8, minW: 4, minH: 6 },
  { i: "workflows_exec_os",x: 0,  y: 8,  w: 8,  h: 8, minW: 4, minH: 6 },
  { i: "calendar",         x: 0,  y: 16, w: 8,  h: 5, minW: 3, minH: 4 },
  { i: "inbox",            x: 0,  y: 21, w: 8,  h: 3, minW: 3, minH: 3 },
  { i: "done_today",       x: 0,  y: 24, w: 8,  h: 6, minW: 4, minH: 4 },
  { i: "money",            x: 0,  y: 30, w: 4,  h: 5, minW: 3, minH: 4 },
  { i: "projects",         x: 4,  y: 30, w: 4,  h: 5, minW: 3, minH: 4 },
  { i: "content_pulse",    x: 0,  y: 35, w: 4,  h: 5, minW: 3, minH: 4 },
  { i: "follow_ups",       x: 4,  y: 35, w: 4,  h: 5, minW: 3, minH: 4 },
  { i: "bench_whispers",   x: 0,  y: 40, w: 8,  h: 5, minW: 3, minH: 4 },
  { i: "bench",            x: 0,  y: 45, w: 8,  h: 4, minW: 4, minH: 4 },
  { i: "timers_alarms",    x: 0,  y: 49, w: 4,  h: 5, minW: 3, minH: 4 },
  { i: "kitchen_recipes",  x: 4,  y: 49, w: 4,  h: 6, minW: 3, minH: 5 },
  { i: "top_priority",     x: 0,  y: 55, w: 8,  h: 3, minW: 4, minH: 2 },
  { i: "voice_capture",    x: 0,  y: 58, w: 4,  h: 4, minW: 3, minH: 3 },
  { i: "timeline",         x: 0,  y: 62, w: 8,  h: 4, minW: 4, minH: 3 },
];

const MOBILE_ORDER: WidgetId[] = [
  "top_priority",
  "workflows",
  "workflows_exec_os",
  "done_today",
  "inbox",
  "calendar",
  "money",
  "content_pulse",
  "projects",
  "follow_ups",
  "bench",
  "timers_alarms",
  "kitchen_recipes",
  "voice_capture",
  "timeline",
];

function stackedLayout(cols: number): LayoutItem[] {
  let y = 0;
  const out: LayoutItem[] = [];
  for (const id of MOBILE_ORDER) {
    const base = LG_BASE.find((l) => l.i === id);
    // If a widget id is in MOBILE_ORDER but missing from LG_BASE (config
    // drift), skip it instead of crashing the mobile render path.
    if (!base) continue;
    const h = base.h ?? 4;
    out.push({ i: id, x: 0, y, w: cols, h, minW: 1, minH: base.minH });
    y += h;
  }
  return out;
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

// Bumped to v4 on 2026-05-18 — header restructured + appointment timeline
// dropped from the default grid in favor of a real productivity-log
// (done_today) widget. Wiping the saved layout so the new defaults apply.
const DASHBOARD_KEY = "execOs.dashboardLayout.v5";

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
    return null;
  } catch {
    return null;
  }
}

// One-time migration that ensures saved widgets are at least as large as
// the current DEFAULT_WIDGET_SIZE. Won't shrink anything the user manually
// enlarged. Bump SIZE_FLOOR_KEY whenever DEFAULT_WIDGET_SIZE changes so
// existing users pick up the new floor on next load.
const SIZE_FLOOR_KEY = "execOs.dashboard.sizeFloor.v8";

// Floor migration: any layout entry whose w/h is below the catalog's
// DEFAULT_WIDGET_SIZE gets bumped to that floor. Plus: if the entry looks
// "auto-placed" (1x1 cell that react-grid-layout filled in for an active
// widget with no saved layout — the projects/content_pulse bug from v4),
// we also reposition it to the bottom so the user doesn't have to hunt for
// it in the middle of the grid.
function applySizeFloor(arr: LayoutItem[] | undefined, cols: number): LayoutItem[] | undefined {
  if (!arr) return arr;
  // First pass: compute current maxY so we can stack auto-placed widgets after it.
  let cursorY = arr.reduce((m, l) => Math.max(m, l.y + l.h), 0);
  return arr.map((l) => {
    const def = DEFAULT_WIDGET_SIZE[l.i];
    if (!def) return l;
    const wFloor = Math.min(def.w, cols);
    const w = Math.max(l.w, wFloor);
    const h = Math.max(l.h, def.h);
    const wasOrphan = cols > 1 && l.w <= 1 && l.h <= 1;
    if (w === l.w && h === l.h && !wasOrphan) return l;
    if (wasOrphan) {
      const next = { ...l, w, h, x: 0, y: cursorY };
      cursorY += h;
      return next;
    }
    return { ...l, w, h };
  });
}

function loadLayouts(): ResponsiveLayouts | null {
  const d = loadDashboard();
  if (!d) return null;
  if (!d.lg && !d.md && !d.sm) return null;

  if (typeof window !== "undefined" && !localStorage.getItem(SIZE_FLOOR_KEY)) {
    const next: DashboardPersisted = {
      ...d,
      lg: applySizeFloor(d.lg, 12),
      md: applySizeFloor(d.md, 8),
      sm: applySizeFloor(d.sm, 1),
    };
    try {
      localStorage.setItem(DASHBOARD_KEY, JSON.stringify(next));
      localStorage.setItem(SIZE_FLOOR_KEY, "1");
    } catch {}
    return { lg: next.lg, md: next.md, sm: next.sm } as ResponsiveLayouts;
  }

  return { lg: d.lg, md: d.md, sm: d.sm } as ResponsiveLayouts;
}

function loadActiveWidgets(): string[] {
  if (typeof window === "undefined") return DEFAULT_ACTIVE_WIDGETS;
  try {
    const raw = localStorage.getItem(ACTIVE_WIDGETS_KEY);
    if (!raw) return DEFAULT_ACTIVE_WIDGETS;
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) return DEFAULT_ACTIVE_WIDGETS;
    let active = parsed;
    // One-time auto-remove of dead/deprecated widgets. Runs once per
    // AUTO_REMOVE_KEY bump. See AUTO_REMOVE_WIDGETS comments in widgets.ts.
    if (!localStorage.getItem(AUTO_REMOVE_KEY)) {
      const toRemove = new Set(AUTO_REMOVE_WIDGETS);
      const cleaned = active.filter((id) => !toRemove.has(id));
      if (cleaned.length !== active.length) {
        active = cleaned;
        try { localStorage.setItem(ACTIVE_WIDGETS_KEY, JSON.stringify(active)); } catch {}
      }
      try { localStorage.setItem(AUTO_REMOVE_KEY, "1"); } catch {}
    }
    // One-time auto-append for widgets added in later releases. AUTO_APPEND_KEY
    // is bumped in src/config/widgets.ts whenever AUTO_APPEND_WIDGETS gains an
    // entry, which re-runs this block once for users past the previous key.
    if (!localStorage.getItem(AUTO_APPEND_KEY)) {
      const missing = AUTO_APPEND_WIDGETS.filter((id) => !active.includes(id));
      if (missing.length > 0) {
        active = [...active, ...missing];
        try { localStorage.setItem(ACTIVE_WIDGETS_KEY, JSON.stringify(active)); } catch {}
      }
      try { localStorage.setItem(AUTO_APPEND_KEY, "1"); } catch {}
    }
    return active;
  } catch {
    return DEFAULT_ACTIVE_WIDGETS;
  }
}
function saveActiveWidgets(ids: string[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(ACTIVE_WIDGETS_KEY, JSON.stringify(ids)); } catch {}
}
// Default-lock migration: widgets used to default to unlocked, which made
// the dashboard feel like a draggable construction zone on every load.
// Donna asked for locked-by-default with explicit unlock when she wants to
// rearrange. This runs once per user.
const DEFAULT_LOCKS_KEY = "execOs.defaultLocks.v1";

function defaultAllLocked(activeIds: string[]): Record<string, boolean> {
  return Object.fromEntries(activeIds.map((id) => [id, true]));
}

function loadLocks(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  const saved = loadDashboard()?.locked;
  if (!localStorage.getItem(DEFAULT_LOCKS_KEY)) {
    // One-time: replace whatever's there with all-locked. The locks map
    // pre-migration was almost always empty (= all unlocked).
    try { localStorage.setItem(DEFAULT_LOCKS_KEY, "1"); } catch {}
    // Use the union of currently-active widgets + defaults so the migration
    // catches whatever the user actually has on screen right now.
    const active = (() => {
      try {
        const raw = localStorage.getItem(ACTIVE_WIDGETS_KEY);
        const parsed = raw ? (JSON.parse(raw) as string[]) : null;
        return Array.isArray(parsed) ? parsed : DEFAULT_ACTIVE_WIDGETS;
      } catch {
        return DEFAULT_ACTIVE_WIDGETS;
      }
    })();
    return defaultAllLocked(active);
  }
  return saved ?? {};
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

// ACCOUNTS moved to src/config/accounts.ts (imported above) to stop the
// three-place duplication called out in the audit.

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
  top_priority_done: boolean | null;
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

// relTime + whenLabel moved to src/lib/time.ts (single source of truth).

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

// PROJECTS used to ship with five hardcoded fake rows (Ideafetti 62%, AI Lead
// 38%, etc.) displayed to the user as if real. Removed — the widget now
// renders an honest "needs setup" empty state until a real backing source
// (Ideafetti DB, exec_os_projects table, etc.) is wired in.

function TodayPage() {
  // Live clock — minute-aligned, self-correcting, and resyncs on tab focus.
  // The header shows minute-precision time; we want it to flip exactly when
  // the minute rolls over, not up-to-30s late.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const scheduleNextTick = () => {
      const ms = Date.now();
      const msUntilNextMinute = 60_000 - (ms % 60_000) + 50; // +50ms safety
      timeoutId = setTimeout(() => {
        setNow(new Date());
        scheduleNextTick(); // re-arm — self-correcting drift
      }, msUntilNextMinute);
    };

    // Hard refresh whenever the tab regains focus — covers the browser
    // setInterval-throttling-when-backgrounded case where the timer can stall
    // for 1+ minutes and the clock appears frozen.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setNow(new Date());
        if (timeoutId) clearTimeout(timeoutId);
        scheduleNextTick();
      }
    };

    scheduleNextTick();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, []);

  const { user } = useAuth();
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [emailsLoadedAt, setEmailsLoadedAt] = useState<number | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventRow[]>([]);
  const [calendarLoadedAt, setCalendarLoadedAt] = useState<number | null>(null);
  const [daily, setDaily] = useState<DailyRow | null>(null);
  const [dailyLoadedAt, setDailyLoadedAt] = useState<number | null>(null);
  const [editingTopPriority, setEditingTopPriority] = useState(false);
  const [topPriorityDraft, setTopPriorityDraft] = useState("");
  const [todayRevenueCents, setTodayRevenueCents] = useState<number | null>(null);
  const [lastDoneTask, setLastDoneTask] = useState<{ title: string; completed_at: string } | null>(null);
  // Real per-source liveness: last record timestamp from each table, plus
  // a row count. Drives the Data Fresh popover so it shows when the upstream
  // integration last actually wrote data, not when we last queried.
  const [sourceHealth, setSourceHealth] = useState<Record<string, { lastAt: string | null; count: number }>>({});

  const upsertDailyToday = useCallback(
    async (patch: Partial<Omit<DailyRow, "entry_date">>) => {
      if (!user) return;
      const entry_date = new Date().toISOString().slice(0, 10);
      // Optimistic local update so the UI updates instantly.
      setDaily((cur) => ({
        entry_date,
        energy_level: cur?.energy_level ?? null,
        mood: cur?.mood ?? null,
        top_priority: cur?.top_priority ?? null,
        top_priority_done: cur?.top_priority_done ?? false,
        ...patch,
      }));
      // Cast to any until Supabase types are regenerated to include
      // top_priority_done (added by migration 20260517150000_top_priority_done.sql).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("exec_os_daily")
        .upsert(
          { user_id: user.id, entry_date, ...patch },
          { onConflict: "user_id,entry_date" },
        );
      if (error) {
        toast.error("Couldn't save", { description: error.message });
      } else {
        setDailyLoadedAt(Date.now());
      }
    },
    [user],
  );

  const startEditTopPriority = useCallback(() => {
    setTopPriorityDraft(daily?.top_priority ?? "");
    setEditingTopPriority(true);
  }, [daily?.top_priority]);

  const commitTopPriority = useCallback(() => {
    const next = topPriorityDraft.trim() || null;
    if (next !== (daily?.top_priority ?? null)) {
      // Setting a new priority resets the done state — different priority, fresh check.
      void upsertDailyToday({ top_priority: next, top_priority_done: false });
    }
    setEditingTopPriority(false);
  }, [topPriorityDraft, daily?.top_priority, upsertDailyToday]);

  const toggleTopPriorityDone = useCallback(() => {
    if (!daily?.top_priority) return;
    void upsertDailyToday({ top_priority_done: !daily.top_priority_done });
  }, [daily?.top_priority, daily?.top_priority_done, upsertDailyToday]);
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
    return window.localStorage.getItem("execOs.today.selectedCalendar.v1") || "all";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("execOs.today.selectedCalendar.v1", selectedCalendar);
  }, [selectedCalendar]);

  // Manual calendar refresh — triggers the Make.com calendar-sync scenarios
  // via the refresh-calendars edge function. Useful when an event was just
  // added/changed in Google Calendar and we don't want to wait for the
  // daily 5am cron pull.
  const [refreshing, setRefreshing] = useState(false);
  // Manual refresh — re-pulls calendar + Gmail live and reloads all dashboard
  // state. Replaces the old Make.com-trigger path (refresh-calendars edge
  // function firing scenario webhooks), which has been dead since 2026-05-19.
  // Both data sources now flow through our own OAuth-backed edge functions:
  //   - fetchCalendarEvents → live Google Calendar
  //   - refreshGmail → fetch-gmail-emails edge fn upserts to exec_os_emails
  // loadAll() handles the rest (revenue, daily, lastDone, etc).
  const refreshCalendars = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // Kick off Gmail refresh first (fire-and-forget — its writes flow in via
      // realtime). Calendar live-fetch happens inside loadAll().
      void refreshGmail();
      await loadAllRef.current?.();
      toast.success("Synced calendar + Gmail.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  // Stable ref to loadAll so the refreshCalendars callback can reach it even
  // though loadAll is declared later in this component. Avoids the "cannot
  // access before initialization" issue with useCallback ordering.
  const loadAllRef = useRef<(() => Promise<void>) | null>(null);

  // Dashboard grid layout state
  //
  // H-2 + H-12 (AUDIT.md): persistence is now a *derived sink*. The previous
  // implementation had 4+ places calling saveDashboard(...) — sometimes
  // inside a setLayouts updater (where it ran during render commit),
  // sometimes against `loadLocks()` (re-reading from disk), sometimes
  // against in-memory `locks`. localStorage could mismatch React state.
  // Single persistence effect below is the only writer.
  const isMobileViewport = useIsMobile();
  const [locks, setLocks] = useState<Record<string, boolean>>(() => loadLocks());
  const [layouts, setLayouts] = useState<ResponsiveLayouts>(() => loadLayouts() ?? buildLayouts(loadLocks()));

  // The single source of persistence. Runs after every commit that changes
  // layouts or locks. No other code path writes to DASHBOARD_KEY.
  useEffect(() => {
    saveDashboard(layouts, locks);
  }, [layouts, locks]);

  // Sync the `static` flag on each layout item from locks. react-grid-layout
  // reads this off the layout objects, so locks need to be reflected there.
  useEffect(() => {
    setLayouts((cur) => {
      const next: ResponsiveLayouts = { ...cur };
      (Object.keys(next) as (keyof ResponsiveLayouts)[]).forEach((bp) => {
        const arr = next[bp];
        if (arr) next[bp] = arr.map((l) => ({ ...l, static: !!locks[l.i] }));
      });
      return next;
    });
  }, [locks]);

  const onLayoutChange = useCallback((_layout: readonly LayoutItem[], all: ResponsiveLayouts) => {
    setLayouts(all);
  }, []);
  const toggleLock = useCallback((id: WidgetId) => {
    setLocks((cur) => ({ ...cur, [id]: !cur[id] }));
  }, []);
  // If any active widget is currently UNLOCKED, the next press locks
  // everything. If all are locked, the next press unlocks everything.
  // Reads activeWidgets via the activeWidgetsRef declared further down so it
  // doesn't need to live in the dependency list.
  const toggleAllLocks = useCallback(() => {
    setLocks((cur) => {
      const ids = activeWidgetsRef.current;
      const anyUnlocked = ids.some((id) => !cur[id]);
      const next: Record<string, boolean> = { ...cur };
      ids.forEach((id) => { next[id] = anyUnlocked; });
      toast.success(anyUnlocked ? "All widgets locked" : "All widgets unlocked");
      return next;
    });
  }, []);
  const resetLayout = useCallback(() => {
    const ok = typeof window !== "undefined"
      ? window.confirm("Reset dashboard layout? This will undo all drag, resize, and lock customizations.")
      : true;
    if (!ok) return;
    setLocks({});
    setLayouts(buildLayouts({}));
    toast.success("Dashboard layout reset");
  }, []);

  // Active widgets + edit mode + library sheet
  const [activeWidgets, setActiveWidgets] = useState<string[]>(() => loadActiveWidgets());
  const [editMode, setEditMode] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  useEffect(() => { saveActiveWidgets(activeWidgets); }, [activeWidgets]);
  // Derived: are all currently-active widgets locked? Drives the toolbar
  // toggle's icon (LockOpen → "lock all", Lock → "unlock all"). The
  // activeWidgetsRef sync happens further down (same ref reused by
  // removeWidget); no need to duplicate.
  const allLocked = useMemo(
    () => activeWidgets.length > 0 && activeWidgets.every((id) => !!locks[id]),
    [activeWidgets, locks],
  );

  // Sync: any active widget that doesn't have a layout entry in lg/md/sm
  // gets one appended at the bottom (maxY) with its DEFAULT_WIDGET_SIZE.
  // Without this, react-grid-layout would assign 1×1 cells to orphaned IDs
  // (which is what happened to projects/content_pulse on first load after
  // auto-append shipped them as new defaults).
  useEffect(() => {
    setLayouts((cur) => {
      if (!cur) return cur;
      let changed = false;
      const next: ResponsiveLayouts = { ...cur };
      (["lg", "md", "sm"] as const).forEach((bp) => {
        const arr = next[bp] ? [...next[bp]!] : [];
        const cols = bp === "lg" ? 12 : bp === "md" ? 8 : 1;
        const have = new Set(arr.map((l) => l.i));
        activeWidgets.forEach((id) => {
          if (have.has(id)) return;
          const size = defaultSizeFor(id);
          const maxY = arr.reduce((m, l) => Math.max(m, l.y + l.h), 0);
          const w = bp === "sm" ? 1 : Math.min(size.w, cols);
          // minW/minH must match the widget's intended size — react-grid-layout
          // will otherwise compact new widgets into 1×1 tiles on first load.
          // Per memory rule: widgets must ship at full size from day one.
          const minW = bp === "sm" ? 1 : Math.max(3, Math.min(size.w - 2, cols));
          const minH = Math.max(3, size.h - 2);
          arr.push({ i: id, x: 0, y: maxY, w, h: size.h, minW, minH });
          changed = true;
        });
        if (changed) next[bp] = arr;
      });
      return changed ? next : cur;
    });
  }, [activeWidgets]);

  const addWidget = useCallback((id: string) => {
    setActiveWidgets((cur) => (cur.includes(id) ? cur : [...cur, id]));
    // New widgets default to locked, matching the dashboard-wide default.
    // User can unlock from the widget header if they want to move/resize.
    setLocks((cur) => (cur[id] === undefined ? { ...cur, [id]: true } : cur));
    setLayouts((cur) => {
      const size = defaultSizeFor(id);
      const next: ResponsiveLayouts = { ...cur };
      (Object.keys(next) as (keyof ResponsiveLayouts)[]).forEach((bp) => {
        const arr = next[bp] ? [...next[bp]!] : [];
        if (arr.find((l) => l.i === id)) { next[bp] = arr; return; }
        const maxY = arr.reduce((m, l) => Math.max(m, l.y + l.h), 0);
        const cols = bp === "lg" ? 12 : bp === "md" ? 8 : 1;
        const w = bp === "sm" ? 1 : Math.min(size.w, cols);
        const minW = bp === "sm" ? 1 : Math.max(3, Math.min(size.w - 2, cols));
        const minH = Math.max(3, size.h - 2);
        arr.push({ i: id, x: 0, y: maxY, w, h: size.h, minW, minH });
        next[bp] = arr;
      });
      return next;
    });
    toast.success(`Added ${id.replace(/_/g, " ").toUpperCase()}`);
  }, []);

  // Refs hold the current committed state so removeWidget can snapshot
  // synchronously before issuing the two setState calls. The previous
  // implementation captured `prevActive`/`prevLayouts` from inside two
  // separate setState callbacks; under concurrent renders or StrictMode
  // the toast's Undo could restore stale state. Refs are updated by the
  // effects below to stay in sync with React's committed state.
  const activeWidgetsRef = useRef<string[]>([]);
  const layoutsRef = useRef<ResponsiveLayouts | null>(null);
  useEffect(() => { activeWidgetsRef.current = activeWidgets; }, [activeWidgets]);
  useEffect(() => { layoutsRef.current = layouts; }, [layouts]);

  const removeWidget = useCallback((id: string) => {
    const prevActive = activeWidgetsRef.current;
    const prevLayouts = layoutsRef.current;
    setActiveWidgets((cur) => cur.filter((x) => x !== id));
    setLayouts((cur) => {
      const next: ResponsiveLayouts = { ...cur };
      (Object.keys(next) as (keyof ResponsiveLayouts)[]).forEach((bp) => {
        const arr = next[bp];
        if (arr) next[bp] = arr.filter((l) => l.i !== id);
      });
      return next;
    });
    toast(`Removed ${id.replace(/_/g, " ").toUpperCase()}`, {
      action: {
        label: "Undo",
        onClick: () => {
          setActiveWidgets(prevActive);
          if (prevLayouts) setLayouts(prevLayouts);
        },
      },
      duration: 5000,
    });
  }, []);

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
    const todayStr = new Date().toISOString().slice(0, 10);

    const dayStart = startOfDay(selectedDate);
    const dayEnd = addDays(dayStart, 1);

    // Today's revenue rows for the header tile — silently ignore the
    // "table doesn't exist" error so this doesn't break the dashboard if
    // exec_os_revenue hasn't been migrated yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const revenuePromise = (supabase as any)
      .from("exec_os_revenue")
      .select("amount_cents")
      .eq("user_id", user.id)
      .eq("entry_date", todayStr);

    // Most-recent task closed today — drives the "Last done" header strip.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lastDonePromise = (supabase as any)
      .from("exec_os_workflow_tasks")
      .select("title, completed_at")
      .eq("status", "done")
      .gte("completed_at", dayStart.toISOString())
      .lt("completed_at", dayEnd.toISOString())
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Kick off Gmail refresh in parallel with everything else. The edge
    // function upserts to exec_os_emails by external_id, so even if it's
    // still running when we read the table below, the previous refresh's
    // rows are still there. On the NEXT load they're current. This avoids
    // a 1–3s blocking wait on every load.
    //
    // The promise is fire-and-forget on this load — we don't await it before
    // the table read. The realtime channel below will push the new rows in
    // once they land.
    refreshGmail()
      .then((r) => {
        if (!r.ok && r.errorCode && r.errorCode !== "not_connected") {
          // Don't spam the user with toasts for "not connected" — Settings
          // page surfaces that. But scope_missing / refresh_failed deserve a
          // one-time notice so Donna knows to fix it.
          console.warn("Gmail refresh failed:", r.errorCode, r.error);
        }
      })
      .catch((e) => console.warn("Gmail refresh threw:", e));

    const [emailsRes, dailyRes, weekRes, calRes, revRes, lastDoneRes] = await Promise.all([
      supabase
        .from("exec_os_emails")
        .select(
          "id,account,kind,sender_name,sender_email,subject,snippet,received_at,scheduled_at,attendees,video_url,status",
        )
        .eq("user_id", user.id),
      // Today's daily row only — pills must reflect TODAY, not the most-recent
      // row ever written (which was a long-running bug that froze pills on
      // onboarding day's data).
      supabase
        .from("exec_os_daily")
        .select("energy_level,mood,top_priority,top_priority_done,entry_date")
        .eq("user_id", user.id)
        .eq("entry_date", todayStr)
        .maybeSingle(),
      supabase
        .from("exec_os_daily")
        .select("entry_date,energy_level")
        .eq("user_id", user.id)
        .gte("entry_date", sevenAgoStr)
        .order("entry_date", { ascending: true }),
      // Live Google Calendar read (server-side OAuth — replaces the
      // Make.com → exec_os_calendar_events pipeline that was paused
      // 2026-05-19 after Single-Events recurrence expansion bug).
      // Returns the same shape as the old supabase query so downstream
      // code (setCalendarEvents, sorting, filtering) is unchanged.
      fetchCalendarEvents({
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
      }).then((r) => ({
        data: r.events,
        error: r.error ? { message: r.error } : null,
      })),
      revenuePromise,
      lastDonePromise,
    ]);

    setEmails((emailsRes.data as EmailRow[]) ?? []);
    setEmailsLoadedAt(Date.now());
    setDaily((dailyRes.data as unknown as DailyRow) ?? null);
    setDailyLoadedAt(Date.now());
    setCalendarEvents((calRes.data as CalendarEventRow[]) ?? []);
    setCalendarLoadedAt(Date.now());
    // Sum today's revenue. Swallow "table missing" silently — header tile
    // gracefully degrades to $0 until the migration lands.
    if (revRes && !revRes.error) {
      const rows = (revRes.data ?? []) as { amount_cents: number }[];
      setTodayRevenueCents(rows.reduce((s, r) => s + (r.amount_cents ?? 0), 0));
    } else {
      setTodayRevenueCents(null);
    }

    if (lastDoneRes && !lastDoneRes.error && lastDoneRes.data) {
      const r = lastDoneRes.data as { title: string; completed_at: string };
      setLastDoneTask({ title: r.title, completed_at: r.completed_at });
    } else {
      setLastDoneTask(null);
    }

    // Per-source liveness — last-record timestamp + count, used by the
    // header status popover. Each query: 1 row max, head=true for count.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const healthQueries: Record<string, Promise<{ lastAt: string | null; count: number }>> = {
      emails: (async () => {
        const last = await sb.from("exec_os_emails").select("received_at").order("received_at", { ascending: false }).limit(1).maybeSingle();
        const total = await sb.from("exec_os_emails").select("*", { count: "exact", head: true });
        return { lastAt: (last.data?.received_at as string | undefined) ?? null, count: total.count ?? 0 };
      })(),
      calendar: (async () => {
        const last = await sb.from("exec_os_calendar_events").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
        const total = await sb.from("exec_os_calendar_events").select("*", { count: "exact", head: true });
        return { lastAt: (last.data?.created_at as string | undefined) ?? null, count: total.count ?? 0 };
      })(),
      daily: (async () => {
        const last = await sb.from("exec_os_daily").select("entry_date").eq("user_id", user.id).order("entry_date", { ascending: false }).limit(1).maybeSingle();
        const total = await sb.from("exec_os_daily").select("*", { count: "exact", head: true });
        return { lastAt: (last.data?.entry_date as string | undefined) ?? null, count: total.count ?? 0 };
      })(),
      revenue: (async () => {
        const last = await sb.from("exec_os_revenue").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
        const total = await sb.from("exec_os_revenue").select("*", { count: "exact", head: true });
        return { lastAt: (last.data?.created_at as string | undefined) ?? null, count: total.count ?? 0 };
      })(),
      content: (async () => {
        const last = await sb.from("exec_os_content").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
        const total = await sb.from("exec_os_content").select("*", { count: "exact", head: true });
        return { lastAt: (last.data?.created_at as string | undefined) ?? null, count: total.count ?? 0 };
      })(),
    };
    const healthEntries = await Promise.all(
      Object.entries(healthQueries).map(async ([k, p]) => {
        try { return [k, await p] as const; }
        catch { return [k, { lastAt: null, count: 0 }] as const; }
      }),
    );
    setSourceHealth(Object.fromEntries(healthEntries));

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
    loadAllRef.current = loadAll;
    void loadAll();
  }, [loadAll, refreshTick]);

  // Realtime: refresh header (Last Done) + source-health pills whenever a
  // workflow task or revenue row changes. Without this, "Last Done" stays
  // stale until Donna refreshes — which is exactly the bug she flagged.
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("today_header_rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "exec_os_workflow_tasks" },
        () => setRefreshTick((n) => n + 1),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "exec_os_revenue" },
        () => setRefreshTick((n) => n + 1),
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [user]);

  // Realtime emails
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("exec_os_emails_rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "exec_os_emails", filter: `user_id=eq.${user.id}` },
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
      .channel("exec_os_calendar_rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "exec_os_calendar_events", filter: `user_id=eq.${user.id}` },
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
            if (Number.isNaN(t) || t < dayStart.getTime() || t >= dayEnd.getTime()) {
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

  const lastDoneAgo = useMemo(() => {
    if (!lastDoneTask) return "";
    const ms = now.getTime() - new Date(lastDoneTask.completed_at).getTime();
    const mins = Math.max(0, Math.round(ms / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60 * 10) / 10;
    return `${hrs}h ago`;
  }, [lastDoneTask, now]);

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

  // Per-source health for the status popover. `kind` distinguishes external
  // integrations (something writes for you) from manual logs (you write).
  // The pill only flips to "needs attention" for integrations that have
  // gone dark — manual sources being empty isn't a problem to flag.
  type SourceKind = "integration" | "manual";
  const sources: {
    name: string;
    kind: SourceKind;
    lastAt: string | null;
    count: number;
    maxAgeHours: number | null;
    // Short hint shown when the source is empty.
    emptyHint: string;
  }[] = [
    { name: "Inbox (Gmail)",     kind: "integration", lastAt: sourceHealth.emails?.lastAt   ?? null, count: sourceHealth.emails?.count   ?? 0, maxAgeHours: 48,       emptyHint: "Gmail ingester never ran" },
    { name: "Calendar (Google)", kind: "integration", lastAt: sourceHealth.calendar?.lastAt ?? null, count: sourceHealth.calendar?.count ?? 0, maxAgeHours: 48,       emptyHint: "Calendar ingester never ran" },
    { name: "Pulse (daily log)", kind: "manual",      lastAt: sourceHealth.daily?.lastAt    ?? null, count: sourceHealth.daily?.count    ?? 0, maxAgeHours: 48,       emptyHint: "Log mood + energy via the Pulse widget" },
    { name: "Money (revenue)",   kind: "manual",      lastAt: sourceHealth.revenue?.lastAt  ?? null, count: sourceHealth.revenue?.count  ?? 0, maxAgeHours: null,     emptyHint: "Log revenue via the Money widget" },
    { name: "Content Pulse",     kind: "manual",      lastAt: sourceHealth.content?.lastAt  ?? null, count: sourceHealth.content?.count  ?? 0, maxAgeHours: 14 * 24,  emptyHint: "Log posts via the Content Pulse widget" },
  ];
  // Pill only goes "needs attention" when an INTEGRATION is broken or stale.
  // Empty manual sources are an expected state, not a fault.
  const stale = sources.some((s) => {
    if (s.kind !== "integration") return false;
    if (s.count === 0) return true;
    if (!s.lastAt || s.maxAgeHours == null) return false;
    return Date.now() - new Date(s.lastAt).getTime() > s.maxAgeHours * 3600_000;
  });

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

  const [personalization] = usePersonalization();
  const personaStyle: React.CSSProperties | undefined = (() => {
    if (personalization.mode === "color" && personalization.color) {
      return { backgroundColor: personalization.color };
    }
    if (personalization.mode === "image" && personalization.imageDataUrl) {
      return {
        backgroundImage: `url(${personalization.imageDataUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
    }
    return undefined;
  })();
  const isImage = personalization.mode === "image" && !!personalization.imageDataUrl;
  const isDarkBg =
    personalization.mode === "color" && !!personalization.color
      ? isDarkColor(personalization.color)
      : isImage; // assume images need light text by default
  const fullPage = personalization.applyFullPage && !!personaStyle;
  const wrapperStyle = fullPage ? personaStyle : undefined;
  const headerStyle = fullPage ? undefined : personaStyle;
  const headerBgClass = headerStyle ? "" : "bg-background/85 backdrop-blur";
  const overlayNeeded = fullPage && isImage;
  const textOverrideClass = isDarkBg ? "today-personalized-text" : "";
  const textShadowStyle: React.CSSProperties | undefined = isImage
    ? { textShadow: "0 1px 2px rgba(0,0,0,0.3)" }
    : undefined;

  return (
    <div
      className={`relative space-y-3 sm:space-y-4 pb-32 ${textOverrideClass}`}
      style={{ ...wrapperStyle, ...textShadowStyle }}
    >
      {overlayNeeded && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-0"
          style={{ backgroundColor: "rgba(255,255,255,0.6)" }}
        />
      )}
      {/* HEADER STRIP — sticky */}
      <header
        style={{ ...headerStyle, ...(headerStyle && isImage ? textShadowStyle : {}) }}
        className={`relative sticky top-0 z-30 -mx-3 sm:-mx-5 lg:-mx-6 px-3 sm:px-5 lg:px-6 py-3 sm:py-4 ${headerBgClass} border-b border-border ${headerStyle && isDarkBg ? "today-personalized-text" : ""}`}
      >
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

          {/* TODAY REVENUE — live from exec_os_revenue */}
          <Link
            to="/today"
            className="lg:col-span-2 group block min-w-0"
            title="Click MONEY widget below to log revenue"
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Revenue today
            </div>
            <div className="flex items-baseline gap-2">
              <div className="text-xl lg:text-2xl font-semibold tabular-nums text-foreground group-hover:text-[color:var(--navy)] transition-colors">
                {todayRevenueCents === null
                  ? "—"
                  : (todayRevenueCents / 100).toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: todayRevenueCents % 100 === 0 ? 0 : 2,
                    })}
              </div>
              {todayRevenueCents !== null && todayRevenueCents > 0 && (
                <span className="text-xs text-[color:var(--forest)]">
                  ▲ logged
                </span>
              )}
            </div>
          </Link>

          {/* LAST DONE — proof-of-productivity strip. Pulls the most recent
              completed workflow task today; falls back to next calendar
              event if nothing's been logged yet. Top priority lives in the
              top_priority widget below — header keeps only objective signals
              (clock, money, what-shipped, alarms). */}
          <div className="lg:col-span-5 min-w-0 hidden lg:block">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {lastDoneTask ? "Last done" : "Next up"}
            </div>
            {lastDoneTask ? (
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                  ✓ {lastDoneTask.title}
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {lastDoneAgo}
                </div>
              </div>
            ) : nextMeeting && nextMeetingMinutes != null ? (
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                  {nextMeeting.title || "(untitled)"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  in {nextMeetingMinutes < 60 ? `${nextMeetingMinutes}m` : `${Math.round(nextMeetingMinutes / 60 * 10) / 10}h`}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">Nothing logged yet</div>
            )}
          </div>

          {/* Status pill (desktop) + Library / Edit buttons */}
          <div className="hidden lg:flex lg:col-span-2 lg:justify-end items-center gap-2">
            <TimersAlarmsMenu />
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
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              aria-label="Add widget"
              title="Widget library"
              className="inline-flex items-center justify-center h-8 w-8 rounded-full border border-border hover:bg-muted text-[color:var(--navy)]"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={toggleAllLocks}
              aria-label={allLocked ? "Unlock all widgets" : "Lock all widgets"}
              title={allLocked ? "Unlock all widgets" : "Lock all widgets"}
              className={`inline-flex items-center justify-center h-8 w-8 rounded-full border border-border transition ${
                allLocked
                  ? "bg-[color:var(--sage)]/20 text-[color:var(--forest)] border-[color:var(--sage)]"
                  : "hover:bg-muted text-[color:var(--navy)]"
              }`}
            >
              {allLocked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setEditMode((v) => !v)}
              aria-label="Edit dashboard"
              title={editMode ? "Done editing" : "Edit dashboard"}
              className={`inline-flex items-center justify-center h-8 w-8 rounded-full border border-border transition ${
                editMode
                  ? "bg-[color:var(--navy)] text-white border-[color:var(--navy)]"
                  : "hover:bg-muted text-[color:var(--navy)]"
              }`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* Mobile + / edit buttons (shown next to clock pill row) */}
          <div className="flex lg:hidden items-center gap-2 -mt-1">
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              aria-label="Add widget"
              className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-border hover:bg-muted text-[color:var(--navy)]"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={toggleAllLocks}
              aria-label={allLocked ? "Unlock all widgets" : "Lock all widgets"}
              className={`inline-flex items-center justify-center h-9 w-9 rounded-full border border-border transition ${
                allLocked
                  ? "bg-[color:var(--sage)]/20 text-[color:var(--forest)] border-[color:var(--sage)]"
                  : "hover:bg-muted text-[color:var(--navy)]"
              }`}
            >
              {allLocked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setEditMode((v) => !v)}
              aria-label="Edit dashboard"
              className={`inline-flex items-center justify-center h-9 w-9 rounded-full border border-border transition ${
                editMode ? "bg-[color:var(--navy)] text-white border-[color:var(--navy)]" : "hover:bg-muted text-[color:var(--navy)]"
              }`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs text-muted-foreground">{editMode ? "Editing" : ""}</span>
          </div>
        </div>
        {statusOpen && (
          <div className="absolute right-3 sm:right-5 lg:right-6 top-full mt-2 z-40 w-[320px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-card shadow-lg p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground pb-1 border-b border-border">
              Source liveness — when the upstream wrote last
            </div>
            {sources.map((s) => {
              const ageMs = s.lastAt ? Date.now() - new Date(s.lastAt).getTime() : null;
              const isStale =
                s.kind === "integration" &&
                ((s.count === 0) ||
                  (s.maxAgeHours != null && ageMs != null && ageMs > s.maxAgeHours * 3600_000));
              const isEmptyManual = s.kind === "manual" && s.count === 0;
              const dotColor =
                s.kind === "integration" && s.count === 0
                  ? "bg-[color:var(--rose)]"
                  : isStale
                    ? "bg-[color:var(--orange)]"
                    : isEmptyManual
                      ? "bg-muted-foreground/40"
                      : "bg-[color:var(--sage)]";
              const detail =
                s.count === 0
                  ? s.emptyHint
                  : s.lastAt
                    ? `${relTime(s.lastAt)} · ${s.count} rows`
                    : `${s.count} rows`;
              const detailColor = isStale
                ? "text-[color:var(--orange)]"
                : s.kind === "integration" && s.count === 0
                  ? "text-[color:var(--rose)]"
                  : "text-muted-foreground";
              return (
                <div key={s.name} className="flex items-start justify-between text-xs gap-3">
                  <span className="flex items-center gap-2 text-foreground">
                    <span className={`h-2 w-2 rounded-full mt-1 shrink-0 ${dotColor}`} />
                    <span>
                      {s.name}
                      <span className="ml-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                        {s.kind === "integration" ? "auto" : "manual"}
                      </span>
                    </span>
                  </span>
                  <span className={`text-right text-[11px] max-w-[60%] ${detailColor}`}>
                    {detail}
                  </span>
                </div>
              );
            })}
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
        {/* WORKFLOWS — action layer: current phase + tasks + Send to Claude */}
        {activeWidgets.includes("workflows") && (
        <div key="workflows" className="relative">
          <Card
            title="Workflow"
            icon={Activity}
            className="h-full overflow-hidden"
            dragHandle={!locks.workflows && !isMobileViewport}
            lockId="workflows"
            locked={!!locks.workflows}
            onToggleLock={toggleLock}
            editMode={editMode}
            onRemove={removeWidget}
          >
            <WorkflowsWidget />
          </Card>
        </div>
        )}

        {/* WORKFLOWS — second instance, pinned to the Exec OS Build workflow */}
        {activeWidgets.includes("workflows_exec_os") && (
        <div key="workflows_exec_os" className="relative">
          <Card
            title="Workflow · Exec OS Build"
            icon={Activity}
            className="h-full overflow-hidden"
            dragHandle={!locks.workflows_exec_os && !isMobileViewport}
            lockId="workflows_exec_os"
            locked={!!locks.workflows_exec_os}
            onToggleLock={toggleLock}
            editMode={editMode}
            onRemove={removeWidget}
          >
            <WorkflowsWidget workflowId="e4029110-338b-4d48-875e-53257a8f4dd9" />
          </Card>
        </div>
        )}

        {/* CALENDAR */}
        {activeWidgets.includes("calendar") && (
        <div key="calendar" className="relative">
          <Card
            title="Calendar"
            icon={CalendarClock}
            className="h-full overflow-auto"
            dragHandle={!locks.calendar && !isMobileViewport}
            lockId="calendar"
            locked={!!locks.calendar}
            onToggleLock={toggleLock}
            editMode={editMode}
            onRemove={removeWidget}
            right={
              <div className="flex items-center gap-1.5 no-drag">
                {availableCalendars.length > 1 ? (
                  <Select value={selectedCalendar} onValueChange={setSelectedCalendar}>
                    <SelectTrigger className="h-7 text-xs w-[140px] sm:w-[160px]">
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
                ) : null}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={refreshing}
                  onClick={refreshCalendars}
                  aria-label="Refresh calendars from Google"
                  title="Refresh calendars from Google"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>
            }
          >
            <DateNav
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              isToday={selectedIsToday}
            />
            {meetingsToday.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <p className="text-xs text-muted-foreground/70 italic">
                  {selectedIsToday ? "Nothing on the calendar today." : "Nothing on the calendar."}
                </p>
                {selectedIsToday && sourceHealth.calendar?.lastAt && (
                  <p className="text-[11px] text-muted-foreground">
                    Last sync:{" "}
                    <span className={
                      Date.now() - new Date(sourceHealth.calendar.lastAt).getTime() > 86_400_000 * 2
                        ? "text-[color:var(--orange)]"
                        : "text-foreground"
                    }>
                      {relTime(sourceHealth.calendar.lastAt)}
                    </span>
                    {" · "}
                    <button
                      onClick={refreshCalendars}
                      disabled={refreshing}
                      className="text-[color:var(--navy)] hover:underline disabled:opacity-50"
                    >
                      Refresh now
                    </button>
                  </p>
                )}
                {selectedIsToday && !sourceHealth.calendar?.lastAt && sourceHealth.calendar?.count === 0 && (
                  <p className="text-[11px] text-[color:var(--rose)]">
                    No events in database — Make.com sync may be paused
                  </p>
                )}
              </div>
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
        )}

        {/* INBOX */}
        {activeWidgets.includes("inbox") && (
        <div key="inbox" className="relative">
          <Card
            title="Inbox"
            icon={Inbox}
            className="h-full overflow-auto"
            dragHandle={!locks.inbox && !isMobileViewport}
            lockId="inbox"
            locked={!!locks.inbox}
            onToggleLock={toggleLock}
            editMode={editMode}
            onRemove={removeWidget}
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
        )}

        {/* MONEY */}
        {activeWidgets.includes("money") && (
        <div key="money" className="relative">
          <Card
            title="Money"
            icon={Banknote}
            className="h-full overflow-hidden"
            dragHandle={!locks.money && !isMobileViewport}
            lockId="money"
            locked={!!locks.money}
            onToggleLock={toggleLock}
            editMode={editMode}
            onRemove={removeWidget}
          >
            <MoneyWidget />
          </Card>
        </div>
        )}

        {/* TIMELINE */}
        {activeWidgets.includes("timeline") && (
        <div key="timeline" className="relative">
          <Card
            title="Timeline"
            icon={Activity}
            className="h-full overflow-auto"
            dragHandle={!locks.timeline && !isMobileViewport}
            lockId="timeline"
            locked={!!locks.timeline}
            onToggleLock={toggleLock}
            editMode={editMode}
            onRemove={removeWidget}
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
        )}

        {/* CONTENT PULSE */}
        {activeWidgets.includes("content_pulse") && (
        <div key="content_pulse" className="relative">
          <Card
            title="Content pulse"
            icon={Sparkles}
            className="h-full overflow-hidden"
            dragHandle={!locks.content_pulse && !isMobileViewport}
            lockId="content_pulse"
            locked={!!locks.content_pulse}
            onToggleLock={toggleLock}
            editMode={editMode}
            onRemove={removeWidget}
          >
            <ContentPulseWidget />
          </Card>
        </div>
        )}

        {/* PROJECTS */}
        {activeWidgets.includes("projects") && (
        <div key="projects" className="relative">
          <Card
            title="Projects"
            icon={FolderKanban}
            className="h-full overflow-hidden"
            dragHandle={!locks.projects && !isMobileViewport}
            lockId="projects"
            locked={!!locks.projects}
            onToggleLock={toggleLock}
            editMode={editMode}
            onRemove={removeWidget}
          >
            <ProjectsWidget />
          </Card>
        </div>
        )}
        {/* WELLNESS widget removed: never made it into the widget catalog,
           so any user who removed it couldn't re-add it. The Sparkline /
           trend / mood components remain in case a real wellness widget is
           rebuilt later. */}

        {/* FOLLOW-UPS */}
        {activeWidgets.includes("follow_ups") && (
        <div key="follow_ups" className="relative">
          <Card
            title="Follow-ups"
            icon={MessageCircle}
            className="h-full overflow-auto"
            dragHandle={!locks.follow_ups && !isMobileViewport}
            lockId="follow_ups"
            locked={!!locks.follow_ups}
            onToggleLock={toggleLock}
            editMode={editMode}
            onRemove={removeWidget}
          >
            <FollowUpsWidget
              userId={user?.id}
              userEmail={user?.email}
              onOpenEvent={(ev) => setSelectedEvent(ev as CalendarEventRow)}
            />
          </Card>
        </div>
        )}

        {/* BENCH */}
        {activeWidgets.includes("bench") && (
        <div key="bench" className="relative">
          <Card
            title="Your Bench"
            icon={Users}
            className="h-full overflow-auto"
            dragHandle={!locks.bench && !isMobileViewport}
            lockId="bench"
            locked={!!locks.bench}
            onToggleLock={toggleLock}
            editMode={editMode}
            onRemove={removeWidget}
          >
            <BenchWidget />
          </Card>
        </div>
        )}

        {activeWidgets.includes("bench_whispers") && (
        <div key="bench_whispers" className="relative">
          <Card
            title="Bench whispers"
            icon={Sparkles}
            className="h-full overflow-auto"
            dragHandle={!locks.bench_whispers && !isMobileViewport}
            lockId="bench_whispers"
            locked={!!locks.bench_whispers}
            onToggleLock={toggleLock}
            editMode={editMode}
            onRemove={removeWidget}
          >
            <BenchWhispersWidget />
          </Card>
        </div>
        )}

        {/* PIPELINE — sales pipeline + active clients (the 1000x layer) */}
        {activeWidgets.includes("pipeline") && (
        <div key="pipeline" className="relative">
          <Card
            title="Pipeline"
            icon={Briefcase}
            className="h-full overflow-auto"
            dragHandle={!locks.pipeline && !isMobileViewport}
            lockId="pipeline"
            locked={!!locks.pipeline}
            onToggleLock={toggleLock}
            editMode={editMode}
            onRemove={removeWidget}
          >
            <PipelineWidget />
          </Card>
        </div>
        )}

        {/* MORNING BRIEF — what the AI staff team did overnight */}
        {activeWidgets.includes("morning_brief") && (
        <div key="morning_brief" className="relative">
          <Card
            title="Morning brief"
            icon={Sparkles}
            className="h-full overflow-auto"
            dragHandle={!locks.morning_brief && !isMobileViewport}
            lockId="morning_brief"
            locked={!!locks.morning_brief}
            onToggleLock={toggleLock}
            editMode={editMode}
            onRemove={removeWidget}
          >
            <MorningBriefWidget />
          </Card>
        </div>
        )}

        {/* TIMERS + ALARMS */}
        {activeWidgets.includes("timers_alarms") && (
        <div key="timers_alarms" className="relative">
          <Card
            title="Timers + alarms"
            icon={AlarmClock}
            className="h-full overflow-auto"
            dragHandle={!locks.timers_alarms && !isMobileViewport}
            lockId="timers_alarms"
            locked={!!locks.timers_alarms}
            onToggleLock={toggleLock}
            editMode={editMode}
            onRemove={removeWidget}
          >
            <TimersAlarmsWidget />
          </Card>
        </div>
        )}

        {/* KITCHEN + RECIPES */}
        {activeWidgets.includes("kitchen_recipes") && (
        <div key="kitchen_recipes" className="relative">
          <Card
            title="Kitchen + recipes"
            icon={ChefHat}
            className="h-full overflow-auto"
            dragHandle={!locks.kitchen_recipes && !isMobileViewport}
            lockId="kitchen_recipes"
            locked={!!locks.kitchen_recipes}
            onToggleLock={toggleLock}
            editMode={editMode}
            onRemove={removeWidget}
          >
            <KitchenRecipesWidget />
          </Card>
        </div>
        )}

        {/* TOP PRIORITY (stub) */}
        {activeWidgets.includes("top_priority") && (
          <div key="top_priority" className="relative">
            <Card
              title="Top priority"
              icon={Sparkles}
              className="h-full overflow-auto"
              dragHandle={!locks.top_priority && !isMobileViewport}
              lockId="top_priority"
              locked={!!locks.top_priority}
              onToggleLock={toggleLock}
              editMode={editMode}
              onRemove={removeWidget}
            >
              <TopPriorityWidget topPriority={daily?.top_priority ?? null} />
            </Card>
          </div>
        )}

        {/* VOICE CAPTURE (stub) */}
        {activeWidgets.includes("voice_capture") && (
          <div key="voice_capture" className="relative">
            <Card
              title="Voice capture"
              icon={Mic}
              className="h-full overflow-auto"
              dragHandle={!locks.voice_capture && !isMobileViewport}
              lockId="voice_capture"
              locked={!!locks.voice_capture}
              onToggleLock={toggleLock}
              editMode={editMode}
              onRemove={removeWidget}
            >
              <VoiceCaptureWidget />
            </Card>
          </div>
        )}

        {/* DONE TODAY (stub) */}
        {activeWidgets.includes("done_today") && (
          <div key="done_today" className="relative">
            <Card
              title="Done for today"
              icon={Activity}
              className="h-full overflow-auto"
              dragHandle={!locks.done_today && !isMobileViewport}
              lockId="done_today"
              locked={!!locks.done_today}
              onToggleLock={toggleLock}
              editMode={editMode}
              onRemove={removeWidget}
            >
              <DoneTodayWidget />
            </Card>
          </div>
        )}
      </ResponsiveGridLayout>

      {activeWidgets.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card p-12 flex flex-col items-center justify-center text-center gap-4">
          <LayoutGrid className="h-10 w-10 text-muted-foreground/60" />
          <div>
            <p className="text-base font-medium text-foreground">Your dashboard is empty.</p>
            <p className="text-sm text-muted-foreground mt-1">Click + to add widgets.</p>
          </div>
          <Button
            onClick={() => setLibraryOpen(true)}
            style={{ backgroundColor: "#083D77", color: "white" }}
          >
            Open widget library
          </Button>
        </div>
      )}

      <WidgetLibrarySheet
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        side={isMobileViewport ? "bottom" : "right"}
        activeIds={activeWidgets}
        onAdd={(id) => addWidget(id)}
        onRemove={(id) => removeWidget(id)}
      />

      <button
        type="button"
        onClick={() => setCaptureOpen(true)}
        className="fixed bottom-20 sm:bottom-6 right-4 sm:left-6 sm:right-auto z-50 h-14 w-14 rounded-full bg-[color:var(--navy)] text-white shadow-lg flex items-center justify-center hover:opacity-90 transition"
        aria-label="Capture"
      >
        <Mic className="h-6 w-6" />
      </button>

      <DoneForToday />

      <footer className="mt-8 pt-4 border-t border-border flex justify-center">
        <button
          type="button"
          onClick={resetLayout}
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" /> Reset layout
        </button>
      </footer>

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
  editMode = false,
  onRemove,
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
  editMode?: boolean;
  onRemove?: (id: WidgetId) => void;
}) {
  const isLocked = !!locked;
  return (
    <section
      className={`group/widget rounded-xl border bg-card p-4 sm:p-5 lg:p-6 transition-colors ${
        editMode
          ? "border-dashed border-[color:var(--navy)]/50"
          : isLocked
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
          {lockId && onRemove && (
            <button
              type="button"
              onClick={() => onRemove(lockId)}
              className={`no-drag inline-flex items-center justify-center p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition ${
                editMode ? "opacity-100" : "opacity-0 group-hover/widget:opacity-100"
              }`}
              aria-label="Remove widget"
              title="Remove widget"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
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
      className={`no-drag inline-flex items-center justify-center p-1.5 rounded hover:bg-muted transition ${
        locked
          ? "text-[color:var(--navy)]"
          : "text-muted-foreground hover:text-foreground"
      }`}
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

// Honest "not wired yet" state — used by widgets that don't have a backing
// data source. Visually distinct from "table is empty" so the user can tell
// them apart at a glance.
function NeedsSetup({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-1.5 py-6 px-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--orange)]">
        Needs setup
      </div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="text-xs text-muted-foreground max-w-[28ch]">{body}</div>
    </div>
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
  // Default range covers most working/social hours. If a meeting falls outside
  // this window we still render it (the band extends visually) so nothing is
  // silently hidden, but the typical day fills the band without horizontal
  // scrolling at any container width.
  let startH = 6;
  let endH = 23; // 11pm
  // Expand the window if a meeting falls outside the default range.
  meetings.forEach((m) => {
    if (!m.start_at) return;
    const s = new Date(m.start_at);
    if (Number.isNaN(s.getTime())) return;
    const sh = s.getHours() + s.getMinutes() / 60;
    if (sh < startH) startH = Math.max(0, Math.floor(sh));
    if (m.end_at) {
      const e = new Date(m.end_at);
      if (!Number.isNaN(e.getTime())) {
        const eh = e.getHours() + e.getMinutes() / 60 + (e.getDate() !== s.getDate() ? 24 : 0);
        if (eh > endH) endH = Math.min(24, Math.ceil(eh));
      }
    }
  });
  const totalMin = (endH - startH) * 60;
  const nowMin = (now.getHours() - startH) * 60 + now.getMinutes();
  const nowPct = (nowMin / totalMin) * 100;

  // Pick a step size that yields ~6 labels regardless of range.
  const step = (endH - startH) <= 12 ? 2 : 3;
  const hours: number[] = [];
  for (let h = startH; h <= endH; h += step) hours.push(h);

  return (
    <div className="relative w-full">
      {/* Hour grid — no horizontal scroll, fits any width. Labels live INSIDE
          the band at the bottom so they can't be clipped by overflow. */}
      <div className="relative h-14 sm:h-16 rounded-lg bg-muted/40 border border-border overflow-hidden">
        {/* Hour ticks + labels */}
        {hours.map((h) => {
          const pct = ((h - startH) / (endH - startH)) * 100;
          const display = h === 24 ? 12 : h % 12 === 0 ? 12 : h % 12;
          return (
            <div
              key={h}
              className="absolute top-0 bottom-0 border-l border-border/60 pointer-events-none"
              style={{ left: `${pct}%` }}
            >
              <span className="absolute bottom-0.5 left-1 text-[9px] text-muted-foreground tabular-nums leading-none">
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
          if (startMin + durMin < 0 || startMin > totalMin) return null;
          const clampedStart = Math.max(0, startMin);
          const clampedEnd = Math.min(totalMin, startMin + durMin);
          const left = (clampedStart / totalMin) * 100;
          const width = Math.max(2, ((clampedEnd - clampedStart) / totalMin) * 100);
          return (
            <button
              type="button"
              key={m.id}
              onClick={() => onSelect?.(m)}
              className="absolute top-1.5 bottom-4 rounded-md bg-[color:var(--sage)]/40 border border-[color:var(--sage)] px-1 py-0.5 overflow-hidden text-left hover:bg-[color:var(--sage)]/60 transition-colors cursor-pointer"
              style={{ left: `${left}%`, width: `${width}%` }}
              title={m.title ?? ""}
            >
              <span className="text-[10px] text-[color:var(--forest)] truncate block leading-tight">
                {m.title || "Mtg"}
              </span>
            </button>
          );
        })}

        {/* Now line */}
        {showNow && nowPct >= 0 && nowPct <= 100 && (
          <div
            className="absolute top-0 bottom-0 w-px bg-[color:var(--rose)] z-10 pointer-events-none"
            style={{ left: `${nowPct}%` }}
          >
            <div className="absolute -top-1 -translate-x-1/2 h-2 w-2 rounded-full bg-[color:var(--rose)]" />
          </div>
        )}
      </div>
      {meetings.length === 0 && (
        <p className="text-xs text-muted-foreground/70 italic text-center mt-2">
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
