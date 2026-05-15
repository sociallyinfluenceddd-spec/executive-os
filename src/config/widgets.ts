export type WidgetStatus = "connected" | "needs_setup" | "coming_soon";

export type WidgetCatalogItem = {
  id: string;
  name: string;
  icon: string; // Lucide icon name
  description: string;
  status: WidgetStatus;
};

export const WIDGET_CATALOG: WidgetCatalogItem[] = [
  { id: "inbox",         name: "Inbox",          icon: "Mail",         description: "Priority + needs-response email counts",     status: "connected" },
  { id: "calendar",      name: "Calendar Today", icon: "CalendarDays", description: "Today's events with full detail panel",       status: "connected" },
  { id: "timeline",      name: "Timeline",       icon: "Activity",     description: "24-hour visual timeline of meetings",         status: "connected" },
  { id: "projects",      name: "Projects",       icon: "FolderKanban", description: "Active project progress bars",                status: "connected" },
  { id: "follow_ups",    name: "Follow-ups",     icon: "MessageCircle",description: "People + threads awaiting your reply",        status: "needs_setup" },
  { id: "money",         name: "Money",          icon: "CreditCard",   description: "Lead pipeline + revenue from Ideafetti",      status: "needs_setup" },
  { id: "content_pulse", name: "Content Pulse",  icon: "Sparkles",     description: "Latest content performance from Ideafetti",   status: "needs_setup" },
  { id: "top_priority",  name: "Top Priority",   icon: "Target",       description: "Single most important thing today",           status: "connected" },
  { id: "voice_capture", name: "Voice Capture",  icon: "Mic",          description: "Quick voice-to-task entry",                   status: "coming_soon" },
  { id: "done_today",    name: "Done for Today", icon: "CheckCircle2", description: "End-of-day shutdown button",                  status: "connected" },
  { id: "bench",         name: "Bench",          icon: "Users",        description: "Your AI expert team — tap an avatar to chat", status: "connected" },
  { id: "bench_whispers",name: "Bench Whispers", icon: "Sparkles",     description: "Proactive nudges from your advisors",         status: "connected" },
];

export const ACTIVE_WIDGETS_KEY = "execOs.activeWidgets.v1";

export const DEFAULT_ACTIVE_WIDGETS: string[] = [
  "top_priority",
  "bench",
  "inbox",
  "calendar",
  "timeline",
  "follow_ups",
  "bench_whispers",
  "content_pulse",
  "money",
  "projects",
];

// Widgets that should be auto-appended to existing users' saved layouts
// once, if they don't already have them. Migration runs in src/routes/today.tsx.
export const AUTO_APPEND_WIDGETS: string[] = ["bench", "bench_whispers"];
export const AUTO_APPEND_KEY = "execOs.activeWidgets.autoAppend.v2";

// Default grid sizes when a widget is freshly added via the library.
// Full-width widgets get the timeline-style row.
export const DEFAULT_WIDGET_SIZE: Record<string, { w: number; h: number }> = {
  timeline: { w: 12, h: 4 },
  top_priority: { w: 12, h: 3 },
  done_today: { w: 4, h: 3 },
  voice_capture: { w: 4, h: 4 },
  bench: { w: 12, h: 4 },
  bench_whispers: { w: 6, h: 6 },
};

export function defaultSizeFor(id: string): { w: number; h: number } {
  return DEFAULT_WIDGET_SIZE[id] ?? { w: 4, h: 6 };
}
