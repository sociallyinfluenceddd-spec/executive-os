import { Check } from "lucide-react";
import { useEffect, useState } from "react";

function formatAgo(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function SavedChip({ at, className = "" }: { at: number | null; className?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!at) return;
    const id = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, [at]);
  if (!at) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] text-[color:var(--sage)] ${className}`}
    >
      <Check className="h-3 w-3" /> Saved {formatAgo(Date.now() - at)}
    </span>
  );
}
