import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Pin,
  ExternalLink,
  Folder,
  Copy,
  Plus,
  Archive,
  Pause,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AppShell } from "@/components/AppShell";
import { StackTab } from "@/components/StackTab";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

// exec_os_artifacts isn't in generated types yet — added by migration
// 20260517160000_artifacts.sql. Untyped alias until types regenerate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adb = supabase as any;

const NAVY = "#083D77";
const SAGE = "#A4B494";

type Kind =
  | "workflow"
  | "doc"
  | "dashboard"
  | "tool"
  | "migration"
  | "spec"
  | "note"
  | "data";

type Category =
  | "ideafetti"
  | "exec_os"
  | "cmo_business"
  | "socially_influenceddd"
  | "research"
  | "strategy"
  | "tools";

type LocationType = "url" | "file" | "embedded" | "app_route";

type Artifact = {
  id: string;
  title: string;
  emoji: string | null;
  kind: Kind;
  category: Category;
  location_type: LocationType;
  location: string;
  summary: string | null;
  status: "active" | "parked" | "archived";
  is_pinned: boolean;
  sort_order: number;
  last_touched: string | null;
  opened_count: number;
  notes: string | null;
};

const CATEGORY_LABEL: Record<Category, string> = {
  ideafetti: "Ideafetti",
  exec_os: "Exec OS",
  cmo_business: "CMO Business",
  socially_influenceddd: "Socially Influenceddd",
  research: "Research",
  strategy: "Strategy",
  tools: "Tools",
};

const CATEGORY_COLOR: Record<Category, string> = {
  ideafetti: "#7C3AED",
  exec_os: NAVY,
  cmo_business: "#E97451",
  socially_influenceddd: "#DB9C96",
  research: "#355834",
  strategy: "#FFC100",
  tools: "#6B7280",
};

const KIND_LABEL: Record<Kind, string> = {
  workflow: "Workflow",
  doc: "Doc",
  dashboard: "Dashboard",
  tool: "Tool",
  migration: "Migration",
  spec: "Spec",
  note: "Note",
  data: "Data",
};

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return iso.slice(0, 10);
}

function HubPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Artifact[] | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await adb
      .from("exec_os_artifacts")
      .select(
        "id, title, emoji, kind, category, location_type, location, summary, status, is_pinned, sort_order, last_touched, opened_count, notes",
      )
      .order("is_pinned", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("last_touched", { ascending: false });
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
      toast.error("Couldn't load artifacts", { description: error.message });
      setRows([]);
      return;
    }
    setSetupNeeded(false);
    setRows((data ?? []) as Artifact[]);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showArchived && r.status === "archived") return false;
      if (activeCategory !== "all" && r.category !== activeCategory) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.summary ?? "").toLowerCase().includes(q) ||
        r.kind.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
      );
    });
  }, [rows, query, activeCategory, showArchived]);

  const pinned = useMemo(
    () => filtered.filter((r) => r.is_pinned && r.status === "active"),
    [filtered],
  );
  const rest = useMemo(
    () => filtered.filter((r) => !r.is_pinned || r.status !== "active"),
    [filtered],
  );

  const categoryCounts = useMemo(() => {
    if (!rows) return {} as Record<Category | "all", number>;
    const counts: Record<string, number> = { all: 0 };
    rows.forEach((r) => {
      if (!showArchived && r.status === "archived") return;
      counts.all = (counts.all ?? 0) + 1;
      counts[r.category] = (counts[r.category] ?? 0) + 1;
    });
    return counts as Record<Category | "all", number>;
  }, [rows, showArchived]);

  const openArtifact = async (a: Artifact) => {
    // Touch + count optimistically
    setRows((cur) =>
      cur
        ? cur.map((r) =>
            r.id === a.id
              ? { ...r, last_touched: new Date().toISOString(), opened_count: r.opened_count + 1 }
              : r,
          )
        : cur,
    );
    void adb
      .from("exec_os_artifacts")
      .update({
        last_touched: new Date().toISOString(),
        opened_count: a.opened_count + 1,
      })
      .eq("id", a.id);

    if (a.location_type === "url") {
      window.open(a.location, "_blank", "noopener,noreferrer");
    } else if (a.location_type === "app_route") {
      // Same-app navigation
      window.location.assign(a.location);
    } else if (a.location_type === "file") {
      // Browsers block file:// from non-file pages. Best UX: copy the path
      // so user can paste into Finder / VS Code / `open <path>`.
      await navigator.clipboard.writeText(a.location).catch(() => {});
      toast.success("Path copied", {
        description: a.location,
        duration: 6000,
      });
    } else {
      toast.info("Embedded view not built yet", { description: a.title });
    }
  };

  const togglePin = async (a: Artifact) => {
    const next = !a.is_pinned;
    setRows((cur) =>
      cur ? cur.map((r) => (r.id === a.id ? { ...r, is_pinned: next } : r)) : cur,
    );
    const { error } = await adb
      .from("exec_os_artifacts")
      .update({ is_pinned: next })
      .eq("id", a.id);
    if (error) {
      toast.error("Couldn't update pin", { description: error.message });
      setRows((cur) =>
        cur ? cur.map((r) => (r.id === a.id ? { ...r, is_pinned: !next } : r)) : cur,
      );
    }
  };

  const cycleStatus = async (a: Artifact) => {
    const order: Artifact["status"][] = ["active", "parked", "archived"];
    const next = order[(order.indexOf(a.status) + 1) % order.length];
    setRows((cur) =>
      cur ? cur.map((r) => (r.id === a.id ? { ...r, status: next } : r)) : cur,
    );
    const { error } = await adb
      .from("exec_os_artifacts")
      .update({ status: next })
      .eq("id", a.id);
    if (error) {
      toast.error("Couldn't update status", { description: error.message });
    }
  };

  const copyLocation = async (loc: string) => {
    await navigator.clipboard.writeText(loc).catch(() => {});
    toast.success("Copied", { description: loc });
  };

  // ---------- Render ----------
  if (rows === null) {
    return (
      <AppShell wide>
        <div className="space-y-3">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </AppShell>
    );
  }

  if (setupNeeded) {
    return (
      <AppShell wide>
        <div className="max-w-xl mx-auto py-12 text-center">
          <h1 className="text-2xl font-semibold mb-3" style={{ color: NAVY }}>
            Hub not deployed yet
          </h1>
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
            The <code className="px-1 rounded bg-muted">exec_os_artifacts</code> table from
            migration{" "}
            <code className="px-1 rounded bg-muted">20260517160000_artifacts.sql</code> hasn't
            been applied to your Supabase project yet. Once Lovable applies it, your hub
            populates with every doc, dashboard, and tool you've built.
          </p>
          <Button onClick={() => void load()} variant="outline">
            Retry
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell wide>
      <div className="space-y-5 pb-24">
        {/* HEADER */}
        <div>
          <div className="text-[11px] uppercase tracking-[0.3em] font-semibold mb-1" style={{ color: "#FFC100" }}>
            Hub
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold" style={{ color: NAVY, fontFamily: "Cambria, Georgia, serif" }}>
            Where everything lives.
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Docs are the artifacts you've made. Stack is the services you use — what each one does, why you keep it, what it costs.
          </p>
        </div>

        {/* TOP-LEVEL TABS: Docs (artifacts) vs Stack (tools) */}
        <Tabs defaultValue="docs" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="docs">Docs</TabsTrigger>
            <TabsTrigger value="stack">Stack</TabsTrigger>
          </TabsList>

          <TabsContent value="stack" className="space-y-4 m-0">
            <StackTab />
          </TabsContent>

          <TabsContent value="docs" className="space-y-5 m-0">

        {/* SEARCH */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by title, summary, or tag…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 h-10"
            />
          </div>
          <Button
            type="button"
            variant={showArchived ? "default" : "outline"}
            size="sm"
            onClick={() => setShowArchived((v) => !v)}
            className="h-10"
          >
            <Archive className="h-3.5 w-3.5 mr-1" />
            {showArchived ? "Hide" : "Show"} archived
          </Button>
        </div>

        {/* CATEGORY TABS */}
        <div className="flex gap-2 flex-wrap">
          {(["all", "ideafetti", "exec_os", "cmo_business", "socially_influenceddd", "research", "strategy", "tools"] as const).map(
            (cat) => {
              const isActive = activeCategory === cat;
              const count = categoryCounts[cat] ?? 0;
              const color = cat === "all" ? NAVY : CATEGORY_COLOR[cat];
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`text-xs px-3 py-1.5 rounded-full transition-colors border ${
                    isActive
                      ? "text-white"
                      : "text-foreground bg-background hover:bg-muted"
                  }`}
                  style={{
                    backgroundColor: isActive ? color : undefined,
                    borderColor: color,
                  }}
                >
                  {cat === "all" ? "All" : CATEGORY_LABEL[cat]}{" "}
                  <span
                    className="ml-1 text-[10px] opacity-70"
                  >
                    {count}
                  </span>
                </button>
              );
            },
          )}
        </div>

        {/* PINNED */}
        {pinned.length > 0 && (
          <section>
            <div className="text-[11px] uppercase tracking-[0.2em] font-semibold mb-2 flex items-center gap-1 text-muted-foreground">
              <Pin className="h-3 w-3" /> Pinned
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {pinned.map((a) => (
                <ArtifactCard
                  key={a.id}
                  a={a}
                  onOpen={openArtifact}
                  onTogglePin={togglePin}
                  onCycleStatus={cycleStatus}
                  onCopy={copyLocation}
                />
              ))}
            </div>
          </section>
        )}

        {/* REST */}
        {rest.length > 0 && (
          <section>
            <div className="text-[11px] uppercase tracking-[0.2em] font-semibold mb-2 text-muted-foreground">
              {pinned.length > 0 ? "Everything else" : "All artifacts"}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {rest.map((a) => (
                <ArtifactCard
                  key={a.id}
                  a={a}
                  onOpen={openArtifact}
                  onTogglePin={togglePin}
                  onCycleStatus={cycleStatus}
                  onCopy={copyLocation}
                />
              ))}
            </div>
          </section>
        )}

        {/* EMPTY */}
        {filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground">
              {query
                ? "No matches. Try a different search."
                : "No artifacts yet. They'll appear here as you build."}
            </p>
          </div>
        )}

        {/* ADD NEW (placeholder) */}
        <div className="pt-4 text-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              toast.info("Add-artifact form coming next session", {
                description: "For now, insert via Supabase SQL editor.",
              })
            }
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add artifact
          </Button>
        </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function ArtifactCard({
  a,
  onOpen,
  onTogglePin,
  onCycleStatus,
  onCopy,
}: {
  a: Artifact;
  onOpen: (a: Artifact) => void;
  onTogglePin: (a: Artifact) => void;
  onCycleStatus: (a: Artifact) => void;
  onCopy: (loc: string) => void;
}) {
  const isParked = a.status === "parked";
  const isArchived = a.status === "archived";
  return (
    <div
      className={`group border border-border rounded-lg p-3.5 bg-card hover:shadow-md transition-shadow ${
        isArchived ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl leading-none shrink-0 mt-0.5">{a.emoji ?? "📄"}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={() => onOpen(a)}
              className="text-left font-semibold text-sm text-foreground hover:text-[color:var(--navy)] transition-colors truncate flex-1"
            >
              {a.title}
            </button>
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => onTogglePin(a)}
                title={a.is_pinned ? "Unpin" : "Pin"}
                className="p-1 rounded hover:bg-muted"
              >
                <Pin
                  className={`h-3.5 w-3.5 ${a.is_pinned ? "text-[color:var(--yellow)] fill-[color:var(--yellow)]" : "text-muted-foreground"}`}
                />
              </button>
              <button
                type="button"
                onClick={() => onCopy(a.location)}
                title="Copy location"
                className="p-1 rounded hover:bg-muted text-muted-foreground"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onCycleStatus(a)}
                title={`Status: ${a.status} (click to cycle)`}
                className="p-1 rounded hover:bg-muted text-muted-foreground"
              >
                {isParked ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : isArchived ? (
                  <Archive className="h-3.5 w-3.5" />
                ) : (
                  <span className="text-[10px] font-semibold">●</span>
                )}
              </button>
            </div>
          </div>
          {a.summary && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
              {a.summary}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge
              variant="outline"
              className="text-[10px] py-0 px-1.5 font-medium"
              style={{
                backgroundColor: CATEGORY_COLOR[a.category] + "15",
                borderColor: CATEGORY_COLOR[a.category] + "55",
                color: CATEGORY_COLOR[a.category],
              }}
            >
              {CATEGORY_LABEL[a.category]}
            </Badge>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {KIND_LABEL[a.kind]}
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {relTime(a.last_touched)}
            </span>
            <button
              type="button"
              onClick={() => onOpen(a)}
              className="ml-1 inline-flex items-center gap-1 text-[10px] font-medium text-[color:var(--navy)] hover:underline"
            >
              {a.location_type === "url" ? (
                <>
                  Open <ExternalLink className="h-2.5 w-2.5" />
                </>
              ) : a.location_type === "app_route" ? (
                <>Go →</>
              ) : (
                <>
                  Copy path <Folder className="h-2.5 w-2.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/hub")({
  component: HubPage,
});
