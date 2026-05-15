// Composer for advisor chat: textarea + paperclip + slash menu + model badge
// + boost-to-Opus toggle.
import { useEffect, useRef, useState } from "react";
import { Paperclip, Send, Slash, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { ModelTier } from "@/config/advisors";

const SLASH_COMMANDS: { slash: string; description: string; insert: string }[] = [
  { slash: "/summarize-day", description: "Summarize today's calendar + email + captures", insert: "Summarize my day so far. Pull from calendar, email, and captures." },
  { slash: "/draft-reply", description: "Draft a reply to the most recent priority email", insert: "Draft a reply to my most recent priority email." },
  { slash: "/whats-blocking-me", description: "Find blockers across daily logs", insert: "Look at my last 7 days of daily logs and tell me what's blocking me." },
  { slash: "/turn-into-tasks", description: "Extract tasks from recent captures", insert: "Pull tasks out of my recent captures and create them." },
  { slash: "/weekly-review", description: "Generate a weekly review", insert: "Walk me through a weekly review of what moved and what didn't." },
];

export interface ComposerProps {
  agentTier: ModelTier;
  disabled: boolean;
  onSend: (message: string, opts: { boostToOpus: boolean; attachments: File[] }) => void;
}

const TIER_LABEL: Record<ModelTier, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};

export function Composer({ agentTier, disabled, onSend }: ComposerProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [boost, setBoost] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount + after send completes
  useEffect(() => {
    if (!disabled) textareaRef.current?.focus();
  }, [disabled]);

  // Detect leading "/" → open slash menu
  useEffect(() => {
    setSlashOpen(text.startsWith("/") && text.length > 0 && !text.includes(" "));
  }, [text]);

  const effectiveTier: ModelTier = boost ? "opus" : agentTier;

  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text.trim(), { boostToOpus: boost, attachments });
    setText("");
    setAttachments([]);
    setBoost(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-border bg-background p-3">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-xl border border-border bg-muted/20 p-2 shadow-sm focus-within:border-primary/50">
          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKey}
              disabled={disabled}
              rows={2}
              placeholder="Message your advisor… (try /summarize-day, /draft-reply)"
              className="min-h-[60px] resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0"
            />
            {slashOpen && (
              <div className="absolute bottom-full left-0 mb-2 w-full max-w-md rounded-md border border-border bg-popover p-1 shadow-md">
                <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Slash commands
                </div>
                {SLASH_COMMANDS.filter((c) => c.slash.startsWith(text)).map((c) => (
                  <button
                    key={c.slash}
                    type="button"
                    className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setText(c.insert);
                      setSlashOpen(false);
                      textareaRef.current?.focus();
                    }}
                  >
                    <span className="font-mono">{c.slash}</span>
                    <span className="text-muted-foreground">{c.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 px-1 pt-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                setAttachments((prev) => [...prev, ...files]);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              title="Attach files"
            >
              <Paperclip className="h-3.5 w-3.5" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" title="Slash commands">
                  <Slash className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>Slash commands</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {SLASH_COMMANDS.map((c) => (
                  <DropdownMenuItem
                    key={c.slash}
                    onSelect={() => {
                      setText(c.insert);
                      setTimeout(() => textareaRef.current?.focus(), 0);
                    }}
                  >
                    <div className="flex flex-col">
                      <span className="font-mono text-xs">{c.slash}</span>
                      <span className="text-[11px] text-muted-foreground">{c.description}</span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Badge variant={boost ? "default" : "secondary"} className="ml-1 text-[10px]">
              {TIER_LABEL[effectiveTier]}
            </Badge>

            {agentTier !== "opus" && (
              <Button
                type="button"
                variant={boost ? "default" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setBoost((b) => !b)}
                title="Boost this turn to Opus"
              >
                <Zap className="mr-1 h-3 w-3" />
                Boost
              </Button>
            )}

            <div className="ml-auto flex items-center gap-1">
              {attachments.length > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {attachments.length} file{attachments.length !== 1 ? "s" : ""}
                </span>
              )}
              <Button
                type="button"
                size="icon-sm"
                onClick={submit}
                disabled={disabled || !text.trim()}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1 px-1 pb-1 pt-2">
              {attachments.map((f, i) => (
                <Badge key={i} variant="outline" className="text-[10px]">
                  {f.name}
                  <button
                    type="button"
                    className="ml-1 text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, idx) => idx !== i))
                    }
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
