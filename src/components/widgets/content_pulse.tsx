import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

// exec_os_content isn't in the Supabase-generated types yet — added by
// migration 20260517140000_projects_content.sql. Untyped alias until types
// are regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cdb = supabase as any;

const NAVY = "#083D77";
const FOREST = "#355834";

type Platform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "twitter"
  | "linkedin"
  | "substack"
  | "other";

type Kind = "post" | "video" | "short" | "reel" | "story" | "article" | "script" | "other";

type ContentRow = {
  id: string;
  entry_date: string;
  platform: Platform;
  kind: Kind;
  title: string | null;
  url: string | null;
  views: number | null;
  notes: string | null;
};

const PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  twitter: "Twitter",
  linkedin: "LinkedIn",
  substack: "Substack",
  other: "Other",
};

const PLATFORM_ORDER: Platform[] = [
  "tiktok",
  "instagram",
  "youtube",
  "linkedin",
  "twitter",
  "substack",
  "other",
];

const KIND_LABEL: Record<Kind, string> = {
  post: "Post",
  video: "Video",
  short: "Short",
  reel: "Reel",
  story: "Story",
  article: "Article",
  script: "Script",
  other: "Other",
};

const KIND_ORDER: Kind[] = [
  "video",
  "short",
  "reel",
  "post",
  "story",
  "article",
  "script",
  "other",
];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatViews(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

function relDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return `${diff}d ago`;
  return iso.slice(5);
}

export function ContentPulseWidget() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ContentRow[] | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const [entryDate, setEntryDate] = useState(todayISO());
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [kind, setKind] = useState<Kind>("video");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [views, setViews] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    const since = daysAgoISO(31);
    const { data, error } = await cdb
      .from("exec_os_content")
      .select("id, entry_date, platform, kind, title, url, views, notes")
      .gte("entry_date", since)
      .order("entry_date", { ascending: false })
      .order("views", { ascending: false, nullsLast: true });
    if (error) {
      const msg = (error.message || "").toLowerCase();
      const code = (error as { code?: string }).code;
      if (
        code === "42P01" ||
        msg.includes("schema cache") ||
        msg.includes("does not exist") ||
        msg.includes("could not find the table")
      ) {
        setSetupNeeded(true);
        setRows([]);
        return;
      }
      toast.error("Couldn't load content", { description: error.message });
      setRows([]);
      return;
    }
    setSetupNeeded(false);
    setRows((data ?? []) as ContentRow[]);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const todayCount = useMemo(() => {
    if (!rows) return 0;
    const t = todayISO();
    return rows.filter((r) => r.entry_date === t).length;
  }, [rows]);

  const weekCount = useMemo(() => {
    if (!rows) return 0;
    const cutoff = daysAgoISO(6);
    return rows.filter((r) => r.entry_date >= cutoff).length;
  }, [rows]);

  const monthViews = useMemo(() => {
    if (!rows) return 0;
    return rows.reduce((s, r) => s + (r.views ?? 0), 0);
  }, [rows]);

  const recent = useMemo(() => (rows ?? []).slice(0, 8), [rows]);

  const resetForm = () => {
    setEntryDate(todayISO());
    setPlatform("tiktok");
    setKind("video");
    setTitle("");
    setUrl("");
    setViews("");
  };

  const submit = async () => {
    if (!user) return;
    const parsedViews = views.trim() ? Number.parseInt(views, 10) : null;
    if (views.trim() && (!Number.isFinite(parsedViews) || (parsedViews ?? 0) < 0)) {
      toast.error("Views must be a positive number");
      return;
    }
    setBusy(true);
    const { error } = await cdb.from("exec_os_content").insert({
      user_id: user.id,
      entry_date: entryDate,
      platform,
      kind,
      title: title.trim() || null,
      url: url.trim() || null,
      views: parsedViews,
    });
    setBusy(false);
    if (error) {
      toast.error("Couldn't save", { description: error.message });
      return;
    }
    toast.success("Logged");
    resetForm();
    setAdding(false);
    void load();
  };

  const remove = async (id: string) => {
    const prev = rows ?? [];
    setRows(prev.filter((r) => r.id !== id));
    const { error } = await cdb.from("exec_os_content").delete().eq("id", id);
    if (error) {
      toast.error("Couldn't delete", { description: error.message });
      setRows(prev);
    }
  };

  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  if (setupNeeded) {
    return (
      <div className="text-xs space-y-2">
        <div className="font-medium text-foreground">Content table not deployed yet.</div>
        <div className="text-muted-foreground leading-relaxed">
          The <code className="text-[11px] px-1 rounded bg-muted">exec_os_content</code>{" "}
          migration hasn't been applied. Once it lands, log every TikTok/Reel/post here.
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          className="no-drag h-7 text-xs"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-baseline gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Today</div>
          <div className="text-2xl font-semibold tabular-nums text-foreground">{todayCount}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">7d</div>
          <div className="text-2xl font-semibold tabular-nums text-foreground">{weekCount}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Views 30d</div>
          <div className="text-lg font-semibold tabular-nums" style={{ color: FOREST }}>
            {formatViews(monthViews)}
          </div>
        </div>
      </div>

      {adding ? (
        <div className="border border-border rounded-md p-2.5 space-y-2 bg-muted/30 no-drag">
          <div className="grid grid-cols-3 gap-2">
            <Input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="no-drag h-8 text-sm"
            />
            <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
              <SelectTrigger className="no-drag h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATFORM_ORDER.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PLATFORM_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger className="no-drag h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_ORDER.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            type="text"
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="no-drag h-8 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="url"
              placeholder="URL (optional)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="no-drag h-8 text-sm"
            />
            <Input
              type="number"
              inputMode="numeric"
              min="0"
              placeholder="Views (optional)"
              value={views}
              onChange={(e) => setViews(e.target.value)}
              className="no-drag h-8 text-sm"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdding(false);
                resetForm();
              }}
              className="no-drag h-7 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={busy}
              className="no-drag h-7 text-xs"
              style={{ backgroundColor: NAVY, color: "white" }}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAdding(true)}
          className="no-drag h-7 text-xs self-start"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Log content
        </Button>
      )}

      <div className="flex-1 overflow-auto -mx-1 px-1">
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            Nothing logged in the last 30 days. Start with a recent TikTok.
          </p>
        ) : (
          <ul className="space-y-1">
            {recent.map((r) => (
              <li
                key={r.id}
                className="group flex items-center gap-2 text-xs py-1 border-b border-border/40 last:border-b-0"
              >
                <span className="tabular-nums text-muted-foreground w-14 shrink-0">
                  {relDate(r.entry_date)}
                </span>
                <span
                  className="shrink-0 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ background: "rgba(8,61,119,0.08)", color: NAVY }}
                >
                  {PLATFORM_LABEL[r.platform]}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">{KIND_LABEL[r.kind]}</span>
                <span className="flex-1 truncate text-foreground">
                  {r.title || <span className="text-muted-foreground italic">—</span>}
                </span>
                {r.views !== null && (
                  <span className="tabular-nums text-[10px] shrink-0" style={{ color: FOREST }}>
                    {formatViews(r.views)} views
                  </span>
                )}
                {r.url && (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="no-drag shrink-0 p-1 -m-1 text-muted-foreground hover:text-[color:var(--navy)]"
                    aria-label="Open"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  className="no-drag opacity-0 group-hover:opacity-100 transition-opacity p-1 -m-1 text-muted-foreground hover:text-[color:var(--orange)]"
                  aria-label="Delete entry"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
