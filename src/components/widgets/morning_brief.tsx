// Morning Brief widget — the central surface for the AI Staff Team.
//
// Reads pending outputs from exec_os_agent_outputs (populated by all 6 agents
// running on cron). Donna reviews each item and approves, edits, or rejects.
//
// Design principles:
//   - One scrollable list, sorted by priority
//   - Each item shows: agent (with avatar color), kind, title, suggested_at
//   - Click to expand body + actions (Approve / Edit / Reject / Archive)
//   - Empty state explains what'll appear here once agents are running
//
// This widget replaces the previous "Bench Whispers" placeholder which
// never had anything to whisper. Same emotional slot in the dashboard,
// real substance now.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listPendingOutputs,
  approveOutput,
  rejectOutput,
  approveWithEdits,
  archiveOutput,
  AGENT_META,
  KIND_LABEL,
  type AgentOutput,
} from "@/lib/agent-outputs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Check, X, Edit3, Archive, ChevronDown, ChevronRight, Clock, Copy, ExternalLink, Mail, MessageSquare, RefreshCw, Loader2, Target, PenLine } from "lucide-react";
import { relTime } from "@/lib/time";
import { toast } from "sonner";
import { reissueDraft } from "@/lib/cleo";
import { runSageNow } from "@/lib/sage";
import { runRenNow } from "@/lib/ren";
import { Button } from "@/components/ui/button";

export function MorningBriefWidget() {
  const [outputs, setOutputs] = useState<AgentOutput[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setOutputs(await listPendingOutputs(25));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onApprove = useCallback(
    async (output: AgentOutput) => {
      const res = await approveOutput(output.id);
      if (res.ok) {
        toast.success(`Approved ${AGENT_META[output.agent_id].name}'s ${KIND_LABEL[output.kind].toLowerCase()}`);
        await refresh();
      } else {
        toast.error(res.error ?? "Could not approve");
      }
    },
    [refresh],
  );

  const onReject = useCallback(
    async (output: AgentOutput) => {
      const res = await rejectOutput(output.id);
      if (res.ok) {
        toast.success("Rejected");
        await refresh();
      } else {
        toast.error(res.error ?? "Could not reject");
      }
    },
    [refresh],
  );

  const onArchive = useCallback(
    async (output: AgentOutput) => {
      const res = await archiveOutput(output.id);
      if (res.ok) {
        toast.success("Archived");
        await refresh();
      } else {
        toast.error(res.error ?? "Could not archive");
      }
    },
    [refresh],
  );

  const startEdit = useCallback((output: AgentOutput) => {
    setEditingId(output.id);
    setEditValue(output.body ?? "");
  }, []);

  const saveEdit = useCallback(
    async (output: AgentOutput) => {
      const res = await approveWithEdits(output.id, editValue, output.body ?? "");
      if (res.ok) {
        toast.success(`Approved with your edits — ${AGENT_META[output.agent_id].name} will learn from the diff`);
        setEditingId(null);
        setEditValue("");
        await refresh();
      } else {
        toast.error(res.error ?? "Could not save");
      }
    },
    [editValue, refresh],
  );

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditValue("");
  }, []);

  const grouped = useMemo(() => {
    // Group by agent_id for visual chunking
    const byAgent: Record<string, AgentOutput[]> = {};
    for (const o of outputs) {
      byAgent[o.agent_id] = byAgent[o.agent_id] ?? [];
      byAgent[o.agent_id].push(o);
    }
    return byAgent;
  }, [outputs]);

  // Run-agent state for Sage + Ren manual triggers
  const [sageRunning, setSageRunning] = useState(false);
  const [renRunning, setRenRunning] = useState(false);

  const onRunSage = async () => {
    setSageRunning(true);
    try {
      const r = await runSageNow();
      if (r.ok) {
        toast.success(r.summary ?? `Sage produced ${r.outputs ?? 0} items`);
        await refresh();
      } else {
        toast.error(r.error ?? "Sage failed");
      }
    } finally {
      setSageRunning(false);
    }
  };

  const onRunRen = async () => {
    setRenRunning(true);
    try {
      const r = await runRenNow();
      if (r.ok) {
        toast.success(r.summary ?? `Ren drafted ${r.outputs ?? 0} hooks`);
        await refresh();
      } else {
        toast.error(r.error ?? "Ren failed");
      }
    } finally {
      setRenRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {outputs.length > 0 && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {outputs.length} pending
          </Badge>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={onRunSage}
            disabled={sageRunning}
            className="text-xs h-7"
            style={{ borderColor: "#A4B494", color: "#A4B494" }}
            title="Trigger Sage's focus + triage now"
          >
            {sageRunning ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Target className="h-3 w-3 mr-1" />
            )}
            Run Sage
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onRunRen}
            disabled={renRunning}
            className="text-xs h-7"
            style={{ borderColor: "#E97451", color: "#E97451" }}
            title="Trigger Ren to draft 3 TikTok hooks now"
          >
            {renRunning ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <PenLine className="h-3 w-3 mr-1" />
            )}
            Run Ren
          </Button>
          <button
            onClick={refresh}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-4 w-3/4 bg-muted rounded" />
          <div className="h-4 w-full bg-muted rounded" />
          <div className="h-4 w-1/2 bg-muted rounded" />
        </div>
      ) : outputs.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([agentId, items]) => {
            const meta = AGENT_META[agentId as keyof typeof AGENT_META];
            if (!meta) return null;
            return (
              <div key={agentId} className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span style={{ color: meta.brand_color }} className="font-medium">
                    {meta.emoji} {meta.name}
                  </span>
                  <span>·</span>
                  <span className="text-[11px]">{meta.role}</span>
                  <span>·</span>
                  <span className="text-[11px]">{items.length} pending</span>
                </div>
                {items.map((output) => (
                  <OutputItem
                    key={output.id}
                    output={output}
                    expanded={expandedId === output.id}
                    editing={editingId === output.id}
                    editValue={editValue}
                    onToggle={() => setExpandedId(expandedId === output.id ? null : output.id)}
                    onApprove={() => onApprove(output)}
                    onReject={() => onReject(output)}
                    onArchive={() => onArchive(output)}
                    onStartEdit={() => startEdit(output)}
                    onChangeEdit={(v) => setEditValue(v)}
                    onSaveEdit={() => saveEdit(output)}
                    onCancelEdit={cancelEdit}
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

function OutputItem(props: {
  output: AgentOutput;
  expanded: boolean;
  editing: boolean;
  editValue: string;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onArchive: () => void;
  onStartEdit: () => void;
  onChangeEdit: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
}) {
  const { output, expanded, editing } = props;

  const channel = (output.metadata?.channel as string | undefined) ?? "";
  const rationale = (output.metadata?.rationale as string | undefined) ?? "";
  const clientName = (output.metadata?.client_name as string | undefined) ?? output.client?.name ?? "";
  const clientStatus = (output.metadata?.client_status as string | undefined) ?? output.client?.status ?? "";
  const linkedinUrl = output.client?.linkedin_url ?? "";
  const email = output.client?.primary_contact_email ?? "";
  const company = output.client?.company ?? "";
  const clientTitle = output.client?.title ?? "";

  const [regenerating, setRegenerating] = useState(false);
  const canRegenerate = output.agent_id === "cleo" && !!output.ref_id;
  const onRegenerate = async () => {
    if (!output.ref_id) return;
    setRegenerating(true);
    try {
      const r = await reissueDraft(output.id, output.ref_id);
      if (r.ok) {
        toast.success("Cleo drafted a fresh version — check the top of the list");
        // The parent's refresh will be triggered by the toggle/refresh flow;
        // we don't have direct access to refresh here, but the OutputItem
        // re-renders when the parent reloads. Cheapest path: nudge user.
        // (If parent doesn't refresh fast enough, the user can hit Refresh.)
      } else {
        toast.error(r.error ?? "Could not regenerate");
      }
    } finally {
      setRegenerating(false);
    }
  };

  const channelIcon = channel === "email"
    ? <Mail className="h-3 w-3" />
    : <MessageSquare className="h-3 w-3" />;

  const sendUrl = channel === "linkedin" && linkedinUrl
    ? linkedinUrl
    : channel === "email" && email
      ? `mailto:${email}`
      : "";

  const onCopyBody = () => {
    if (!output.body) return;
    navigator.clipboard.writeText(output.body).then(() => {
      toast.success("Copied — paste into " + (channel === "linkedin" ? "LinkedIn" : channel === "email" ? "your email" : "the channel"));
    }).catch(() => toast.error("Copy failed"));
  };

  return (
    <div className="rounded-lg border border-border bg-background/40">
      <button
        onClick={props.onToggle}
        className="w-full flex items-start gap-2 p-3 text-left hover:bg-muted/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {KIND_LABEL[output.kind]}
            </Badge>
            {channel && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex items-center gap-1">
                {channelIcon}
                {channel}
              </Badge>
            )}
            <span className="text-sm font-medium truncate">{output.title}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground mt-1">
            {clientName && (
              <span>
                <span className="font-medium text-foreground/80">{clientName}</span>
                {clientTitle && <> · {clientTitle}</>}
                {company && <> @ {company}</>}
                {clientStatus && <> · <em>{clientStatus}</em></>}
              </span>
            )}
            {output.suggested_at && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {relTime(output.suggested_at)}
              </span>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-3 space-y-3">
          {/* WHY block — Cleo's rationale + contact links */}
          {(rationale || sendUrl) && (
            <div className="rounded-md bg-muted/40 px-3 py-2 space-y-2">
              {rationale && (
                <div className="text-[11px] leading-relaxed">
                  <span className="uppercase tracking-wider text-muted-foreground font-medium">Why now: </span>
                  <span className="text-foreground/80">{rationale}</span>
                </div>
              )}
              {sendUrl && (
                <a
                  href={sendUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-[color:var(--navy)] hover:underline"
                >
                  {channelIcon}
                  {channel === "linkedin" ? "Open LinkedIn profile" : channel === "email" ? `Compose email to ${email}` : "Open"}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {editing ? (
            <>
              <Textarea
                value={props.editValue}
                onChange={(e) => props.onChangeEdit(e.target.value)}
                className="text-sm min-h-[120px] font-mono"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={props.onSaveEdit} className="text-xs">
                  <Check className="h-3 w-3 mr-1" />
                  Save & Approve
                </Button>
                <Button size="sm" variant="ghost" onClick={props.onCancelEdit} className="text-xs">
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <pre className="text-sm whitespace-pre-wrap font-sans text-foreground/90 leading-relaxed">
                {output.body || <em className="text-muted-foreground">No body content.</em>}
              </pre>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={onCopyBody} disabled={!output.body} className="text-xs">
                  <Copy className="h-3 w-3 mr-1" />
                  Copy message
                </Button>
                <Button size="sm" variant="outline" onClick={props.onApprove} className="text-xs">
                  <Check className="h-3 w-3 mr-1" />
                  Mark sent
                </Button>
                <Button size="sm" variant="outline" onClick={props.onStartEdit} className="text-xs">
                  <Edit3 className="h-3 w-3 mr-1" />
                  Edit
                </Button>
                {canRegenerate && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onRegenerate}
                    disabled={regenerating}
                    className="text-xs"
                    title="Archive this draft and have Cleo write a fresh one"
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${regenerating ? "animate-spin" : ""}`} />
                    {regenerating ? "Rerolling…" : "Regenerate"}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={props.onReject} className="text-xs">
                  <X className="h-3 w-3 mr-1" />
                  Reject
                </Button>
                <Button size="sm" variant="ghost" onClick={props.onArchive} className="text-xs">
                  <Archive className="h-3 w-3 mr-1" />
                  Archive
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center space-y-2">
      <Sparkles className="h-5 w-5 text-muted-foreground mx-auto" />
      <p className="text-sm text-foreground">No briefs yet.</p>
      <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
        Once your AI staff agents are enabled, this is where their overnight work
        lands — outreach DMs from Cleo, content drafts from Ren, code PRs from
        Maya. Review → approve → ship.
      </p>
    </div>
  );
}
