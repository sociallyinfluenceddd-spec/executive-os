import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

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

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </header>

      <section className="rounded-xl border border-border bg-card p-6 space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Account
        </p>
        <p className="text-sm">{user?.email}</p>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <Button variant="outline" onClick={signOut} className="w-full">
          Sign out
        </Button>
      </section>
    </div>
  );
}
