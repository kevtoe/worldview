import { useState, useCallback, useRef } from 'react';

export interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null; // metres — null for IP-based
  source: 'gps' | 'ip';
  city?: string;
  country?: string;
  countryCode?: string;
  region?: string;
}

export type GeoStatus = 'idle' | 'requesting' | 'success' | 'error';

interface UseGeolocationResult {
  location: GeoLocation | null;
  status: GeoStatus;
  error: string | null;
  locate: () => void;
}

/**
 * Geolocation hook — tries browser Geolocation API first (GPS/WiFi, high precision,
 * requires user consent). Falls back to IP-based geolocation via the Express proxy.
 */
export function useGeolocation(): UseGeolocationResult {
  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [status, setStatus] = useState<GeoStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const locatingRef = useRef(false);

  /** IP-based fallback via server proxy (ipwho.is) */
  const ipFallback = useCallback(async (): Promise<GeoLocation> => {
    const res = await fetch('/api/geolocation');
    if (!res.ok) throw new Error(`IP geolocation failed (${res.status})`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'IP geolocation unavailable');
    return {
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: null,
      source: 'ip',
      city: data.city,
      country: data.country,
      countryCode: data.countryCode,
      region: data.region,
    };
  }, []);

  /** Request location — browser geolocation first, then IP fallback */
  const locate = useCallback(() => {
    if (locatingRef.current) return;
    locatingRef.current = true;
    setStatus('requesting');
    setError(null);

    // Try browser Geolocation API
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        // Success — high precision
        (pos) => {
          const geo: GeoLocation = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            source: 'gps',
          };
          setLocation(geo);
          setStatus('success');
          locatingRef.current = false;
        },
        // Permission denied or error — fall back to IP
        async (geoErr) => {
          console.warn('[GEO] Browser geolocation failed:', geoErr.message, '— falling back to IP');
          try {
            const ipGeo = await ipFallback();
            setLocation(ipGeo);
            setStatus('success');
          } catch (ipErr) {
            setError(`Location unavailable: ${(ipErr as Error).message}`);
            setStatus('error');
          }
          locatingRef.current = false;
        },
        {
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 60_000, // Accept cached position up to 1 minute old
        }
      );
    } else {
      // No browser geolocation — go straight to IP
      ipFallback()
        .then((ipGeo) => {
          setLocation(ipGeo);
          setStatus('success');
        })
        .catch((err) => {
          setError(`Location unavailable: ${(err as Error).message}`);
          setStatus('error');
        })
        .finally(() => {
          locatingRef.current = false;
        });
    }
  }, [ipFallback]);

  return { location, status, error, locate };
}
