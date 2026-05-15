// Custom code-block renderer for advisor chat.
// - Always shows a copy button.
// - Pops out into an artifact dialog at >= 30 lines.
import { useMemo, useState } from "react";
import { Copy, Check, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ARTIFACT_LINE_THRESHOLD = 30;

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function ChatCodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const lineCount = useMemo(() => code.split("\n").length, [code]);
  const isArtifact = lineCount >= ARTIFACT_LINE_THRESHOLD;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const previewCode = isArtifact
    ? code.split("\n").slice(0, 12).join("\n") + "\n…"
    : code;

  return (
    <>
      <div className="my-3 overflow-hidden rounded-md border border-border bg-muted/40">
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs">
          <span className="font-mono text-muted-foreground">{language || "code"}</span>
          <div className="flex items-center gap-1">
            {isArtifact && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setOpen(true)}
              >
                <Maximize2 className="mr-1 h-3 w-3" />
                Open ({lineCount} lines)
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleCopy}>
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
        </div>
        <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
          <code className="font-mono">{previewCode}</code>
        </pre>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span className="font-mono text-sm">{language || "artifact"} · {lineCount} lines</span>
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
                Copy
              </Button>
            </DialogTitle>
          </DialogHeader>
          <pre className="max-h-[70vh] overflow-auto rounded-md bg-muted p-4 text-xs">
            <code className="font-mono">{code}</code>
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
