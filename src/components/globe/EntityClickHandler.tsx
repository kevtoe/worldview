import { useEffect, useRef, useCallback } from 'react';
import {
  Cartesian2,
  Cartesian3,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
  Entity as CesiumEntity,
} from 'cesium';
import { useCesium } from 'resium';

/** Helper entity names to skip (not user-facing data entities) */
function isHelperEntity(name: string | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return (
    n.includes('orbit') ||
    n.includes('ground track') ||
    n.includes('nadir') ||
    n.includes('trail') ||
    n.includes('route-origin') ||
    n.includes('route-dest')
  );
}

export interface TrackedEntityInfo {
  name: string;
  entityType: 'satellite' | 'aircraft' | 'earthquake' | 'cctv' | 'unknown';
  description: string;
}

/** Duck-type check: is this a CCTV CameraFeed object stored as billboard id? */
function isCameraFeed(obj: unknown): obj is { id: string; name: string; latitude: number; longitude: number; source: string; country: string; countryName: string; region: string; available: boolean } {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return typeof o.latitude === 'number' && typeof o.longitude === 'number' && typeof o.source === 'string' && typeof o.name === 'string';
}

interface EntityClickHandlerProps {
  onTrackEntity?: (info: TrackedEntityInfo | null) => void;
  onCctvClick?: (cameraData: any) => void;
}

/**
 * Handles click events on Cesium entities.
 * - Click entity → zoom in and lock camera to track it
 * - Click empty space / ESC → unlock but keep current camera position
 */
export default function EntityClickHandler({ onTrackEntity, onCctvClick }: EntityClickHandlerProps) {
  const { viewer } = useCesium();
  const isTrackingRef = useRef(false);
  const onTrackEntityRef = useRef(onTrackEntity);
  onTrackEntityRef.current = onTrackEntity;
  const onCctvClickRef = useRef(onCctvClick);
  onCctvClickRef.current = onCctvClick;

  /** Unlock tracking without moving the camera */
  const unlock = useCallback(() => {
    if (!viewer || viewer.isDestroyed()) return;
    isTrackingRef.current = false;
    viewer.trackedEntity = undefined;
    viewer.selectedEntity = undefined;
    onTrackEntityRef.current?.(null);
  }, [viewer]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((movement: { position: Cartesian2 }) => {
      if (!viewer || viewer.isDestroyed()) return;

      // Use drillPick with a generous limit to find entities behind 3D tiles
      const pickedList = viewer.scene.drillPick(movement.position, 10);

      // Find the first real data entity in the pick list.
      // Primitives from PointPrimitiveCollection/LabelCollection set `id` to a
      // backing CesiumEntity, so picked.id instanceof CesiumEntity works for both
      // Entity-based layers and primitive-based layers.
      let entity: CesiumEntity | null = null;
      for (const picked of pickedList) {
        if (defined(picked?.id) && picked.id instanceof CesiumEntity) {
          const candidate = picked.id as CesiumEntity;
          if (isHelperEntity(candidate.name)) continue;
          // Accept any entity with a position (backing entities from primitive layers
          // have only position + description — no point/billboard/label graphics)
          if (candidate.position) {
            entity = candidate;
            break;
          }
        }
      }

      // --- Fallback: try regular pick if drillPick found nothing ---
      let singlePick: any = null;
      if (!entity) {
        singlePick = viewer.scene.pick(movement.position);
        if (defined(singlePick?.id) && singlePick.id instanceof CesiumEntity) {
          const candidate = singlePick.id as CesiumEntity;
          if (!isHelperEntity(candidate.name) && candidate.position) {
            entity = candidate;
          }
        }
      }

      // --- Check for CCTV billboard pick (stored CameraFeed as id) ---
      if (!entity) {
        const allPicks = singlePick ? [...pickedList, singlePick] : pickedList;
        for (const picked of allPicks) {
          if (isCameraFeed(picked?.id)) {
            onCctvClickRef.current?.(picked.id);
            return;
          }
        }
      }

      // --- Click on empty space → just unlock, keep current view ---
      if (!entity) {
        if (isTrackingRef.current || viewer.trackedEntity) {
          unlock();
        }
        return;
      }

      // --- Determine entity type from description/properties ---
      const entityType = classifyEntity(entity);
      const info: TrackedEntityInfo = {
        name: entity.name || 'Unknown',
        entityType,
        description: typeof entity.description?.getValue(viewer.clock.currentTime) === 'string'
          ? entity.description.getValue(viewer.clock.currentTime)
          : '',
      };

      // Set a sensible viewFrom offset so the camera arrives at a useful distance
      const offset = entityType === 'satellite'
        ? new Cartesian3(0, -500_000, 500_000)    // ~700 km offset for satellites
        : entityType === 'aircraft'
          ? new Cartesian3(0, -30_000, 30_000)     // ~42 km for aircraft
          : new Cartesian3(0, -200_000, 200_000);  // ~280 km for earthquakes/other

      entity.viewFrom = offset as any;

      // Use Cesium's built-in entity tracking — camera flies to entity and follows it
      viewer.trackedEntity = entity;
      isTrackingRef.current = true;
      onTrackEntityRef.current?.(info);
    }, ScreenSpaceEventType.LEFT_CLICK);

    // --- ESC key → unlock tracking, keep current view ---
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (isTrackingRef.current || viewer?.trackedEntity)) {
        unlock();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      if (!handler.isDestroyed()) handler.destroy();
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [viewer, unlock]);

  return null;
}

/** Classify an entity by inspecting its description HTML for known keywords */
function classifyEntity(entity: CesiumEntity): TrackedEntityInfo['entityType'] {
  const name = (entity.name || '').toLowerCase();
  let desc = '';
  try {
    const val = entity.description?.getValue(new Date() as any);
    if (typeof val === 'string') desc = val.toLowerCase();
  } catch { /* ignore */ }

  if (desc.includes('norad') || name.includes('iss') || (desc.includes('altitude') && desc.includes('km'))) {
    return 'satellite';
  }
  if (desc.includes('callsign') || desc.includes('icao24') || desc.includes('aircraft') || desc.includes('squawk')) {
    return 'aircraft';
  }
  if (desc.includes('magnitude') || desc.includes('depth')) {
    return 'earthquake';
  }
  return 'unknown';
}
