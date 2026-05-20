import { useEffect, useMemo, useState } from "react";
import { AlarmClock, Timer as TimerIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimersAlarmsWidget } from "@/components/widgets/timers_alarms";

type CountdownTimer = {
  id: string;
  label: string;
  durationSec: number;
  endAt: number | null;
  pausedRemainingSec: number | null;
};

type Alarm = {
  id: string;
  label: string;
  time: string;
  daysOfWeek: number[];
  enabled: boolean;
  lastFiredKey?: string;
};

const TIMERS_KEY = "execOs.timers.v1";
const ALARMS_KEY = "execOs.alarms.v1";

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return (JSON.parse(raw) ?? fallback) as T;
  } catch {
    return fallback;
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

function fmtCountdown(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h${mm ? ` ${mm}m` : ""}`;
}

function nextAlarmTodayHHMM(alarms: Alarm[], now: Date): string | null {
  const hh = now.getHours();
  const mm = now.getMinutes();
  const dow = now.getDay();
  let best: { hhmm: string; minutes: number } | null = null;
  for (const a of alarms) {
    if (!a.enabled) continue;
    if (a.daysOfWeek.length > 0 && !a.daysOfWeek.includes(dow)) continue;
    const [h, m] = a.time.split(":").map((x) => parseInt(x, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) continue;
    const minsFromMidnight = h * 60 + m;
    const nowMins = hh * 60 + mm;
    if (minsFromMidnight <= nowMins) continue;
    if (!best || minsFromMidnight < best.minutes) {
      best = { hhmm: a.time, minutes: minsFromMidnight };
    }
  }
  return best?.hhmm ?? null;
}

export function TimersAlarmsMenu() {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);

  // Light 1s tick so the chip stays current. We don't re-read LS every tick —
  // just trigger a re-render. The Popover content reads fresh state itself.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, []);

  // Pull live state directly from localStorage on each render (cheap, <1KB).
  const chip = useMemo(() => {
    // tick is a dep so this recomputes every second
    void tick;
    const now = new Date();
    const timers = readLS<CountdownTimer[]>(TIMERS_KEY, []);
    const alarms = readLS<Alarm[]>(ALARMS_KEY, []);

    // Soonest running timer's remaining seconds
    let soonestTimerSec: number | null = null;
    for (const t of timers) {
      if (!t.endAt) continue;
      const remaining = (t.endAt - Date.now()) / 1000;
      if (remaining > 0 && (soonestTimerSec == null || remaining < soonestTimerSec)) {
        soonestTimerSec = remaining;
      }
    }
    const nextAlarm = nextAlarmTodayHHMM(alarms, now);
    const activeAlarmCount = alarms.filter((a) => a.enabled).length;

    if (soonestTimerSec != null) {
      return {
        icon: "timer" as const,
        label: fmtCountdown(soonestTimerSec),
        tone: "active" as const,
      };
    }
    if (nextAlarm) {
      return {
        icon: "alarm" as const,
        label: fmt12h(nextAlarm),
        tone: "active" as const,
      };
    }
    return {
      icon: "alarm" as const,
      label: activeAlarmCount === 0 ? "Set" : `${activeAlarmCount}`,
      tone: "idle" as const,
    };
  }, [tick]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Timers and alarms"
          title="Timers + alarms"
          className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border text-xs tabular-nums transition ${
            chip.tone === "active"
              ? "border-[color:var(--navy)] bg-[color:var(--navy)]/10 text-[color:var(--navy)]"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          {chip.icon === "timer" ? (
            <TimerIcon className="h-3.5 w-3.5" />
          ) : (
            <AlarmClock className="h-3.5 w-3.5" />
          )}
          <span>{chip.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[360px] p-3 max-h-[70vh] overflow-auto"
      >
        <TimersAlarmsWidget />
      </PopoverContent>
    </Popover>
  );
}
