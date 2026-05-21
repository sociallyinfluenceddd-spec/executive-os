// StudioShell — the cohesive chrome wrapper for the new design.
//
// Wraps any route in the studio layout: dark navy sidebar on the left,
// optional right rail, main content in the middle. Used by /today,
// /hub, /capture, /settings so the whole app feels like ONE app, not
// disconnected screens.
//
// The page-specific content goes in `children`. Optional `rail` slot for
// pages that want a right rail (today does; others may not).

import { Link, useRouterState } from "@tanstack/react-router";
import { AGENT_META } from "@/lib/agent-outputs";
import type { ReactNode } from "react";

interface StudioShellProps {
  children: ReactNode;
  rail?: ReactNode;
  /** Legacy prop from old AppShell — accepted for backward compat, no effect */
  wide?: boolean;
  /** Legacy prop from old AppShell */
  bareHeader?: boolean;
}

export function StudioShell({ children, rail }: StudioShellProps) {
  const routerState = useRouterState();
  const path = routerState.location.pathname;
  const isActive = (p: string) => path === p || (p !== "/today" && path.startsWith(p));

  return (
    <div className="concierge">
      <div className={`studio-grid ${rail ? "" : "studio-grid--no-rail"}`}>
        <aside className="studio-sidebar">
          <div className="flex items-center justify-between mb-8">
            <span className="monogram">DC</span>
          </div>

          <nav className="space-y-1 mb-8">
            <Link to="/today" data-active={isActive("/today")}>
              <span style={{ width: "1rem" }}>{isActive("/today") ? "◆" : "◇"}</span> Today
            </Link>
            <Link to="/hub" data-active={isActive("/hub")}>
              <span style={{ width: "1rem" }}>{isActive("/hub") ? "◆" : "◇"}</span> Hub
            </Link>
            <Link to="/capture" data-active={isActive("/capture")}>
              <span style={{ width: "1rem" }}>{isActive("/capture") ? "◆" : "◇"}</span> Capture
            </Link>
            <Link to="/settings" data-active={isActive("/settings")}>
              <span style={{ width: "1rem" }}>{isActive("/settings") ? "◆" : "◇"}</span> Settings
            </Link>
          </nav>

          <div className="text-[0.625rem] uppercase tracking-[0.22em] font-semibold mb-2" style={{ color: "rgba(242, 234, 211, 0.5)" }}>
            Agents
          </div>
          <nav className="space-y-1">
            {(["cleo", "sage", "ren", "vee", "maya", "theo"] as const).map((id) => {
              const meta = AGENT_META[id];
              return (
                <a key={id} href="#brief" data-active="false">
                  <span style={{ width: "1rem", color: meta.brand_color }}>●</span>
                  {meta.name}
                </a>
              );
            })}
          </nav>
        </aside>

        <main className="studio-main">
          {children}
        </main>

        {rail && <aside className="studio-rail">{rail}</aside>}
      </div>
    </div>
  );
}
