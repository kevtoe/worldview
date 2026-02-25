import { Entity, BillboardGraphics, LabelGraphics, PolylineGraphics, useCesium } from 'resium';
import { Cartesian3, Color, NearFarScalar, VerticalOrigin, HorizontalOrigin, CallbackProperty, Math as CesiumMath, Ellipsoid, ColorMaterialProperty, ArcType, PolylineDashMaterialProperty } from 'cesium';
import * as Cesium from 'cesium';

// EllipsoidalOccluder exists at runtime but is missing from Cesium's TS declarations
const EllipsoidalOccluder = (Cesium as any).EllipsoidalOccluder as new (
  ellipsoid: typeof Ellipsoid.WGS84,
  cameraPosition: Cartesian3,
) => { isPointVisible(point: Cartesian3): boolean };
import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { propagate, eciToGeodetic, gstime, degreesLat, degreesLong } from 'satellite.js';
import type { SatellitePosition } from '../../hooks/useSatellites';

// Stable colour constants — avoids creating new Color objects every 2 s render
const SAT_COLOR_ISS = Color.fromCssColorString('#00D4FF');
const SAT_COLOR_DEFAULT = Color.fromCssColorString('#39FF14');

/** Satellite category type for filtering */
export type SatelliteCategory = 'iss' | 'other';

/* ─── satellite icon canvas ──────────────────────────────────────── */

/** Create a white satellite silhouette on transparent canvas (32x32).
 *  Drawn pointing UP (direction of travel). Billboard.rotation rotates it. */
function createSatelliteIcon(): HTMLCanvasElement {
  const S = 32;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const c = canvas.getContext('2d')!;
  const cx = S / 2;
  const cy = S / 2;

  c.fillStyle = '#FFFFFF';
  c.strokeStyle = '#FFFFFF';
  c.lineWidth = 1.2;

  // Central body (diamond)
  c.beginPath();
  c.moveTo(cx, cy - 5);
  c.lineTo(cx + 4, cy);
  c.lineTo(cx, cy + 5);
  c.lineTo(cx - 4, cy);
  c.closePath();
  c.fill();

  // Left solar panel
  c.fillRect(cx - 14, cy - 3, 9, 6);
  // Right solar panel
  c.fillRect(cx + 5, cy - 3, 9, 6);

  // Panel struts
  c.beginPath();
  c.moveTo(cx - 4, cy);
  c.lineTo(cx - 14, cy);
  c.moveTo(cx + 4, cy);
  c.lineTo(cx + 14, cy);
  c.stroke();

  // Panel grid lines
  c.lineWidth = 0.5;
  c.strokeStyle = 'rgba(0,0,0,0.3)';
  for (let i = 1; i < 3; i++) {
    c.beginPath();
    c.moveTo(cx - 14 + i * 3, cy - 3);
    c.lineTo(cx - 14 + i * 3, cy + 3);
    c.moveTo(cx + 5 + i * 3, cy - 3);
    c.lineTo(cx + 5 + i * 3, cy + 3);
    c.stroke();
  }

  // Direction indicator (small arrow tip above body)
  c.fillStyle = '#FFFFFF';
  c.beginPath();
  c.moveTo(cx, cy - 10);
  c.lineTo(cx + 2, cy - 7);
  c.lineTo(cx - 2, cy - 7);
  c.closePath();
  c.fill();

  return canvas;
}

/** Lazily-created singleton satellite icon canvas */
let _satIcon: HTMLCanvasElement | null = null;
function getSatelliteIcon(): HTMLCanvasElement {
  if (!_satIcon) _satIcon = createSatelliteIcon();
  return _satIcon;
}

/** Compute bearing in degrees from (lat1,lon1) to (lat2,lon2) */
function computeBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

interface SatelliteLayerProps {
  satellites: SatellitePosition[];
  visible: boolean;
  showPaths: boolean;
  categoryFilter: Record<SatelliteCategory, boolean>;
  isTracking?: boolean;
}

export default function SatelliteLayer({ satellites, visible, showPaths, categoryFilter, isTracking }: SatelliteLayerProps) {
  if (!visible || satellites.length === 0) return null;

  return (
    <>
      {satellites.map((sat) => {
        const isISS = sat.name.includes('ISS') || sat.noradId === 25544;
        const category: SatelliteCategory = isISS ? 'iss' : 'other';

        // Filter by category
        if (!categoryFilter[category]) return null;

        const color = isISS ? SAT_COLOR_ISS : SAT_COLOR_DEFAULT;
        const scale = isISS ? 0.6 : 0.35;

        return <MemoSatelliteEntity key={sat.noradId} sat={sat} color={color} scale={scale} isISS={isISS} hideLabel={!!isTracking} showPaths={showPaths} isTracked={!!isTracking} />;
      })}
    </>
  );
}

/** Individual satellite entity — memoises orbit path Cartesian3 array */
const MemoSatelliteEntity = memo(function SatelliteEntity({
  sat,
  color,
  scale,
  isISS,
  hideLabel,
  showPaths,
  isTracked,
}: {
  sat: SatellitePosition;
  color: Color;
  scale: number;
  isISS: boolean;
  hideLabel: boolean;
  showPaths: boolean;
  isTracked: boolean;
}) {
  // Build orbit path positions (at satellite altitude)
  const orbitPositions = useMemo(() => {
    if (!sat.orbitPath || sat.orbitPath.length < 2) return null;
    return sat.orbitPath.map((p) =>
      Cartesian3.fromDegrees(p.longitude, p.latitude, p.altitude * 1000)
    );
  }, [sat.orbitPath]);

  // Ground track positions (projected onto surface)
  const groundTrackPositions = useMemo(() => {
    if (!sat.orbitPath || sat.orbitPath.length < 2) return null;
    return sat.orbitPath.map((p) =>
      Cartesian3.fromDegrees(p.longitude, p.latitude, 0)
    );
  }, [sat.orbitPath]);

  // Far-side occlusion state — only re-renders when visibility toggles
  const { viewer } = useCesium();
  const [isFarSide, setIsFarSide] = useState(false);
  const isFarSideRef = useRef(false);

  // Real-time position + heading via satellite.js propagation — throttled to 5 Hz
  const satrecRef = useRef(sat.satrec);
  satrecRef.current = sat.satrec;
  const cachedPositionRef = useRef(Cartesian3.fromDegrees(sat.longitude, sat.latitude, sat.altitude * 1000));
  const cachedHeadingRef = useRef(0); // degrees, 0=north

  useEffect(() => {
    const updatePosition = () => {
      try {
        const now = new Date();
        const gmst = gstime(now);
        const pv = propagate(satrecRef.current, now);
        if (pv && typeof pv.position !== 'boolean' && pv.position) {
          const geo = eciToGeodetic(pv.position, gmst);
          const lat = degreesLat(geo.latitude);
          const lon = degreesLong(geo.longitude);
          cachedPositionRef.current = Cartesian3.fromDegrees(lon, lat, geo.height * 1000);

          // Compute heading from a position 10s in the future
          const future = new Date(now.getTime() + 10_000);
          const futureGmst = gstime(future);
          const futurePV = propagate(satrecRef.current, future);
          if (futurePV && typeof futurePV.position !== 'boolean' && futurePV.position) {
            const futureGeo = eciToGeodetic(futurePV.position, futureGmst);
            cachedHeadingRef.current = computeBearing(
              lat, lon,
              degreesLat(futureGeo.latitude), degreesLong(futureGeo.longitude),
            );
          }

          // Far-side occlusion check — hide satellite when behind the globe
          if (viewer && !viewer.isDestroyed()) {
            const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, viewer.camera.positionWC);
            const hidden = !occluder.isPointVisible(cachedPositionRef.current);
            if (hidden !== isFarSideRef.current) {
              isFarSideRef.current = hidden;
              setIsFarSide(hidden);
            }
          }
        }
      } catch { /* propagation error — keep previous cached position */ }
    };
    updatePosition(); // immediate first propagation
    const handle = setInterval(updatePosition, 200); // 5 Hz
    return () => clearInterval(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sat.noradId, viewer]);

  const positionProperty = useMemo(() => {
    return new CallbackProperty(() => cachedPositionRef.current, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sat.noradId]);

  const rotationProperty = useMemo(() => {
    return new CallbackProperty(() => -CesiumMath.toRadians(cachedHeadingRef.current), false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sat.noradId]);

  return (
    <>
      {/* Satellite billboard + label */}
      <Entity
        id={`sat-${sat.noradId}`}
        show={!isFarSide}
        position={positionProperty as any}
        name={sat.name}
        description={`
          <p><b>NORAD ID:</b> ${sat.noradId}</p>
          <p><b>Altitude:</b> ${sat.altitude.toFixed(1)} km</p>
          <p><b>Lat:</b> ${sat.latitude.toFixed(4)}°</p>
          <p><b>Lon:</b> ${sat.longitude.toFixed(4)}°</p>
        `}
      >
        <BillboardGraphics
          image={getSatelliteIcon()}
          color={color}
          scale={isTracked ? 1.0 : scale}
          rotation={rotationProperty as any}
          alignedAxis={Cartesian3.UNIT_Z}
          horizontalOrigin={HorizontalOrigin.CENTER}
          verticalOrigin={VerticalOrigin.CENTER}
          scaleByDistance={new NearFarScalar(1e5, 1.5, 1e8, 0.3)}
        />
        <LabelGraphics
          show={!hideLabel}
          text={sat.name}
          font="9px monospace"
          fillColor={color.withAlpha(0.8)}
          outlineColor={Color.BLACK}
          outlineWidth={2}
          style={2}
          verticalOrigin={VerticalOrigin.BOTTOM}
          pixelOffset={{ x: 8, y: -4 } as any}
          scaleByDistance={new NearFarScalar(1e5, 1, 5e7, 0)}
        />
      </Entity>

      {/* Orbit path (at altitude) — only shown if showPaths is true */}
      {showPaths && orbitPositions && (
        <Entity key={`${sat.noradId}-orbit-${orbitPositions.length}`} id={`sat-${sat.noradId}-orbit`} name={`${sat.name} orbit`}>
          <PolylineGraphics
            positions={orbitPositions}
            width={isISS ? 3 : 2}
            material={new ColorMaterialProperty(color.withAlpha(isISS ? 0.7 : 0.4))}
            arcType={ArcType.NONE}
            clampToGround={false}
          />
        </Entity>
      )}

      {/* Ground track (projected on surface) — only shown if showPaths is true */}
      {showPaths && groundTrackPositions && (
        <Entity key={`${sat.noradId}-gtrack-${groundTrackPositions.length}`} id={`sat-${sat.noradId}-gtrack`} name={`${sat.name} ground track`}>
          <PolylineGraphics
            positions={groundTrackPositions}
            width={isISS ? 2 : 1}
            material={new PolylineDashMaterialProperty({ color: color.withAlpha(isISS ? 0.35 : 0.15), dashLength: 8 })}
            arcType={ArcType.GEODESIC}
            clampToGround={true}
          />
        </Entity>
      )}

      {/* Altitude line from ground to satellite — only shown if showPaths is true */}
      {showPaths && (
        <Entity id={`sat-${sat.noradId}-nadir`} name={`${sat.name} nadir`}>
          <PolylineGraphics
            positions={[
              Cartesian3.fromDegrees(sat.longitude, sat.latitude, 0),
              Cartesian3.fromDegrees(sat.longitude, sat.latitude, sat.altitude * 1000),
            ]}
            width={1}
            material={new ColorMaterialProperty(color.withAlpha(0.2))}
            arcType={ArcType.NONE}
          />
        </Entity>
      )}
    </>
  );
});
