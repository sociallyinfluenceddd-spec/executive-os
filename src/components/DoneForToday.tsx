import { useNavigate } from "@tanstack/react-router";
import confetti from "canvas-confetti";
import { useState } from "react";
import { Check } from "lucide-react";

export function DoneForToday({ onPress }: { onPress?: () => void }) {
  const navigate = useNavigate();
  const [done, setDone] = useState(false);

  const handle = () => {
    onPress?.();
    const colors = ["#9caf88", "#3b5249", "#d4a574", "#1e3a5f"];
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { x: 0.85, y: 0.9 },
      colors,
      disableForReducedMotion: true,
    });
    setTimeout(() => {
      confetti({
        particleCount: 40,
        spread: 100,
        origin: { x: 0.85, y: 0.9 },
        colors,
        disableForReducedMotion: true,
      });
    }, 200);
    setDone(true);
    setTimeout(() => {
      navigate({ to: "/" });
    }, 3000);
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {done && (
        <div className="rounded-full bg-card border border-border shadow-lg px-4 py-2 text-sm text-foreground animate-fade-in">
          Captured. See you tomorrow.
        </div>
      )}
      <button
        type="button"
        onClick={handle}
        disabled={done}
        className="inline-flex items-center gap-2 rounded-full bg-[color:var(--navy,#1e3a5f)] text-white shadow-lg px-5 py-3 text-sm font-medium hover:opacity-90 transition disabled:opacity-60"
      >
        <Check className="h-4 w-4" />
        {done ? "Done" : "Done for today"}
      </button>
    </div>
  );
}
