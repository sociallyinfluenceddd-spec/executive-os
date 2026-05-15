import { Mic } from "lucide-react";

export function VoiceCaptureWidget() {
  return (
    <div>
      <h2 className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
        <Mic className="h-3.5 w-3.5" /> Voice capture
      </h2>
      <p className="text-sm text-muted-foreground">Coming soon</p>
    </div>
  );
}
