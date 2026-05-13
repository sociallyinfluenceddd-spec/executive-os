import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Agent } from "@/components/BenchRow";
import { Trash2, ArrowUp, ArrowDown, Plus } from "lucide-react";

const DEFAULT_COLOR = "#083D77";

export function BenchSettings() {
  const { user } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    role: "",
    system_prompt: "",
    color: DEFAULT_COLOR,
    avatar_letter: "",
  });

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("exec_os_agents")
      .select("*")
      .eq("user_id", user.id)
      .order("order_index");
    setAgents((data ?? []) as Agent[]);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const updateAgent = async (id: string, patch: Partial<Agent>) => {
    await supabase.from("exec_os_agents").update(patch).eq("id", id);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this avatar?")) return;
    await supabase.from("exec_os_agents").delete().eq("id", id);
    load();
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const a = agents[idx];
    const b = agents[idx + dir];
    if (!a || !b) return;
    await Promise.all([
      supabase.from("exec_os_agents").update({ order_index: b.order_index }).eq("id", a.id),
      supabase.from("exec_os_agents").update({ order_index: a.order_index }).eq("id", b.id),
    ]);
    load();
  };

  const addAgent = async () => {
    if (!user || !draft.name.trim()) return;
    const nextOrder = (agents[agents.length - 1]?.order_index ?? 0) + 1;
    await supabase.from("exec_os_agents").insert({
      user_id: user.id,
      name: draft.name.trim(),
      role: draft.role.trim() || "Custom",
      system_prompt: draft.system_prompt.trim() || "You are a helpful assistant.",
      color: draft.color || DEFAULT_COLOR,
      avatar_letter: (draft.avatar_letter || draft.name[0] || "?").toUpperCase().slice(0, 1),
      order_index: nextOrder,
    });
    setDraft({ name: "", role: "", system_prompt: "", color: DEFAULT_COLOR, avatar_letter: "" });
    setAdding(false);
    load();
  };

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Bench</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAdding((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add custom avatar
        </Button>
      </header>

      {adding && (
        <div className="rounded-lg border border-border p-4 space-y-3 bg-muted/30">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Role</Label>
              <Input
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Letter</Label>
              <Input
                maxLength={1}
                value={draft.avatar_letter}
                onChange={(e) => setDraft({ ...draft, avatar_letter: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <Input
                type="color"
                value={draft.color}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">System prompt</Label>
            <Textarea
              rows={4}
              value={draft.system_prompt}
              onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={addAgent}>
              Save
            </Button>
          </div>
        </div>
      )}

      <ul className="space-y-2">
        {agents.map((a, i) => (
          <li
            key={a.id}
            className="flex items-center gap-3 rounded-lg border border-border p-3"
          >
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center text-white font-semibold shrink-0"
              style={{ backgroundColor: a.color }}
            >
              {a.avatar_letter}
            </div>
            <div className="flex-1 min-w-0">
              <Input
                className="h-8 text-sm font-medium"
                value={a.name}
                onChange={(e) =>
                  setAgents((prev) =>
                    prev.map((p) => (p.id === a.id ? { ...p, name: e.target.value } : p)),
                  )
                }
                onBlur={(e) => updateAgent(a.id, { name: e.target.value })}
              />
              <Input
                className="h-7 text-xs mt-1 text-muted-foreground"
                value={a.role}
                onChange={(e) =>
                  setAgents((prev) =>
                    prev.map((p) => (p.id === a.id ? { ...p, role: e.target.value } : p)),
                  )
                }
                onBlur={(e) => updateAgent(a.id, { role: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="p-1 rounded hover:bg-muted disabled:opacity-30"
                aria-label="Move up"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === agents.length - 1}
                className="p-1 rounded hover:bg-muted disabled:opacity-30"
                aria-label="Move down"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
            </div>
            <button
              onClick={() => remove(a.id)}
              className="p-2 rounded hover:bg-muted text-muted-foreground"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
        {agents.length === 0 && (
          <li className="text-sm text-muted-foreground italic">
            No avatars yet. Add one to get started.
          </li>
        )}
      </ul>
    </section>
  );
}
