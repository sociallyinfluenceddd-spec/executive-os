// Pipeline widget — the 1000x unlock.
//
// Shows your fractional-exec sales pipeline at a glance: hot leads + active
// MRR + proposals out + overdue follow-ups. Click a client to expand and
// edit. Cleo (Sales Agent) writes new leads + outreach drafts that flow
// through here.
//
// Design: KPI strip at top, then a grouped list (Hot leads → Proposal out →
// Active → Paused). Clicking a row expands inline.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listClients,
  pipelineSummary,
  setClientStatus,
  updateClient,
  createClient,
  formatCents,
  CLIENT_STATUSES,
  STATUS_META,
  type Client,
  type ClientStatus,
  type PipelineSummary,
} from "@/lib/clients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, ChevronDown, ChevronRight, ExternalLink, AlertCircle, Flame, Clock, Sparkles, Loader2 } from "lucide-react";
import { relTime } from "@/lib/time";
import { toast } from "sonner";
import { runCleoNow, runCleoForClient, runCleoCold } from "@/lib/cleo";

export function PipelineWidget() {
  const [clients, setClients] = useState<Client[]>([]);
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showCleoCold, setShowCleoCold] = useState(false);
  const [cleoRunning, setCleoRunning] = useState(false);

  const onRunCleoAll = async () => {
    setCleoRunning(true);
    try {
      const r = await runCleoNow();
      if (r.ok) {
        toast.success(r.summary ?? `Cleo drafted ${r.outputs ?? 0} ${r.outputs === 1 ? "message" : "messages"}`);
      } else {
        toast.error(r.error ?? "Cleo failed");
      }
    } finally {
      setCleoRunning(false);
    }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    const [list, sum] = await Promise.all([listClients(), pipelineSummary()]);
    setClients(list);
    setSummary(sum);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const grouped = useMemo(() => {
    const byStatus: Partial<Record<ClientStatus, Client[]>> = {};
    for (const c of clients) {
      (byStatus[c.status] ??= []).push(c);
    }
    return byStatus;
  }, [clients]);

  // Display order: hot → proposal → active → paused, hide churned/lost from default view
  const displayOrder: ClientStatus[] = ["qualified", "contacted", "lead", "proposal_sent", "active", "paused"];

  return (
    <div className="space-y-4">
      {/* KPI STRIP */}
      <KpiStrip summary={summary} loading={loading} />

      {/* ACTION BAR */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Pipeline
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            onClick={onRunCleoAll}
            disabled={cleoRunning}
            className="text-xs h-7"
            style={{ backgroundColor: "#DB9C96", color: "#1a1a1a" }}
            title="Run Cleo across your whole pipeline now"
          >
            {cleoRunning ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3 mr-1" />
            )}
            {cleoRunning ? "Cleo drafting…" : "Run Cleo"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setShowCleoCold(!showCleoCold); setShowAdd(false); }}
            className="text-xs h-7"
            title="Paste a LinkedIn URL — Cleo adds them as a lead + drafts first-touch"
          >
            <Sparkles className="h-3 w-3 mr-1" />
            {showCleoCold ? "Cancel" : "Cold lead"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setShowAdd(!showAdd); setShowCleoCold(false); }}
            className="text-xs h-7"
          >
            <Plus className="h-3 w-3 mr-1" />
            {showAdd ? "Cancel" : "Add lead"}
          </Button>
        </div>
      </div>

      {showAdd && (
        <AddClientForm
          onSaved={async () => {
            setShowAdd(false);
            await refresh();
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {showCleoCold && (
        <CleoColdForm
          onDone={async () => {
            setShowCleoCold(false);
            await refresh();
          }}
          onCancel={() => setShowCleoCold(false)}
        />
      )}

      {/* GROUPED LIST */}
      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-4 w-full bg-muted rounded" />
          <div className="h-4 w-3/4 bg-muted rounded" />
        </div>
      ) : clients.length === 0 ? (
        <EmptyState onAdd={() => setShowAdd(true)} />
      ) : (
        <div className="space-y-4">
          {displayOrder.map((status) => {
            const items = grouped[status] ?? [];
            if (items.length === 0) return null;
            const meta = STATUS_META[status];
            return (
              <div key={status} className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <span style={{ color: meta.color }} className="font-medium">
                    {meta.emoji} {meta.label}
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{items.length}</span>
                </div>
                {items.map((client) => (
                  <ClientRow
                    key={client.id}
                    client={client}
                    expanded={expandedId === client.id}
                    onToggle={() =>
                      setExpandedId(expandedId === client.id ? null : client.id)
                    }
                    onRefresh={refresh}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KpiStrip({ summary, loading }: { summary: PipelineSummary | null; loading: boolean }) {
  if (loading || !summary) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 bg-muted/40 rounded animate-pulse" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <KpiTile
        label="Hot leads"
        value={String(summary.hotLeadCount)}
        accent="#E97451"
        icon={<Flame className="h-3 w-3" />}
      />
      <KpiTile
        label="Proposals out"
        value={formatCents(summary.proposalOutValueCents)}
        accent="#FFC100"
      />
      <KpiTile
        label="Active MRR"
        value={`${formatCents(summary.activeMrrCents)}/mo`}
        sublabel={`${summary.activeClientCount} ${summary.activeClientCount === 1 ? "client" : "clients"}`}
        accent="#355834"
      />
      <KpiTile
        label="Follow-ups due"
        value={String(summary.todayFollowUps + summary.overdueFollowUps)}
        sublabel={summary.overdueFollowUps > 0 ? `${summary.overdueFollowUps} overdue` : undefined}
        accent={summary.overdueFollowUps > 0 ? "#E97451" : "#A4B494"}
        icon={summary.overdueFollowUps > 0 ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      />
    </div>
  );
}

function KpiTile(props: { label: string; value: string; sublabel?: string; accent: string; icon?: React.ReactNode }) {
  return (
    <div
      className="rounded-lg border border-border bg-background/40 px-3 py-2"
      style={{ borderLeftWidth: 3, borderLeftColor: props.accent }}
    >
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {props.icon}
        {props.label}
      </div>
      <div className="text-base font-semibold mt-0.5" style={{ color: props.accent }}>
        {props.value}
      </div>
      {props.sublabel && (
        <div className="text-[10px] text-muted-foreground mt-0.5">{props.sublabel}</div>
      )}
    </div>
  );
}

function ClientRow({
  client,
  expanded,
  onToggle,
  onRefresh,
}: {
  client: Client;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => Promise<void>;
}) {
  const meta = STATUS_META[client.status];
  const isOverdue =
    client.next_action_at &&
    new Date(client.next_action_at).getTime() < Date.now() &&
    client.status !== "churned" &&
    client.status !== "lost";

  return (
    <div className="rounded-lg border border-border bg-background/40">
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-2 p-2.5 text-left hover:bg-muted/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 mt-1 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 mt-1 text-muted-foreground shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{client.name}</span>
            {client.company && (
              <span className="text-xs text-muted-foreground">@ {client.company}</span>
            )}
            {(client.mrr_cents > 0 || client.one_time_value_cents > 0) && (
              <span className="text-xs" style={{ color: meta.color }}>
                {client.mrr_cents > 0 && `${formatCents(client.mrr_cents)}/mo`}
                {client.mrr_cents > 0 && client.one_time_value_cents > 0 && " · "}
                {client.one_time_value_cents > 0 && formatCents(client.one_time_value_cents)}
              </span>
            )}
          </div>
          {client.next_action_at && (
            <div className={`flex items-center gap-1 text-[11px] mt-0.5 ${isOverdue ? "text-[color:var(--orange)]" : "text-muted-foreground"}`}>
              <Clock className="h-3 w-3" />
              {client.next_action_kind || "Follow-up"} — {relTime(client.next_action_at)}
              {isOverdue && " · overdue"}
            </div>
          )}
        </div>
      </button>
      {expanded && <ClientDetails client={client} onRefresh={onRefresh} />}
    </div>
  );
}

function ClientDetails({ client, onRefresh }: { client: Client; onRefresh: () => Promise<void> }) {
  const [status, setStatus] = useState<ClientStatus>(client.status);
  const [notes, setNotes] = useState(client.notes ?? "");
  const [nextActionAt, setNextActionAt] = useState(
    client.next_action_at ? client.next_action_at.slice(0, 16) : ""
  );
  const [nextActionKind, setNextActionKind] = useState(client.next_action_kind ?? "");
  const [mrr, setMrr] = useState(((client.mrr_cents ?? 0) / 100).toString());
  const [oneTime, setOneTime] = useState(((client.one_time_value_cents ?? 0) / 100).toString());
  const [saving, setSaving] = useState(false);
  const [cleoBusy, setCleoBusy] = useState(false);

  const onCleoForThis = async () => {
    setCleoBusy(true);
    try {
      const r = await runCleoForClient(client.id);
      if (r.ok) {
        toast.success(r.summary ?? "Cleo drafted — check Morning Brief");
      } else {
        toast.error(r.error ?? "Cleo failed");
      }
    } finally {
      setCleoBusy(false);
    }
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const patch = {
        status,
        notes: notes || null,
        next_action_at: nextActionAt ? new Date(nextActionAt).toISOString() : null,
        next_action_kind: nextActionKind || null,
        mrr_cents: Math.round((parseFloat(mrr) || 0) * 100),
        one_time_value_cents: Math.round((parseFloat(oneTime) || 0) * 100),
      };
      const res = await updateClient(client.id, patch);
      if (res.ok) {
        toast.success("Saved");
        await onRefresh();
      } else {
        toast.error(res.error ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  };

  const onAdvance = async () => {
    const idx = CLIENT_STATUSES.indexOf(client.status);
    const next = CLIENT_STATUSES[Math.min(idx + 1, 4)] as ClientStatus; // cap at 'active'
    const res = await setClientStatus(client.id, next);
    if (res.ok) {
      toast.success(`Moved to ${STATUS_META[next].label}`);
      await onRefresh();
    } else {
      toast.error(res.error ?? "Failed");
    }
  };

  return (
    <div className="border-t border-border p-3 space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</label>
          <Select value={status} onValueChange={(v) => setStatus(v as ClientStatus)}>
            <SelectTrigger className="h-8 text-xs mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLIENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {STATUS_META[s].emoji} {STATUS_META[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Next action kind</label>
          <Input
            value={nextActionKind}
            onChange={(e) => setNextActionKind(e.target.value)}
            placeholder="follow_up / send_proposal / call"
            className="h-8 text-xs mt-1"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Next action at</label>
          <Input
            type="datetime-local"
            value={nextActionAt}
            onChange={(e) => setNextActionAt(e.target.value)}
            className="h-8 text-xs mt-1"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">LinkedIn</label>
          {client.linkedin_url ? (
            <a
              href={client.linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-[color:var(--navy)] mt-2"
            >
              Open <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">—</p>
          )}
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">MRR ($/mo)</label>
          <Input
            type="number"
            value={mrr}
            onChange={(e) => setMrr(e.target.value)}
            className="h-8 text-xs mt-1"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">One-time ($)</label>
          <Input
            type="number"
            value={oneTime}
            onChange={(e) => setOneTime(e.target.value)}
            className="h-8 text-xs mt-1"
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes</label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="text-xs mt-1 min-h-[60px]"
        />
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={onSave} disabled={saving} className="text-xs">
          Save
        </Button>
        {client.status !== "active" && client.status !== "churned" && client.status !== "lost" && client.status !== "paused" && (
          <Button size="sm" variant="outline" onClick={onAdvance} className="text-xs">
            Advance stage →
          </Button>
        )}
        {client.status !== "churned" && client.status !== "lost" && (
          <Button
            size="sm"
            variant="outline"
            onClick={onCleoForThis}
            disabled={cleoBusy}
            className="text-xs"
            style={{ borderColor: "#DB9C96", color: "#DB9C96" }}
            title="Have Cleo draft outreach for this client now"
          >
            {cleoBusy ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3 mr-1" />
            )}
            Cleo draft
          </Button>
        )}
      </div>
    </div>
  );
}

function CleoColdForm({
  onDone,
  onCancel,
}: {
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [running, setRunning] = useState(false);

  const onSubmit = async () => {
    const url = linkedinUrl.trim();
    if (!url) {
      toast.error("Paste a LinkedIn URL");
      return;
    }
    if (!url.includes("linkedin.com/in/")) {
      toast.error("That doesn't look like a LinkedIn profile URL");
      return;
    }
    setRunning(true);
    try {
      const r = await runCleoCold({ linkedinUrl: url, notes: notes.trim() || undefined });
      if (r.ok) {
        toast.success(r.summary ?? "Cleo drafted — check Morning Brief");
        await onDone();
      } else {
        toast.error(r.error ?? "Cleo failed");
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="rounded-lg border bg-background/40 p-3 space-y-2"
      style={{ borderColor: "#DB9C96" }}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "#DB9C96" }}>
        <Sparkles className="h-3 w-3" />
        Cold lead — Cleo will add them and draft first-touch
      </div>
      <Input
        value={linkedinUrl}
        onChange={(e) => setLinkedinUrl(e.target.value)}
        placeholder="https://linkedin.com/in/their-handle"
        className="h-8 text-xs"
        autoFocus
      />
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional context — name, role, why they're a fit, anything you noticed. Helps Cleo since she can't scrape LinkedIn yet."
        className="text-xs min-h-[60px]"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={running}
          className="text-xs"
          style={{ backgroundColor: "#DB9C96", color: "#1a1a1a" }}
        >
          {running ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Drafting…
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3 mr-1" />
              Draft outreach
            </>
          )}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} className="text-xs">Cancel</Button>
      </div>
    </div>
  );
}

function AddClientForm({ onSaved, onCancel }: { onSaved: () => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [source, setSource] = useState("linkedin_inbound");
  const [saving, setSaving] = useState(false);

  const onSubmit = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await createClient({
        name: name.trim(),
        company: company.trim() || null,
        title: title.trim() || null,
        linkedin_url: linkedinUrl.trim() || null,
        source,
        status: "lead",
      });
      if (res.ok) {
        toast.success(`Added ${name}`);
        await onSaved();
      } else {
        toast.error(res.error ?? "Could not add");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-background/40 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name *" className="h-8 text-xs" />
        <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" className="h-8 text-xs" />
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. Fractional CMO)" className="h-8 text-xs" />
        <Input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="LinkedIn URL" className="h-8 text-xs" />
      </div>
      <Select value={source} onValueChange={setSource}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="linkedin_inbound" className="text-xs">LinkedIn — inbound</SelectItem>
          <SelectItem value="linkedin_outbound" className="text-xs">LinkedIn — outbound</SelectItem>
          <SelectItem value="referral" className="text-xs">Referral</SelectItem>
          <SelectItem value="tiktok" className="text-xs">TikTok</SelectItem>
          <SelectItem value="cold_email" className="text-xs">Cold email</SelectItem>
          <SelectItem value="other" className="text-xs">Other</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSubmit} disabled={saving} className="text-xs">Add</Button>
        <Button size="sm" variant="ghost" onClick={onCancel} className="text-xs">Cancel</Button>
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center space-y-2">
      <p className="text-sm">No clients yet.</p>
      <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
        Add your first lead manually, or wait for Cleo to surface ICP matches from your LinkedIn signals. Once Cleo's running, leads land here automatically.
      </p>
      <Button size="sm" onClick={onAdd} className="text-xs mt-2">
        <Plus className="h-3 w-3 mr-1" />
        Add first lead
      </Button>
    </div>
  );
}
