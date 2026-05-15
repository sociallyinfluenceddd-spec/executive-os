import { CheckCircle2 } from "lucide-react";

export function DoneTodayWidget() {
  return (
    <div className="space-y-2">
      <h2 className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        <CheckCircle2 className="h-3.5 w-3.5" /> Done for today
      </h2>
      <p className="text-xs text-muted-foreground">
        Wrap the day with a deliberate shutdown. Use the floating "Done for today" button at the bottom-right to confirm.
      </p>
    </div>
  );
}
