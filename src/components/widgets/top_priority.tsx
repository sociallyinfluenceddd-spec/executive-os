import { Target } from "lucide-react";

export function TopPriorityWidget({ topPriority }: { topPriority: string | null }) {
  return (
    <div>
      <h2 className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
        <Target className="h-3.5 w-3.5" /> Top priority
      </h2>
      {topPriority ? (
        <p className="text-2xl font-semibold text-foreground leading-snug">{topPriority}</p>
      ) : (
        <p className="text-sm text-muted-foreground">Set your top priority in Capture.</p>
      )}
    </div>
  );
}
