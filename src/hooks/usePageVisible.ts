import { useEffect, useState } from 'react';

/**
 * Tracks whether the page is currently visible to the user.
 *
 * Every data layer in this app polls on a timer. Without this, a tab left open
 * in the background keeps requesting live data indefinitely: at a 5s flight
 * poll that is roughly 900 requests an hour that nobody is looking at, each one
 * a billed serverless invocation. Gating the pollers on visibility means a
 * backgrounded tab costs nothing, and resumes instantly when the user comes
 * back.
 *
 * Starts optimistically as visible so that server-side rendering and the very
 * first paint never suppress the initial fetch.
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    onChange();
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return visible;
}
