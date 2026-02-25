import { useState, useEffect } from 'react';

interface CameraState {
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
  pitch: number;
}

interface StatusBarProps {
  camera: CameraState;
  shaderMode: string;
  dataStatus: {
    flights: number;
    satellites: number;
    earthquakes: number;
    cctv: number;
  };
  isMobile?: boolean;
}

function formatCoord(value: number, posLabel: string, negLabel: string): string {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = Math.floor((abs - deg) * 60);
  const sec = ((abs - deg - min / 60) * 3600).toFixed(1);
  return `${deg}°${min}'${sec}" ${value >= 0 ? posLabel : negLabel}`;
}

function formatAltitude(metres: number): string {
  if (metres > 100000) return `${(metres / 1000).toFixed(0)} km`;
  if (metres > 1000) return `${(metres / 1000).toFixed(1)} km`;
  return `${metres.toFixed(0)} m`;
}

export default function StatusBar({ camera, shaderMode, dataStatus, isMobile = false }: StatusBarProps) {
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const utcTime = clock.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const lat = formatCoord(camera.latitude, 'N', 'S');
  const lon = formatCoord(camera.longitude, 'E', 'W');
  const alt = formatAltitude(camera.altitude);
  const hdg = `${camera.heading.toFixed(1)}°`;

  // Compact coordinate format for mobile
  const latShort = `${Math.abs(camera.latitude).toFixed(2)}°${camera.latitude >= 0 ? 'N' : 'S'}`;
  const lonShort = `${Math.abs(camera.longitude).toFixed(2)}°${camera.longitude >= 0 ? 'E' : 'W'}`;
  const utcShort = clock.toISOString().slice(11, 19) + 'Z';

  /* ── Mobile: compact single row ── */
  if (isMobile) {
    return (
      <div className="fixed bottom-0 left-0 right-0 h-7 panel-glass flex items-center justify-between px-3 text-[9px] text-wv-muted z-50 select-none mobile-safe-bottom">
        <span className="text-wv-cyan">{latShort} {lonShort}</span>
        <span className="text-wv-green glow-green font-bold tracking-wider">{utcShort}</span>
        <span className="text-wv-text">{alt}</span>
      </div>
    );
  }

  /* ── Desktop: full status bar ── */

  return (
    <div className="fixed bottom-0 left-0 right-0 h-8 panel-glass flex items-center justify-between px-4 text-[10px] text-wv-muted z-50 select-none">
      {/* Left: Coordinates */}
      <div className="flex gap-4">
        <span>
          LAT <span className="text-wv-cyan glow-cyan">{lat}</span>
        </span>
        <span>
          LON <span className="text-wv-cyan glow-cyan">{lon}</span>
        </span>
        <span>
          ALT <span className="text-wv-text">{alt}</span>
        </span>
        <span>
          HDG <span className="text-wv-text">{hdg}</span>
        </span>
      </div>

      {/* Centre: Clock */}
      <div className="text-wv-green glow-green font-bold tracking-wider">
        {utcTime}
      </div>

      {/* Right: Data feeds + shader */}
      <div className="flex gap-4">
        <span>
          ACFT <span className={dataStatus.flights > 0 ? 'text-wv-green' : 'text-wv-muted'}>{dataStatus.flights}</span>
        </span>
        <span>
          SATS <span className={dataStatus.satellites > 0 ? 'text-wv-green' : 'text-wv-muted'}>{dataStatus.satellites}</span>
        </span>
        <span>
          SEIS <span className={dataStatus.earthquakes > 0 ? 'text-wv-amber' : 'text-wv-muted'}>{dataStatus.earthquakes}</span>
        </span>
        <span>
          CCTV <span className={dataStatus.cctv > 0 ? 'text-wv-red' : 'text-wv-muted'}>{dataStatus.cctv}</span>
        </span>
        <span className="border-l border-wv-border pl-4">
          OPTICS <span className="text-wv-cyan uppercase">{shaderMode === 'none' ? 'STD' : shaderMode}</span>
        </span>
      </div>
    </div>
  );
}
