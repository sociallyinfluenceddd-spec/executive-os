import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { EmailPanel } from "@/components/EmailPanel";
import { SavedChip } from "@/components/SavedChip";
import { DoneForToday } from "@/components/DoneForToday";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

type SectionKey = "priority" | "energy" | "mood" | "must" | "reflection";

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

const ENERGY_OPTIONS = [
  { value: 2, emoji: "😴", label: "Drained" },
  { value: 4, emoji: "😐", label: "Low" },
  { value: 6, emoji: "🙂", label: "Okay" },
  { value: 8, emoji: "⚡", label: "Sharp" },
  { value: 10, emoji: "🔥", label: "On fire" },
];

const MOOD_PRESETS = ["calm", "scattered", "focused", "anxious", "tired", "energized"];

const REFLECTION_STEPS = [
  { key: "blockers", label: "Blockers", placeholder: "e.g. waiting on legal review" },
  { key: "what_moved", label: "What moved", placeholder: "e.g. shipped Q3 plan" },
  { key: "what_didnt", label: "What didn't", placeholder: "e.g. pricing deck stalled" },
  { key: "tomorrow_seed", label: "Tomorrow's seed", placeholder: "e.g. start with the deck" },
] as const;

function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function TodayPage() {
  const { user } = useAuth();
  const [row, setRow] = useState<DailyRow>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [savedSections, setSavedSections] = useState<Record<SectionKey, number | null>>({
    priority: null,
    energy: null,
    mood: null,
    must: null,
    reflection: null,
  });
  const [showMore, setShowMore] = useState(false);
  const [showMustMoves, setShowMustMoves] = useState(false);
  const [visibleMustMoves, setVisibleMustMoves] = useState(1);
  const [showReflection, setShowReflection] = useState(false);
  const [reflectionStep, setReflectionStep] = useState(0);
  const [moodCustom, setMoodCustom] = useState(false);

  const entryDate = useMemo(() => todayDate(), []);
  const firstName = useMemo(() => {
    const display = (user?.user_metadata?.display_name as string | undefined)?.trim();
    if (display) return display.split(" ")[0];
    return user?.email?.split("@")[0] ?? "";
  }, [user]);

  const lastSaved = useRef<string>(JSON.stringify(EMPTY));

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("exec_os_daily")
        .select(
          "top_priority,must_move_1,must_move_2,must_move_3,energy_level,mood,blockers,what_moved,what_didnt,tomorrow_seed",
        )
        .eq("user_id", user.id)
        .eq("entry_date", entryDate)
        .maybeSingle();
      if (!active) return;
      if (data) {
        const merged = { ...EMPTY, ...data };
        setRow(merged);
        lastSaved.current = JSON.stringify(merged);
        if (merged.must_move_1 || merged.must_move_2 || merged.must_move_3) {
          setShowMustMoves(true);
          setVisibleMustMoves(merged.must_move_3 ? 3 : merged.must_move_2 ? 2 : 1);
        }
        if (merged.blockers || merged.what_moved || merged.what_didnt || merged.tomorrow_seed) {
          setShowReflection(true);
        }
        if (merged.mood && !MOOD_PRESETS.includes(merged.mood)) {
          setMoodCustom(true);
        }
      }
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [user, entryDate]);

  const persist = useCallback(
    async (next: DailyRow, section?: SectionKey) => {
      if (!user) return;
      if (JSON.stringify(next) === lastSaved.current) return;
      const hasContent = Object.values(next).some(
        (v) => (typeof v === "string" && v.trim() !== "") || typeof v === "number",
      );
      if (!hasContent) return;
      const { error } = await supabase
        .from("exec_os_daily")
        .upsert(
          { user_id: user.id, entry_date: entryDate, ...next },
          { onConflict: "user_id,entry_date" },
        );
      if (!error) {
        lastSaved.current = JSON.stringify(next);
        if (section) {
          setSavedSections((prev) => ({ ...prev, [section]: Date.now() }));
        }
      }
    },
    [user, entryDate],
  );

  const saveField = useCallback(
    (patch: Partial<DailyRow>, section?: SectionKey) =>
      persist({ ...row, ...patch }, section),
    [row, persist],
  );

  const setAndSave = (patch: Partial<DailyRow>, section?: SectionKey) => {
    const next = { ...row, ...patch };
    setRow(next);
    persist(next, section);
  };

  const update = (patch: Partial<DailyRow>) => setRow((r) => ({ ...r, ...patch }));

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
    <div className="space-y-6 pb-24">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{dateLabel}</p>
      </header>

      {/* Top Priority */}
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Top priority
          </Label>
          <SavedChip at={savedSections.priority} />
        </div>
        <Textarea
          className="mt-3 min-h-[110px] text-lg leading-relaxed border-0 bg-transparent focus-visible:ring-0 px-0 resize-none"
          placeholder="e.g. close the Acme proposal"
          value={row.top_priority ?? ""}
          onChange={(e) => update({ top_priority: e.target.value })}
          onBlur={() => saveField({ top_priority: row.top_priority }, "priority")}
        />
      </section>

      {/* Energy */}
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Energy</Label>
          <SavedChip at={savedSections.energy} />
        </div>
        <div className="mt-3 grid grid-cols-5 gap-2">
          {ENERGY_OPTIONS.map((opt) => {
            const active = row.energy_level === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAndSave({ energy_level: opt.value }, "energy")}
                className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-3 transition-colors ${
                  active
                    ? "border-[color:var(--navy)] bg-[color:var(--navy)]/5"
                    : "border-border hover:bg-muted"
                }`}
              >
                <span className="text-2xl leading-none">{opt.emoji}</span>
                <span className="text-[11px] text-muted-foreground">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Mood */}
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Mood</Label>
          <SavedChip at={savedSections.mood} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {MOOD_PRESETS.map((m) => {
            const active = row.mood === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMoodCustom(false);
                  setAndSave({ mood: m }, "mood");
                }}
                className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                  active
                    ? "border-[color:var(--navy)] bg-[color:var(--navy)] text-[color:var(--primary-foreground)]"
                    : "border-border hover:bg-muted"
                }`}
              >
                {m}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMoodCustom((v) => !v)}
            className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
              moodCustom
                ? "border-[color:var(--navy)] bg-muted"
                : "border-dashed border-border hover:bg-muted"
            }`}
          >
            Other…
          </button>
        </div>
        {moodCustom && (
          <Textarea
            className="mt-3 min-h-[76px] resize-none"
            placeholder="e.g. cautiously optimistic"
            value={row.mood && !MOOD_PRESETS.includes(row.mood) ? row.mood : ""}
            onChange={(e) => update({ mood: e.target.value })}
            onBlur={() => saveField({ mood: row.mood }, "mood")}
            autoFocus
          />
        )}
      </section>

      <EmailPanel />

      {!showMore ? (
        <Button
          variant="outline"
          className="w-full justify-start text-muted-foreground"
          onClick={() => setShowMore(true)}
        >
          <Plus className="h-4 w-4" /> Add more
        </Button>
      ) : (
        <div className="space-y-4">
          {!showMustMoves ? (
            <Button
              variant="outline"
              className="w-full justify-start text-muted-foreground"
              onClick={() => setShowMustMoves(true)}
            >
              <Plus className="h-4 w-4" /> Add must-moves
            </Button>
          ) : (
            <section className="rounded-xl border border-border bg-card p-6 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Must move
                </Label>
                <SavedChip at={savedSections.must} />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-[color:var(--sage)] w-5 tabular-nums">
                  1.
                </span>
                <Input
                  value={row.must_move_1 ?? ""}
                  placeholder="e.g. send contract"
                  onChange={(e) => update({ must_move_1: e.target.value })}
                  onBlur={() => saveField({ must_move_1: row.must_move_1 }, "must")}
                  autoFocus
                />
              </div>
              {visibleMustMoves >= 2 && (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-[color:var(--sage)] w-5 tabular-nums">
                    2.
                  </span>
                  <Input
                    value={row.must_move_2 ?? ""}
                    placeholder="e.g. book follow-up"
                    onChange={(e) => update({ must_move_2: e.target.value })}
                    onBlur={() => saveField({ must_move_2: row.must_move_2 }, "must")}
                  />
                </div>
              )}
              {visibleMustMoves >= 3 && (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-[color:var(--sage)] w-5 tabular-nums">
                    3.
                  </span>
                  <Input
                    value={row.must_move_3 ?? ""}
                    placeholder="e.g. prep client brief"
                    onChange={(e) => update({ must_move_3: e.target.value })}
                    onBlur={() => saveField({ must_move_3: row.must_move_3 }, "must")}
                  />
                </div>
              )}
              {visibleMustMoves < 3 &&
                (visibleMustMoves === 1 ? row.must_move_1 : row.must_move_2)?.trim() && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-0 text-muted-foreground hover:bg-transparent"
                    onClick={() => setVisibleMustMoves((count) => Math.min(3, count + 1))}
                  >
                    <Plus className="h-4 w-4" /> another
                  </Button>
                )}
            </section>
          )}

          {!showReflection ? (
            <Button
              variant="outline"
              className="w-full justify-start text-muted-foreground"
              onClick={() => setShowReflection(true)}
            >
              <Plus className="h-4 w-4" /> Reflect on today
            </Button>
          ) : (
            <section className="rounded-xl border border-border bg-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  {REFLECTION_STEPS[reflectionStep].label}
                </Label>
                <div className="flex items-center gap-3">
                  <SavedChip at={savedSections.reflection} />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {reflectionStep + 1} / {REFLECTION_STEPS.length}
                  </span>
                </div>
              </div>
              {(() => {
                const step = REFLECTION_STEPS[reflectionStep];
                const key = step.key;
                return (
                  <Textarea
                    key={key}
                    className="min-h-[100px] resize-none"
                    placeholder={step.placeholder}
                    value={(row[key] as string | null) ?? ""}
                    onChange={(e) => update({ [key]: e.target.value } as Partial<DailyRow>)}
                    onBlur={() => saveField({ [key]: row[key] } as Partial<DailyRow>, "reflection")}
                    autoFocus
                  />
                );
              })()}
              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={reflectionStep === 0}
                  onClick={() => setReflectionStep((s) => Math.max(0, s - 1))}
                >
                  ← Back
                </Button>
                {reflectionStep < REFLECTION_STEPS.length - 1 ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      saveField(
                        {
                          [REFLECTION_STEPS[reflectionStep].key]:
                            row[REFLECTION_STEPS[reflectionStep].key],
                        } as Partial<DailyRow>,
                        "reflection",
                      );
                      setReflectionStep((s) => s + 1);
                    }}
                  >
                    Next →
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">All done.</span>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      <DoneForToday
        onPress={() => {
          setShowMore(false);
          setShowMustMoves(false);
          setShowReflection(false);
          setMoodCustom(false);
        }}
      />
    </div>
  );
}
