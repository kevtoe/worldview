import { useMemo, useRef, memo } from 'react';
import { Entity, PointGraphics, LabelGraphics } from 'resium';
import {
  CallbackProperty,
  Cartesian3,
  Color,
  JulianDate,
  NearFarScalar,
  VerticalOrigin,
} from 'cesium';
import type { Earthquake } from '../../hooks/useEarthquakes';

interface EarthquakeLayerProps {
  earthquakes: Earthquake[];
  visible: boolean;
  isTracking?: boolean;
}

function getMagnitudeColor(mag: number): Color {
  if (mag >= 6) return Color.RED;
  if (mag >= 5) return Color.ORANGE;
  if (mag >= 4) return Color.YELLOW;
  if (mag >= 3) return Color.fromCssColorString('#FF9500').withAlpha(0.8);
  return Color.fromCssColorString('#FF9500').withAlpha(0.4);
}

function getMagnitudeSize(mag: number): number {
  if (mag >= 6) return 14;
  if (mag >= 5) return 10;
  if (mag >= 4) return 7;
  if (mag >= 3) return 5;
  return 3;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashStringToNumber(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getPulseConfig(mag: number) {
  const clamped = clamp(mag, 2.5, 7.5);
  const t = (clamped - 2.5) / (7.5 - 2.5);
  return {
    baseSize: getMagnitudeSize(mag),
    amplitude: 2 + t * 6,
    speed: 0.9 + t * 1.4,
    alphaBase: 0.35 + t * 0.35,
    alphaAmplitude: 0.25 + t * 0.35,
  };
}

export default function EarthquakeLayer({ earthquakes, visible, isTracking }: EarthquakeLayerProps) {
  if (!visible) return null;

  // Only show M2.5+ to avoid clutter
  const filtered = earthquakes.filter((q) => q.mag >= 2.5);

  return (
    <>
      {filtered.map((eq) => (
        <MemoEarthquakeEntity key={eq.id} eq={eq} isTracking={!!isTracking} />
      ))}
    </>
  );
}

/** Individual earthquake entity — memoised so CallbackProperty instances persist across parent re-renders */
const MemoEarthquakeEntity = memo(function EarthquakeEntity({
  eq,
  isTracking,
}: {
  eq: Earthquake;
  isTracking: boolean;
}) {
  const startTimeRef = useRef(JulianDate.now());
  const { baseSize, amplitude, speed, alphaBase, alphaAmplitude } = getPulseConfig(eq.mag);
  const phase = (hashStringToNumber(eq.id) % 360) * (Math.PI / 180);

  // Stable CallbackProperty instances — created once per entity mount, persist across renders
  const pixelSize = useMemo(
    () =>
      new CallbackProperty((time) => {
        const now = time ?? JulianDate.now();
        const seconds = JulianDate.secondsDifference(now, startTimeRef.current);
        const pulse = (Math.sin(seconds * speed + phase) + 1) / 2;
        return baseSize + pulse * amplitude;
      }, false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eq.id],
  );

  const color = useMemo(
    () =>
      new CallbackProperty((time) => {
        const now = time ?? JulianDate.now();
        const seconds = JulianDate.secondsDifference(now, startTimeRef.current);
        const pulse = (Math.sin(seconds * speed + phase) + 1) / 2;
        const alpha = alphaBase + pulse * alphaAmplitude;
        return getMagnitudeColor(eq.mag).withAlpha(alpha);
      }, false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eq.id],
  );

  const position = useMemo(
    () => Cartesian3.fromDegrees(eq.longitude, eq.latitude),
    [eq.longitude, eq.latitude],
  );

  return (
    <>
      <Entity
        id={`eq-${eq.id}`}
        position={position}
        name={`M${eq.mag.toFixed(1)} — ${eq.place}`}
        description={`
          <p><b>Magnitude:</b> ${eq.mag.toFixed(1)}</p>
          <p><b>Depth:</b> ${eq.depth.toFixed(1)} km</p>
          <p><b>Time:</b> ${new Date(eq.time).toISOString()}</p>
        `}
      >
        <PointGraphics
          pixelSize={pixelSize}
          color={color}
          outlineColor={Color.BLACK}
          outlineWidth={1}
          scaleByDistance={new NearFarScalar(1e3, 1.5, 1e7, 0.5)}
        />
        <LabelGraphics
          show={eq.mag >= 4.5 && !isTracking}
          text={`M${eq.mag.toFixed(1)}`}
          font="10px monospace"
          fillColor={Color.fromCssColorString('#FF9500')}
          outlineColor={Color.BLACK}
          outlineWidth={2}
          style={2}
          verticalOrigin={VerticalOrigin.BOTTOM}
          pixelOffset={{ x: 0, y: -12 } as any}
          scaleByDistance={new NearFarScalar(1e3, 1, 5e6, 0.3)}
        />
      </Entity>
    </>
  );
});
