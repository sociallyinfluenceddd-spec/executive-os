// Shared time formatters. Previously there were three near-identical
// relTime/formatAgo implementations across today.tsx, follow_ups.tsx, and
// SavedChip.tsx that drifted slightly (rounding mode, future-vs-past sign,
// "just now" threshold). Consolidated here.

/**
 * "2m ago" / "in 45m" / "3h ago" / "in 2d" — handles past and future.
 * Returns "" if iso is null/undefined.
 */
export function relTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMs = t - Date.now();
  const past = diffMs < 0;
  const abs = Math.abs(diffMs);
  const m = Math.round(abs / 60_000);
  if (m < 1) return past ? "just now" : "now";
  if (m < 60) return past ? `${m}m ago` : `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`;
  const d = Math.round(h / 24);
  return past ? `${d}d ago` : `in ${d}d`;
}

/** Same as relTime, but accepts an absolute duration in ms and assumes past. */
export function formatAgo(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** "9:30 AM" or "9:30 AM Tue" if a different day from today */
export function whenLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  const wd = d.toLocaleDateString([], { weekday: "short" });
  return `${time} ${wd}`;
}
