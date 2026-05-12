import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Video } from "lucide-react";

type EmailRow = {
  id: string;
  account: string;
  kind: "priority" | "needs_response" | "invite" | "meeting";
  sender_name: string | null;
  sender_email: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string | null;
  scheduled_at: string | null;
  attendees: unknown;
  video_url: string | null;
  status: string | null;
};

const ACCOUNTS = [
  "hello@donnabdicenso.com",
  "sociallyinfluenceddd@gmail.com",
  "sociallydonna@gmail.com",
  "ideafetti@gmail.com",
  "donna@dblankstyle.com",
];

const TABS: { key: EmailRow["kind"]; label: string; empty: string }[] = [
  { key: "priority", label: "Priority", empty: "Inbox is clear." },
  { key: "needs_response", label: "Needs response", empty: "Nothing waiting on you." },
  { key: "invite", label: "Calendar invites", empty: "No invites today." },
  { key: "meeting", label: "Upcoming meetings", empty: "No meetings on the horizon." },
];

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  if (isTomorrow) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${time}`;
}

function urgencyClass(iso: string | null): string {
  if (!iso) return "bg-[color:var(--sage)]";
  const ageH = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (ageH > 24) return "bg-rose-500";
  if (ageH > 12) return "bg-amber-400";
  return "bg-[color:var(--sage)]";
}

function accountChip(account: string): string {
  return account.split("@")[0];
}

export function EmailPanel() {
  const { user } = useAuth();
  const [account, setAccount] = useState<string>("all");
  const [tab, setTab] = useState<EmailRow["kind"]>("priority");
  const [rows, setRows] = useState<EmailRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("exec_os_emails")
        .select(
          "id,account,kind,sender_name,sender_email,subject,snippet,received_at,scheduled_at,attendees,video_url,status",
        )
        .eq("user_id", user.id);
      if (!active) return;
      setRows((data as EmailRow[]) ?? []);
      setLoaded(true);
    })();

    const channel = supabase
      .channel("exec_os_emails_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "exec_os_emails" },
        (payload) => {
          setRows((cur) => {
            if (payload.eventType === "DELETE") {
              return cur.filter((r) => r.id !== (payload.old as EmailRow).id);
            }
            const next = payload.new as EmailRow;
            const idx = cur.findIndex((r) => r.id === next.id);
            if (idx === -1) return [next, ...cur];
            const copy = cur.slice();
            copy[idx] = next;
            return copy;
          });
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [user]);

  useEffect(() => setShowAll(false), [tab, account]);

  const filtered = useMemo(() => {
    let list = rows.filter((r) => r.kind === tab);
    if (account !== "all") list = list.filter((r) => r.account === account);
    if (tab === "invite" || tab === "meeting") {
      list.sort(
        (a, b) =>
          new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime(),
      );
    } else {
      list.sort(
        (a, b) =>
          new Date(b.received_at ?? 0).getTime() - new Date(a.received_at ?? 0).getTime(),
      );
    }
    return list;
  }, [rows, tab, account]);

  const visible = showAll ? filtered : filtered.slice(0, 8);
  const tabMeta = TABS.find((t) => t.key === tab)!;

  async function setStatus(id: string, status: string) {
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, status } : r)));
    await supabase.from("exec_os_emails").update({ status }).eq("id", id);
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Inbox signal</h2>
        <Select value={account} onValueChange={setAccount}>
          <SelectTrigger className="w-full sm:w-[260px]">
            <SelectValue placeholder="All accounts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All accounts</SelectItem>
            {ACCOUNTS.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = t.key === tab;
          const count = rows.filter(
            (r) => r.kind === t.key && (account === "all" || r.account === account),
          ).length;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                active
                  ? "border-[color:var(--navy)] bg-[color:var(--navy)] text-[color:var(--primary-foreground)]"
                  : "border-border hover:bg-muted"
              }`}
            >
              {t.label}
              {count > 0 && (
                <span
                  className={`ml-1.5 text-xs ${active ? "opacity-80" : "text-muted-foreground"}`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {!loaded ? (
          <div className="space-y-2">
            <div className="h-16 w-full rounded-lg bg-muted animate-pulse" />
            <div className="h-16 w-full rounded-lg bg-muted animate-pulse" />
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{tabMeta.empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((r) => (
              <li key={r.id} className="py-3">
                {tab === "priority" || tab === "needs_response" ? (
                  <MessageItem row={r} />
                ) : tab === "invite" ? (
                  <InviteItem row={r} onStatus={(s) => setStatus(r.id, s)} />
                ) : (
                  <MeetingItem row={r} />
                )}
              </li>
            ))}
          </ul>
        )}
        {filtered.length > 8 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 px-0 text-muted-foreground"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show less" : `Show ${filtered.length - 8} more`}
          </Button>
        )}
      </div>
    </section>
  );
}

function MessageItem({ row }: { row: EmailRow }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`mt-2 h-2 w-2 rounded-full shrink-0 ${urgencyClass(row.received_at)}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-foreground truncate">
            {row.sender_name || row.sender_email || "Unknown"}
          </span>
          {row.sender_email && row.sender_name && (
            <span className="text-xs text-muted-foreground truncate">{row.sender_email}</span>
          )}
        </div>
        <div className="text-sm text-foreground truncate">{row.subject || "(no subject)"}</div>
        {row.snippet && (
          <div className="text-xs text-muted-foreground truncate mt-0.5">{row.snippet}</div>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[11px] text-muted-foreground">{relativeTime(row.received_at)}</span>
          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            {accountChip(row.account)}
          </span>
        </div>
      </div>
    </div>
  );
}

function InviteItem({
  row,
  onStatus,
}: {
  row: EmailRow;
  onStatus: (s: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium text-foreground">
          {row.subject || "(untitled event)"}
        </div>
        <div className="text-xs text-muted-foreground">
          {row.sender_name || row.sender_email || "Organizer"} · {whenLabel(row.scheduled_at)}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["accepted", "declined", "maybe"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={row.status === s ? "default" : "outline"}
            onClick={() => onStatus(s)}
          >
            {s === "accepted" ? "Accept" : s === "declined" ? "Decline" : "Maybe"}
          </Button>
        ))}
        <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground self-center">
          {accountChip(row.account)}
        </span>
      </div>
    </div>
  );
}

function MeetingItem({ row }: { row: EmailRow }) {
  const attendeeCount = Array.isArray(row.attendees) ? row.attendees.length : 0;
  const others = Math.max(0, attendeeCount - 1);
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground truncate">
          {row.subject || "(untitled meeting)"}
        </div>
        <div className="text-xs text-muted-foreground">
          {whenLabel(row.scheduled_at)}
          {others > 0 && ` · +${others} other${others > 1 ? "s" : ""}`}
        </div>
        <div className="mt-1">
          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            {accountChip(row.account)}
          </span>
        </div>
      </div>
      {row.video_url && (
        <a
          href={row.video_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-[color:var(--navy)] hover:underline shrink-0"
        >
          <Video className="h-4 w-4" /> Join
        </a>
      )}
    </div>
  );
}
