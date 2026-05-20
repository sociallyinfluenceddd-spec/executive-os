import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SavedIndicator } from "@/components/SavedIndicator";
import { BenchSettings } from "@/components/BenchSettings";
import { PersonalizationSettings } from "@/components/PersonalizationSettings";
import { GoogleCalendarConnection } from "@/components/settings/GoogleCalendarConnection";
import { relTime } from "@/lib/time";
import { RefreshCw, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  component: () => (
    <AppShell>
      <SettingsPage />
    </AppShell>
  ),
});

function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const lastSaved = useRef<string>("");

  useEffect(() => {
    const initial =
      (user?.user_metadata?.display_name as string | undefined) ?? "";
    setDisplayName(initial);
    lastSaved.current = initial;
  }, [user]);

  const saveDisplayName = async () => {
    const next = displayName.trim();
    if (next === lastSaved.current) return;
    const { error } = await supabase.auth.updateUser({
      data: { display_name: next },
    });
    if (!error) {
      lastSaved.current = next;
      setSavedAt(Date.now());
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <div className="pt-2">
          <SavedIndicator stamp={savedAt} />
        </div>
      </header>

      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="space-y-2">
          <Label
            htmlFor="display-name"
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            Display name
          </Label>
          <Input
            id="display-name"
            value={displayName}
            placeholder="What should we call you?"
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={saveDisplayName}
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Account
          </p>
          <p className="text-sm">{user?.email}</p>
        </div>
      </section>

      <BenchSettings />

      <PersonalizationSettings />

      <GoogleCalendarConnection />

      <IntegrationHealth />

      <section className="rounded-xl border border-border bg-card p-6">
        <Button variant="outline" onClick={signOut} className="w-full">
          Sign out
        </Button>
      </section>
    </div>
  );
}

type SourceStatus = {
  lastAt: string | null;
  count: number;
};

function IntegrationHealth() {
  const { user } = useAuth();
  const [cal, setCal] = useState<SourceStatus | null>(null);
  const [email, setEmail] = useState<SourceStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const sb = supabase as any;
    const [calLast, calCount, emailLast, emailCount] = await Promise.all([
      // Use created_at (row insertion time) not start_at (event date) to show last ingest time
      sb.from("exec_os_calendar_events").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("exec_os_calendar_events").select("*", { count: "exact", head: true }),
      sb.from("exec_os_emails").select("received_at").not("received_at", "is", null).order("received_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("exec_os_emails").select("*", { count: "exact", head: true }),
    ]);
    setCal({ lastAt: calLast.data?.created_at ?? null, count: calCount.count ?? 0 });
    setEmail({ lastAt: emailLast.data?.received_at ?? null, count: emailCount.count ?? 0 });
    setLoaded(true);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const refreshCalendar = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("refresh-calendars", { body: {} });
      if (error) {
        const msg = (error.message ?? "").toLowerCase();
        if (msg.includes("500") || msg.includes("make_api_token")) {
          toast.error("Make.com token not set — add MAKE_API_TOKEN in Lovable Cloud → Settings → Secrets.", { duration: 8000 });
        } else {
          toast.error("Sync trigger unavailable — run Make.com scenarios #5067108 and #5072163 manually.", { duration: 10000 });
        }
        return;
      }
      const results = (data?.results ?? []) as Array<{ ok: boolean; id: string; error?: string }>;
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast.success("Calendar sync triggered — new events will appear in ~30 seconds.");
      } else if (failed.length === results.length) {
        toast.error(`Make.com scenarios failed: ${failed.map((r) => r.error ?? r.id).join(", ")}`);
      } else {
        toast.warning(`${failed.length}/${results.length} scenarios failed`);
      }
      // Reload health after brief delay
      setTimeout(() => void load(), 5000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, load]);

  if (!loaded) {
    return (
      <section className="rounded-xl border border-border bg-card p-6 space-y-3 animate-pulse">
        <div className="h-4 w-40 bg-muted rounded" />
        <div className="h-3 w-full bg-muted rounded" />
        <div className="h-3 w-full bg-muted rounded" />
      </section>
    );
  }

  const calAgeMs = cal?.lastAt ? Date.now() - new Date(cal.lastAt).getTime() : null;
  const emailAgeMs = email?.lastAt ? Date.now() - new Date(email.lastAt).getTime() : null;
  const calStale = !cal?.lastAt || (calAgeMs != null && calAgeMs > 86_400_000 * 2);
  const emailStale = !email?.lastAt || (emailAgeMs != null && emailAgeMs > 86_400_000 * 2);

  function RowIcon({ stale }: { stale: boolean }) {
    return stale
      ? <AlertCircle className="h-4 w-4 text-[color:var(--orange)] shrink-0 mt-0.5" />
      : <CheckCircle2 className="h-4 w-4 text-[color:var(--sage)] shrink-0 mt-0.5" />;
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Integration health
        </p>
        <button
          onClick={() => void load()}
          className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {/* Calendar */}
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <RowIcon stale={calStale} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Google Calendar</span>
              <span className="text-[11px] text-muted-foreground">{cal?.count ?? 0} events stored</span>
            </div>
            {cal?.lastAt ? (
              <p className={`text-xs mt-0.5 ${calStale ? "text-[color:var(--orange)]" : "text-muted-foreground"}`}>
                Last synced: {relTime(cal.lastAt)}
                {calStale && " — sync may be paused"}
              </p>
            ) : (cal?.count ?? 0) > 0 ? (
              <p className="text-xs mt-0.5 text-[color:var(--orange)]">
                Events exist but missing dates — check Make.com field mapping
              </p>
            ) : (
              <p className="text-xs mt-0.5 text-[color:var(--rose)]">
                No events in database — Make.com scenario not running
              </p>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs h-8"
          onClick={refreshCalendar}
          disabled={refreshing}
        >
          {refreshing ? (
            <><RefreshCw className="h-3 w-3 mr-1.5 animate-spin" />Triggering Make.com…</>
          ) : (
            <><RefreshCw className="h-3 w-3 mr-1.5" />Trigger calendar sync now</>
          )}
        </Button>
        {calStale && (
          <p className="text-[11px] text-muted-foreground">
            If sync keeps failing, check Make.com scenarios{" "}
            <span className="font-mono text-foreground">#5067108</span> and{" "}
            <span className="font-mono text-foreground">#5072163</span> — they may be paused or erroring.
          </p>
        )}
      </div>

      <div className="border-t border-border" />

      {/* Email */}
      <div className="flex items-start gap-2">
        <RowIcon stale={emailStale} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Gmail</span>
            <span className="text-[11px] text-muted-foreground">{email?.count ?? 0} emails stored</span>
          </div>
          {email?.lastAt ? (
            <p className={`text-xs mt-0.5 ${emailStale ? "text-[color:var(--orange)]" : "text-muted-foreground"}`}>
              Last email received: {relTime(email.lastAt)}
              {emailStale && " — ingester may be paused"}
            </p>
          ) : (
            <p className="text-xs mt-0.5 text-[color:var(--rose)]">
              No emails in database — Make.com email scenario not running
            </p>
          )}
          {emailStale && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Gmail ingests via a separate Make.com scenario that POSTs to the
              ingest-email edge function. Check Make.com for errors or a paused trigger.
            </p>
          )}
        </div>
      </div>

      {/* Token reminder */}
      <div className="flex items-start gap-2 pt-1 border-t border-border">
        <Clock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground">
          Make.com runs calendar sync at 5am daily. The{" "}
          <span className="font-mono">MAKE_API_TOKEN</span> and{" "}
          <span className="font-mono">INGEST_TOKEN</span> secrets must be set in
          Lovable Cloud → Settings → Secrets.
        </p>
      </div>
    </section>
  );
}
