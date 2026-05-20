import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, X, Plus, AlarmClock, Timer as TimerIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Tab = "timers" | "alarms";

type CountdownTimer = {
  id: string;
  label: string;
  durationSec: number;
  endAt: number | null;          // wall-clock ms; null when paused
  pausedRemainingSec: number | null; // set only while paused
};

type Alarm = {
  id: string;
  label: string;
  time: string;          // "HH:MM"
  daysOfWeek: number[];  // 0=Sun..6=Sat; [] means daily
  enabled: boolean;
  lastFiredKey?: string; // "YYYY-MM-DD HH:MM" to dedupe
};

const TIMERS_KEY = "execOs.timers.v1";
const ALARMS_KEY = "execOs.alarms.v1";
const TAB_KEY = "execOs.timersAlarms.activeTab.v1";

const PRESETS_MIN = [5, 15, 30, 60];

const NAVY = "#083D77";
const ORANGE = "#E97451";

function uid() {
  return crypto?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function saveLS<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage may be full or unavailable; intentionally swallow.
  }
}

function fmt12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function fmtMMSS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}:${String(mm).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}

/* --- Sound engine (Web Audio API, no packages) --- */

let audioCtx: AudioContext | null = null;
function ensureAudio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const C = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    audioCtx = new C();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playBeepSequence(notes: number[] = [880, 1100, 1320], duration = 0.18, gap = 0.06) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = now + i * (duration + gap);
    const stop = start + duration;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
    gain.gain.linearRampToValueAtTime(0, stop);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(stop + 0.05);
  });
}

/* --- Notifications (optional, best-effort) --- */
function requestNotificationsOnce() {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  } catch {
    /* iOS Safari etc. */
  }
}
function notify(title: string, body: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {
    /* swallow */
  }
}

/* --- Main component --- */

export function TimersAlarmsWidget() {
  const [tab, setTab] = useState<Tab>(() => loadLS<Tab>(TAB_KEY, "timers"));
  const [timers, setTimers] = useState<CountdownTimer[]>(() => loadLS<CountdownTimer[]>(TIMERS_KEY, []));
  const [alarms, setAlarms] = useState<Alarm[]>(() => loadLS<Alarm[]>(ALARMS_KEY, []));
  const [, setTick] = useState(0);
  const firedRef = useRef<Set<string>>(new Set());

  /* tick every second */
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, []);

  /* persist tab */
  useEffect(() => saveLS(TAB_KEY, tab), [tab]);
  useEffect(() => saveLS(TIMERS_KEY, timers), [timers]);
  useEffect(() => saveLS(ALARMS_KEY, alarms), [alarms]);

  /* fire completed timers */
  useEffect(() => {
    const now = Date.now();
    const toFire: CountdownTimer[] = [];
    timers.forEach((t) => {
      if (t.endAt && t.endAt <= now && !firedRef.current.has(t.id)) {
        toFire.push(t);
        firedRef.current.add(t.id);
      }
    });
    if (toFire.length > 0) {
      playBeepSequence();
      toFire.forEach((t) => {
        toast.success(`⏰ ${t.label || "Timer"} done`, { duration: 8000 });
        notify("Timer done", t.label || "Timer");
      });
    }
  });

  /* fire matching alarms */
  useEffect(() => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dow = d.getDay();
    const nowKey = `${ymd} ${hh}:${mm}`;
    let changed = false;
    const next = alarms.map((a) => {
      if (!a.enabled) return a;
      if (a.daysOfWeek.length > 0 && !a.daysOfWeek.includes(dow)) return a;
      if (a.time !== `${hh}:${mm}`) return a;
      if (a.lastFiredKey === nowKey) return a;
      playBeepSequence([660, 880, 1100, 880]);
      toast.success(`⏰ ${a.label || "Alarm"}`, { duration: 12000 });
      notify("Alarm", a.label || "Alarm");
      changed = true;
      return { ...a, lastFiredKey: nowKey };
    });
    if (changed) setAlarms(next);
    // depend on the minute boundary only — using `tick` via setInterval above
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      <Tabs tab={tab} setTab={setTab} timerCount={timers.length} alarmCount={alarms.filter((a) => a.enabled).length} />
      <div className="flex-1 overflow-auto pt-2">
        {tab === "timers" ? (
          <TimersPanel timers={timers} setTimers={setTimers} firedRef={firedRef} />
        ) : (
          <AlarmsPanel alarms={alarms} setAlarms={setAlarms} />
        )}
      </div>
    </div>
  );
}

function Tabs({
  tab,
  setTab,
  timerCount,
  alarmCount,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  timerCount: number;
  alarmCount: number;
}) {
  const Btn = ({ value, label, count, icon: Icon }: { value: Tab; label: string; count: number; icon: typeof TimerIcon }) => {
    const active = tab === value;
    return (
      <button
        type="button"
        onClick={() => setTab(value)}
        className={`flex items-center gap-1.5 text-sm pb-1.5 border-b-2 transition-colors ${
          active ? "text-foreground border-current font-semibold" : "text-muted-foreground border-transparent hover:text-foreground"
        }`}
        style={active ? { color: NAVY } : undefined}
      >
        <Icon className="h-3.5 w-3.5" />
        {label} <span className="opacity-60">({count})</span>
      </button>
    );
  };
  return (
    <div className="flex gap-4 border-b border-border">
      <Btn value="timers" label="Timers" count={timerCount} icon={TimerIcon} />
      <Btn value="alarms" label="Alarms" count={alarmCount} icon={AlarmClock} />
    </div>
  );
}

/* ----- Timers ----- */

function TimersPanel({
  timers,
  setTimers,
  firedRef,
}: {
  timers: CountdownTimer[];
  setTimers: React.Dispatch<React.SetStateAction<CountdownTimer[]>>;
  firedRef: React.MutableRefObject<Set<string>>;
}) {
  const [label, setLabel] = useState("");
  const [mins, setMins] = useState("");

  const addTimer = (durationSec: number, customLabel?: string) => {
    if (durationSec <= 0) return;
    ensureAudio();
    requestNotificationsOnce();
    const id = uid();
    firedRef.current.delete(id);
    const t: CountdownTimer = {
      id,
      label: (customLabel ?? label).trim() || `${Math.round(durationSec / 60)}m timer`,
      durationSec,
      endAt: Date.now() + durationSec * 1000,
      pausedRemainingSec: null,
    };
    setTimers((cur) => [t, ...cur]);
    setLabel("");
    setMins("");
  };

  const togglePause = (id: string) => {
    setTimers((cur) =>
      cur.map((t) => {
        if (t.id !== id) return t;
        if (t.endAt) {
          // pause
          const remaining = Math.max(0, Math.round((t.endAt - Date.now()) / 1000));
          return { ...t, endAt: null, pausedRemainingSec: remaining };
        }
        // resume
        firedRef.current.delete(id);
        const remaining = t.pausedRemainingSec ?? t.durationSec;
        return { ...t, endAt: Date.now() + remaining * 1000, pausedRemainingSec: null };
      }),
    );
  };

  const restart = (id: string) => {
    setTimers((cur) =>
      cur.map((t) => {
        if (t.id !== id) return t;
        firedRef.current.delete(id);
        return { ...t, endAt: Date.now() + t.durationSec * 1000, pausedRemainingSec: null };
      }),
    );
  };

  const remove = (id: string) => {
    firedRef.current.delete(id);
    setTimers((cur) => cur.filter((t) => t.id !== id));
  };

  const onAdd = () => {
    const m = parseFloat(mins);
    if (!Number.isFinite(m) || m <= 0) return;
    addTimer(Math.round(m * 60));
  };

  return (
    <div className="space-y-3">
      {/* On narrow widths the label stacks above the min+add row.
          @container ensures we look at the widget's width, not the page's. */}
      <div className="@container">
        <div className="space-y-2 @[280px]:space-y-0 @[280px]:flex @[280px]:items-center @[280px]:gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="h-8 w-full @[280px]:flex-1 text-sm"
          />
          <div className="flex items-center gap-2 @[280px]:contents">
            <Input
              value={mins}
              onChange={(e) => setMins(e.target.value)}
              placeholder="min"
              inputMode="decimal"
              type="number"
              className="h-8 flex-1 @[280px]:flex-none @[280px]:w-[70px] text-sm"
            />
            <Button size="sm" onClick={onAdd} className="h-8 shrink-0" style={{ backgroundColor: NAVY }}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PRESETS_MIN.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => addTimer(m * 60, label || `${m}m`)}
            className="text-xs rounded-full border border-border px-2.5 py-1 hover:bg-muted transition-colors"
          >
            {m}m
          </button>
        ))}
      </div>

      {timers.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">
          No timers running. Add one above or pick a preset.
        </div>
      ) : (
        <ul className="space-y-2">
          {timers.map((t) => {
            const running = !!t.endAt;
            const remaining = running
              ? Math.max(0, Math.round((t.endAt! - Date.now()) / 1000))
              : t.pausedRemainingSec ?? t.durationSec;
            const done = running && remaining === 0;
            const pct = Math.max(0, Math.min(100, (1 - remaining / Math.max(1, t.durationSec)) * 100));
            return (
              <li
                key={t.id}
                className={`relative rounded-lg border px-3 py-2 transition-colors ${
                  done ? "border-orange-300 bg-orange-50/60" : "border-border bg-card"
                }`}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-l-lg pointer-events-none"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: done ? `${ORANGE}22` : `${NAVY}11`,
                    transition: "width 0.5s linear",
                  }}
                  aria-hidden
                />
                <div className="relative flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{t.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {Math.round(t.durationSec / 60)}m total
                      {!running && !done ? " · paused" : ""}
                      {done ? " · done" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="tabular-nums text-base font-semibold" style={{ color: done ? ORANGE : NAVY }}>
                      {fmtMMSS(remaining)}
                    </div>
                    {done ? (
                      <Button size="sm" variant="outline" onClick={() => restart(t.id)} className="h-7 px-2">
                        Restart
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => togglePause(t.id)} className="h-7 px-2">
                        {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => remove(t.id)} className="h-7 px-2 text-muted-foreground">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ----- Alarms ----- */

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function AlarmsPanel({
  alarms,
  setAlarms,
}: {
  alarms: Alarm[];
  setAlarms: React.Dispatch<React.SetStateAction<Alarm[]>>;
}) {
  const [label, setLabel] = useState("");
  const [time, setTime] = useState("07:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]); // weekdays default

  const addAlarm = () => {
    if (!/^\d{2}:\d{2}$/.test(time)) {
      toast.error("Time must be HH:MM");
      return;
    }
    ensureAudio();
    requestNotificationsOnce();
    const a: Alarm = {
      id: uid(),
      label: label.trim() || "Alarm",
      time,
      daysOfWeek: days,
      enabled: true,
    };
    setAlarms((cur) => [a, ...cur]);
    setLabel("");
  };

  const toggleDay = (d: number) => {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  };

  const toggleEnabled = (id: string) => {
    setAlarms((cur) => cur.map((a) => (a.id === id ? { ...a, enabled: !a.enabled, lastFiredKey: undefined } : a)));
  };
  const remove = (id: string) => setAlarms((cur) => cur.filter((a) => a.id !== id));

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border p-3 space-y-2 bg-muted/20 @container">
        <div className="space-y-2 @[280px]:space-y-0 @[280px]:flex @[280px]:items-center @[280px]:gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. School pickup)"
            className="h-8 w-full @[280px]:flex-1 text-sm"
          />
          <div className="flex items-center gap-2 @[280px]:contents">
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-8 flex-1 @[280px]:flex-none @[280px]:w-[100px] text-sm"
            />
            <Button size="sm" onClick={addAlarm} className="h-8 shrink-0" style={{ backgroundColor: NAVY }}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {DAY_LABELS.map((dl, idx) => {
            const on = days.includes(idx);
            return (
              <button
                key={idx}
                type="button"
                onClick={() => toggleDay(idx)}
                className={`h-7 w-7 rounded-full text-xs font-semibold transition-colors ${
                  on ? "text-white" : "text-muted-foreground border border-border"
                }`}
                style={on ? { backgroundColor: NAVY } : undefined}
                aria-pressed={on}
                aria-label={`Toggle ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][idx]}`}
              >
                {dl}
              </button>
            );
          })}
          <span className="text-xs text-muted-foreground self-center ml-2">
            {days.length === 0 ? "Daily" : `${days.length} day${days.length === 1 ? "" : "s"}/wk`}
          </span>
        </div>
      </div>

      {alarms.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">
          No alarms set. Add one above.
        </div>
      ) : (
        <ul className="space-y-2">
          {alarms.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 bg-card">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold tabular-nums" style={{ color: a.enabled ? NAVY : undefined }}>
                    {fmt12h(a.time)}
                  </span>
                  <span className={`text-sm truncate ${a.enabled ? "" : "text-muted-foreground line-through"}`}>
                    {a.label}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {a.daysOfWeek.length === 0
                    ? "Every day"
                    : a.daysOfWeek.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(" · ")}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => toggleEnabled(a.id)} className="h-7 px-2 text-xs">
                  {a.enabled ? "On" : "Off"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(a.id)} className="h-7 px-2 text-muted-foreground">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
