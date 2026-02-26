import { useState, useEffect, useRef } from 'react';
import type { IntelFeedItem } from '../components/ui/IntelFeed';

/**
 * AIS Navigational Status codes.
 * @see https://gpsd.gitlab.io/gpsd/AIVDM.html#_ais_navigational_status
 */
export type NavStatus =
  | 0  // Under way using engine
  | 1  // At anchor
  | 2  // Not under command
  | 3  // Restricted manoeuvrability
  | 4  // Constrained by draught
  | 5  // Moored
  | 6  // Aground
  | 7  // Engaged in fishing
  | 8  // Under way sailing
  | 9  // Reserved (HSC)
  | 10 // Reserved (WIG)
  | 14 // AIS-SART
  | 15 // Not defined
  | null;

/**
 * AIS ship type code (first digit = broad category).
 * @see https://coast.noaa.gov/data/marinecadastre/ais/VesselTypeCodes2018.pdf
 */
export type ShipTypeCode = number | null;

export interface Ship {
  mmsi: string;
  name: string;
  latitude: number;
  longitude: number;
  heading: number | null;        // True heading (degrees), null if 511 / unavailable
  cog: number | null;            // Course over ground (degrees)
  sog: number;                   // Speed over ground (knots)
  navStatus: NavStatus;
  shipType: ShipTypeCode;
  destination: string | null;
  imo: number | null;
  callSign: string | null;
  length: number | null;         // metres (A+B)
  width: number | null;          // metres (C+D)
  country: string | null;
  countryCode: string | null;
  timestamp: string;
}

/** Human-readable ship category derived from AIS type code */
export type ShipCategory =
  | 'cargo'
  | 'tanker'
  | 'passenger'
  | 'fishing'
  | 'military'
  | 'tug'
  | 'pleasure'
  | 'highspeed'
  | 'other';

/** Map AIS ship type code to a broad category for colouring / filtering */
export function getShipCategory(typeCode: ShipTypeCode): ShipCategory {
  if (typeCode == null) return 'other';
  const t = typeCode;
  if (t >= 70 && t <= 79) return 'cargo';
  if (t >= 80 && t <= 89) return 'tanker';
  if (t >= 60 && t <= 69) return 'passenger';
  if (t === 30) return 'fishing';
  if (t === 35) return 'military';
  if ((t >= 31 && t <= 32) || t === 52) return 'tug';
  if (t >= 36 && t <= 37) return 'pleasure';
  if (t >= 40 && t <= 49) return 'highspeed';
  return 'other';
}

const POLL_INTERVAL = 30_000;        // 30s — server caches for 60s
const ERROR_BACKOFF_BASE = 30_000;   // 30s after first error, doubles
const MAX_BACKOFF = 120_000;         // 2 min max

/**
 * Fetches global vessel data from the backend ship proxy endpoint.
 * Mirrors the useFlights pattern: poll + exponential backoff.
 * Defaults to moving vessels only (SOG > 0.5 kt, excludes moored/anchored).
 */
export function useShips(enabled: boolean, movingOnly = true) {
  const [ships, setShips] = useState<Ship[]>([]);
  const [feedItems, setFeedItems] = useState<IntelFeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const prevCountRef = useRef(0);
  const consecutiveErrorsRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setShips([]);
      setIsLoading(false);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const fetchData = async () => {
      if (cancelled) return;

      // Only show loading spinner on the first fetch (no data yet)
      if (ships.length === 0 && consecutiveErrorsRef.current === 0) {
        setIsLoading(true);
      }

      try {
        const url = movingOnly ? '/api/ships?moving=1' : '/api/ships';
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Ships proxy HTTP ${res.status}`);
        const data: Ship[] = await res.json();

        consecutiveErrorsRef.current = 0;
        setIsLoading(false);

        // Filter out stationary vessels at 0,0 (AIS default / invalid)
        const valid = data.filter(
          (s) => !(s.latitude === 0 && s.longitude === 0),
        );
        setShips(valid);

        // Intel feed item on significant count changes
        if (Math.abs(valid.length - prevCountRef.current) > 30 || prevCountRef.current === 0) {
          prevCountRef.current = valid.length;
          if (valid.length > 0) {
            setFeedItems([
              {
                id: `ship-${Date.now()}`,
                time: new Date().toISOString().slice(11, 19),
                type: 'ship',
                message: `${valid.length} vessels tracked via AIS`,
              },
            ]);
          }
        }

        console.info(`[SHIP] ${valid.length} vessels from AIS`);
      } catch (err) {
        consecutiveErrorsRef.current++;
        setIsLoading(false);
        console.error('[SHIP] Fetch error:', err);
      }

      if (cancelled) return;

      const backoff = consecutiveErrorsRef.current > 0
        ? Math.min(ERROR_BACKOFF_BASE * Math.pow(2, consecutiveErrorsRef.current - 1), MAX_BACKOFF)
        : POLL_INTERVAL;

      timeoutId = setTimeout(fetchData, backoff);
    };

    fetchData();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [enabled, movingOnly]);

  return { ships, feedItems, isLoading };
}
