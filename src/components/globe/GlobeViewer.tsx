import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Viewer as CesiumViewer,
  Cartesian3,
  Color,
  Ion,
  Math as CesiumMath,
  PostProcessStage,
  GoogleMaps,
  OpenStreetMapImageryProvider,
  createGooglePhotorealistic3DTileset,
} from 'cesium';
import { Viewer, Globe, Scene, Camera, useCesium } from 'resium';
import EntityClickHandler from './EntityClickHandler';
import type { TrackedEntityInfo } from './EntityClickHandler';
import {
  CRT_SHADER,
  NVG_SHADER,
  FLIR_SHADER,
  SHADER_DEFAULTS,
  type ShaderMode,
} from '../../shaders/postprocess';

// Configure API keys
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
if (GOOGLE_API_KEY) {
  GoogleMaps.defaultApiKey = GOOGLE_API_KEY;
}

const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN;
if (CESIUM_ION_TOKEN) {
  Ion.defaultAccessToken = CESIUM_ION_TOKEN;
}

interface GlobeViewerProps {
  shaderMode: ShaderMode;
  mapTiles: 'google' | 'osm';
  onCameraChange?: (lat: number, lon: number, alt: number, heading: number, pitch: number) => void;
  onViewerReady?: (viewer: CesiumViewer) => void;
  onTrackEntity?: (info: TrackedEntityInfo | null) => void;
  onCctvClick?: (cameraData: any) => void;
  children?: React.ReactNode;
}

// Default camera: Sydney, Australia — zoomed out to see the full globe
const DEFAULT_POSITION = Cartesian3.fromDegrees(151.2093, -33.8688, 20_000_000);
const DEFAULT_HEADING = CesiumMath.toRadians(0);
const DEFAULT_PITCH = CesiumMath.toRadians(-90);

// Stable constants — prevents resium from recreating the Viewer on every render
const CONTEXT_OPTIONS = {
  webgl: {
    alpha: false,
    depth: true,
    stencil: false,
    antialias: true,
    preserveDrawingBuffer: true,
  },
};
const SCENE_BG_COLOR = new Color(0.04, 0.04, 0.04, 1.0);

/** Apply OpenStreetMap imagery to the viewer as a fallback */
function applyOSM(viewer: CesiumViewer) {
  if (viewer.isDestroyed()) return;
  const osmProvider = new OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
  });
  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.addImageryProvider(osmProvider);
}

/**
 * Inner component that lives inside <Viewer> so it can use useCesium().
 * Manages PostProcessStage lifecycle safely.
 */
function ShaderManager({ shaderMode }: { shaderMode: ShaderMode }) {
  const { viewer } = useCesium();
  const shaderStageRef = useRef<PostProcessStage | null>(null);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    // Remove existing shader
    if (shaderStageRef.current) {
      try {
        viewer.scene.postProcessStages.remove(shaderStageRef.current);
      } catch {
        // Stage may already have been removed if viewer was recreated
      }
      shaderStageRef.current = null;
    }

    if (shaderMode === 'none') return;

    let fragmentShader: string;
    let uniforms: Record<string, unknown>;

    switch (shaderMode) {
      case 'crt':
        fragmentShader = CRT_SHADER;
        uniforms = { ...SHADER_DEFAULTS.crt };
        break;
      case 'nvg':
        fragmentShader = NVG_SHADER;
        uniforms = { ...SHADER_DEFAULTS.nvg };
        break;
      case 'flir':
        fragmentShader = FLIR_SHADER;
        uniforms = { ...SHADER_DEFAULTS.flir };
        break;
      default:
        return;
    }

    const stage = new PostProcessStage({ fragmentShader, uniforms });
    viewer.scene.postProcessStages.add(stage);
    shaderStageRef.current = stage;

    return () => {
      if (shaderStageRef.current && viewer && !viewer.isDestroyed()) {
        try {
          viewer.scene.postProcessStages.remove(shaderStageRef.current);
        } catch {
          // Cleanup best-effort
        }
        shaderStageRef.current = null;
      }
    };
  }, [shaderMode, viewer]);

  return null;
}

export default function GlobeViewer({ shaderMode, mapTiles, onCameraChange, onViewerReady, onTrackEntity, onCctvClick, children }: GlobeViewerProps) {
  const viewerRef = useRef<CesiumViewer | null>(null);
  const [google3dReady, setGoogle3dReady] = useState(false);
  const google3dTilesetRef = useRef<any>(null);

  // Apply Google 3D Tiles on viewer ready
  const handleViewerReady = useCallback(async (viewer: CesiumViewer) => {
    viewerRef.current = viewer;

    // Ensure globe is fully opaque — prevent transparent rendering
    const globe = viewer.scene.globe;
    if (globe) {
      globe.baseColor = Color.BLACK;
      globe.depthTestAgainstTerrain = true;
      globe.showGroundAtmosphere = true;
      globe.translucency.enabled = false;
      globe.translucency.frontFaceAlpha = 1.0;
      globe.translucency.backFaceAlpha = 1.0;
    }

    // Only attempt Google tiles if mapTiles === 'google'
    if (mapTiles === 'google' && GOOGLE_API_KEY) {
      try {
        // Clear any imagery so only the Google 3D tileset provides textures
        viewer.imageryLayers.removeAll();
        const tileset = await createGooglePhotorealistic3DTileset();
        if (!viewer.isDestroyed()) {
          viewer.scene.primitives.add(tileset);
          google3dTilesetRef.current = tileset;
          setGoogle3dReady(true);
        }
      } catch (err) {
        console.warn('Google 3D Tiles failed to load — falling back to OSM.', err);
        applyOSM(viewer);
      }
    } else {
      applyOSM(viewer);
    }

    // Fly to default position
    viewer.camera.flyTo({
      destination: DEFAULT_POSITION,
      orientation: {
        heading: DEFAULT_HEADING,
        pitch: DEFAULT_PITCH,
        roll: 0,
      },
      duration: 3,
    });

    // Camera move listener — report position to parent
    viewer.camera.changed.addEventListener(() => {
      if (!onCameraChange || viewer.isDestroyed()) return;
      const carto = viewer.camera.positionCartographic;
      onCameraChange(
        CesiumMath.toDegrees(carto.latitude),
        CesiumMath.toDegrees(carto.longitude),
        carto.height,
        CesiumMath.toDegrees(viewer.camera.heading),
        CesiumMath.toDegrees(viewer.camera.pitch),
      );
    });
    // Lower the threshold so it fires more frequently
    viewer.camera.percentageChanged = 0.01;

    onViewerReady?.(viewer);
  }, [onCameraChange, onViewerReady, mapTiles]);

  // React to mapTiles changes after initial mount
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    if (mapTiles === 'google' && !google3dReady && GOOGLE_API_KEY) {
      // Switch to Google 3D Tiles — strip OSM imagery first
      viewer.imageryLayers.removeAll();
      (async () => {
        try {
          const tileset = await createGooglePhotorealistic3DTileset();
          if (!viewer.isDestroyed()) {
            viewer.scene.primitives.add(tileset);
            google3dTilesetRef.current = tileset;
            setGoogle3dReady(true);
          }
        } catch (err) {
          console.warn('Google 3D Tiles failed, staying on OSM.', err);
          applyOSM(viewer);
        }
      })();
    } else if (mapTiles === 'osm') {
      // Remove Google 3D tileset (if present) and switch to OSM
      if (google3dTilesetRef.current) {
        try {
          viewer.scene.primitives.remove(google3dTilesetRef.current);
        } catch { /* already removed */ }
        google3dTilesetRef.current = null;
      }
      setGoogle3dReady(false);
      applyOSM(viewer);
    }
  }, [mapTiles, google3dReady]);

  return (
    <Viewer
      full
      ref={(e) => {
        if (e?.cesiumElement && e.cesiumElement !== viewerRef.current) {
          handleViewerReady(e.cesiumElement);
        }
      }}
      animation={false}
      baseLayerPicker={false}
      baseLayer={false as any}
      shouldAnimate={true}
      fullscreenButton={false}
      geocoder={false}
      homeButton={false}
      infoBox={false}
      navigationHelpButton={false}
      sceneModePicker={false}
      selectionIndicator={false}
      timeline={false}
      orderIndependentTranslucency={false}
      contextOptions={CONTEXT_OPTIONS}
    >
      <Scene backgroundColor={SCENE_BG_COLOR} />
      {/* Globe is always shown so its spherical geometry contributes to the
          depth buffer — this occludes billboards/labels on the far side of
          Earth. When Google 3D Tiles are active they render on top visually,
          but the globe still provides the depth sphere underneath. */}
      <Globe
        enableLighting={true}
        depthTestAgainstTerrain={true}
        baseColor={Color.BLACK}
      />
      <Camera />
      <ShaderManager shaderMode={shaderMode} />
      <EntityClickHandler onTrackEntity={onTrackEntity} onCctvClick={onCctvClick} />
      {children}
    </Viewer>
  );
}
