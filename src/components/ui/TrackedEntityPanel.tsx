import { useState } from 'react';
import type { TrackedEntityInfo } from '../globe/EntityClickHandler';

interface TrackedEntityPanelProps {
  trackedEntity: TrackedEntityInfo | null;
  onUnlock?: () => void;
  isMobile?: boolean;
}

const TYPE_ICONS: Record<TrackedEntityInfo['entityType'], string> = {
  satellite: '🛰',
  aircraft: '✈',
  earthquake: '🌍',
  cctv: '📹',
  unknown: '📍',
};

const TYPE_LABELS: Record<TrackedEntityInfo['entityType'], string> = {
  satellite: 'SATELLITE',
  aircraft: 'AIRCRAFT',
  earthquake: 'SEISMIC EVENT',
  cctv: 'CCTV CAMERA',
  unknown: 'TARGET',
};

const TYPE_COLORS: Record<TrackedEntityInfo['entityType'], string> = {
  satellite: 'text-wv-green',
  aircraft: 'text-wv-cyan',
  earthquake: 'text-wv-amber',
  cctv: 'text-wv-red',
  unknown: 'text-wv-muted',
};

/** Parse simple key-value pairs from the entity description HTML */
function parseDescription(html: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  // Match patterns like <b>Key:</b> Value
  const regex = /<b>([^<]+):<\/b>\s*([^<]+)/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const key = match[1].trim();
    const value = match[2].trim();
    if (key && value) pairs[key] = value;
  }
  return pairs;
}

/** Build a FlightAware URL from a registration string (strips hyphens) */
function flightAwareUrl(registration: string): string {
  return `https://www.flightaware.com/live/flight/${registration.replace(/-/g, '')}`;
}

export default function TrackedEntityPanel({ trackedEntity, onUnlock, isMobile = false }: TrackedEntityPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!trackedEntity) return null;

  const details = parseDescription(trackedEntity.description);
  const icon = TYPE_ICONS[trackedEntity.entityType];
  const label = TYPE_LABELS[trackedEntity.entityType];
  const colorClass = TYPE_COLORS[trackedEntity.entityType];

  /* ── Mobile: compact tracking bar, tap to expand ── */
  if (isMobile) {
    return (
      <div className="fixed bottom-8 left-2 right-2 z-50 pointer-events-auto">
        <div className="panel-glass rounded-lg border border-wv-cyan/30 overflow-hidden">
          {/* Always-visible compact bar */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left"
          >
            <span className="text-base">{icon}</span>
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-mono font-bold text-wv-cyan truncate block">
                {trackedEntity.name}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="relative">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              </div>
              <span className="text-[8px] font-mono text-red-400 uppercase tracking-wider">LOCK</span>
              <span className="text-[10px] text-wv-muted ml-1">{expanded ? '▼' : '▲'}</span>
            </div>
          </button>

          {/* Expanded detail section */}
          {expanded && Object.keys(details).length > 0 && (
            <div className="px-3 pb-2 pt-1 border-t border-wv-cyan/10">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {Object.entries(details).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-1">
                    <span className="text-[9px] font-mono text-wv-muted uppercase truncate">{key}</span>
                    <span className="text-[10px] font-mono text-wv-cyan tabular-nums text-right truncate">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unlock button */}
          <button
            onClick={onUnlock}
            className="w-full text-[9px] font-mono uppercase tracking-wider text-wv-muted
                       hover:text-wv-cyan border-t border-wv-cyan/20
                       px-3 py-2 transition-colors min-h-[36px]"
          >
            Tap to unlock
          </button>
        </div>
      </div>
    );
  }

  /* ── Desktop: centred bottom panel (unchanged) ── */

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 pointer-events-auto">
      <div className="panel-glass rounded border border-wv-cyan/30 px-4 py-3 min-w-[320px] max-w-[480px]">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">{icon}</span>
            <div>
              <span className={`text-[10px] font-mono uppercase tracking-wider ${colorClass} opacity-70`}>
                {label} • TRACKING
              </span>
              <h3 className="text-sm font-mono font-bold text-wv-cyan leading-tight">
                {trackedEntity.name}
              </h3>
            </div>
          </div>
          {/* Tracking indicator - pulsing dot */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <div className="absolute inset-0 w-2 h-2 rounded-full bg-red-500 animate-ping opacity-50" />
            </div>
            <span className="text-[9px] font-mono text-red-400 uppercase tracking-wider">Lock</span>
          </div>
        </div>

        {/* Detail grid */}
        {Object.keys(details).length > 0 && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 pt-2 border-t border-wv-cyan/10">
            {Object.entries(details).map(([key, value]) => {
              const isRegLink = trackedEntity.entityType === 'aircraft'
                && key === 'Registration' && value && value !== 'N/A';

              return (
                <div key={key} className="flex justify-between gap-2">
                  <span className="text-[9px] font-mono text-wv-muted uppercase truncate">{key}</span>
                  {isRegLink ? (
                    <a
                      href={flightAwareUrl(value)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-mono text-wv-cyan tabular-nums text-right
                                 underline decoration-wv-cyan/40 hover:decoration-wv-cyan
                                 hover:text-white transition-colors pointer-events-auto"
                    >
                      {value}
                    </a>
                  ) : (
                    <span className="text-[10px] font-mono text-wv-cyan tabular-nums text-right">{value}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Unlock button */}
        <button
          onClick={onUnlock}
          className="mt-2 w-full text-[9px] font-mono uppercase tracking-wider text-wv-muted
                     hover:text-wv-cyan border border-wv-cyan/20 hover:border-wv-cyan/50
                     rounded px-2 py-1 transition-colors cursor-pointer"
        >
          Click empty space or press ESC to unlock
        </button>
      </div>
    </div>
  );
}
