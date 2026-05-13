import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff, X, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

const PLACEHOLDERS = [
  "What's on your mind?",
  "What are you avoiding?",
  "What just happened?",
  "Brain dump anything…",
];

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

function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CaptureModal({
  open,
  onClose,
  onCaptured,
}: {
  open: boolean;
  onClose: () => void;
  onCaptured?: () => void;
}) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [phIndex, setPhIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [source, setSource] = useState<"text" | "voice">("text");
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const recRef = useRef<any>(null);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setPhIndex((i) => (i + 1) % PLACEHOLDERS.length), 4000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setText("");
      setExtracted(null);
      setSource("text");
      if (recording) recRef.current?.stop();
    }
  }, [open, recording]);

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
    r.onerror = () => setRecording(false);
    r.onend = () => setRecording(false);
    recRef.current = r;
    r.start();
    setRecording(true);
  };

  const applyExtracted = async (ex: Extracted) => {
    if (!user) return;
    const dailyPatch: Record<string, unknown> = {};
    if (ex.top_priority) dailyPatch.top_priority = ex.top_priority;
    if (ex.must_moves?.[0]) dailyPatch.must_move_1 = ex.must_moves[0];
    if (ex.must_moves?.[1]) dailyPatch.must_move_2 = ex.must_moves[1];
    if (ex.must_moves?.[2]) dailyPatch.must_move_3 = ex.must_moves[2];
    if (typeof ex.energy_level === "number") dailyPatch.energy_level = ex.energy_level;
    if (ex.mood) dailyPatch.mood = ex.mood;
    if (ex.blockers) dailyPatch.blockers = ex.blockers;
    if (ex.what_moved) dailyPatch.what_moved = ex.what_moved;
    if (ex.what_didnt) dailyPatch.what_didnt = ex.what_didnt;
    if (ex.tomorrow_seed) dailyPatch.tomorrow_seed = ex.tomorrow_seed;

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
    }

    if (ex.decisions?.length) {
      const rows = ex.decisions.map((d) => ({
        user_id: user.id,
        decision_text: d.text,
        category: d.category ?? null,
      }));
      await supabase.from("exec_os_decisions").insert(rows);
    }
  };

  const submit = async () => {
    if (!user || !text.trim() || submitting) return;
    setSubmitting(true);
    if (recording) recRef.current?.stop();
    const raw = text.trim();
    try {
      const { data: cap, error } = await supabase
        .from("exec_os_captures")
        .insert({ user_id: user.id, raw_text: raw, source })
        .select("id")
        .single();
      if (error) throw error;

      let ex: Extracted = {};
      try {
        const { data: fn, error: fnErr } = await supabase.functions.invoke(
          "extract-from-capture",
          { body: { text: raw } },
        );
        if (fnErr) throw fnErr;
        ex = (fn?.extracted ?? {}) as Extracted;
      } catch (e) {
        console.error("extract failed", e);
      }
      await applyExtracted(ex);
      await supabase
        .from("exec_os_captures")
        .update({ extracted: ex, routed_to: [] })
        .eq("id", cap.id);

      setExtracted(ex);
      setText("");
      onCaptured?.();
      setTimeout(() => {
        onClose();
      }, 1400);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to capture");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const chipLabels: string[] = [];
  if (extracted) {
    extracted.decisions?.forEach((d) => chipLabels.push(`Decision: ${d.text}`));
    if (extracted.top_priority) chipLabels.push(`Priority: ${extracted.top_priority}`);
    extracted.must_moves?.forEach((m) => chipLabels.push(`Must move: ${m}`));
    if (typeof extracted.energy_level === "number")
      chipLabels.push(`Energy: ${extracted.energy_level}/10`);
    if (extracted.mood) chipLabels.push(`Mood: ${extracted.mood}`);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-xl bg-card border-t sm:border border-border sm:rounded-2xl rounded-t-2xl shadow-2xl p-5 space-y-4 animate-slide-in-from-bottom"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "slideUp 0.25s ease-out" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Capture</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {extracted ? (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2 text-[color:var(--forest)]">
              <Check className="h-5 w-5" />
              <span className="text-sm font-medium">Captured ✓</span>
            </div>
            {chipLabels.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {chipLabels.map((c, i) => (
                  <span
                    key={i}
                    className="text-xs px-2.5 py-1 rounded-full bg-[color:var(--sage)]/20 text-[color:var(--forest)]"
                  >
                    {c}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Saved as raw note.</p>
            )}
          </div>
        ) : (
          <>
            <Textarea
              autoFocus
              rows={6}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (source !== "voice") setSource("text");
              }}
              placeholder={PLACEHOLDERS[phIndex]}
              className="min-h-[160px] resize-none border-0 shadow-none focus-visible:ring-0 px-0 text-base"
            />
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={toggleMic}
                className={recording ? "border-destructive text-destructive" : ""}
              >
                {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              {recording && (
                <span className="text-xs text-destructive animate-pulse">Listening…</span>
              )}
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
          </>
        )}
      </div>
      <style>{`@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
    </div>
  );
}
