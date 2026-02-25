import { useEffect, useRef } from 'react';
import { useCesium } from 'resium';
import {
  BillboardCollection,
  LabelCollection,
  Cartesian3,
  Color,
  VerticalOrigin,
  HorizontalOrigin,
  NearFarScalar,
  DistanceDisplayCondition,
} from 'cesium';
import type { CameraFeed } from '../../types/camera';

interface CCTVLayerProps {
  cameras: CameraFeed[];
  visible: boolean;
  selectedCameraId: string | null;
}

const COUNTRY_COLORS: Record<string, Color> = {
  GB: Color.fromCssColorString('#00D4FF'),   // cyan
  US: Color.fromCssColorString('#FF9500'),   // amber
  AU: Color.fromCssColorString('#39FF14'),   // green
};

const DEFAULT_COLOR = Color.fromCssColorString('#CCCCCC');
const SELECTED_COLOR = Color.fromCssColorString('#FF3B30');

/**
 * Create a canvas-based camera icon for Cesium billboards.
 */
function createCameraIcon(color: string, size = 16): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Camera body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(2, 4, 10, 8, 1);
  ctx.fill();

  // Camera lens
  ctx.beginPath();
  ctx.moveTo(12, 5);
  ctx.lineTo(15, 3);
  ctx.lineTo(15, 13);
  ctx.lineTo(12, 11);
  ctx.closePath();
  ctx.fill();

  // Recording dot
  ctx.fillStyle = '#FF3B30';
  ctx.beginPath();
  ctx.arc(5, 7, 1.5, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

// Pre-render icon canvases per country
const iconCache = new Map<string, HTMLCanvasElement>();

function getCameraIcon(country: string, isSelected: boolean): HTMLCanvasElement {
  const key = isSelected ? `${country}-selected` : country;
  if (!iconCache.has(key)) {
    const color = isSelected
      ? '#FF3B30'
      : COUNTRY_COLORS[country]?.toCssColorString() || '#CCCCCC';
    iconCache.set(key, createCameraIcon(color, 20));
  }
  return iconCache.get(key)!;
}

export default function CCTVLayer({ cameras, visible, selectedCameraId }: CCTVLayerProps) {
  const { scene } = useCesium();
  const billboardCollectionRef = useRef<BillboardCollection | null>(null);
  const labelCollectionRef = useRef<LabelCollection | null>(null);

  // Create/destroy primitive collections
  useEffect(() => {
    if (!scene) return;

    const bbCollection = new BillboardCollection({ scene });
    const lblCollection = new LabelCollection({ scene });

    scene.primitives.add(bbCollection);
    scene.primitives.add(lblCollection);

    billboardCollectionRef.current = bbCollection;
    labelCollectionRef.current = lblCollection;

    return () => {
      if (!scene.isDestroyed()) {
        scene.primitives.remove(bbCollection);
        scene.primitives.remove(lblCollection);
      }
      billboardCollectionRef.current = null;
      labelCollectionRef.current = null;
    };
  }, [scene]);

  // Update billboards when cameras or visibility changes
  useEffect(() => {
    const bbCollection = billboardCollectionRef.current;
    const lblCollection = labelCollectionRef.current;
    if (!bbCollection || !lblCollection) return;

    // Clear existing
    bbCollection.removeAll();
    lblCollection.removeAll();

    if (!visible || cameras.length === 0) return;

    for (let i = 0; i < cameras.length; i++) {
      const cam = cameras[i];
      const isSelected = cam.id === selectedCameraId;
      const position = Cartesian3.fromDegrees(cam.longitude, cam.latitude, 50);
      const countryColor = COUNTRY_COLORS[cam.country] || DEFAULT_COLOR;

      bbCollection.add({
        position,
        image: getCameraIcon(cam.country, isSelected),
        scale: isSelected ? 1.5 : 1.0,
        color: isSelected ? SELECTED_COLOR : countryColor,
        verticalOrigin: VerticalOrigin.CENTER,
        horizontalOrigin: HorizontalOrigin.CENTER,
        scaleByDistance: new NearFarScalar(5_000, 1.2, 500_000, 0.4),
        translucencyByDistance: new NearFarScalar(1_000, 1.0, 2_000_000, 0.3),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 2_000_000),
        id: cam, // Store the full CameraFeed object for EntityClickHandler pick detection
      });

      // Label only at close zoom
      lblCollection.add({
        position,
        text: cam.name,
        font: '10px JetBrains Mono, monospace',
        fillColor: Color.WHITE.withAlpha(0.9),
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        style: 2, // FILL_AND_OUTLINE
        verticalOrigin: VerticalOrigin.TOP,
        horizontalOrigin: HorizontalOrigin.CENTER,
        pixelOffset: new Cartesian3(0, 12, 0) as any,
        scaleByDistance: new NearFarScalar(1_000, 1.0, 100_000, 0.0),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 50_000),
      });

    }
  }, [cameras, visible, selectedCameraId]);

  return null; // Imperative rendering — no JSX needed
}
