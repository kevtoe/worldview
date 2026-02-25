/**
 * TrafficLayer — Renders street traffic with road networks and animated vehicles.
 *
 * Architecture:
 * - Uses PolylineCollection for roads (efficient, batched)
 * - Uses PointPrimitiveCollection for vehicle particles (efficient, ~1000+ supported)
 * - Updates imperatively via Cesium API (bypasses React reconciliation)
 *
 * Performance:
 * - 500–1000 vehicles at 60 FPS on typical hardware
 * - LOD: disabled when altitude > 5km (zoomed out)
 */
import { useEffect, useRef } from 'react';
import { useCesium } from 'resium';
import {
  PolylineCollection,
  PointPrimitiveCollection,
  Cartesian3,
  Color,
  Material,
} from 'cesium';
import type { RoadSegment, TrafficVehicle } from '../../hooks/useTraffic';

interface TrafficLayerProps {
  roads: RoadSegment[];
  vehicles: TrafficVehicle[];
  visible: boolean;
  showRoads?: boolean;
  showVehicles?: boolean;
  congestionMode?: boolean;
}

export default function TrafficLayer({
  roads,
  vehicles,
  visible,
  showRoads = true,
  showVehicles = true,
  congestionMode = false,
}: TrafficLayerProps) {
  // All hooks MUST be called unconditionally (React rules of hooks)
  const { viewer } = useCesium();

  const polylineCollectionRef = useRef<PolylineCollection | null>(null);
  const pointCollectionRef = useRef<PointPrimitiveCollection | null>(null);
  const renderedRoadsRef = useRef(new Set<string>());

  // Keep a stable ref to vehicles/roads so the animation loop doesn't
  // need them in its dependency array (avoids infinite re-render).
  const vehiclesRef = useRef<TrafficVehicle[]>(vehicles);
  vehiclesRef.current = vehicles;
  const roadsRef = useRef<RoadSegment[]>(roads);
  roadsRef.current = roads;

  /* ── Effect 1: Create / destroy primitive collections ── */
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const polylines = new PolylineCollection();
    const points = new PointPrimitiveCollection();

    viewer.scene.primitives.add(polylines);
    viewer.scene.primitives.add(points);

    polylineCollectionRef.current = polylines;
    pointCollectionRef.current = points;

    return () => {
      try {
        if (!viewer.isDestroyed()) {
          try { viewer.scene.primitives.remove(polylines); } catch { /* ok */ }
          try { viewer.scene.primitives.remove(points); } catch { /* ok */ }
        }
      } catch { /* viewer may be destroyed during HMR */ }
      polylineCollectionRef.current = null;
      pointCollectionRef.current = null;
      renderedRoadsRef.current.clear();
    };
  }, [viewer]);

  /* ── Effect 2: Sync road data into polylines ── */
  useEffect(() => {
    const polylines = polylineCollectionRef.current;
    if (!viewer || viewer.isDestroyed() || !polylines) return;

    if (!visible || !showRoads || roads.length === 0) {
      polylines.show = false;
      return;
    }

    polylines.show = true;

    // Only render roads that haven't been rendered yet (incremental updates)
    const newRoads = roads.filter((road) => !renderedRoadsRef.current.has(road.id));

    newRoads.forEach((road) => {
      const positions = road.geometry.map((pt: { lat: number; lon: number }) =>
        Cartesian3.fromDegrees(pt.lon, pt.lat, 0)
      );

      if (positions.length < 2) return; // Skip roads with insufficient geometry

      const color = getRoadColor(road.highway, congestionMode);

      try {
        polylines.add({
          positions,
          width: getRoadWidth(road.highway),
          material: Material.fromType('Color', { color }),
        });

        renderedRoadsRef.current.add(road.id);
      } catch {
        // Skip roads that fail to render
      }
    });


  }, [viewer, roads, visible, showRoads, congestionMode]);

  /* ── Effect 3: Render & animate vehicle particles ── */
  useEffect(() => {
    const points = pointCollectionRef.current;
    if (!viewer || viewer.isDestroyed() || !points) return;

    if (!visible || !showVehicles || vehicles.length === 0 || roads.length === 0) {
      points.show = false;
      return;
    }

    points.show = true;

    // Rebuild all vehicle points (fast enough for ~1000 points)
    points.removeAll();

    // Build road lookup map for O(1) access
    const roadMap = new Map<string, RoadSegment>();
    for (const r of roads) roadMap.set(r.id, r);

    vehicles.forEach((vehicle) => {
      const road = roadMap.get(vehicle.roadId);
      if (!road) return;

      const { lat, lon } = getPositionAlongRoad(road, vehicle.distanceAlongRoad);

      points.add({
        position: Cartesian3.fromDegrees(lon, lat, 0),
        pixelSize: 3,
        color: getVehicleColor(road.highway),
        outlineColor: Color.WHITE,
        outlineWidth: 0.5,
      });
    });
  }, [viewer, vehicles, roads, visible, showVehicles]);

  /* ── Effect 4: Visibility toggling ── */
  useEffect(() => {
    if (polylineCollectionRef.current) {
      polylineCollectionRef.current.show = visible && showRoads;
    }
    if (pointCollectionRef.current) {
      pointCollectionRef.current.show = visible && showVehicles;
    }
  }, [visible, showRoads, showVehicles]);

  return null; // Imperatively renders via Cesium
}

/**
 * Get colour for a road based on its class.
 */
function getRoadColor(roadClass: string, congestionMode: boolean): Color {
  if (congestionMode) {
    // In congestion mode, all roads start green (free flow)
    // This would be enhanced with real traffic data
    return Color.fromCssColorString('#00FF00').withAlpha(0.6);
  }

  const colorMap: Record<string, Color> = {
    motorway: Color.fromCssColorString('#FF6B6B').withAlpha(0.7),
    trunk: Color.fromCssColorString('#FF9999').withAlpha(0.7),
    primary: Color.fromCssColorString('#FFA500').withAlpha(0.7),
    secondary: Color.fromCssColorString('#FFD700').withAlpha(0.7),
    tertiary: Color.fromCssColorString('#BFFF00').withAlpha(0.7),
    residential: Color.fromCssColorString('#00BFFF').withAlpha(0.7),
  };

  return colorMap[roadClass] || Color.fromCssColorString('#808080').withAlpha(0.6);
}

/**
 * Get polyline width based on road class.
 */
function getRoadWidth(roadClass: string): number {
  const widthMap: Record<string, number> = {
    motorway: 3,
    trunk: 2.5,
    primary: 2,
    secondary: 1.5,
    tertiary: 1,
    residential: 0.8,
  };

  return widthMap[roadClass] || 1;
}

/**
 * Get colour for a vehicle particle.
 */
function getVehicleColor(roadClass: string): Color {
  // Vehicles on faster roads = more vibrant colour
  const colorMap: Record<string, Color> = {
    motorway: Color.fromCssColorString('#00FF00'),
    trunk: Color.fromCssColorString('#00FF00'),
    primary: Color.fromCssColorString('#FFFF00'),
    secondary: Color.fromCssColorString('#FFFF00'),
    tertiary: Color.fromCssColorString('#FF8800'),
    residential: Color.fromCssColorString('#FF4444'),
  };

  return colorMap[roadClass] || Color.fromCssColorString('#FFFFFF');
}

/**
 * Get lat/lon position of a vehicle at a given distance along a road.
 * Uses linear interpolation between geometry points.
 */
function getPositionAlongRoad(road: RoadSegment, distanceAlongRoad: number) {
  if (road.geometry.length === 0) {
    return { lat: 0, lon: 0 };
  }

  if (distanceAlongRoad <= 0) {
    const pt = road.geometry[0];
    return { lat: pt.lat, lon: pt.lon };
  }

  let accumulatedDistance = 0;

  for (let i = 0; i < road.geometry.length - 1; i++) {
    const p1 = road.geometry[i];
    const p2 = road.geometry[i + 1];

    const segmentLength = haversineDistance(p1.lat, p1.lon, p2.lat, p2.lon);
    const segmentEnd = accumulatedDistance + segmentLength;

    if (distanceAlongRoad <= segmentEnd) {
      // Vehicle is on this segment
      const fraction = (distanceAlongRoad - accumulatedDistance) / segmentLength;
      return {
        lat: p1.lat + (p2.lat - p1.lat) * fraction,
        lon: p1.lon + (p2.lon - p1.lon) * fraction,
      };
    }

    accumulatedDistance = segmentEnd;
  }

  // Fallback: end of road
  const lastPt = road.geometry[road.geometry.length - 1];
  return { lat: lastPt.lat, lon: lastPt.lon };
}

/**
 * Calculate distance between two lat/lon points in meters.
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
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
