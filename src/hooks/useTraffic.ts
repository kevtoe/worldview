import { useState, useEffect, useRef, useCallback } from 'react';

export interface RoadSegment {
  id: string;
  name: string;
  highway: string; // 'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'residential'
  maxspeed: number;
  geometry: Array<{ lat: number; lon: number }>;
  length_meters: number;
}

export interface TrafficVehicle {
  id: string;
  roadId: string;
  distanceAlongRoad: number; // meters
  velocity: number; // m/s
  heading: number; // degrees
  timeCreated: number;
}

/**
 * Hook: Fetches road data (with static fallback) and animates traffic particles.
 *
 * Simplified architecture:
 * 1. Single fetch on enable (no bbox-change polling)
 * 2. Backend handles Overpass → static-data failover
 * 3. Retry with exponential backoff on failure
 * 4. Animation loop runs at 60 FPS, React state at 5 Hz
 */
export function useTraffic(
  enabled: boolean,
  latitude: number,
  longitude: number,
  altitude: number
) {
  const [roads, setRoads] = useState<RoadSegment[]>([]);
  const [vehicles, setVehicles] = useState<TrafficVehicle[]>([]);
  const [loading, setLoading] = useState(false);

  const animationFrameRef = useRef<number | undefined>(undefined);
  const vehiclesRef = useRef<TrafficVehicle[]>([]);
  const fetchedBboxRef = useRef<string | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Disable traffic rendering when zoomed out too far */
  const shouldFetchRoads = altitude < 5_000_000;

  /** Calculate bounding box from camera position and altitude */
  const calculateBbox = useCallback((lat: number, lon: number, alt: number) => {
    const scale = Math.max(0.01, Math.min(alt / 111000, 1.0)); // Cap at ~111km
    return {
      south: lat - scale,
      west: lon - scale,
      north: lat + scale,
      east: lon + scale,
    };
  }, []);

  /** Round bbox to reduce redundant fetches (snap to ~500m grid) */
  const bboxKey = useCallback((lat: number, lon: number, alt: number) => {
    const precision = 3; // ~111m precision
    return `${lat.toFixed(precision)},${lon.toFixed(precision)},${alt.toFixed(0)}`;
  }, []);

  // ── Fetch roads on enable or significant camera move ──
  useEffect(() => {
    if (!enabled || !shouldFetchRoads) {
      setRoads([]);
      setVehicles([]);
      vehiclesRef.current = [];
      fetchedBboxRef.current = null;
      return;
    }

    const currentKey = bboxKey(latitude, longitude, altitude);

    // Skip if we already fetched for this approximate position
    if (fetchedBboxRef.current === currentKey) return;

    // Skip if bbox is too large (zoomed way out)
    const bbox = calculateBbox(latitude, longitude, altitude);
    const span = Math.max(bbox.north - bbox.south, bbox.east - bbox.west);
    if (span > 2) return;

    let cancelled = false;

    const fetchRoads = async () => {
      setLoading(true);

      const params = new URLSearchParams({
        south: bbox.south.toString(),
        west: bbox.west.toString(),
        north: bbox.north.toString(),
        east: bbox.east.toString(),
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s frontend timeout

      try {
        const res = await fetch(`/api/traffic/roads?${params}`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`Traffic API HTTP ${res.status}`);
        if (cancelled) return;

        const data = await res.json();
        const roadData = data.roads as RoadSegment[];

        if (cancelled) return;

        fetchedBboxRef.current = currentKey;
        retryCountRef.current = 0;
        setRoads(roadData);

        // Spawn vehicles
        const newVehicles = spawnTrafficVehicles(roadData);
        vehiclesRef.current = newVehicles;
        setVehicles(newVehicles);


      } catch (err) {
        clearTimeout(timeoutId);
        if (cancelled) return;

        retryCountRef.current++;
        const backoff = Math.min(5000 * Math.pow(2, retryCountRef.current - 1), 30000);


        retryTimerRef.current = setTimeout(() => {
          if (!cancelled) fetchRoads();
        }, backoff);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchRoads();

    return () => {
      cancelled = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [enabled, latitude, longitude, altitude, shouldFetchRoads, bboxKey, calculateBbox]);

  // ── Animation loop for traffic particles ──
  useEffect(() => {
    if (!enabled || !shouldFetchRoads || roads.length === 0) return;
    if (vehiclesRef.current.length === 0) return;

    let lastFrameTime = Date.now();
    let lastReactUpdate = 0;
    const REACT_UPDATE_MS = 200; // 5 Hz React state pushes

    const animate = () => {
      const now = Date.now();
      const deltaTime = (now - lastFrameTime) / 1000;
      lastFrameTime = now;

      vehiclesRef.current = vehiclesRef.current.map((vehicle) => {
        const road = roads.find((r) => r.id === vehicle.roadId);
        if (!road) return vehicle;

        let newDistance = vehicle.distanceAlongRoad + vehicle.velocity * deltaTime;
        if (newDistance > road.length_meters) {
          newDistance -= road.length_meters;
        }

        return { ...vehicle, distanceAlongRoad: newDistance };
      });

      if (now - lastReactUpdate >= REACT_UPDATE_MS) {
        lastReactUpdate = now;
        setVehicles([...vehiclesRef.current]);
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [enabled, roads, shouldFetchRoads]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  return { roads, vehicles, loading, shouldFetchRoads };
}

/**
 * Spawn traffic particles along a set of roads.
 * Vehicle density varies by road class (motorways more crowded).
 */
function spawnTrafficVehicles(roads: RoadSegment[]): TrafficVehicle[] {
  const vehicles: TrafficVehicle[] = [];

  roads.forEach((road) => {
    const density = getVehicleDensity(road.highway); // vehicles per km
    const roadLengthKm = road.length_meters / 1000;
    const numVehicles = Math.max(1, Math.floor(roadLengthKm * density));

    for (let i = 0; i < numVehicles; i++) {
      const fractionAlong = i / numVehicles;
      const distanceAlongRoad = fractionAlong * road.length_meters;

      const vehicle: TrafficVehicle = {
        id: `vehicle:${road.id}:${i}:${Date.now()}`,
        roadId: road.id,
        distanceAlongRoad,
        velocity: getVehicleBaseSpeed(road.highway), // m/s
        heading: 0, // Will be calculated based on road geometry
        timeCreated: Date.now(),
      };

      vehicles.push(vehicle);
    }
  });

  return vehicles;
}

/**
 * Get base velocity for a road class (km/h → m/s).
 * Results in realistic speed variations: motorway faster, residential slower.
 */
function getVehicleBaseSpeed(roadClass: string): number {
  const speedMap: Record<string, number> = {
    motorway: 110, // km/h
    trunk: 90,
    primary: 60,
    secondary: 50,
    tertiary: 40,
    residential: 30,
  };

  const kmh = speedMap[roadClass] || 30;
  return kmh / 3.6; // Convert to m/s
}

/**
 * Get vehicle density (vehicles per km) for a road class.
 * Motorways busier than residential streets.
 */
function getVehicleDensity(roadClass: string): number {
  const densityMap: Record<string, number> = {
    motorway: 2.0, // 2 vehicles per km
    trunk: 1.5,
    primary: 1.0,
    secondary: 0.5,
    tertiary: 0.3,
    residential: 0.2,
  };

  return densityMap[roadClass] || 0.2;
}

/**
 * Get heading (bearing) for a vehicle at a given position along a road.
 * Calculates direction between consecutive geometry points.
 */
export function getHeadingForPosition(
  road: RoadSegment,
  distanceAlongRoad: number
): number {
  if (road.geometry.length < 2) return 0;

  // Find which segment the vehicle is on
  let accumulatedDistance = 0;
  for (let i = 0; i < road.geometry.length - 1; i++) {
    const p1 = road.geometry[i];
    const p2 = road.geometry[i + 1];
    const segmentLength = distanceBetweenPoints(p1.lat, p1.lon, p2.lat, p2.lon);

    if (accumulatedDistance + segmentLength >= distanceAlongRoad) {
      // Vehicle is on this segment
      return bearing(p1.lat, p1.lon, p2.lat, p2.lon);
    }

    accumulatedDistance += segmentLength;
  }

  return 0;
}

/**
 * Calculate distance between two points in meters (Haversine).
 */
function distanceBetweenPoints(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Calculate bearing (heading) between two points in degrees.
 */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}
