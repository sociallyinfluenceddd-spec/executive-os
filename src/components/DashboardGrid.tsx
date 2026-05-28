// DashboardGrid — draggable + resizable module board for /today.
//
// Wraps react-grid-layout (legacy compat API). Each child must be a plain
// element with a `key` matching a layout item `i`. Drag by the `.rgl-handle`
// grip in each card header; resize from the bottom-right corner. The layout
// persists to localStorage so Donna arranges it once and it sticks.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout/legacy";

const Grid = WidthProvider(Responsive);

const STORAGE_KEY = "execOs.today.board.v1";

// 12-column default arrangement. Donna drags/resizes from here; her version
// overrides this once saved. minW/minH stop modules from collapsing too small.
export const DEFAULT_LAYOUT: Layout = [
  { i: "pipeline", x: 0, y: 0,  w: 12, h: 8,  minW: 6, minH: 6 },
  { i: "toship",   x: 0, y: 8,  w: 7,  h: 11, minW: 4, minH: 6 },
  { i: "brief",    x: 7, y: 8,  w: 5,  h: 11, minW: 4, minH: 6 },
  { i: "inbox",    x: 0, y: 19, w: 7,  h: 9,  minW: 4, minH: 5 },
  { i: "schedule", x: 7, y: 19, w: 5,  h: 5,  minW: 3, minH: 4 },
  { i: "wins",     x: 7, y: 24, w: 5,  h: 4,  minW: 3, minH: 4 },
  { i: "money",    x: 0, y: 28, w: 7,  h: 6,  minW: 3, minH: 4 },
  { i: "staff",    x: 7, y: 28, w: 5,  h: 6,  minW: 3, minH: 4 },
];

function loadLayout(): Layout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Layout;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLayout(layout: Layout) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

export function DashboardGrid({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<Layout>(() => loadLayout() ?? DEFAULT_LAYOUT);

  const onLayoutChange = useCallback((current: Layout) => {
    // Ignore the empty/initial callbacks RGL fires before children mount.
    if (!current || current.length === 0) return;
    setLayout(current);
    saveLayout(current);
  }, []);

  const layouts = useMemo(() => ({ lg: layout }), [layout]);

  const reset = useCallback(() => {
    if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
    setLayout(DEFAULT_LAYOUT);
  }, []);

  return (
    <div className="relative">
      <button
        onClick={reset}
        className="absolute -top-7 right-0 text-[0.6875rem] z-10"
        style={{ color: "var(--con-charcoal-faint)" }}
        title="Reset the dashboard arrangement to default"
      >
        Reset layout
      </button>
      <Grid
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 0 }}
        cols={{ lg: 12 }}
        rowHeight={40}
        margin={[16, 16]}
        containerPadding={[0, 0]}
        draggableHandle=".rgl-handle"
        isResizable
        isDraggable
        onLayoutChange={onLayoutChange}
      >
        {children}
      </Grid>
    </div>
  );
}
