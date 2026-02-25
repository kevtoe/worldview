import { useState, useEffect, useRef } from 'react';
import type { IntelFeedItem } from '../components/ui/IntelFeed';

export interface Flight {
  icao24: string;
  callsign: string;
  registration: string;
  aircraftType: string;
  description: string;
  operator: string;
  country: string;
  latitude: number;
  longitude: number;
  altitude: number;       // metres
  altitudeFeet: number;
  onGround: boolean;
  velocity: number | null; // m/s
  velocityKnots: number | null;
  heading: number | null;
  verticalRate: number | null;
  squawk: string;
  category: string;
  originAirport: string;
  destAirport: string;
  airline: string;
}

const POLL_INTERVAL = 20_000;        // 20s normal polling (global data is heavier)
const ERROR_BACKOFF_BASE = 30_000;   // 30s after first error, doubles each time
const MAX_BACKOFF = 120_000;         // 2 min max

/**
 * Fetches global live aircraft data from the backend proxy.
 * No camera position dependency — returns worldwide flights with route data.
 */
export function useFlights(enabled: boolean) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [feedItems, setFeedItems] = useState<IntelFeedItem[]>([]);

  const prevCountRef = useRef(0);
  const consecutiveErrorsRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setFlights([]);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const fetchData = async () => {
      if (cancelled) return;

      try {
        const res = await fetch('/api/flights');
        if (!res.ok) throw new Error(`Flights proxy HTTP ${res.status}`);
        const data: Flight[] = await res.json();

        consecutiveErrorsRef.current = 0;

        // Filter out on-ground aircraft for a cleaner display
        const airborne = data.filter((f) => !f.onGround && f.altitude > 0);
        setFlights(airborne);

        // Only push an intel feed item when the count changes significantly
        if (Math.abs(airborne.length - prevCountRef.current) > 50 || prevCountRef.current === 0) {
          prevCountRef.current = airborne.length;
          if (airborne.length > 0) {
            setFeedItems([
              {
                id: `flt-${Date.now()}`,
                time: new Date().toISOString().slice(11, 19),
                type: 'flight',
                message: `${airborne.length} aircraft tracked worldwide`,
              },
            ]);
          }
        }

        console.info(`[FLT] ${airborne.length} airborne aircraft globally`);
      } catch (err) {
        consecutiveErrorsRef.current++;
        console.error('[FLT] Fetch error:', err);
      }

      if (cancelled) return;

      // Schedule next poll — exponential backoff on consecutive errors
      const backoff = consecutiveErrorsRef.current > 0
        ? Math.min(ERROR_BACKOFF_BASE * Math.pow(2, consecutiveErrorsRef.current - 1), MAX_BACKOFF)
        : POLL_INTERVAL;

      timeoutId = setTimeout(fetchData, backoff);
    };

    // Start first fetch
    fetchData();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [enabled]); // Only re-subscribe when enabled changes

  return { flights, feedItems };
}
