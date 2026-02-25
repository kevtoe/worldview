import { useState, useEffect, useRef } from 'react';
import type { Flight } from './useFlights';

const LIVE_POLL_INTERVAL = 5_000;    // 5s — respectful of adsb.fi rate limits
const ERROR_BACKOFF = 15_000;        // 15s after error
const MAX_BACKOFF = 60_000;          // 1 min max
const DIST_NM = 250;                 // 250 nautical miles radius (~460 km)

/**
 * High-frequency regional flight data via adsb.fi.
 *
 * Polls every 5 seconds for smooth real-time aircraft movement.
 * Only active when the flights layer is enabled AND the camera is
 * zoomed in enough (altitude < threshold) or an entity is being tracked.
 *
 * The returned flights are merged with the global FR24 data in App.tsx,
 * with live positions taking priority over the slower global feed.
 */
export function useFlightsLive(
  enabled: boolean,
  cameraLat: number,
  cameraLon: number,
  cameraAlt: number,
  isTracking: boolean,
) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const consecutiveErrorsRef = useRef(0);

  // Snap camera position to 0.5° grid to avoid cache misses from tiny camera jitter
  const stableLat = Math.round(cameraLat * 2) / 2;
  const stableLon = Math.round(cameraLon * 2) / 2;

  // Only activate live polling when zoomed in (<5,000 km) or tracking an entity
  const shouldPoll = enabled && (cameraAlt < 5_000_000 || isTracking);

  useEffect(() => {
    if (!shouldPoll) {
      setFlights([]);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const fetchLive = async () => {
      if (cancelled) return;

      try {
        const url = `/api/flights/live?lat=${stableLat}&lon=${stableLon}&dist=${DIST_NM}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Live flights HTTP ${res.status}`);
        const data: Flight[] = await res.json();

        consecutiveErrorsRef.current = 0;

        const airborne = data.filter((f) => !f.onGround && f.altitude > 0);
        setFlights(airborne);

        console.info(`[FLT-LIVE] ${airborne.length} aircraft in region (${stableLat}, ${stableLon})`);
      } catch (err) {
        consecutiveErrorsRef.current++;
        console.error('[FLT-LIVE] Fetch error:', err);
      }

      if (cancelled) return;

      const backoff = consecutiveErrorsRef.current > 0
        ? Math.min(ERROR_BACKOFF * Math.pow(2, consecutiveErrorsRef.current - 1), MAX_BACKOFF)
        : LIVE_POLL_INTERVAL;

      timeoutId = setTimeout(fetchLive, backoff);
    };

    fetchLive();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [shouldPoll, stableLat, stableLon]);

  return { flightsLive: flights };
}
