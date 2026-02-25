import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Viewer as CesiumViewer, Cartesian3, Math as CesiumMath, Entity as CesiumEntity } from 'cesium';
import type { CameraFeed } from './types/camera';
import GlobeViewer from './components/globe/GlobeViewer';
import EarthquakeLayer from './components/layers/EarthquakeLayer';
import SatelliteLayer from './components/layers/SatelliteLayer';
import FlightLayer from './components/layers/FlightLayer';
import TrafficLayer from './components/layers/TrafficLayer';
import CCTVLayer from './components/layers/CCTVLayer';
import type { AltitudeBand } from './components/layers/FlightLayer';
import type { SatelliteCategory } from './components/layers/SatelliteLayer';
import OperationsPanel from './components/ui/OperationsPanel';
import StatusBar from './components/ui/StatusBar';
import IntelFeed from './components/ui/IntelFeed';
import AudioToggle from './components/ui/AudioToggle';
import CCTVPanel from './components/ui/CCTVPanel';
import Crosshair from './components/ui/Crosshair';
import TrackedEntityPanel from './components/ui/TrackedEntityPanel';
import SplashScreen from './components/ui/SplashScreen';
import FilmGrain from './components/ui/FilmGrain';
import { useEarthquakes } from './hooks/useEarthquakes';
import { useSatellites } from './hooks/useSatellites';
import { useFlights } from './hooks/useFlights';
import { useFlightsLive } from './hooks/useFlightsLive';
import { useTraffic } from './hooks/useTraffic';
import { useCameras } from './hooks/useCameras';
import { useGeolocation } from './hooks/useGeolocation';
import { useIsMobile } from './hooks/useIsMobile';
import { useAudio } from './hooks/useAudio';
import type { ShaderMode } from './shaders/postprocess';
import type { IntelFeedItem } from './components/ui/IntelFeed';
import type { TrackedEntityInfo } from './components/globe/EntityClickHandler';

const DEFAULT_ALTITUDE_FILTER: Record<AltitudeBand, boolean> = {
  cruise: false,
  high: true,
  mid: true,
  low: true,
  ground: true,
};

const DEFAULT_SATELLITE_FILTER: Record<SatelliteCategory, boolean> = {
  iss: true,
  other: true,
};

function App() {
  // Responsive breakpoint
  const isMobile = useIsMobile();

  // Audio engine
  const audio = useAudio();

  // Viewer ref for reset-view functionality
  const viewerRef = useRef<CesiumViewer | null>(null);

  // Boot sequence
  const [booted, setBooted] = useState(false);

  // State: shader mode
  const [shaderMode, setShaderMode] = useState<ShaderMode>('crt');

  // State: map tiles (google 3D vs OSM for testing)
  const [mapTiles, setMapTiles] = useState<'google' | 'osm'>('google');

  // State: data layer visibility
  const [layers, setLayers] = useState({
    flights: true,
    satellites: true,
    earthquakes: true,
    traffic: false,
    cctv: true,
  });

  // State: CCTV country filter
  const [cctvCountryFilter, setCctvCountryFilter] = useState('ALL');
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);

  // State: flight sub-toggles
  const [showPaths, setShowPaths] = useState(false);
  const [altitudeFilter, setAltitudeFilter] = useState<Record<AltitudeBand, boolean>>(DEFAULT_ALTITUDE_FILTER);

  // State: satellite sub-toggles
  const [showSatPaths, setShowSatPaths] = useState(false);
  const [satCategoryFilter, setSatCategoryFilter] = useState<Record<SatelliteCategory, boolean>>(DEFAULT_SATELLITE_FILTER);

  // State: camera position
  const [camera, setCamera] = useState({
    latitude: -33.8688,
    longitude: 151.2093,
    altitude: 50000,
    heading: 0,
    pitch: -45,
  });

  // State: tracked entity (lock view)
  const [trackedEntity, setTrackedEntity] = useState<TrackedEntityInfo | null>(null);
  const cctvTrackEntityRef = useRef<CesiumEntity | null>(null);

  /** Remove the temporary Cesium Entity used for CCTV lock-on */
  const cleanupCctvEntity = useCallback(() => {
    if (cctvTrackEntityRef.current) {
      const viewer = viewerRef.current;
      if (viewer && !viewer.isDestroyed()) {
        viewer.entities.remove(cctvTrackEntityRef.current);
      }
      cctvTrackEntityRef.current = null;
    }
  }, []);

  const handleTrackEntity = useCallback((info: TrackedEntityInfo | null) => {
    setTrackedEntity(info);
    // When tracking something else or clearing, clean up CCTV entity
    if (!info || info.entityType !== 'cctv') {
      cleanupCctvEntity();
    }
  }, [cleanupCctvEntity]);

  const handleViewerReady = useCallback((viewer: CesiumViewer) => {
    viewerRef.current = viewer;
  }, []);

  const handleResetView = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.trackedEntity = undefined;
    setTrackedEntity(null);
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(151.2093, -33.8688, 20_000_000),
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch: CesiumMath.toRadians(-90),
        roll: 0,
      },
      duration: 2,
    });
  }, []);

  // Data hooks
  const { earthquakes, feedItems: eqFeedItems } = useEarthquakes(layers.earthquakes);
  const { satellites, feedItems: satFeedItems } = useSatellites(layers.satellites);
  const { flights: flightsGlobal, feedItems: fltFeedItems } = useFlights(layers.flights);
  const { flightsLive } = useFlightsLive(
    layers.flights,
    camera.latitude,
    camera.longitude,
    camera.altitude,
    !!trackedEntity,
  );
  const { roads: trafficRoads, vehicles: trafficVehicles } = useTraffic(
    layers.traffic,
    camera.latitude,
    camera.longitude,
    camera.altitude,
  );
  const {
    cameras: cctvCameras,
    feedItems: cctvFeedItems,
    isLoading: cctvLoading,
    error: cctvError,
    totalOnline: cctvOnline,
    totalCameras: cctvTotal,
    availableCountries: cctvCountries,
  } = useCameras(layers.cctv, cctvCountryFilter);

  // Geolocation hook — browser GPS (consent) + IP fallback
  const { location: geoLocation, status: geoStatus, locate: geoLocate } = useGeolocation();

  // Fly to user's location when geolocation succeeds
  useEffect(() => {
    if (!geoLocation || geoStatus !== 'success') return;
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    // Choose altitude based on precision: GPS → street level, IP → city level
    const flyAltitude = geoLocation.source === 'gps' ? 5_000 : 200_000;

    viewer.trackedEntity = undefined;
    setTrackedEntity(null);
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(
        geoLocation.longitude,
        geoLocation.latitude,
        flyAltitude,
      ),
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch: CesiumMath.toRadians(-45),
        roll: 0,
      },
      duration: 2.5,
    });
  }, [geoLocation, geoStatus]);

  // Smart layer swap: live (adsb.fi 5s) replaces global (FR24 30s) for matching aircraft.
  // Global aircraft outside the live region remain visible. Zero duplicates guaranteed.
  const flights = useMemo(() => {
    if (flightsLive.length === 0) return flightsGlobal;
    if (flightsGlobal.length === 0) return flightsLive;

    // Set of icao24s in the live feed — these are EXCLUDED from global to prevent duplicates
    const liveIcaos = new Set(flightsLive.map((f) => f.icao24));

    // Global flights NOT covered by live feed (outside the adsb.fi 250nm region)
    const globalOnly = flightsGlobal.filter((f) => !liveIcaos.has(f.icao24));

    // Enrich live flights with FR24 route info where the live data is missing it
    const routeMap = new Map<string, { originAirport: string; destAirport: string; airline: string }>();
    for (const f of flightsGlobal) {
      if (f.originAirport || f.destAirport) {
        routeMap.set(f.icao24, {
          originAirport: f.originAirport,
          destAirport: f.destAirport,
          airline: f.airline,
        });
      }
    }
    const enrichedLive = flightsLive.map((f) => {
      const route = routeMap.get(f.icao24);
      if (route) {
        return {
          ...f,
          originAirport: f.originAirport || route.originAirport,
          destAirport: f.destAirport || route.destAirport,
          airline: f.airline || route.airline,
        };
      }
      return f;
    });

    return [...globalOnly, ...enrichedLive];
  }, [flightsGlobal, flightsLive]);

  // Combine intel feed items
  const allFeedItems: IntelFeedItem[] = [...fltFeedItems, ...satFeedItems, ...eqFeedItems, ...cctvFeedItems];

  // Handlers
  const handleCameraChange = useCallback(
    (lat: number, lon: number, alt: number, heading: number, pitch: number) => {
      setCamera({ latitude: lat, longitude: lon, altitude: alt, heading, pitch });
    },
    []
  );

  const handleLayerToggle = useCallback((layer: 'flights' | 'satellites' | 'earthquakes' | 'traffic' | 'cctv') => {
    setLayers((prev) => {
      const next = !prev[layer];
      audio.play(next ? 'toggleOn' : 'toggleOff');
      return { ...prev, [layer]: next };
    });
  }, [audio]);

  /** Select a camera in the panel (shows feed preview, no fly) */
  const handleSelectCamera = useCallback((cam: CameraFeed | null) => {
    setSelectedCameraId(cam ? cam.id : null);
  }, []);

  /** Lock-on to a CCTV camera: select, create entity, set trackedEntity */
  const handleCctvLockOn = useCallback((cam: CameraFeed) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    setSelectedCameraId(cam.id);

    // Clean up any previous CCTV tracking entity
    cleanupCctvEntity();

    // Create a temporary Cesium Entity at the camera position for lock-on
    const entity = viewer.entities.add({
      position: Cartesian3.fromDegrees(cam.longitude, cam.latitude, 0),
      name: cam.name,
      description: [
        `<b>Source:</b> ${cam.source.toUpperCase()}`,
        `<b>Country:</b> ${cam.countryName}`,
        `<b>Region:</b> ${cam.region || 'N/A'}`,
        `<b>Status:</b> ${cam.available ? 'ONLINE' : 'OFFLINE'}`,
        `<b>Coords:</b> ${cam.latitude.toFixed(4)}°, ${cam.longitude.toFixed(4)}°`,
      ].join('<br/>') as any,
    });
    // Viewing offset: 2km south + 2km up ≈ 45° angle, ~2.8km distance
    entity.viewFrom = new Cartesian3(0, -2000, 2000) as any;

    cctvTrackEntityRef.current = entity;

    // Lock on — Cesium flies to and centres the entity
    viewer.trackedEntity = entity;

    // Set React tracked-entity state for the tracking panel UI
    setTrackedEntity({
      name: cam.name,
      entityType: 'cctv',
      description: [
        `<b>Source:</b> ${cam.source.toUpperCase()}`,
        `<b>Country:</b> ${cam.countryName}`,
        `<b>Region:</b> ${cam.region || 'N/A'}`,
        `<b>Status:</b> ${cam.available ? 'ONLINE' : 'OFFLINE'}`,
      ].join('<br/>'),
    });
  }, [cleanupCctvEntity]);

  /** Handle FLY TO from CCTVPanel — locks on (same as globe click) */
  const handleFlyToCamera = useCallback((cam: CameraFeed) => {
    handleCctvLockOn(cam);
  }, [handleCctvLockOn]);

  /** Handle CCTV billboard click on the globe (from EntityClickHandler) */
  const handleCctvClickOnGlobe = useCallback((camData: any) => {
    handleCctvLockOn(camData as CameraFeed);
  }, [handleCctvLockOn]);

  const handleAltitudeToggle = useCallback((band: AltitudeBand) => {
    audio.play('click');
    setAltitudeFilter((prev) => ({ ...prev, [band]: !prev[band] }));
  }, [audio]);

  const handleSatCategoryToggle = useCallback((category: SatelliteCategory) => {
    audio.play('click');
    setSatCategoryFilter((prev) => ({ ...prev, [category]: !prev[category] }));
  }, [audio]);

  // Stable altitude filter ref to avoid unnecessary re-renders
  const stableAltitudeFilter = useMemo(() => altitudeFilter, [
    altitudeFilter.cruise, altitudeFilter.high, altitudeFilter.mid,
    altitudeFilter.low, altitudeFilter.ground,
  ]);

  // Boot complete callback — starts ambient drone
  const handleBootComplete = useCallback(() => {
    audio.play('bootComplete');
    audio.startAmbient();
    setBooted(true);
  }, [audio]);

  // Splash screen
  if (!booted) {
    return <SplashScreen onComplete={handleBootComplete} audio={audio} />;
  }

  return (
    <div className="w-screen h-screen bg-wv-black overflow-hidden scanline-overlay">
      {/* Animated film grain texture */}
      <FilmGrain opacity={0.06} />
      {/* 3D Globe (fills entire viewport) */}
      <GlobeViewer
        shaderMode={shaderMode}
        mapTiles={mapTiles}
        onCameraChange={handleCameraChange}
        onTrackEntity={handleTrackEntity}
        onViewerReady={handleViewerReady}
        onCctvClick={handleCctvClickOnGlobe}
      >
        <EarthquakeLayer earthquakes={earthquakes} visible={layers.earthquakes} isTracking={!!trackedEntity} />
        <SatelliteLayer satellites={satellites} visible={layers.satellites} showPaths={showSatPaths} categoryFilter={satCategoryFilter} isTracking={!!trackedEntity} />
        <FlightLayer
          flights={flights}
          visible={layers.flights}
          showPaths={showPaths}
          altitudeFilter={stableAltitudeFilter}
          isTracking={!!trackedEntity}
        />
        <TrafficLayer
          roads={trafficRoads}
          vehicles={trafficVehicles}
          visible={layers.traffic}
          showRoads={true}
          showVehicles={true}
          congestionMode={false}
        />
        <CCTVLayer
          cameras={cctvCameras}
          visible={layers.cctv}
          selectedCameraId={selectedCameraId}
        />
      </GlobeViewer>

      {/* Tactical UI Overlay */}
      <Crosshair />
      <TrackedEntityPanel trackedEntity={trackedEntity} isMobile={isMobile} />
      <OperationsPanel
        shaderMode={shaderMode}
        onShaderChange={(mode) => { audio.play('shaderSwitch'); setShaderMode(mode); }}
        layers={layers}
        onLayerToggle={handleLayerToggle}
        mapTiles={mapTiles}
        onMapTilesChange={(t) => { audio.play('click'); setMapTiles(t); }}
        showPaths={showPaths}
        onShowPathsToggle={() => { audio.play('click'); setShowPaths((p) => !p); }}
        altitudeFilter={altitudeFilter}
        onAltitudeToggle={handleAltitudeToggle}
        showSatPaths={showSatPaths}
        onShowSatPathsToggle={() => { audio.play('click'); setShowSatPaths((p) => !p); }}
        satCategoryFilter={satCategoryFilter}
        onSatCategoryToggle={handleSatCategoryToggle}
        onResetView={() => { audio.play('click'); handleResetView(); }}
        onLocateMe={() => { audio.play('click'); geoLocate(); }}
        geoStatus={geoStatus}
        isMobile={isMobile}
      />
      <IntelFeed items={allFeedItems} isMobile={isMobile} />
      {layers.cctv && (
        <CCTVPanel
          cameras={cctvCameras}
          isLoading={cctvLoading}
          error={cctvError}
          totalOnline={cctvOnline}
          totalCameras={cctvTotal}
          availableCountries={cctvCountries}
          countryFilter={cctvCountryFilter}
          selectedCameraId={selectedCameraId}
          onCountryFilterChange={setCctvCountryFilter}
          onSelectCamera={handleSelectCamera}
          onFlyToCamera={handleFlyToCamera}
          isMobile={isMobile}
        />
      )}
      <StatusBar
        camera={camera}
        shaderMode={shaderMode}
        isMobile={isMobile}
        dataStatus={{
          flights: flights.length,
          satellites: satellites.length,
          earthquakes: earthquakes.length,
          cctv: cctvTotal,
        }}
      />
      <AudioToggle muted={audio.muted} onToggle={audio.toggleMute} isMobile={isMobile} />
    </div>
  );
}

export default App;
