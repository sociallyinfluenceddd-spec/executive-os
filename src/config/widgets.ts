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
  { id: "projects",      name: "Projects",       icon: "FolderKanban", description: "Track active builds with status, progress, and deadlines", status: "connected" },
  { id: "follow_ups",    name: "Follow-ups",     icon: "MessageCircle",description: "People + threads awaiting your reply",        status: "needs_setup" },
  { id: "money",         name: "Money",          icon: "CreditCard",   description: "Today's revenue + 7-day avg + MTD across all sources", status: "connected" },
  { id: "content_pulse", name: "Content Pulse",  icon: "Sparkles",     description: "Log every TikTok / Reel / post with views and links", status: "connected" },
  { id: "top_priority",  name: "Top Priority",   icon: "Target",       description: "Single most important thing today",           status: "connected" },
  { id: "voice_capture", name: "Voice Capture",  icon: "Mic",          description: "Quick voice-to-task entry",                   status: "coming_soon" },
  { id: "done_today",    name: "Done Today",     icon: "CheckCircle2", description: "Today's productivity log — every task closed and dollar logged, with timestamps", status: "connected" },
  { id: "bench",         name: "Bench",          icon: "Users",        description: "Your AI expert team — tap an avatar to chat", status: "connected" },
  { id: "bench_whispers",name: "Bench Whispers", icon: "Sparkles",     description: "Proactive nudges from your advisors",         status: "connected" },
  { id: "timers_alarms", name: "Timers + alarms",icon: "AlarmClock",   description: "Countdown timers and alarms with sound",      status: "connected" },
  { id: "kitchen_recipes",name:"Kitchen + recipes",icon:"ChefHat",     description: "Shopping list, meals, recipes and tonight plan", status: "connected" },
  { id: "workflows",     name: "Workflow",       icon: "Activity",     description: "Active phase + this week's tasks · Send to Claude / mark done inline", status: "connected" },
  { id: "workflows_exec_os", name: "Workflow · Exec OS Build", icon: "Hammer", description: "Parallel workflow for shipping dashboard improvements. Runs alongside Ideafetti.", status: "connected" },
];

// Bumped to v3 on 2026-05-19 — adds workflows_exec_os (second parallel
// workflow widget for shipping dashboard work). Reset to pull in defaults.
export const ACTIVE_WIDGETS_KEY = "execOs.activeWidgets.v3";

// New-user defaults. Intentionally excluded:
//   - top_priority   — duplicates the sticky header value
//   - voice_capture  — stub; floating mic button already covers this
//   - timeline       — replaced by done_today; appointment view available in calendar widget
// All of the above are still in the widget library and can be added.
export const DEFAULT_ACTIVE_WIDGETS: string[] = [
  "workflows",
  "workflows_exec_os",
  "done_today",
  "money",
  "bench",
  "inbox",
  "calendar",
  "projects",
  "content_pulse",
  "follow_ups",
  "bench_whispers",
  "kitchen_recipes",
];

// Widgets that should be auto-appended to existing users' saved layouts
// once, if they don't already have them. Migration runs in src/routes/today.tsx.
// Bump AUTO_APPEND_KEY whenever entries are added so the migration fires once
// more for users who already passed the previous key.
export const AUTO_APPEND_WIDGETS: string[] = [
  "workflows",
  "workflows_exec_os",
  "money",
  "projects",
  "content_pulse",
  "bench",
  "bench_whispers",
  "timers_alarms",
  "kitchen_recipes",
  "done_today",
];
export const AUTO_APPEND_KEY = "execOs.activeWidgets.autoAppend.v8";

// Default grid sizes when a widget is freshly added via the library.
// Full-width widgets get the timeline-style row.
// Sized to fit each widget's DEFAULT empty-state content without scroll.
// applySizeFloor in today.tsx bumps any stored layout entry below these
// dimensions back up to this floor (matches LG_BASE in today.tsx).
export const DEFAULT_WIDGET_SIZE: Record<string, { w: number; h: number }> = {
  timeline:        { w: 12, h: 4 },
  top_priority:    { w: 12, h: 3 },
  done_today:      { w: 12, h: 6 },
  voice_capture:   { w: 4,  h: 4 },
  bench:           { w: 12, h: 4 },
  bench_whispers:  { w: 6,  h: 5 },
  timers_alarms:   { w: 6,  h: 5 },
  kitchen_recipes: { w: 6,  h: 6 },
  money:           { w: 4,  h: 5 },
  projects:        { w: 4,  h: 5 },
  content_pulse:   { w: 4,  h: 5 },
  workflows:         { w: 6,  h: 8 },
  workflows_exec_os: { w: 6,  h: 8 },
};

export function defaultSizeFor(id: string): { w: number; h: number } {
  return DEFAULT_WIDGET_SIZE[id] ?? { w: 4, h: 6 };
}
