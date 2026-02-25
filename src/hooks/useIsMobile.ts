import { useState, useEffect } from 'react';

/** Breakpoint (px) below which we switch to compact mobile HUD */
const MOBILE_BREAKPOINT = 768;

/**
 * Returns `true` when the viewport width is below the mobile breakpoint.
 * Uses `window.matchMedia` with an event listener for live updates.
 */
export function useIsMobile(breakpoint = MOBILE_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);

    // Set initial value from the query (handles SSR → client hydration)
    setIsMobile(mql.matches);

    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);

  return isMobile;
}
