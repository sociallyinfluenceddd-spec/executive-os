import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

// exec_os_revenue isn't in the Supabase-generated types yet — added by
// migration 20260517120000_revenue.sql. Route calls through the untyped
// alias until types are regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rdb = supabase as any;

const NAVY = "#083D77";
const FOREST = "#355834";
const ORANGE = "#E97451";

type Source =
  | "stripe"
  | "gumroad"
  | "cmo_retainer"
  | "tiktok"
  | "sponsorship"
  | "manual"
  | "other";

type RevenueRow = {
  id: string;
  entry_date: string; // YYYY-MM-DD
  source: Source;
  amount_cents: number;
  currency: string;
  notes: string | null;
  created_at: string;
};

const SOURCE_LABEL: Record<Source, string> = {
  stripe: "Stripe",
  gumroad: "Gumroad",
  cmo_retainer: "CMO Retainer",
  tiktok: "TikTok",
  sponsorship: "Sponsorship",
  manual: "Manual",
  other: "Other",
};

const SOURCE_ORDER: Source[] = [
  "cmo_retainer",
  "stripe",
  "gumroad",
  "tiktok",
  "sponsorship",
  "manual",
  "other",
];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatUSD(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 10000) return `$${(dollars / 1000).toFixed(1)}k`;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: dollars % 1 === 0 ? 0 : 2,
  });
}

function relDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return `${diff}d ago`;
  return iso.slice(5); // MM-DD
}

export function MoneyWidget() {
  const { user } = useAuth();
  const [rows, setRows] = useState<RevenueRow[] | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  // Entry form state
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<Source>("cmo_retainer");
  const [entryDate, setEntryDate] = useState(todayISO());
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    // Pull 31 days back — plenty for today / 7-day / MTD aggregates plus
    // a recent-entries list.
    const since = daysAgoISO(31);
    const { data, error } = await rdb
      .from("exec_os_revenue")
      .select("id, entry_date, source, amount_cents, currency, notes, created_at")
      .gte("entry_date", since)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) {
      // Migration not applied yet → fail soft with inline setup CTA, no toast spam.
      const msg = (error.message || "").toLowerCase();
      const code = (error as { code?: string }).code;
      if (
        code === "42P01" ||
        msg.includes("schema cache") ||
        msg.includes("does not exist") ||
        msg.includes("could not find the table")
      ) {
        setSetupNeeded(true);
        setRows([]);
        return;
      }
      toast.error("Couldn't load revenue", { description: error.message });
      setRows([]);
      return;
    }
    setSetupNeeded(false);
    setRows((data ?? []) as RevenueRow[]);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const todayCents = useMemo(() => {
    if (!rows) return 0;
    const t = todayISO();
    return rows.filter((r) => r.entry_date === t).reduce((s, r) => s + r.amount_cents, 0);
  }, [rows]);

  const sevenDayAvgCents = useMemo(() => {
    if (!rows) return 0;
    const cutoff = daysAgoISO(6); // include today + previous 6 days = 7 days
    const sum = rows
      .filter((r) => r.entry_date >= cutoff)
      .reduce((s, r) => s + r.amount_cents, 0);
    return Math.round(sum / 7);
  }, [rows]);

  const mtdCents = useMemo(() => {
    if (!rows) return 0;
    const som = startOfMonthISO();
    return rows.filter((r) => r.entry_date >= som).reduce((s, r) => s + r.amount_cents, 0);
  }, [rows]);

  const recent = useMemo(() => (rows ?? []).slice(0, 6), [rows]);

  // vs-yesterday color cue (Principle 3: money is the lead view, with signal)
  const yesterdayCents = useMemo(() => {
    if (!rows) return 0;
    const y = daysAgoISO(1);
    return rows.filter((r) => r.entry_date === y).reduce((s, r) => s + r.amount_cents, 0);
  }, [rows]);
  const todayDeltaColor =
    todayCents === 0 && yesterdayCents === 0
      ? "text-muted-foreground"
      : todayCents >= yesterdayCents
        ? "text-[color:var(--forest)]"
        : "text-[color:var(--orange)]";

  const resetForm = () => {
    setAmount("");
    setSource("cmo_retainer");
    setEntryDate(todayISO());
    setNotes("");
  };

  const submit = async () => {
    if (!user) return;
    const parsed = Number.parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Enter a positive amount");
      return;
    }
    setBusy(true);
    const { error } = await rdb.from("exec_os_revenue").insert({
      user_id: user.id,
      entry_date: entryDate,
      source,
      amount_cents: Math.round(parsed * 100),
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast.error("Couldn't save", { description: error.message });
      return;
    }
    toast.success("Logged");
    resetForm();
    setAdding(false);
    void load();
  };

  const remove = async (id: string) => {
    const prev = rows ?? [];
    setRows(prev.filter((r) => r.id !== id));
    const { error } = await rdb.from("exec_os_revenue").delete().eq("id", id);
    if (error) {
      toast.error("Couldn't delete", { description: error.message });
      setRows(prev);
    }
  };

  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (setupNeeded) {
    return (
      <div className="flex flex-col gap-2 text-xs">
        <div className="font-medium text-foreground">Revenue table not deployed yet.</div>
        <div className="text-muted-foreground leading-relaxed">
          The <code className="text-[11px] px-1 rounded bg-muted">exec_os_revenue</code> migration
          (<code className="text-[11px] px-1 rounded bg-muted">20260517120000_revenue.sql</code>)
          hasn't been applied to your Supabase project. Run{" "}
          <code className="text-[11px] px-1 rounded bg-muted">supabase db push</code> or paste it
          into the Supabase SQL editor, then refresh.
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          className="no-drag h-7 text-xs self-start mt-1"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* HERO STATS — Principle 3: money is the lead view */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Today
        </div>
        <div className={`text-3xl font-semibold tabular-nums ${todayDeltaColor}`}>
          {formatUSD(todayCents)}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Yesterday {formatUSD(yesterdayCents)} · 7-day avg{" "}
          <span className="font-medium text-foreground">{formatUSD(sevenDayAvgCents)}</span>{" "}
          · MTD <span className="font-medium text-foreground">{formatUSD(mtdCents)}</span>
        </div>
      </div>

      {/* ENTRY FORM (toggle) */}
      {adding ? (
        <div className="border border-border rounded-md p-2.5 space-y-2 bg-muted/30 no-drag">
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="no-drag h-8 text-sm"
            />
            <Select value={source} onValueChange={(v) => setSource(v as Source)}>
              <SelectTrigger className="no-drag h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SOURCE_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="no-drag h-8 text-sm"
            />
            <Input
              type="text"
              placeholder="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="no-drag h-8 text-sm"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdding(false);
                resetForm();
              }}
              className="no-drag h-7 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={busy || !amount}
              className="no-drag h-7 text-xs"
              style={{ backgroundColor: NAVY, color: "white" }}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAdding(true)}
          className="no-drag h-7 text-xs self-start"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Log revenue
        </Button>
      )}

      {/* RECENT ENTRIES */}
      <div className="flex-1 overflow-auto -mx-1 px-1">
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No entries yet. Log this week's revenue to set a baseline.
          </p>
        ) : (
          <ul className="space-y-1">
            {recent.map((r) => (
              <li
                key={r.id}
                className="group flex items-center gap-2 text-xs py-1 border-b border-border/40 last:border-b-0"
              >
                <span className="tabular-nums text-muted-foreground w-16 shrink-0">
                  {relDate(r.entry_date)}
                </span>
                <span
                  className="shrink-0 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ background: "rgba(8,61,119,0.08)", color: NAVY }}
                >
                  {SOURCE_LABEL[r.source]}
                </span>
                <span className="flex-1 truncate text-foreground">
                  {r.notes || <span className="text-muted-foreground italic">—</span>}
                </span>
                <span
                  className="tabular-nums font-medium shrink-0"
                  style={{ color: FOREST }}
                >
                  {formatUSD(r.amount_cents)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  className="no-drag opacity-0 group-hover:opacity-100 transition-opacity p-1 -m-1 text-muted-foreground hover:text-[color:var(--orange)]"
                  aria-label="Delete entry"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
