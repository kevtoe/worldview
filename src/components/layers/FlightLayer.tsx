/**
 * FlightLayer — High-performance imperative rendering using Cesium Primitive Collections.
 *
 * Instead of creating ~27,000 React <Entity> components (which caused complete UI freeze),
 * this uses BillboardCollection, LabelCollection, and PolylineCollection to batch
 * all aircraft into just a few GPU-friendly collections. This architecture is proven to
 * handle 100,000+ objects efficiently.
 *
 * Key decisions:
 * - Imperative API via useCesium() + useEffect — bypasses React reconciliation entirely
 * - removeAll() + bulk add() on each data refresh (recommended by Cesium docs)
 * - Route lines use great-circle (slerp) interpolation for proper curved arcs
 * - Labels use distanceDisplayCondition to hide when zoomed far out
 * - BillboardCollection renders aircraft icons rotated by heading
 * - disableDepthTestDistance: 0 on all labels/billboards for proper globe occlusion
 * - Each billboard gets an `id` property (backing Entity) for scene.pick() + trackedEntity
 */
import { useEffect, useRef } from 'react';
import { useCesium } from 'resium';
import {
  Cartesian3,
  Color,
  NearFarScalar,
  DistanceDisplayCondition,
  BillboardCollection,
  LabelCollection,
  PolylineCollection,
  BlendOption,
  VerticalOrigin,
  HorizontalOrigin,
  Cartesian2 as CesiumCartesian2,
  LabelStyle,
  Entity as CesiumEntity,
  CallbackProperty,
  ConstantProperty,
  Math as CesiumMath,
  Material,
  Cartographic,
  Ellipsoid,
  EllipsoidGeodesic,
} from 'cesium';
import type { Flight } from '../../hooks/useFlights';
import { getAirportCoords } from '../../data/airports';

/* ─── aircraft icon canvas ─────────────────────────────────────── */

/** Create a white aircraft silhouette on a transparent canvas (32x32).
 *  Drawn pointing UP (north). Billboard.rotation rotates it to heading. */
function createAircraftIcon(): HTMLCanvasElement {
  const S = 32;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const c = canvas.getContext('2d')!;
  const cx = S / 2;

  c.fillStyle = '#FFFFFF';
  c.beginPath();
  // Nose
  c.moveTo(cx, 2);
  // Right fuselage → right wing
  c.lineTo(cx + 3, 10);
  c.lineTo(cx + 13, 16);
  c.lineTo(cx + 13, 17);
  c.lineTo(cx + 3, 14);
  // Right tail
  c.lineTo(cx + 3, 22);
  c.lineTo(cx + 7, 27);
  c.lineTo(cx + 7, 28);
  c.lineTo(cx + 1, 25);
  // Centre tail
  c.lineTo(cx, 27);
  // Left tail
  c.lineTo(cx - 1, 25);
  c.lineTo(cx - 7, 28);
  c.lineTo(cx - 7, 27);
  c.lineTo(cx - 3, 22);
  // Left fuselage → left wing
  c.lineTo(cx - 3, 14);
  c.lineTo(cx - 13, 17);
  c.lineTo(cx - 13, 16);
  c.lineTo(cx - 3, 10);
  c.closePath();
  c.fill();

  return canvas;
}

/** Lazily-created singleton aircraft icon canvas */
let _aircraftIcon: HTMLCanvasElement | null = null;
function getAircraftIcon(): HTMLCanvasElement {
  if (!_aircraftIcon) _aircraftIcon = createAircraftIcon();
  return _aircraftIcon;
}

/** Altitude band keys — matches the colour coding */
export type AltitudeBand = 'cruise' | 'high' | 'mid' | 'low' | 'ground';

export interface FlightLayerProps {
  flights: Flight[];
  visible: boolean;
  showPaths: boolean;
  altitudeFilter: Record<AltitudeBand, boolean>;
  isTracking: boolean;
}

/* ─── altitude band classification ────────────────────────────────── */

export function getAltitudeBand(altFeet: number): AltitudeBand {
  if (altFeet >= 35_000) return 'cruise';
  if (altFeet >= 20_000) return 'high';
  if (altFeet >= 10_000) return 'mid';
  if (altFeet >= 3_000) return 'low';
  return 'ground';
}

/* ─── colour / size helpers ───────────────────────────────────────── */

function getAltitudeColor(altFeet: number): Color {
  if (altFeet >= 35_000) return Color.fromCssColorString('#00D4FF');
  if (altFeet >= 20_000) return Color.fromCssColorString('#00BFFF');
  if (altFeet >= 10_000) return Color.fromCssColorString('#FFD700');
  if (altFeet >= 3_000) return Color.fromCssColorString('#FF8C00');
  return Color.fromCssColorString('#FF4444');
}

/** Billboard scale by altitude — larger icons for higher aircraft */
function getAltitudeScale(altFeet: number): number {
  if (altFeet >= 30_000) return 0.45;
  if (altFeet >= 15_000) return 0.38;
  return 0.3;
}

/* ─── great-circle route line builder ─────────────────────────────── */

const ROUTE_ALT = 11_000;
const SEGMENTS = 12;

/**
 * Build positions along a great-circle arc between two geographic points,
 * with a smooth altitude curve. Uses EllipsoidGeodesic for accurate
 * geodesic interpolation — avoids the straight-line-through-globe artefact
 * that linear lat/lon interpolation produces on a 3D globe.
 */
function buildRoutePositions(
  fromLat: number, fromLon: number,
  toLat: number, toLon: number,
  altStart: number, altEnd: number,
  curveUp: boolean,
): Cartesian3[] {
  const start = Cartographic.fromDegrees(fromLon, fromLat);
  const end = Cartographic.fromDegrees(toLon, toLat);
  const geodesic = new EllipsoidGeodesic(start, end, Ellipsoid.WGS84);
  const pts: Cartesian3[] = [];

  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const carto = geodesic.interpolateUsingFraction(t);
    const alt = curveUp
      ? ROUTE_ALT * Math.sin(t * Math.PI * 0.5) + 500
      : ROUTE_ALT * Math.cos(t * Math.PI * 0.5) + 500;
    const finalAlt = i === 0 ? altStart : i === SEGMENTS ? altEnd : alt;
    carto.height = finalAlt;
    pts.push(Ellipsoid.WGS84.cartographicToCartesian(carto));
  }
  return pts;
}

/* ─── palette caching ─────────────────────────────────────────────── */

const ROUTE_COMPLETED_COLOR = Color.fromCssColorString('#00D4FF').withAlpha(0.18);
const ROUTE_REMAINING_COLOR = Color.fromCssColorString('#00D4FF').withAlpha(0.35);
const TRAIL_ALPHA = 0.4;
const LABEL_OFFSET = new CesiumCartesian2(10, -4);

/* ─── build description HTML for info panel ───────────────────────── */

function buildFlightDescription(f: Flight): string {
  return `
    <p><b>Callsign:</b> ${f.callsign || 'N/A'}</p>
    <p><b>Registration:</b> ${f.registration || 'N/A'}</p>
    <p><b>Aircraft:</b> ${f.description || f.aircraftType || 'Unknown'}</p>
    <p><b>Operator:</b> ${f.operator || f.airline || 'N/A'}</p>
    <p><b>Route:</b> ${f.originAirport || '?'} → ${f.destAirport || '?'}</p>
    <p><b>Altitude:</b> ${f.altitudeFeet.toLocaleString()} ft (${Math.round(f.altitude).toLocaleString()} m)</p>
    <p><b>Speed:</b> ${f.velocityKnots ?? 'N/A'} kt</p>
    <p><b>Heading:</b> ${f.heading != null ? Math.round(f.heading) + '°' : 'N/A'}</p>
    <p><b>Squawk:</b> ${f.squawk || 'N/A'}</p>
    <p><b>ICAO24:</b> ${f.icao24}</p>
  `;
}

/* ═══════════════════════════════════════════════════════════════════ */

export default function FlightLayer({ flights, visible, showPaths, altitudeFilter, isTracking }: FlightLayerProps) {
  const { viewer } = useCesium();

  // Map of icao24 → backing CesiumEntity for tracked-entity camera follow.
  const entityMapRef = useRef<Map<string, CesiumEntity>>(new Map());

  // Map of icao24 → current dead-reckoned Cartesian3 position.
  // CallbackProperty reads from this map every frame for smooth camera tracking.
  const positionMapRef = useRef<Map<string, Cartesian3>>(new Map());

  // Mutable flight state for dead-reckoning interpolation between data refreshes.
  const flightStateRef = useRef<Map<string, {
    lat: number; lon: number; alt: number;
    heading: number | null; speed: number | null;
    updatedAt: number;
  }>>(new Map());

  // Persistent primitive collection refs — survive across data refreshes
  const collectionsRef = useRef<{
    billboards: BillboardCollection;
    labels: LabelCollection;
    trails: PolylineCollection;
    routes: PolylineCollection;
  } | null>(null);

  // Map of icao24 → individual primitive refs for incremental position updates
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const primitiveMapRef = useRef<Map<string, { billboard: any; label: any }>>(new Map());

  /* ── Effect 1: Create / destroy primitive collections (viewer lifecycle) ── */
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const billboards = new BillboardCollection();
    const labels = new LabelCollection({ blendOption: BlendOption.TRANSLUCENT });
    const trails = new PolylineCollection();
    const routes = new PolylineCollection();

    viewer.scene.primitives.add(billboards);
    viewer.scene.primitives.add(labels);
    viewer.scene.primitives.add(trails);
    viewer.scene.primitives.add(routes);

    collectionsRef.current = { billboards, labels, trails, routes };

    return () => {
      try {
        if (!viewer.isDestroyed()) {
          try { viewer.scene.primitives.remove(billboards); } catch { /* ok */ }
          try { viewer.scene.primitives.remove(labels); } catch { /* ok */ }
          try { viewer.scene.primitives.remove(trails); } catch { /* ok */ }
          try { viewer.scene.primitives.remove(routes); } catch { /* ok */ }
        }
      } catch { /* viewer may be destroyed during HMR */ }
      collectionsRef.current = null;
      primitiveMapRef.current.clear();
    };
  }, [viewer]);

  /* ── Effect 2: Sync flight data into primitives (incremental updates) ── */
  useEffect(() => {
    const cols = collectionsRef.current;
    let viewerOk = false;
    try { viewerOk = !!viewer && !viewer.isDestroyed(); } catch { /* */ }
    if (!viewerOk || !cols) return;

    // Guard: if any collection was already destroyed (HMR / strict mode), bail out
    // Hide trail/route collections during rebuild to prevent Cesium rendering
    // partially-updated polylines (avoids material undefined crash)
    try {
      cols.trails.show = false;
      cols.routes.show = false;
      cols.trails.removeAll();
      cols.routes.removeAll();
    } catch {
      // Collections were destroyed — nothing we can do
      return;
    }

    if (!visible || flights.length === 0) {
      try {
        cols.billboards.removeAll();
        cols.labels.removeAll();
      } catch { /* destroyed */ }
      primitiveMapRef.current.clear();
      return;
    }

    const activeIcaos = new Set<string>();

    for (const f of flights) {
      const band = getAltitudeBand(f.altitudeFeet);
      if (!altitudeFilter[band]) continue;

      const color = getAltitudeColor(f.altitudeFeet);
      const scale = getAltitudeScale(f.altitudeFeet);
      const position = Cartesian3.fromDegrees(f.longitude, f.latitude, f.altitude);
      const rotation = f.heading != null ? -CesiumMath.toRadians(f.heading) : 0;

      const callLabel = f.callsign || f.registration || f.icao24;
      const altLabel = f.altitudeFeet > 0 ? `FL${Math.round(f.altitudeFeet / 100)}` : 'GND';
      const speedLabel = f.velocityKnots != null ? `${Math.round(f.velocityKnots)}kt` : '';
      const typeLabel = f.aircraftType || '';
      const routeLabel = f.originAirport && f.destAirport
        ? `${f.originAirport}\u2192${f.destAirport}` : '';
      const fullLabel = `${callLabel} ${altLabel} ${speedLabel} ${typeLabel} ${routeLabel}`.trim();

      activeIcaos.add(f.icao24);

      // Update dead-reckoning state
      flightStateRef.current.set(f.icao24, {
        lat: f.latitude, lon: f.longitude, alt: f.altitude,
        heading: f.heading ?? null, speed: f.velocityKnots ?? null,
        updatedAt: Date.now(),
      });

      // Backing entity for tracked-entity camera follow.
      // Uses CallbackProperty (isConstant=false) so Cesium re-evaluates
      // the position every frame — identical to how SatelliteLayer works.
      positionMapRef.current.set(f.icao24, position);

      let backingEntity = entityMapRef.current.get(f.icao24);
      if (!backingEntity) {
        // Guard: viewer may have been destroyed between loop iterations (HMR / strict mode)
        try { if (viewer!.isDestroyed()) break; } catch { break; }

        const icao = f.icao24; // capture for closure
        backingEntity = new CesiumEntity({
          id: `flight-${f.icao24}`,
          name: callLabel,
          position: new CallbackProperty(
            () => positionMapRef.current.get(icao) ?? position,
            false, // isConstant=false → Cesium re-reads every frame
          ) as any,
          description: new ConstantProperty(buildFlightDescription(f)),
          // A tiny transparent point is required so Cesium's PointVisualiser can
          // compute a bounding sphere for this entity. Without graphics,
          // DataSourceDisplay.getBoundingSphere returns FAILED and trackedEntity
          // camera follow never engages (EntityView is never created).
          point: {
            pixelSize: 1,
            color: Color.TRANSPARENT,
          },
        });
        try {
          viewer!.entities.add(backingEntity);
        } catch {
          // Viewer destroyed mid-loop — stop processing
          break;
        }
        entityMapRef.current.set(f.icao24, backingEntity);
      } else {
        backingEntity.name = callLabel;
        try {
          (backingEntity.description as ConstantProperty).setValue(buildFlightDescription(f));
        } catch { /* entity may be destroyed */ }
      }

      // Billboard + Label: create or update in-place
      const existing = primitiveMapRef.current.get(f.icao24);
      if (existing) {
        existing.billboard.position = position;
        existing.billboard.color = color;
        existing.billboard.scale = scale;
        existing.billboard.rotation = rotation;
        existing.label.position = position;
        existing.label.text = fullLabel;
        existing.label.fillColor = color.withAlpha(0.85);
      } else {
        const billboard = cols.billboards.add({
          position,
          image: getAircraftIcon(),
          color,
          scale,
          rotation,
          alignedAxis: Cartesian3.UNIT_Z,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          scaleByDistance: new NearFarScalar(1e4, 1.5, 5e7, 0.2),
          disableDepthTestDistance: 0,
          id: backingEntity,
        });
        const label = cols.labels.add({
          position,
          text: fullLabel,
          font: '8px monospace',
          fillColor: color.withAlpha(0.85),
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: LABEL_OFFSET,
          scaleByDistance: new NearFarScalar(1e4, 0.8, 3e7, 0),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 8_000_000),
          disableDepthTestDistance: 0,
          id: backingEntity,
        });
        primitiveMapRef.current.set(f.icao24, { billboard, label });
      }

      // Heading trail (rebuilt each refresh)
      if (f.heading != null && f.velocityKnots != null && f.velocityKnots >= 50) {
        try {
          const trailLenDeg = 0.15;
          const headingRad = CesiumMath.toRadians(f.heading);
          const dLat = -Math.cos(headingRad) * trailLenDeg;
          const dLon = -Math.sin(headingRad) * trailLenDeg;
          cols.trails.add({
            positions: [
              Cartesian3.fromDegrees(f.longitude + dLon, f.latitude + dLat, f.altitude),
              position,
            ],
            width: 1.5,
            material: Material.fromType('Color', { color: color.withAlpha(TRAIL_ALPHA) }),
          });
        } catch { /* skip bad trail polyline */ }
      }

      // Route lines (great-circle arcs) — each polyline gets its own Material
      // instance to avoid Cesium bucket corruption when the collection is rebuilt
      if (showPaths) {
        const origin = getAirportCoords(f.originAirport);
        const dest = getAirportCoords(f.destAirport);

        if (origin) {
          try {
            cols.routes.add({
              positions: buildRoutePositions(
                origin.lat, origin.lon,
                f.latitude, f.longitude,
                500, f.altitude, true,
              ),
              width: 1,
              material: Material.fromType('Color', { color: ROUTE_COMPLETED_COLOR }),
            });
          } catch { /* skip bad route polyline */ }
        }

        if (dest) {
          try {
            cols.routes.add({
              positions: buildRoutePositions(
                f.latitude, f.longitude,
                dest.lat, dest.lon,
                f.altitude, 500, false,
              ),
              width: 1.5,
              material: Material.fromType('Color', { color: ROUTE_REMAINING_COLOR }),
            });
          } catch { /* skip bad route polyline */ }
        }
      }
    }

    // Remove stale primitives
    for (const [icao, prims] of primitiveMapRef.current) {
      if (!activeIcaos.has(icao)) {
        try { cols.billboards.remove(prims.billboard); } catch { /* ok */ }
        try { cols.labels.remove(prims.label); } catch { /* ok */ }
        primitiveMapRef.current.delete(icao);
      }
    }

    // Prune backing entities (never prune tracked)
    entityMapRef.current.forEach((entity, icao) => {
      if (!activeIcaos.has(icao)) {
        try {
          if (viewer!.trackedEntity !== entity) {
            viewer!.entities.remove(entity);
          }
        } catch { /* viewer may be destroyed */ }
        if (viewer!.trackedEntity !== entity) {
          entityMapRef.current.delete(icao);
          positionMapRef.current.delete(icao);
          flightStateRef.current.delete(icao);
        }
      }
    });

    // Restore trail/route visibility now that rebuild is complete
    try {
      cols.trails.show = visible;
      cols.routes.show = visible && showPaths;
    } catch { /* collections may have been destroyed */ }
  }, [viewer, flights, visible, showPaths, altitudeFilter]);

  /* ── Effect 3: Visibility toggling ── */
  useEffect(() => {
    const cols = collectionsRef.current;
    if (!cols) return;
    cols.billboards.show = visible;
    cols.labels.show = visible && !isTracking;
    cols.trails.show = visible;
    cols.routes.show = visible && showPaths;
  }, [visible, isTracking, showPaths]);

  /* ── Effect 4: Dead-reckoning via Cesium preUpdate ──────────────── */
  // Uses preUpdate (NOT preRender) so position updates happen BEFORE Cesium
  // positions the camera for trackedEntity — eliminates the one-frame lag
  // that caused aircraft to "drift ahead" of the crosshair.
  //
  // Tracked entity: 60 fps for smooth camera follow
  // All others: bulk-updated every 1 s for visible drift
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    let lastBulkUpdate = 0;
    const BULK_MS = 1000;

    const onPreUpdate = () => {
      try {
        if (viewer.isDestroyed()) return;
      } catch { return; }

      const now = Date.now();
      const tracked = viewer.trackedEntity;

      // Tracked flight: dead-reckon every frame
      if (tracked && typeof tracked.id === 'string' && tracked.id.startsWith('flight-')) {
        const icao = tracked.id.slice(7);
        const state = flightStateRef.current.get(icao);
        if (state) {
          const dtSec = (now - state.updatedAt) / 1000;
          let lat = state.lat;
          let lon = state.lon;

          if (state.heading != null && state.speed != null && state.speed > 10 && dtSec > 0 && dtSec < 120) {
            const speedMps = state.speed * 0.514444;
            const headRad = CesiumMath.toRadians(state.heading);
            lat += (Math.cos(headRad) * speedMps * dtSec) / 111320;
            const cosLat = Math.cos(lat * (Math.PI / 180)) || 0.0001;
            lon += (Math.sin(headRad) * speedMps * dtSec) / (111320 * cosLat);
          }

          const pos = Cartesian3.fromDegrees(lon, lat, state.alt);
          // Update position map — CallbackProperty reads this every frame
          positionMapRef.current.set(icao, pos);

          const prims = primitiveMapRef.current.get(icao);
          if (prims) {
            try {
              prims.billboard.position = pos;
              prims.label.position = pos;
            } catch { /* primitive may have been removed during data refresh */ }
          }
        }
      }

      // Bulk dead-reckon all others every BULK_MS
      if (now - lastBulkUpdate >= BULK_MS) {
        lastBulkUpdate = now;
        const trackedIcao = tracked && typeof tracked.id === 'string' && tracked.id.startsWith('flight-')
          ? tracked.id.slice(7) : null;

        for (const [icao, prims] of primitiveMapRef.current) {
          if (icao === trackedIcao) continue;
          const state = flightStateRef.current.get(icao);
          if (!state) continue;
          const dtSec = (now - state.updatedAt) / 1000;
          if (dtSec <= 0 || dtSec > 120) continue;

          let lat = state.lat;
          let lon = state.lon;
          if (state.heading != null && state.speed != null && state.speed > 10) {
            const speedMps = state.speed * 0.514444;
            const headRad = CesiumMath.toRadians(state.heading);
            lat += (Math.cos(headRad) * speedMps * dtSec) / 111320;
            const cosLat = Math.cos(lat * (Math.PI / 180)) || 0.0001;
            lon += (Math.sin(headRad) * speedMps * dtSec) / (111320 * cosLat);
          }

          const pos = Cartesian3.fromDegrees(lon, lat, state.alt);
          // Update position map so CallbackProperty stays current for all entities
          positionMapRef.current.set(icao, pos);
          try {
            prims.billboard.position = pos;
            prims.label.position = pos;
          } catch { /* primitive may have been removed */ }
        }
      }
    };

    viewer.scene.preUpdate.addEventListener(onPreUpdate);
    return () => {
      try {
        if (!viewer.isDestroyed()) {
          viewer.scene.preUpdate.removeEventListener(onPreUpdate);
        }
      } catch { /* viewer may already be destroyed */ }
    };
  }, [viewer]);

  // Cleanup backing entities on unmount only
  useEffect(() => {
    return () => {
      try {
        if (viewer && !viewer.isDestroyed()) {
          entityMapRef.current.forEach((entity) => {
            try { viewer.entities.remove(entity); } catch { /* ok */ }
          });
        }
      } catch { /* viewer may be destroyed during HMR */ }
      entityMapRef.current.clear();
      positionMapRef.current.clear();
      flightStateRef.current.clear();
    };
  }, [viewer]);

  return null;
}

