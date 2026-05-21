// Settings widget: Connect/disconnect MULTIPLE Google accounts.
//
// Each account in exec_os_google_tokens is a separate row. The Inbox +
// Calendar widgets read across all connected accounts. Disconnect is
// scoped to a single account; connecting another opens a fresh OAuth
// flow without overwriting existing tokens.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, ExternalLink, Loader2, Mail, Calendar, Plus, Unplug } from "lucide-react";
import { toast } from "sonner";
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  getGoogleConnections,
  type GoogleAccountRow,
} from "@/lib/google-calendar";
import { relTime } from "@/lib/time";

export function GoogleCalendarConnection() {
  const [accounts, setAccounts] = useState<GoogleAccountRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setAccounts(await getGoogleConnections());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onConnect = useCallback(async () => {
    setBusy(true);
    try {
      const res = await connectGoogleCalendar();
      if (res.status === "ok") {
        toast.success(`Connected ${res.account ?? "Google account"}.`);
        await refresh();
      } else {
        toast.error(res.message || "Could not connect Google account.");
      }
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onDisconnectAccount = useCallback(async (account: string) => {
    if (!confirm(`Disconnect ${account}? The dashboard will stop pulling its email and calendar.`)) return;
    setBusy(true);
    try {
      const res = await disconnectGoogleCalendar(account);
      if (res.ok) {
        toast.success(`Disconnected ${account}.`);
        await refresh();
      } else {
        toast.error(res.error ?? "Could not disconnect.");
      }
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  if (accounts === null) {
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
          Google accounts ({accounts.length})
        </p>
        {accounts.length > 0 ? (
          <CheckCircle2 className="h-4 w-4 text-[color:var(--sage)]" />
        ) : (
          <AlertCircle className="h-4 w-4 text-[color:var(--orange)]" />
        )}
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Connect each Gmail account you want the dashboard to read — inbox
          + calendar. Each one runs its own OAuth, stored separately.
        </p>
      ) : (
        <ul className="space-y-2">
          {accounts.map((acc) => (
            <li
              key={acc.account}
              className="rounded-lg border border-border bg-background/40 p-3 flex items-center gap-3"
            >
              <div className="flex items-center gap-1.5 shrink-0">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" title="Calendar connected" />
                {acc.hasGmail && (
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" title="Gmail connected" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{acc.account}</p>
                <p className="text-[11px] text-muted-foreground">
                  {acc.hasGmail ? "Calendar + Gmail" : "Calendar only"}
                  {" · "}
                  Last issued {relTime(new Date(new Date(acc.expiresAt).getTime() - 60 * 60 * 1000).toISOString())}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDisconnectAccount(acc.account)}
                disabled={busy}
                className="text-[11px] gap-1 shrink-0"
                title="Disconnect this account"
              >
                <Unplug className="h-3 w-3" />
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button
        size="sm"
        variant={accounts.length === 0 ? "default" : "outline"}
        onClick={onConnect}
        disabled={busy}
        className="w-full text-xs gap-1.5"
      >
        {busy ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            Opening Google…
          </>
        ) : (
          <>
            <Plus className="h-3 w-3" />
            {accounts.length === 0 ? "Connect Google account" : "Connect another account"}
          </>
        )}
      </Button>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
        <span>Read-only. We never modify your data.</span>
        <a
          href="https://myaccount.google.com/permissions"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          Revoke on Google <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </section>
  );
}
