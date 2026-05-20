// Render a streamed assistant message: text (with markdown + code blocks),
// reasoning (collapsed by default), and tool_use cards.
import { Fragment, useState } from "react";
import { ChevronRight, Brain, Wrench } from "lucide-react";
import { ChatCodeBlock } from "./ChatCodeBlock";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export interface ToolEvent {
  id?: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  status: "running" | "done" | "error";
}

export interface ChatBlock {
  text: string;
  thinking: string;
  tools: ToolEvent[];
}

// Tiny markdown renderer: handles ```lang\n...\n```, **bold**, *italic*,
// `code`, and paragraph splitting. Avoids pulling in a heavy lib for now.
function renderMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const fence = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = fence.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <Fragment key={`t-${key++}`}>{renderInline(text.slice(lastIndex, match.index))}</Fragment>,
      );
    }
    parts.push(
      <ChatCodeBlock key={`c-${key++}`} code={match[2]} language={match[1]} />,
    );
    lastIndex = fence.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(
      <Fragment key={`t-${key++}`}>{renderInline(text.slice(lastIndex))}</Fragment>,
    );
  }
  return parts;
}

function renderInline(text: string): React.ReactNode {
  const paragraphs = text.split(/\n{2,}/);
  return paragraphs.map((p, i) => (
    <p key={i} className="my-2 whitespace-pre-wrap leading-relaxed first:mt-0 last:mb-0">
      {applyInlineFormatting(p)}
    </p>
  ));
}

function applyInlineFormatting(text: string): React.ReactNode {
  // process inline code first
  const codeRe = /`([^`]+)`/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = codeRe.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={k++}>{renderLinksAndEmphasis(text.slice(last, m.index))}</Fragment>);
    out.push(<code key={k++} className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{m[1]}</code>);
    last = codeRe.lastIndex;
  }
  if (last < text.length) out.push(<Fragment key={k++}>{renderLinksAndEmphasis(text.slice(last))}</Fragment>);
  return out;
}

function renderLinksAndEmphasis(text: string): React.ReactNode {
  // [label](href) — same-origin paths open inline; external opens in new tab.
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={k++}>{boldItalic(text.slice(last, m.index))}</Fragment>);
    const label = m[1];
    const href = m[2];
    const external = /^https?:\/\//i.test(href);
    out.push(
      <a
        key={k++}
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        className="text-[color:var(--navy)] underline underline-offset-2 hover:opacity-80"
      >
        {label}
      </a>,
    );
    last = linkRe.lastIndex;
  }
  if (last < text.length) out.push(<Fragment key={k++}>{boldItalic(text.slice(last))}</Fragment>);
  return out;
}

function boldItalic(text: string): React.ReactNode {
  // **bold** then *italic*
  const parts: React.ReactNode[] = [];
  let key = 0;
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={key++}>{m[3]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function AssistantBlock({ block }: { block: ChatBlock }) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  return (
    <div className="space-y-3">
      {block.thinking && (
        <Collapsible open={reasoningOpen} onOpenChange={setReasoningOpen}>
          <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRight className={`h-3 w-3 transition-transform ${reasoningOpen ? "rotate-90" : ""}`} />
            <Brain className="h-3 w-3" />
            Reasoning
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1 rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
              {block.thinking}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {block.tools.map((t, i) => (
        <ToolCard key={t.id ?? i} tool={t} />
      ))}

      {block.text && <div className="text-sm">{renderMarkdown(block.text)}</div>}
    </div>
  );
}

function ToolCard({ tool }: { tool: ToolEvent }) {
  const [open, setOpen] = useState(false);
  const statusColor =
    tool.status === "running"
      ? "text-amber-600"
      : tool.status === "error"
      ? "text-destructive"
      : "text-emerald-600";
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-left text-xs hover:bg-muted/60">
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        <Wrench className="h-3 w-3" />
        <span className="font-mono">{tool.name ?? "tool"}</span>
        <span className={`ml-auto ${statusColor}`}>{tool.status}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 space-y-2 rounded-md border border-border bg-background p-3 text-xs">
          {tool.input !== undefined && (
            <div>
              <div className="mb-1 font-medium text-muted-foreground">input</div>
              <pre className="overflow-x-auto rounded bg-muted/40 p-2 font-mono">
                {JSON.stringify(tool.input, null, 2)}
              </pre>
            </div>
          )}
          {tool.output !== undefined && (
            <div>
              <div className="mb-1 font-medium text-muted-foreground">output</div>
              <pre className="overflow-x-auto rounded bg-muted/40 p-2 font-mono max-h-64">
                {JSON.stringify(tool.output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
