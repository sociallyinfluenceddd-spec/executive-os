import { useEffect, useMemo, useState } from "react";
import { Mail, CalendarDays, MessageSquare, MessageSquareMore } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { relTime } from "@/lib/time";

type Channel = "email" | "calendar" | "text" | "social";
type Tab = "all" | Channel;

// Subset shapes — we only read these fields off the row, not the whole
// generated-types union. Keeps the boundary typed without dragging in the
// full table schema.
type EmailRowLite = {
  id: string;
  external_id?: string | null;
  kind: "priority" | "needs_response" | "invite" | "meeting" | string;
  sender_name?: string | null;
  sender_email?: string | null;
  subject?: string | null;
  snippet?: string | null;
  received_at: string;
};
type CalendarRowLite = {
  id: string;
  title?: string | null;
  description?: string | null;
  start_at: string;
  end_at?: string | null;
  organizer_email?: string | null;
  calendar_name?: string | null;
  status?: string | null;
  video_url?: string | null;
  location?: string | null;
};
export type FollowUpRaw = EmailRowLite | CalendarRowLite;

export type FollowUp = {
  id: string;
  channel: Channel;
  sender: string;
  preview: string;
  timestamp: string;
  priority: "high" | "normal";
  source_url: string | null;
  raw: FollowUpRaw;
};

const STORAGE_KEY = "execOs.followups.activeTab.v1";
const NAVY = "#083D77";
const ORANGE = "#E97451";

const CHANNEL_ICON: Record<Channel, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  calendar: CalendarDays,
  text: MessageSquare,
  social: MessageSquareMore,
};

export function FollowUpsWidget({
  userId,
  userEmail,
  onOpenEvent,
}: {
  userId: string | undefined;
  userEmail: string | undefined;
  onOpenEvent: (event: CalendarRowLite) => void;
}) {
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "all";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return (stored as Tab) || "all";
  });
  const [items, setItems] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, tab);
  }, [tab]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const fourteenAgo = new Date(Date.now() - 14 * 86400_000).toISOString();
      const now = new Date();
      const in72h = new Date(now.getTime() + 72 * 3600_000).toISOString();
      const in24h = new Date(now.getTime() + 24 * 3600_000).toISOString();

      const [emailRes, calRes] = await Promise.all([
        supabase
          .from("exec_os_emails")
          .select("id,external_id,kind,sender_name,sender_email,subject,snippet,received_at")
          .eq("user_id", userId!)
          .in("kind", ["needs_response", "priority"])
          .gte("received_at", fourteenAgo),
        supabase
          .from("exec_os_calendar_events")
          .select("*")
          .eq("user_id", userId!)
          .gte("start_at", now.toISOString())
          .lte("start_at", in72h),
      ]);

      if (cancelled) return;

      const emails: FollowUp[] = ((emailRes.data ?? []) as EmailRowLite[]).map((e) => ({
        id: `email:${e.id}`,
        channel: "email",
        sender: e.sender_name || e.sender_email || "Unknown",
        preview: e.subject || e.snippet || "(no subject)",
        timestamp: e.received_at,
        priority: e.kind === "priority" ? "high" : "normal",
        source_url: e.sender_email ? `mailto:${e.sender_email}` : null,
        raw: e,
      }));

      const cal: FollowUp[] = ((calRes.data ?? []) as CalendarRowLite[])
        .filter(
          (c) =>
            c.status === "needsAction" ||
            (!!c.video_url && !!c.start_at && c.start_at <= in24h),
        )
        .map((c) => {
          const startsIn = new Date(c.start_at).getTime() - now.getTime();
          return {
            id: `calendar:${c.id}`,
            channel: "calendar" as const,
            sender: c.organizer_email || c.calendar_name || "Calendar",
            preview: c.title || c.description || "(untitled event)",
            timestamp: c.start_at,
            priority: startsIn <= 2 * 3600_000 ? ("high" as const) : ("normal" as const),
            source_url: null,
            raw: c,
          };
        });

      const merged = [...emails, ...cal].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      });
      setItems(merged);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const counts = useMemo(
    () => ({
      all: items.length,
      email: items.filter((i) => i.channel === "email").length,
      calendar: items.filter((i) => i.channel === "calendar").length,
      text: 0,
      social: 0,
    }),
    [items],
  );

  const visible = tab === "all" ? items : items.filter((i) => i.channel === tab);

  async function notifyMe(feature: string) {
    const { error } = await supabase
      .from("feature_interest")
      .insert({ feature, user_email: userEmail ?? null });
    if (error) toast.error("Couldn't save — try again");
    else toast.success("We'll let you know when it's ready ✨");
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "email", label: "Email" },
    { id: "calendar", label: "Calendar" },
    { id: "text", label: "Text" },
    { id: "social", label: "Social" },
  ];

  function handleClick(f: FollowUp) {
    if (f.channel === "email" && f.source_url) {
      window.location.href = f.source_url;
    } else if (f.channel === "calendar") {
      // f.raw is guaranteed to be a CalendarRowLite because we only set
      // channel="calendar" on calendar rows during the map above.
      onOpenEvent(f.raw as CalendarRowLite);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Tab strip */}
      <div className="no-drag flex items-center gap-4 overflow-x-auto border-b border-border -mx-1 px-1">
        {TABS.map((t) => {
          const active = tab === t.id;
          const count = counts[t.id];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="relative whitespace-nowrap py-1.5 text-xs font-medium transition-colors"
              style={{ color: active ? NAVY : "hsl(var(--muted-foreground))" }}
            >
              {t.label} ({count})
              {active && (
                <span
                  className="absolute left-0 right-0 -bottom-px h-0.5"
                  style={{ background: NAVY }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Body */}
      {tab === "text" ? (
        <StubState
          message="iMessage sync requires a Mac helper app. Coming in Phase 3b."
          onNotify={() => notifyMe("imessage_sync")}
        />
      ) : tab === "social" ? (
        <StubState
          message="MessageSquareMore and TikTok DM access is API-restricted. Coming in Phase 3b."
          onNotify={() => notifyMe("social_dms")}
        />
      ) : loading ? (
        <div className="flex flex-col gap-2 py-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : visible.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">All caught up ✨</p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((f) => {
            const Icon = CHANNEL_ICON[f.channel];
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => handleClick(f)}
                  className="no-drag group w-full flex items-center gap-3 py-2 text-left hover:bg-muted/40 rounded-md px-2 -mx-2 transition-colors"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-[#083D77] transition-colors" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-foreground truncate">
                      {f.sender}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {f.preview}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-muted-foreground">
                      {relTime(f.timestamp)}
                    </span>
                    {f.priority === "high" && (
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: ORANGE }}
                        aria-label="High priority"
                      />
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StubState({ message, onNotify }: { message: string; onNotify: () => void }) {
  return (
    <div className="no-drag flex flex-col items-start gap-3 py-6">
      <p className="text-xs text-muted-foreground">{message}</p>
      <Button size="sm" variant="outline" onClick={onNotify}>
        Notify me when ready
      </Button>
    </div>
  );
}
