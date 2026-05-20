// Settings widget: Connect/disconnect Google Calendar.
// Drop-in replacement for the Make.com-based IntegrationHealth flow.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  getGoogleConnection,
  type GoogleConnectionStatus,
} from "@/lib/google-calendar";
import { relTime } from "@/lib/time";

export function GoogleCalendarConnection() {
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await getGoogleConnection());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onConnect = useCallback(async () => {
    setBusy(true);
    try {
      const res = await connectGoogleCalendar();
      if (res.status === "ok") {
        toast.success(`Connected ${res.account ?? "Google Calendar"}.`);
        await refresh();
      } else {
        toast.error(res.message || "Could not connect Google Calendar.");
      }
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onDisconnect = useCallback(async () => {
    if (!confirm("Disconnect Google Calendar? The dashboard will stop showing events until you reconnect.")) return;
    setBusy(true);
    try {
      const res = await disconnectGoogleCalendar();
      if (res.ok) {
        toast.success("Disconnected.");
        await refresh();
      } else {
        toast.error(res.error ?? "Could not disconnect.");
      }
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  if (status === null) {
    return (
      <section className="rounded-xl border border-border bg-card p-6 space-y-3 animate-pulse">
        <div className="h-4 w-40 bg-muted rounded" />
        <div className="h-3 w-full bg-muted rounded" />
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Google Calendar
        </p>
        {status.connected ? (
          <CheckCircle2 className="h-4 w-4 text-[color:var(--sage)]" />
        ) : (
          <AlertCircle className="h-4 w-4 text-[color:var(--orange)]" />
        )}
      </div>

      {status.connected ? (
        <>
          <div className="space-y-1">
            <p className="text-sm">
              Connected as <span className="font-medium">{status.account}</span>
            </p>
            {status.expiresAt && (
              <p className="text-xs text-muted-foreground">
                Access token refreshes automatically. Last issued{" "}
                {relTime(new Date(new Date(status.expiresAt).getTime() - 60 * 60 * 1000).toISOString())}.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onDisconnect}
              disabled={busy}
              className="text-xs"
            >
              Disconnect
            </Button>
            <Button
              size="sm"
              variant="ghost"
              asChild
              className="text-xs gap-1"
            >
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer noopener"
              >
                Revoke on Google <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Connect your Google Calendar so the dashboard can read today's events
            directly — no Make.com middleware, no daily sync delay.
          </p>
          <Button
            size="sm"
            onClick={onConnect}
            disabled={busy}
            className="w-full text-xs"
          >
            {busy ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                Opening Google…
              </>
            ) : (
              "Connect Google Calendar"
            )}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Read-only access to events. We never modify your calendar.
          </p>
        </>
      )}
    </section>
  );
}
