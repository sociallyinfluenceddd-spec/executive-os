import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SavedIndicator } from "@/components/SavedIndicator";
import { BenchSettings } from "@/components/BenchSettings";

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

      <section className="rounded-xl border border-border bg-card p-6">
        <Button variant="outline" onClick={signOut} className="w-full">
          Sign out
        </Button>
      </section>
    </div>
  );
}
