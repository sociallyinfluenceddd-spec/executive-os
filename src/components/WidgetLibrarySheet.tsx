import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Mail,
  CalendarDays,
  Activity,
  FolderKanban,
  MessageCircle,
  CreditCard,
  Sparkles,
  Target,
  Mic,
  CheckCircle2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { WIDGET_CATALOG, type WidgetCatalogItem, type WidgetStatus } from "@/config/widgets";

const ICONS: Record<string, LucideIcon> = {
  Mail,
  CalendarDays,
  Activity,
  FolderKanban,
  MessageCircle,
  CreditCard,
  Sparkles,
  Target,
  Mic,
  CheckCircle2,
};

const STATUS_LABEL: Record<WidgetStatus, string> = {
  connected: "Connected",
  needs_setup: "Needs setup",
  coming_soon: "Coming soon",
};

const STATUS_DOT: Record<WidgetStatus, string> = {
  connected: "bg-[color:var(--sage)]",
  needs_setup: "bg-[color:var(--yellow)]",
  coming_soon: "bg-muted-foreground/40",
};

export function WidgetLibrarySheet({
  open,
  onOpenChange,
  side,
  activeIds,
  onAdd,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  side: "right" | "bottom";
  activeIds: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        className={
          side === "bottom"
            ? "h-[85vh] overflow-y-auto"
            : "w-full sm:max-w-md overflow-y-auto"
        }
      >
        <SheetHeader>
          <SheetTitle>Widget library</SheetTitle>
          <SheetDescription>Add or remove panels from your dashboard.</SheetDescription>
        </SheetHeader>
        <ul className="mt-4 space-y-2">
          {WIDGET_CATALOG.map((w) => (
            <WidgetRow
              key={w.id}
              widget={w}
              active={activeIds.includes(w.id)}
              onAdd={() => onAdd(w.id)}
              onRemove={() => onRemove(w.id)}
            />
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

function WidgetRow({
  widget,
  active,
  onAdd,
  onRemove,
}: {
  widget: WidgetCatalogItem;
  active: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const Icon = ICONS[widget.icon] ?? Sparkles;
  const isComingSoon = widget.status === "coming_soon";
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/40 transition">
      <Icon className="h-6 w-6 shrink-0 mt-0.5" style={{ color: "#083D77" }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-foreground">{widget.name}</span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted text-[10px] text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[widget.status]}`} />
            {STATUS_LABEL[widget.status]}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{widget.description}</p>
      </div>
      <div className="shrink-0">
        {active ? (
          <Button size="sm" variant="outline" onClick={onRemove}>
            Remove
          </Button>
        ) : isComingSoon ? (
          <Button
            size="sm"
            disabled
            title="Available soon"
            style={{ backgroundColor: "#083D77" }}
          >
            Add
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onAdd}
            style={{ backgroundColor: "#083D77", color: "white" }}
          >
            Add
          </Button>
        )}
      </div>
    </li>
  );
}
