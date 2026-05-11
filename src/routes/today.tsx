import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { SavedIndicator } from "@/components/SavedIndicator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

export const Route = createFileRoute("/today")({
  component: () => (
    <AppShell>
      <TodayPage />
    </AppShell>
  ),
});

type DailyRow = {
  top_priority: string | null;
  must_move_1: string | null;
  must_move_2: string | null;
  must_move_3: string | null;
  energy_level: number | null;
  mood: string | null;
  blockers: string | null;
  what_moved: string | null;
  what_didnt: string | null;
  tomorrow_seed: string | null;
};

const EMPTY: DailyRow = {
  top_priority: "",
  must_move_1: "",
  must_move_2: "",
  must_move_3: "",
  energy_level: null,
  mood: "",
  blockers: "",
  what_moved: "",
  what_didnt: "",
  tomorrow_seed: "",
};

function todayDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const ENERGY_EMOJI = ["😴", "😪", "😐", "🙂", "😌", "😊", "💪", "⚡", "🔥", "🚀"];

function TodayPage() {
  const { user } = useAuth();
  const [row, setRow] = useState<DailyRow>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const entryDate = useMemo(() => todayDate(), []);
  const firstName = useMemo(() => {
    const n =
      (user?.user_metadata?.full_name as string | undefined) ||
      user?.email?.split("@")[0] ||
      "";
    return n.split(" ")[0];
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("exec_os_daily")
        .select(
          "top_priority,must_move_1,must_move_2,must_move_3,energy_level,mood,blockers,what_moved,what_didnt,tomorrow_seed"
        )
        .eq("user_id", user.id)
        .eq("entry_date", entryDate)
        .maybeSingle();
      if (!active) return;
      if (data) setRow({ ...EMPTY, ...data });
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [user, entryDate]);

  const lastSaved = useRef<string>(JSON.stringify(EMPTY));

  const saveField = useCallback(
    async (patch: Partial<DailyRow>) => {
      if (!user) return;
      const next = { ...row, ...patch };
      // Skip if no actual change vs last saved snapshot
      if (JSON.stringify(next) === lastSaved.current) return;
      // Only upsert when at least one field has a non-empty value
      const hasContent = Object.values(next).some(
        (v) => (typeof v === "string" && v.trim() !== "") || typeof v === "number"
      );
      if (!hasContent) return;
      const { error } = await supabase.from("exec_os_daily").upsert(
        {
          user_id: user.id,
          entry_date: entryDate,
          ...next,
        },
        { onConflict: "user_id,entry_date" }
      );
      if (!error) {
        lastSaved.current = JSON.stringify(next);
        setSavedAt(Date.now());
      }
    },
    [user, row, entryDate]
  );

  const update = (patch: Partial<DailyRow>) => setRow((r) => ({ ...r, ...patch }));

  const afterFivePM = new Date().getHours() >= 17;

  if (!loaded) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-2/3 bg-muted rounded-md animate-pulse" />
        <div className="h-32 w-full bg-muted rounded-xl animate-pulse" />
        <div className="h-24 w-full bg-muted rounded-xl animate-pulse" />
      </div>
    );
  }

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {greeting()}{firstName ? `, ${firstName}` : ""}.
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{dateLabel}</p>
        </div>
        <div className="pt-2">
          <SavedIndicator stamp={savedAt} />
        </div>
      </header>

      {/* Top Priority */}
      <section className="rounded-xl border border-border bg-card p-6">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Top priority
        </Label>
        <Textarea
          className="mt-3 min-h-[110px] text-lg leading-relaxed border-0 bg-transparent focus-visible:ring-0 px-0 resize-none"
          placeholder="What's the one thing that moves the needle today?"
          value={row.top_priority ?? ""}
          onChange={(e) => update({ top_priority: e.target.value })}
          onBlur={() => saveField({ top_priority: row.top_priority })}
        />
      </section>

      {/* Must-Move */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-3">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Must move
        </Label>
        {([1, 2, 3] as const).map((n) => {
          const key = `must_move_${n}` as const;
          return (
            <div key={n} className="flex items-center gap-3">
              <span className="text-sm font-medium text-[color:var(--sage)] w-5 tabular-nums">
                {n}.
              </span>
              <Input
                value={row[key] ?? ""}
                placeholder={`Must move ${n}`}
                onChange={(e) => update({ [key]: e.target.value } as Partial<DailyRow>)}
                onBlur={() => saveField({ [key]: row[key] } as Partial<DailyRow>)}
              />
            </div>
          );
        })}
      </section>

      {/* Energy + Mood */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div>
          <div className="flex items-center justify-between mb-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Energy
            </Label>
            <span className="text-2xl">
              {row.energy_level ? ENERGY_EMOJI[row.energy_level - 1] : "—"}
              <span className="ml-2 text-sm text-muted-foreground tabular-nums">
                {row.energy_level ?? "—"}/10
              </span>
            </span>
          </div>
          <Slider
            value={[row.energy_level ?? 5]}
            min={1}
            max={10}
            step={1}
            onValueChange={(v) => update({ energy_level: v[0] })}
            onValueCommit={(v) => saveField({ energy_level: v[0] })}
          />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Mood
          </Label>
          <Input
            className="mt-2"
            placeholder="One word, a phrase, anything…"
            value={row.mood ?? ""}
            onChange={(e) => update({ mood: e.target.value })}
            onBlur={() => saveField({ mood: row.mood })}
          />
        </div>
      </section>

      {/* Reflection */}
      <Collapsible defaultOpen={afterFivePM}>
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <CollapsibleTrigger className="w-full flex items-center justify-between p-6 group">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Reflection
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-6 pb-6 space-y-5">
              {(
                [
                  ["blockers", "Blockers"],
                  ["what_moved", "What moved"],
                  ["what_didnt", "What didn't"],
                  ["tomorrow_seed", "Tomorrow's seed"],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    {label}
                  </Label>
                  <Textarea
                    className="mt-2 min-h-[80px] resize-none"
                    value={row[key] ?? ""}
                    onChange={(e) =>
                      update({ [key]: e.target.value } as Partial<DailyRow>)
                    }
                    onBlur={() =>
                      saveField({ [key]: row[key] } as Partial<DailyRow>)
                    }
                  />
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </section>
      </Collapsible>
    </div>
  );
}
