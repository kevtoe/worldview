import { useState, useEffect, useCallback, useRef } from 'react';
import {
  twoline2satrec,
  propagate,
  eciToGeodetic,
  gstime,
  degreesLong,
  degreesLat,
} from 'satellite.js';
import type { IntelFeedItem } from '../components/ui/IntelFeed';

export interface SatellitePosition {
  name: string;
  noradId: number;
  latitude: number;
  longitude: number;
  altitude: number; // km
  orbitPath: { latitude: number; longitude: number; altitude: number }[];
  satrec: any; // satellite.js TLE record for real-time frame-by-frame propagation
}

// Fetch via our backend proxy to avoid CelesTrak 403 on direct browser requests
const SATELLITES_URL = '/api/satellites?group=stations';
const POLL_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours
const POSITION_INTERVAL = 2000;  // Update positions every 2 seconds
const ORBIT_INTERVAL = 30_000;   // Recompute orbit paths every 30 seconds
const ORBIT_POINTS = 90;         // 90 points × 1 min = 90 minutes ahead
const ORBIT_STEP_MS = 60 * 1000; // 1 minute per step
const TLE_FETCH_RETRIES = 2;
const TLE_RETRY_DELAY = 3000;

/**
 * Parse CelesTrak 3-line TLE text into arrays of { name, line1, line2 }.
 * Format: name (line 0), TLE line 1, TLE line 2 — repeating.
 */
function parseTLEText(text: string): { name: string; line1: string; line2: string }[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const results: { name: string; line1: string; line2: string }[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    // Basic validation: line 1 starts with "1 ", line 2 starts with "2 "
    if (line1.startsWith('1 ') && line2.startsWith('2 ')) {
      results.push({ name, line1, line2 });
    }
  }
  return results;
}

export function useSatellites(enabled: boolean) {
  const [positions, setPositions] = useState<SatellitePosition[]>([]);
  const [feedItems, setFeedItems] = useState<IntelFeedItem[]>([]);
  const satrecsRef = useRef<{ name: string; noradId: number; satrec: ReturnType<typeof twoline2satrec> }[]>([]);
  const orbitCacheRef = useRef<Map<number, { latitude: number; longitude: number; altitude: number }[]>>(new Map());
  // Reactive trigger: increments when TLEs are loaded so effects re-run
  const [tleGeneration, setTleGeneration] = useState(0);
  // Gate: only start position propagation once orbits have been computed
  const [orbitsReady, setOrbitsReady] = useState(false);

  // Fetch TLE data with retry
  const fetchTLEs = useCallback(async () => {
    if (!enabled) return;

    for (let attempt = 0; attempt <= TLE_FETCH_RETRIES; attempt++) {
      try {
        const res = await fetch(SATELLITES_URL);
        if (!res.ok) throw new Error(`Satellite proxy HTTP ${res.status}`);
        const text = await res.text();
        const tleEntries = parseTLEText(text);
        if (tleEntries.length === 0) throw new Error('No valid TLEs parsed');

        satrecsRef.current = tleEntries.map(({ name, line1, line2 }) => {
          const satrec = twoline2satrec(line1, line2);
          return {
            name: name.trim(),
            noradId: Number(satrec.satnum),
            satrec,
          };
        });

        // Bump generation to trigger propagation effects
        setTleGeneration((g) => g + 1);

        setFeedItems([
          {
            id: `sat-load-${Date.now()}`,
            time: new Date().toISOString().slice(11, 19),
            type: 'satellite',
            message: `${tleEntries.length} station satellites tracked`,
          },
        ]);

        console.info(`[SAT] Loaded ${tleEntries.length} TLEs (attempt ${attempt + 1})`);
        return; // success — exit retry loop
      } catch (err) {
        console.warn(`[SAT] Fetch attempt ${attempt + 1} failed:`, err);
        if (attempt < TLE_FETCH_RETRIES) {
          await new Promise((r) => setTimeout(r, TLE_RETRY_DELAY));
        } else {
          console.error('[SAT] All TLE fetch attempts exhausted');
        }
      }
    }
  }, [enabled]);

  // Compute orbit paths — expensive, so run infrequently
  useEffect(() => {
    if (!enabled || tleGeneration === 0) return;

    const computeOrbits = () => {
      const now = new Date();
      const cache = new Map<number, { latitude: number; longitude: number; altitude: number }[]>();

      for (const { noradId, satrec } of satrecsRef.current) {
        const orbitPath: { latitude: number; longitude: number; altitude: number }[] = [];
        for (let i = 0; i < ORBIT_POINTS; i++) {
          const futureTime = new Date(now.getTime() + i * ORBIT_STEP_MS);
          const futureGmst = gstime(futureTime);
          try {
            const pv = propagate(satrec, futureTime);
            if (!pv || typeof pv.position === 'boolean' || !pv.position) continue;
            const geo = eciToGeodetic(pv.position, futureGmst);
            orbitPath.push({
              latitude: degreesLat(geo.latitude),
              longitude: degreesLong(geo.longitude),
              altitude: geo.height,
            });
          } catch {
            // Skip bad propagation point
          }
        }
        cache.set(noradId, orbitPath);
      }
      orbitCacheRef.current = cache;
      console.info(`[SAT] Computed orbit paths for ${cache.size} satellites`);
    };

    computeOrbits();
    setOrbitsReady(true);
    const timer = setInterval(computeOrbits, ORBIT_INTERVAL);
    return () => { clearInterval(timer); setOrbitsReady(false); };
  }, [enabled, tleGeneration]);

  // Propagate current positions — lightweight, runs frequently
  // Only starts after orbits are ready so orbit paths are always populated
  useEffect(() => {
    if (!enabled || !orbitsReady) return;

    const propagatePositions = () => {
      const now = new Date();
      const gmst = gstime(now);

      const newPositions: SatellitePosition[] = [];
      for (const { name, noradId, satrec } of satrecsRef.current) {
        try {
          const posVel = propagate(satrec, now);
          if (!posVel || typeof posVel.position === 'boolean' || !posVel.position) continue;
          const geo = eciToGeodetic(posVel.position, gmst);

          newPositions.push({
            name,
            noradId,
            latitude: degreesLat(geo.latitude),
            longitude: degreesLong(geo.longitude),
            altitude: geo.height,
            orbitPath: orbitCacheRef.current.get(noradId) ?? [],
            satrec,
          });
        } catch {
          // Skip satellites with propagation errors
        }
      }
      setPositions(newPositions);
    };

    propagatePositions();
    const timer = setInterval(propagatePositions, POSITION_INTERVAL);
    return () => clearInterval(timer);
  }, [enabled, orbitsReady, tleGeneration]);

  // Fetch TLEs on mount and on interval
  useEffect(() => {
    fetchTLEs();
    if (!enabled) return;
    const timer = setInterval(fetchTLEs, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchTLEs, enabled]);

  return { satellites: positions, feedItems };
}
