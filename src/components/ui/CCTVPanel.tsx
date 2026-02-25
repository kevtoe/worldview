import { useState, useCallback, useMemo } from 'react';
import type { CameraFeed, CameraCountry } from '../../types/camera';
import MobileModal from './MobileModal';

const IMAGE_PROXY = '/api/cctv/image';

interface CCTVPanelProps {
  cameras: CameraFeed[];
  isLoading: boolean;
  error: string | null;
  totalOnline: number;
  totalCameras: number;
  availableCountries: CameraCountry[];
  countryFilter: string;
  selectedCameraId: string | null;
  onCountryFilterChange: (code: string) => void;
  onSelectCamera: (camera: CameraFeed | null) => void;
  onFlyToCamera: (camera: CameraFeed) => void;
  isMobile?: boolean;
}

function proxyUrl(url: string): string {
  return `${IMAGE_PROXY}?url=${encodeURIComponent(url)}`;
}

function CameraThumbnail({
  camera,
  isSelected,
  onSelect,
}: {
  camera: CameraFeed;
  isSelected: boolean;
  onSelect: (cam: CameraFeed) => void;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <button
      onClick={() => onSelect(camera)}
      className={`
        relative rounded overflow-hidden border transition-all duration-200
        ${isSelected
          ? 'border-wv-cyan/60 ring-1 ring-wv-cyan/30'
          : 'border-wv-border/50 hover:border-wv-border'}
      `}
    >
      <div className="aspect-video bg-wv-dark relative">
        {imgError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-wv-muted">
            <span className="text-[10px] font-bold tracking-wider">SIGNAL LOST</span>
            <span className="text-[8px] mt-0.5">NO FEED</span>
          </div>
        ) : (
          <img
            src={proxyUrl(camera.imageUrl)}
            alt={camera.name}
            loading="lazy"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        )}
        {/* Source badge */}
        <div className="absolute top-0.5 right-0.5 px-1 py-0.5 rounded bg-black/70 text-[7px] text-wv-muted uppercase tracking-wider">
          {camera.source}
        </div>
        {/* Online indicator */}
        <div className={`absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full ${camera.available ? 'bg-wv-green' : 'bg-wv-red'}`} />
      </div>
      <div className="px-1 py-0.5 bg-wv-dark/80">
        <div className="text-[8px] text-wv-text truncate">{camera.name}</div>
        <div className="text-[7px] text-wv-muted truncate">{camera.region}</div>
      </div>
    </button>
  );
}

export default function CCTVPanel({
  cameras,
  isLoading,
  error,
  totalOnline,
  totalCameras,
  availableCountries,
  countryFilter,
  selectedCameraId,
  onCountryFilterChange,
  onSelectCamera,
  onFlyToCamera,
  isMobile = false,
}: CCTVPanelProps) {
  const [visible, setVisible] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [previewImgError, setPreviewImgError] = useState(false);

  // Derive selected camera from prop (single source of truth in App)
  const selectedCamera = useMemo(
    () => cameras.find((c) => c.id === selectedCameraId) ?? null,
    [cameras, selectedCameraId],
  );

  const handleSelectCamera = useCallback((cam: CameraFeed) => {
    onSelectCamera(cam.id === selectedCameraId ? null : cam);
    setPreviewImgError(false);
  }, [onSelectCamera, selectedCameraId]);

  const handleFlyTo = useCallback(() => {
    if (!selectedCamera) return;
    onFlyToCamera(selectedCamera);
    // Auto-minimise only on mobile so the user can see the globe
    if (isMobile) {
      setVisible(false);
      setMobileOpen(false);
    }
  }, [selectedCamera, onFlyToCamera, isMobile]);

  // Paginate: show 30 cameras at a time for performance
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 30;

  // Reset page when filter changes
  const displayCameras = useMemo(() => {
    setPage(0);
    return cameras;
  }, [cameras]);

  const pagedCameras = displayCameras.slice(0, (page + 1) * PAGE_SIZE);
  const hasMore = pagedCameras.length < displayCameras.length;

  /* ── Shared inner content ── */
  const panelBody = (
    <div className="flex flex-col overflow-hidden flex-1">
          {/* Country Filter */}
          <div className="px-3 py-2 border-b border-wv-border shrink-0">
            <div className="text-[8px] text-wv-muted tracking-widest uppercase mb-1.5">Region Filter</div>
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => onCountryFilterChange('ALL')}
                className={`px-2 py-1 rounded text-[9px] tracking-wider transition-all duration-200
                  ${countryFilter === 'ALL'
                    ? 'text-wv-cyan bg-white/10 ring-1 ring-wv-cyan/40'
                    : 'text-wv-muted hover:text-wv-text hover:bg-white/5'
                  }`}
              >
                🌍 ALL
              </button>
              {availableCountries.map((c) => (
                <button
                  key={c.code}
                  onClick={() => onCountryFilterChange(c.code)}
                  className={`px-2 py-1 rounded text-[9px] tracking-wider transition-all duration-200
                    ${countryFilter === c.code
                      ? 'text-wv-cyan bg-white/10 ring-1 ring-wv-cyan/40'
                      : 'text-wv-muted hover:text-wv-text hover:bg-white/5'
                    }`}
                >
                  {c.flag} {c.code}
                </button>
              ))}
            </div>
          </div>

          {/* Status Bar */}
          <div className="px-3 py-1.5 border-b border-wv-border flex items-center justify-between shrink-0">
            <span className="text-[9px] text-wv-muted tracking-wider">
              CAMERAS ONLINE:{' '}
              <span className="text-wv-green">{totalOnline}</span>
              <span className="text-wv-muted"> / {totalCameras}</span>
            </span>
            {error && (
              <span className="text-[8px] text-wv-red tracking-wider">ERR</span>
            )}
          </div>

          {/* Expanded Preview */}
          {selectedCamera && (
            <div className="px-3 py-2 border-b border-wv-border shrink-0">
              <div className="rounded overflow-hidden border border-wv-cyan/30">
                <div className="aspect-video bg-wv-dark relative">
                  {previewImgError ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-wv-muted">
                      <span className="text-[12px] font-bold tracking-wider">SIGNAL LOST</span>
                      <span className="text-[9px] mt-1">CAMERA OFFLINE OR UNREACHABLE</span>
                    </div>
                  ) : (
                    <img
                      src={proxyUrl(selectedCamera.imageUrl)}
                      alt={selectedCamera.name}
                      onError={() => setPreviewImgError(true)}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="p-2 bg-wv-dark/80 space-y-0.5">
                  <div className="text-[10px] text-wv-text font-bold truncate">
                    📍 {selectedCamera.name}
                  </div>
                  <div className="text-[9px] text-wv-muted">
                    {availableCountries.find((c) => c.code === selectedCamera.country)?.flag}{' '}
                    {selectedCamera.region}, {selectedCamera.countryName}
                  </div>
                  <div className="text-[9px] text-wv-muted">
                    📐 {selectedCamera.latitude.toFixed(4)}°, {selectedCamera.longitude.toFixed(4)}°
                  </div>
                  {selectedCamera.viewDirection && (
                    <div className="text-[9px] text-wv-muted">
                      👁 View: {selectedCamera.viewDirection}
                    </div>
                  )}
                  <button
                    onClick={handleFlyTo}
                    className="mt-1.5 w-full px-2 py-1.5 rounded text-[9px] font-bold tracking-wider
                      text-wv-cyan bg-wv-cyan/10 hover:bg-wv-cyan/20 border border-wv-cyan/30
                      transition-all duration-200 flex items-center justify-center gap-1"
                  >
                    <span>⟁</span> FLY TO LOCATION
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Thumbnail Grid */}
          <div className="flex-1 overflow-y-auto p-2">
            {cameras.length === 0 && !isLoading && (
              <div className="text-center py-8 text-wv-muted">
                <div className="text-[11px] font-bold tracking-wider">NO CAMERAS AVAILABLE</div>
                <div className="text-[9px] mt-1">
                  {error ? 'Connection error — retrying...' : 'No feeds found for this region'}
                </div>
              </div>
            )}

            <div className={`grid gap-1.5 ${isMobile ? 'grid-cols-2' : 'grid-cols-3'}`}>
              {pagedCameras.map((cam) => (
                <CameraThumbnail
                  key={cam.id}
                  camera={cam}
                  isSelected={selectedCamera?.id === cam.id}
                  onSelect={handleSelectCamera}
                />
              ))}
            </div>

            {hasMore && (
              <button
                onClick={() => setPage((p) => p + 1)}
                className={`w-full mt-2 px-2 py-1.5 rounded text-[9px] text-wv-muted hover:text-wv-text
                  bg-white/5 hover:bg-white/10 tracking-wider transition-all duration-200
                  ${isMobile ? 'min-h-[44px] text-[11px]' : ''}`}
              >
                LOAD MORE ({displayCameras.length - pagedCameras.length} remaining)
              </button>
            )}
          </div>
        </div>
  );

  /* ── Mobile: badge + full-screen modal ── */
  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed top-3 right-16 z-40 w-11 h-11 rounded-lg panel-glass
                     flex items-center justify-center
                     text-wv-red hover:bg-white/10 transition-colors
                     select-none active:scale-95"
          aria-label="Open CCTV surveillance"
        >
          <span className="text-lg">📹</span>
          {totalOnline > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-wv-red
                             text-[8px] text-white font-bold flex items-center justify-center px-0.5">
              {totalOnline > 99 ? '99+' : totalOnline}
            </span>
          )}
        </button>
        <MobileModal
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          title="CCTV Surveillance"
          icon="📹"
          accent="bg-wv-red"
        >
          {panelBody}
        </MobileModal>
      </>
    );
  }

  /* ── Desktop: fixed side panel — positioned below IntelFeed ── */
  return (
    <div className="fixed top-80 right-4 w-80 panel-glass rounded-lg overflow-hidden z-40 select-none max-h-[calc(100vh-22rem)] flex flex-col">
      {/* Header */}
      <div
        className="px-3 py-2 border-b border-wv-border flex items-center justify-between cursor-pointer shrink-0"
        onClick={() => setVisible(!visible)}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-wv-red animate-pulse" />
          <span className="text-[10px] text-wv-muted tracking-widest uppercase">CCTV Surveillance</span>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && (
            <div className="w-3 h-3 border border-wv-cyan/40 border-t-wv-cyan rounded-full animate-spin" />
          )}
          <span className="text-[10px] text-wv-muted">{visible ? '▼' : '▶'}</span>
        </div>
      </div>
      {visible && panelBody}
    </div>
  );
}
