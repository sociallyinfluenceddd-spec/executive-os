import * as React from "react";

const MOBILE_BREAKPOINT = 768;

// Initial value reads window.matchMedia synchronously when running in the
// browser. The previous implementation initialized `undefined` and only set
// the real value inside useEffect, causing a desktop-first paint flicker
// on mobile devices.
function getInitialIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(getInitialIsMobile);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    // Resync in case viewport changed between SSR and hydration.
    setIsMobile(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
