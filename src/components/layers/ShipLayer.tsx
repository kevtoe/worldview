/**
 * ShipLayer — High-performance imperative rendering of AIS vessel positions.
 *
 * Architecture mirrors FlightLayer: BillboardCollection + LabelCollection +
 * PolylineCollection for heading trails. Avoids React reconciliation via
 * useCesium() + useEffect for tens of thousands of vessels.
 *
 * Key features:
 * - Ship icon canvas (top-down vessel silhouette, pointing UP)
 * - Colour by AIS ship type category (cargo=blue, tanker=orange, etc.)
 * - Heading rotation via TrueHeading (falls back to COG)
 * - Short heading trail line
 * - Labels with vessel name, speed, destination
 * - Backing Entity per vessel for trackedEntity camera follow
 * - Dead-reckoning between data refreshes (preUpdate listener)
 * - Far-side globe occlusion
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
  Ellipsoid,
} from 'cesium';
import * as Cesium from 'cesium';

const EllipsoidalOccluder = (Cesium as any).EllipsoidalOccluder as new (
  ellipsoid: typeof Ellipsoid.WGS84,
  cameraPosition: Cartesian3,
) => { isPointVisible(point: Cartesian3): boolean };

import type { Ship, ShipCategory } from '../../hooks/useShips';
import { getShipCategory } from '../../hooks/useShips';

/* ─── ship icon canvas ─────────────────────────────────────────── */

/** Create a white top-down vessel silhouette on a transparent canvas (28x28).
 *  Drawn pointing UP (north). Billboard.rotation rotates it to heading. */
function createShipIcon(): HTMLCanvasElement {
  const S = 28;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const c = canvas.getContext('2d')!;
  const cx = S / 2;

  c.fillStyle = '#FFFFFF';
  c.beginPath();
  // Bow (pointed top)
  c.moveTo(cx, 2);
  // Starboard hull
  c.lineTo(cx + 5, 8);
  c.lineTo(cx + 5, 22);
  // Stern (flat bottom)
  c.lineTo(cx + 3, 26);
  c.lineTo(cx - 3, 26);
  // Port hull
  c.lineTo(cx - 5, 22);
  c.lineTo(cx - 5, 8);
  c.closePath();
  c.fill();

  // Bridge/superstructure indicator (small rectangle)
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.fillRect(cx - 3, 14, 6, 4);

  return canvas;
}

let _shipIcon: HTMLCanvasElement | null = null;
function getShipIcon(): HTMLCanvasElement {
  if (!_shipIcon) _shipIcon = createShipIcon();
  return _shipIcon;
}

/* ─── colour helpers ───────────────────────────────────────────── */

const CATEGORY_COLORS: Record<ShipCategory, Color> = {
  cargo:     Color.fromCssColorString('#4A9EFF'),  // blue
  tanker:    Color.fromCssColorString('#FF8C00'),  // orange
  passenger: Color.fromCssColorString('#00E676'),  // green
  fishing:   Color.fromCssColorString('#FFD740'),  // amber
  military:  Color.fromCssColorString('#FF5252'),  // red
  tug:       Color.fromCssColorString('#CE93D8'),  // purple
  pleasure:  Color.fromCssColorString('#80DEEA'),  // teal
  highspeed: Color.fromCssColorString('#FF80AB'),  // pink
  other:     Color.fromCssColorString('#90A4AE'),  // grey-blue
};

function getShipColor(category: ShipCategory): Color {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other;
}

/* ─── description HTML ─────────────────────────────────────────── */

function buildShipDescription(s: Ship, category: ShipCategory): string {
  const navStatusMap: Record<number, string> = {
    0: 'Under way (engine)',
    1: 'At anchor',
    2: 'Not under command',
    3: 'Restricted manoeuvrability',
    4: 'Constrained by draught',
    5: 'Moored',
    6: 'Aground',
    7: 'Fishing',
    8: 'Under way (sailing)',
    14: 'AIS-SART',
    15: 'Not defined',
  };
  const status = s.navStatus != null ? (navStatusMap[s.navStatus] ?? `Code ${s.navStatus}`) : 'N/A';

  return `
    <p><b>Name:</b> ${s.name || 'Unknown'}</p>
    <p><b>MMSI:</b> ${s.mmsi}</p>
    <p><b>IMO:</b> ${s.imo ?? 'N/A'}</p>
    <p><b>Call Sign:</b> ${s.callSign ?? 'N/A'}</p>
    <p><b>Type:</b> ${category.toUpperCase()} (code ${s.shipType ?? '?'})</p>
    <p><b>Flag:</b> ${s.country ?? 'N/A'}</p>
    <p><b>Status:</b> ${status}</p>
    <p><b>Speed:</b> ${s.sog != null ? s.sog.toFixed(1) + ' kt' : 'N/A'}</p>
    <p><b>Heading:</b> ${s.heading != null ? Math.round(s.heading) + '°' : 'N/A'}</p>
    <p><b>COG:</b> ${s.cog != null ? s.cog.toFixed(1) + '°' : 'N/A'}</p>
    <p><b>Destination:</b> ${s.destination || 'N/A'}</p>
    <p><b>Size:</b> ${s.length && s.width ? `${s.length}m × ${s.width}m` : 'N/A'}</p>
    <p><b>Position:</b> ${s.latitude.toFixed(4)}°, ${s.longitude.toFixed(4)}°</p>
  `;
}

/* ─── constants ────────────────────────────────────────────────── */

const LABEL_OFFSET = new CesiumCartesian2(10, -4);
const TRAIL_ALPHA = 0.45;
const TRACKED_SCALE = 1.2;

/* ═══════════════════════════════════════════════════════════════ */

export interface ShipLayerProps {
  ships: Ship[];
  visible: boolean;
  isTracking: boolean;
}

export default function ShipLayer({ ships, visible, isTracking }: ShipLayerProps) {
  const { viewer } = useCesium();

  // Backing entity map for trackedEntity camera follow
  const entityMapRef = useRef<Map<string, CesiumEntity>>(new Map());
  // Dead-reckoned position map (CallbackProperty reads from here)
  const positionMapRef = useRef<Map<string, Cartesian3>>(new Map());
  // Mutable ship state for dead-reckoning
  const shipStateRef = useRef<Map<string, {
    lat: number; lon: number;
    heading: number | null; cog: number | null; sog: number;
    updatedAt: number;
  }>>(new Map());

  // Persistent primitive collection refs
  const collectionsRef = useRef<{
    billboards: BillboardCollection;
    labels: LabelCollection;
    trails: PolylineCollection;
  } | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const primitiveMapRef = useRef<Map<string, { billboard: any; label: any }>>(new Map());

  /* ── Effect 1: Create / destroy primitive collections ── */
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const billboards = new BillboardCollection();
    const labels = new LabelCollection({ blendOption: BlendOption.TRANSLUCENT });
    const trails = new PolylineCollection();

    viewer.scene.primitives.add(billboards);
    viewer.scene.primitives.add(labels);
    viewer.scene.primitives.add(trails);

    collectionsRef.current = { billboards, labels, trails };

    return () => {
      try {
        if (!viewer.isDestroyed()) {
          try { viewer.scene.primitives.remove(billboards); } catch { /* ok */ }
          try { viewer.scene.primitives.remove(labels); } catch { /* ok */ }
          try { viewer.scene.primitives.remove(trails); } catch { /* ok */ }
        }
      } catch { /* viewer may be destroyed during HMR */ }
      collectionsRef.current = null;
      primitiveMapRef.current.clear();
    };
  }, [viewer]);

  /* ── Effect 2: Sync ship data into primitives ── */
  useEffect(() => {
    const cols = collectionsRef.current;
    let viewerOk = false;
    try { viewerOk = !!viewer && !viewer.isDestroyed(); } catch { /* */ }
    if (!viewerOk || !cols) return;

    // Rebuild trails each refresh
    try {
      cols.trails.show = false;
      cols.trails.removeAll();
    } catch { return; }

    if (!visible || ships.length === 0) {
      try {
        cols.billboards.removeAll();
        cols.labels.removeAll();
      } catch { /* destroyed */ }
      primitiveMapRef.current.clear();
      return;
    }

    const activeMMSIs = new Set<string>();

    for (const s of ships) {
      const category = getShipCategory(s.shipType);
      const color = getShipColor(category);
      const position = Cartesian3.fromDegrees(s.longitude, s.latitude, 0);
      const headingDeg = s.heading ?? s.cog ?? null;
      const rotation = headingDeg != null ? -CesiumMath.toRadians(headingDeg) : 0;

      const nameLabel = s.name || s.mmsi;
      const speedLabel = s.sog != null ? `${s.sog.toFixed(1)}kt` : '';
      const destLabel = s.destination ? `→${s.destination}` : '';
      const fullLabel = `${nameLabel} ${speedLabel} ${destLabel}`.trim();

      activeMMSIs.add(s.mmsi);

      // Update dead-reckoning state
      shipStateRef.current.set(s.mmsi, {
        lat: s.latitude, lon: s.longitude,
        heading: s.heading, cog: s.cog, sog: s.sog,
        updatedAt: Date.now(),
      });

      // Update position map for CallbackProperty
      positionMapRef.current.set(s.mmsi, position);

      // Backing entity for tracked-entity camera follow
      let backingEntity = entityMapRef.current.get(s.mmsi);
      if (!backingEntity) {
        try { if (viewer!.isDestroyed()) break; } catch { break; }

        const mmsi = s.mmsi;
        backingEntity = new CesiumEntity({
          id: `ship-${s.mmsi}`,
          name: nameLabel,
          position: new CallbackProperty(
            () => positionMapRef.current.get(mmsi) ?? position,
            false,
          ) as any,
          description: new ConstantProperty(buildShipDescription(s, category)),
          point: {
            pixelSize: 1,
            color: Color.TRANSPARENT,
          },
        });
        try {
          viewer!.entities.add(backingEntity);
        } catch { break; }
        entityMapRef.current.set(s.mmsi, backingEntity);
      } else {
        backingEntity.name = nameLabel;
        try {
          (backingEntity.description as ConstantProperty).setValue(buildShipDescription(s, category));
        } catch { /* entity may be destroyed */ }
      }

      // Billboard + Label: create or update in-place
      const existing = primitiveMapRef.current.get(s.mmsi);
      if (existing) {
        existing.billboard.position = position;
        existing.billboard.color = color;
        existing.billboard.rotation = rotation;
        existing.label.position = position;
        existing.label.text = fullLabel;
        existing.label.fillColor = color.withAlpha(0.85);
      } else {
        const billboard = cols.billboards.add({
          position,
          image: getShipIcon(),
          color,
          scale: 0.4,
          rotation,
          alignedAxis: Cartesian3.UNIT_Z,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          scaleByDistance: new NearFarScalar(1e4, 1.5, 5e7, 0.15),
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
          distanceDisplayCondition: new DistanceDisplayCondition(0, 5_000_000),
          disableDepthTestDistance: 0,
          id: backingEntity,
        });
        primitiveMapRef.current.set(s.mmsi, { billboard, label });
      }

      // Far-side occlusion
      if (viewer) {
        const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, viewer.camera.positionWC);
        const vis = occluder.isPointVisible(position);
        const prims = primitiveMapRef.current.get(s.mmsi);
        if (prims) {
          prims.billboard.show = vis;
          prims.label.show = vis && !isTracking;
        }
      }

      // Heading trail (short wake-like line behind the vessel)
      const trailHeading = s.heading ?? s.cog;
      if (trailHeading != null && s.sog > 0.5) {
        try {
          const trailLenDeg = 0.08;
          const headRad = CesiumMath.toRadians(trailHeading);
          const dLat = -Math.cos(headRad) * trailLenDeg;
          const dLon = -Math.sin(headRad) * trailLenDeg;
          cols.trails.add({
            positions: [
              Cartesian3.fromDegrees(s.longitude + dLon, s.latitude + dLat, 0),
              position,
            ],
            width: 1.5,
            material: Material.fromType('Color', { color: color.withAlpha(TRAIL_ALPHA) }),
          });
        } catch { /* skip bad trail */ }
      }
    }

    // Remove stale primitives
    for (const [mmsi, prims] of primitiveMapRef.current) {
      if (!activeMMSIs.has(mmsi)) {
        try { cols.billboards.remove(prims.billboard); } catch { /* ok */ }
        try { cols.labels.remove(prims.label); } catch { /* ok */ }
        primitiveMapRef.current.delete(mmsi);
      }
    }

    // Prune backing entities
    entityMapRef.current.forEach((entity, mmsi) => {
      if (!activeMMSIs.has(mmsi)) {
        try {
          if (viewer!.trackedEntity !== entity) {
            viewer!.entities.remove(entity);
          }
        } catch { /* viewer may be destroyed */ }
        if (viewer!.trackedEntity !== entity) {
          entityMapRef.current.delete(mmsi);
          positionMapRef.current.delete(mmsi);
          shipStateRef.current.delete(mmsi);
        }
      }
    });

    // Restore trail visibility
    try {
      cols.trails.show = visible;
    } catch { /* ok */ }
  }, [viewer, ships, visible]);

  /* ── Effect 3: Visibility toggling ── */
  useEffect(() => {
    const cols = collectionsRef.current;
    if (!cols) return;
    cols.billboards.show = visible;
    cols.labels.show = visible && !isTracking;
    cols.trails.show = visible;
  }, [visible, isTracking]);

  /* ── Effect 4: Dead-reckoning via preUpdate ── */
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    let lastBulkUpdate = 0;
    const BULK_MS = 2000; // Ships move slowly — 2s is fine

    const onPreUpdate = () => {
      try { if (viewer.isDestroyed()) return; } catch { return; }

      const now = Date.now();
      const tracked = viewer.trackedEntity;

      // Occlusion + tracked scale
      const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, viewer.camera.positionWC);
      const trackedId = tracked && typeof tracked.id === 'string' && tracked.id.startsWith('ship-')
        ? tracked.id.slice(5) : null;

      for (const [mmsi, prims] of primitiveMapRef.current) {
        const pos = positionMapRef.current.get(mmsi);
        if (pos) {
          const vis = occluder.isPointVisible(pos);
          prims.billboard.show = vis;
          prims.label.show = vis;
        }
        if (mmsi === trackedId) {
          prims.billboard.scale = TRACKED_SCALE;
          prims.billboard.alignedAxis = Cartesian3.ZERO;
          const st = shipStateRef.current.get(mmsi);
          const hdg = st?.heading ?? st?.cog;
          if (hdg != null) {
            prims.billboard.rotation = viewer.camera.heading - CesiumMath.toRadians(hdg);
          }
        } else {
          prims.billboard.alignedAxis = Cartesian3.UNIT_Z;
          prims.billboard.scale = 0.4;
        }
      }

      // Tracked ship: dead-reckon every frame
      if (tracked && typeof tracked.id === 'string' && tracked.id.startsWith('ship-')) {
        const mmsi = tracked.id.slice(5);
        const state = shipStateRef.current.get(mmsi);
        if (state) {
          const dtSec = (now - state.updatedAt) / 1000;
          let lat = state.lat;
          let lon = state.lon;
          const hdg = state.heading ?? state.cog;
          if (hdg != null && state.sog > 0.5 && dtSec > 0 && dtSec < 300) {
            const speedMps = state.sog * 0.514444;
            const headRad = CesiumMath.toRadians(hdg);
            lat += (Math.cos(headRad) * speedMps * dtSec) / 111320;
            const cosLat = Math.cos(lat * (Math.PI / 180)) || 0.0001;
            lon += (Math.sin(headRad) * speedMps * dtSec) / (111320 * cosLat);
          }
          const pos = Cartesian3.fromDegrees(lon, lat, 0);
          positionMapRef.current.set(mmsi, pos);
          const prims = primitiveMapRef.current.get(mmsi);
          if (prims) {
            try {
              prims.billboard.position = pos;
              prims.label.position = pos;
            } catch { /* ok */ }
          }
        }
      }

      // Bulk dead-reckon others
      if (now - lastBulkUpdate >= BULK_MS) {
        lastBulkUpdate = now;
        const trackedMMSI = tracked && typeof tracked.id === 'string' && tracked.id.startsWith('ship-')
          ? tracked.id.slice(5) : null;

        for (const [mmsi, prims] of primitiveMapRef.current) {
          if (mmsi === trackedMMSI) continue;
          const state = shipStateRef.current.get(mmsi);
          if (!state) continue;
          const dtSec = (now - state.updatedAt) / 1000;
          if (dtSec <= 0 || dtSec > 300) continue;

          let lat = state.lat;
          let lon = state.lon;
          const hdg = state.heading ?? state.cog;
          if (hdg != null && state.sog > 0.5) {
            const speedMps = state.sog * 0.514444;
            const headRad = CesiumMath.toRadians(hdg);
            lat += (Math.cos(headRad) * speedMps * dtSec) / 111320;
            const cosLat = Math.cos(lat * (Math.PI / 180)) || 0.0001;
            lon += (Math.sin(headRad) * speedMps * dtSec) / (111320 * cosLat);
          }
          const pos = Cartesian3.fromDegrees(lon, lat, 0);
          positionMapRef.current.set(mmsi, pos);
          try {
            prims.billboard.position = pos;
            prims.label.position = pos;
          } catch { /* ok */ }
        }
      }
    };

    viewer.scene.preUpdate.addEventListener(onPreUpdate);
    return () => {
      try {
        if (!viewer.isDestroyed()) {
          viewer.scene.preUpdate.removeEventListener(onPreUpdate);
        }
      } catch { /* ok */ }
    };
  }, [viewer]);

  // Cleanup backing entities on unmount
  useEffect(() => {
    return () => {
      try {
        if (viewer && !viewer.isDestroyed()) {
          entityMapRef.current.forEach((entity) => {
            try { viewer.entities.remove(entity); } catch { /* ok */ }
          });
        }
      } catch { /* ok */ }
      entityMapRef.current.clear();
      positionMapRef.current.clear();
      shipStateRef.current.clear();
    };
  }, [viewer]);

  return null;
}
