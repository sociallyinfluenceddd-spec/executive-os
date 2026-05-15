import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/capture")({
  component: () => (
    <AppShell>
      <CapturePage />
    </AppShell>
  ),
});

const PLACEHOLDERS = [
  "What's on your mind?",
  "What are you avoiding?",
  "What just happened?",
  "Brain dump anything…",
];

const CATEGORIES = ["Hire", "Money", "Product", "Client", "Personal", "Other"];

type Extracted = {
  decisions?: { text: string; category?: string }[];
  top_priority?: string;
  must_moves?: string[];
  energy_level?: number;
  mood?: string;
  blockers?: string;
  what_moved?: string;
  what_didnt?: string;
  tomorrow_seed?: string;
};

type CaptureRow = {
  id: string;
  raw_text: string;
  source: string;
  captured_at: string;
  extracted: Extracted | null;
  routed_to: string[] | null;
};

function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function relTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function CapturePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [phIndex, setPhIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [source, setSource] = useState<"text" | "voice">("text");
  const [latest, setLatest] = useState<CaptureRow | null>(null);
  const [history, setHistory] = useState<CaptureRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const recRef = useRef<any>(null);

  useEffect(() => {
    const id = setInterval(() => setPhIndex((i) => (i + 1) % PLACEHOLDERS.length), 4000);
    return () => clearInterval(id);
  }, []);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("exec_os_captures")
      .select("id,raw_text,source,captured_at,extracted,routed_to")
      .eq("user_id", user.id)
      .order("captured_at", { ascending: false })
      .limit(30);
    setHistory((data ?? []) as CaptureRow[]);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const SR = useMemo(() => {
    if (typeof window === "undefined") return null;
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  }, []);

  const toggleMic = () => {
    if (!SR) {
      toast.error("Voice input not supported in this browser");
      return;
    }
    if (recording) {
      recRef.current?.stop();
      return;
    }
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    let base = text;
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tr = e.results[i][0].transcript;
        if (e.results[i].isFinal) base += (base ? " " : "") + tr.trim();
        else interim += tr;
      }
      setText(base + (interim ? (base ? " " : "") + interim : ""));
      setSource("voice");
    };
    r.onerror = (e: { error?: string; message?: string }) => {
      const code = e?.error;
      const msg =
        code === "not-allowed" || code === "service-not-allowed"
          ? "Mic permission denied. Allow microphone access in your browser settings."
          : code === "no-speech"
            ? "No speech detected — try again."
            : code === "audio-capture"
              ? "No microphone detected."
              : `Voice input error: ${code ?? e?.message ?? "unknown"}`;
      toast.error(msg);
      setRecording(false);
    };
    r.onend = () => setRecording(false);
    recRef.current = r;
    r.start();
    setRecording(true);
  };

  const applyExtracted = async (extracted: Extracted) => {
    if (!user) return [] as string[];
    const routed: string[] = [];

    // Daily upsert
    const dailyPatch: Record<string, unknown> = {};
    if (extracted.top_priority) dailyPatch.top_priority = extracted.top_priority;
    if (extracted.must_moves?.[0]) dailyPatch.must_move_1 = extracted.must_moves[0];
    if (extracted.must_moves?.[1]) dailyPatch.must_move_2 = extracted.must_moves[1];
    if (extracted.must_moves?.[2]) dailyPatch.must_move_3 = extracted.must_moves[2];
    if (typeof extracted.energy_level === "number")
      dailyPatch.energy_level = extracted.energy_level;
    if (extracted.mood) dailyPatch.mood = extracted.mood;
    if (extracted.blockers) dailyPatch.blockers = extracted.blockers;
    if (extracted.what_moved) dailyPatch.what_moved = extracted.what_moved;
    if (extracted.what_didnt) dailyPatch.what_didnt = extracted.what_didnt;
    if (extracted.tomorrow_seed) dailyPatch.tomorrow_seed = extracted.tomorrow_seed;

    if (Object.keys(dailyPatch).length) {
      const entry_date = todayDate();
      const { data: existing } = await supabase
        .from("exec_os_daily")
        .select(
          "top_priority,must_move_1,must_move_2,must_move_3,energy_level,mood,blockers,what_moved,what_didnt,tomorrow_seed",
        )
        .eq("user_id", user.id)
        .eq("entry_date", entry_date)
        .maybeSingle();
      // Don't overwrite filled fields
      const merged: Record<string, unknown> = { ...(existing ?? {}) };
      for (const [k, v] of Object.entries(dailyPatch)) {
        const cur = (existing as any)?.[k];
        if (cur === null || cur === undefined || cur === "") merged[k] = v;
      }
      await supabase
        .from("exec_os_daily")
        .upsert(
          { user_id: user.id, entry_date, ...merged },
          { onConflict: "user_id,entry_date" },
        );
      routed.push("daily");
    }

    if (extracted.decisions?.length) {
      const rows = extracted.decisions.map((d) => ({
        user_id: user.id,
        decision_text: d.text,
        category: d.category ?? null,
      }));
      await supabase.from("exec_os_decisions").insert(rows);
      routed.push("decisions");
    }

    return routed;
  };

  const submit = async () => {
    if (!user || !text.trim() || submitting) return;
    setSubmitting(true);
    if (recording) recRef.current?.stop();
    const raw = text.trim();
    const src = source;
    try {
      // Insert capture first
      const { data: cap, error } = await supabase
        .from("exec_os_captures")
        .insert({ user_id: user.id, raw_text: raw, source: src })
        .select("id,raw_text,source,captured_at,extracted,routed_to")
        .single();
      if (error) throw error;

      // Call AI extract
      let extracted: Extracted = {};
      try {
        const { data: fn, error: fnErr } = await supabase.functions.invoke(
          "extract-from-capture",
          { body: { text: raw } },
        );
        if (fnErr) throw fnErr;
        extracted = (fn?.extracted ?? {}) as Extracted;
      } catch (e) {
        console.error("extract failed", e);
        toast.error("AI extraction failed — capture saved as raw text");
      }

      const routed = await applyExtracted(extracted);

      await supabase
        .from("exec_os_captures")
        .update({ extracted, routed_to: routed })
        .eq("id", cap.id);

      const updated: CaptureRow = {
        ...(cap as CaptureRow),
        extracted,
        routed_to: routed,
      };
      setLatest(updated);
      setHistory((h) => [updated, ...h]);
      setText("");
      setSource("text");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to capture");
    } finally {
      setSubmitting(false);
    }
  };

  const removeChip = async (key: string, idx?: number) => {
    if (!latest?.extracted) return;
    const ex = { ...latest.extracted } as Extracted;
    if (key === "decision" && typeof idx === "number") {
      const decs = (ex.decisions ?? []).slice();
      // Find decision in DB and delete it
      const dec = decs[idx];
      decs.splice(idx, 1);
      ex.decisions = decs;
      if (dec) {
        await supabase
          .from("exec_os_decisions")
          .delete()
          .eq("user_id", user!.id)
          .eq("decision_text", dec.text)
          .order("decided_at", { ascending: false })
          .limit(1);
      }
    } else {
      const entry_date = todayDate();
      const dailyKeyMap: Record<string, string> = {
        top_priority: "top_priority",
        energy_level: "energy_level",
        mood: "mood",
        blockers: "blockers",
        what_moved: "what_moved",
        what_didnt: "what_didnt",
        tomorrow_seed: "tomorrow_seed",
      };
      if (key === "must_moves" && typeof idx === "number") {
        const moves = (ex.must_moves ?? []).slice();
        moves.splice(idx, 1);
        ex.must_moves = moves;
        const col = `must_move_${idx + 1}`;
        await supabase
          .from("exec_os_daily")
          .update({ [col]: null } as never)
          .eq("user_id", user!.id)
          .eq("entry_date", entry_date);
      } else if (dailyKeyMap[key]) {
        (ex as any)[key] = undefined;
        await supabase
          .from("exec_os_daily")
          .update({ [dailyKeyMap[key]]: null } as never)
          .eq("user_id", user!.id)
          .eq("entry_date", entry_date);
      }
    }
    const next = { ...latest, extracted: ex };
    setLatest(next);
    setHistory((h) => h.map((c) => (c.id === latest.id ? next : c)));
    await supabase.from("exec_os_captures").update({ extracted: ex }).eq("id", latest.id);
  };

  const renderChips = (cap: CaptureRow, removable: boolean) => {
    const ex = cap.extracted;
    if (!ex) return null;
    const chips: { label: string; onRemove?: () => void }[] = [];
    ex.decisions?.forEach((d, i) =>
      chips.push({
        label: `Decision: ${d.text}`,
        onRemove: removable ? () => removeChip("decision", i) : undefined,
      }),
    );
    if (ex.top_priority)
      chips.push({
        label: `Priority: ${ex.top_priority}`,
        onRemove: removable ? () => removeChip("top_priority") : undefined,
      });
    ex.must_moves?.forEach((m, i) =>
      chips.push({
        label: `Must move: ${m}`,
        onRemove: removable ? () => removeChip("must_moves", i) : undefined,
      }),
    );
    if (typeof ex.energy_level === "number")
      chips.push({
        label: `Energy: ${ex.energy_level}/10`,
        onRemove: removable ? () => removeChip("energy_level") : undefined,
      });
    if (ex.mood)
      chips.push({
        label: `Mood: ${ex.mood}`,
        onRemove: removable ? () => removeChip("mood") : undefined,
      });
    if (ex.blockers)
      chips.push({
        label: `Blocker: ${ex.blockers}`,
        onRemove: removable ? () => removeChip("blockers") : undefined,
      });
    if (ex.what_moved)
      chips.push({
        label: `Moved: ${ex.what_moved}`,
        onRemove: removable ? () => removeChip("what_moved") : undefined,
      });
    if (ex.what_didnt)
      chips.push({
        label: `Didn't: ${ex.what_didnt}`,
        onRemove: removable ? () => removeChip("what_didnt") : undefined,
      });
    if (ex.tomorrow_seed)
      chips.push({
        label: `Tomorrow: ${ex.tomorrow_seed}`,
        onRemove: removable ? () => removeChip("tomorrow_seed") : undefined,
      });

    if (!chips.length) return null;
    return (
      <div className="flex flex-wrap gap-2">
        {chips.map((c, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[color:var(--sage)]/20 text-[color:var(--forest)]"
          >
            {c.label}
            {c.onRemove ? (
              <button
                onClick={c.onRemove}
                className="hover:text-destructive"
                aria-label="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-24">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Capture</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Brain dump. We'll sort it.
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
        <Textarea
          rows={8}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (source !== "voice") setSource("text");
          }}
          placeholder={PLACEHOLDERS[phIndex]}
          className="min-h-[180px] resize-none border-0 shadow-none focus-visible:ring-0 px-0 text-base"
        />
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={toggleMic}
            className={recording ? "border-destructive text-destructive" : ""}
            aria-label={recording ? "Stop recording" : "Start voice input"}
          >
            {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          {recording ? (
            <span className="text-xs text-destructive animate-pulse">Listening…</span>
          ) : null}
          <Button
            onClick={submit}
            disabled={!text.trim() || submitting}
            className="ml-auto px-6"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Capturing…
              </>
            ) : (
              "Capture"
            )}
          </Button>
        </div>
      </div>

      {latest ? (
        <div className="rounded-xl border border-[color:var(--sage)]/40 bg-[color:var(--sage)]/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[color:var(--forest)]">Captured ✓</p>
            <button
              onClick={() => setLatest(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              dismiss
            </button>
          </div>
          {latest.extracted && Object.keys(latest.extracted).length ? (
            renderChips(latest, true) ?? (
              <p className="text-xs text-muted-foreground">Saved as raw note.</p>
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              Saved as raw note — nothing structured detected.
            </p>
          )}
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground px-1">
          Recent captures
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Nothing captured yet.
          </p>
        ) : (
          <div className="space-y-2">
            {history.map((c) => {
              const open = openId === c.id;
              return (
                <div
                  key={c.id}
                  className="rounded-xl border border-border bg-card overflow-hidden"
                >
                  <button
                    onClick={() => setOpenId(open ? null : c.id)}
                    className="w-full text-left p-4"
                  >
                    <p className="text-sm leading-relaxed line-clamp-2">{c.raw_text}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                      <span>{relTime(c.captured_at)}</span>
                      {c.source === "voice" ? (
                        <span className="inline-flex items-center gap-1">
                          · <Mic className="h-3 w-3" /> voice
                        </span>
                      ) : null}
                      {c.routed_to?.length ? (
                        <span>· routed to {c.routed_to.join(", ")}</span>
                      ) : null}
                    </div>
                  </button>
                  {open ? (
                    <div className="px-4 pb-4 pt-0 border-t border-border">
                      <p className="text-xs text-muted-foreground my-3">
                        AI extracted:
                      </p>
                      {c.extracted && Object.keys(c.extracted).length
                        ? renderChips(c, false) ?? (
                            <p className="text-xs text-muted-foreground">
                              Nothing structured.
                            </p>
                          )
                        : (
                          <p className="text-xs text-muted-foreground">
                            Nothing structured.
                          </p>
                        )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
