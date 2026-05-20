import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { CalendarDays, Mic, Settings as SettingsIcon, MessageSquare, Compass } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export function AppShell({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
      </div>
    );
  }

  const items = [
    { to: "/today", label: "Today", icon: CalendarDays },
    { to: "/hub", label: "Hub", icon: Compass },
    { to: "/capture", label: "Capture", icon: Mic },
    { to: "/advisors", label: "Toolkit", icon: MessageSquare },
    { to: "/settings", label: "Settings", icon: SettingsIcon },
  ] as const;

  const containerClass = wide
    ? "mx-auto max-w-[1400px] px-3 sm:px-5 lg:px-6 pt-4 sm:pt-6"
    : "mx-auto max-w-2xl px-4 sm:px-5 pt-6 sm:pt-8";

  return (
    <div className="min-h-screen bg-background pb-24">
      <main className={containerClass}>{children}</main>
      <nav className="fixed bottom-0 inset-x-0 border-t border-border bg-card/95 backdrop-blur z-40">
        <div className="mx-auto max-w-2xl grid grid-cols-5">
          {items.map(({ to, label, icon: Icon }) => {
            const active = location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={`flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

