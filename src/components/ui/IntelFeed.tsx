import { useState } from 'react';
import MobileModal from './MobileModal';

interface IntelFeedItem {
  id: string;
  time: string;
  type: 'flight' | 'seismic' | 'satellite' | 'system' | 'cctv';
  message: string;
}

const TYPE_STYLES: Record<string, string> = {
  flight: 'text-wv-cyan',
  seismic: 'text-wv-amber',
  satellite: 'text-wv-green',
  system: 'text-wv-muted',
  cctv: 'text-wv-red',
};

const TYPE_LABELS: Record<string, string> = {
  flight: 'ACFT',
  seismic: 'SEIS',
  satellite: 'SATS',
  system: 'SYS ',
  cctv: 'CCTV',
};

interface IntelFeedProps {
  items: IntelFeedItem[];
  isMobile?: boolean;
}

export default function IntelFeed({ items, isMobile = false }: IntelFeedProps) {
  const [visible, setVisible] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Bootstrap message on mount
  const [bootMessages] = useState<IntelFeedItem[]>([
    {
      id: 'boot-1',
      time: new Date().toISOString().slice(11, 19),
      type: 'system',
      message: 'WORLDVIEW v1.0.0 INITIALISING...',
    },
    {
      id: 'boot-2',
      time: new Date().toISOString().slice(11, 19),
      type: 'system',
      message: 'CESIUM 3D ENGINE LOADED',
    },
    {
      id: 'boot-3',
      time: new Date().toISOString().slice(11, 19),
      type: 'system',
      message: 'GOOGLE 3D TILES CONNECTED',
    },
    {
      id: 'boot-4',
      time: new Date().toISOString().slice(11, 19),
      type: 'system',
      message: 'TACTICAL DISPLAY ONLINE',
    },
  ]);

  const allItems = [...bootMessages, ...items].slice(-20);

  // Count non-system items as "unread" for the mobile badge
  const liveCount = items.filter((i) => i.type !== 'system').length;

  const feedList = (
    <div className={isMobile ? 'p-3' : 'max-h-64 overflow-y-auto p-2'}>
      {allItems.map((item) => (
        <div key={item.id} className={`flex gap-2 py-0.5 text-[9px] leading-tight ${isMobile ? 'py-1.5 text-[11px]' : ''}`}>
          <span className="text-wv-muted shrink-0">{item.time}</span>
          <span className={`shrink-0 font-bold ${TYPE_STYLES[item.type]}`}>
            [{TYPE_LABELS[item.type]}]
          </span>
          <span className="text-wv-text/80">{item.message}</span>
        </div>
      ))}
    </div>
  );

  /* ── Mobile: badge button + full-screen modal ── */
  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed top-3 right-3 z-40 w-11 h-11 rounded-lg panel-glass
                     flex items-center justify-center
                     text-wv-cyan hover:bg-white/10 transition-colors
                     select-none active:scale-95"
          aria-label="Open intel feed"
        >
          <span className="text-lg">📡</span>
          {liveCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-wv-cyan
                             text-[8px] text-wv-black font-bold flex items-center justify-center px-0.5">
              {liveCount > 99 ? '99+' : liveCount}
            </span>
          )}
        </button>
        <MobileModal
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          title="Intel Feed"
          icon="📡"
          accent="bg-wv-cyan"
        >
          {feedList}
        </MobileModal>
      </>
    );
  }

  /* ── Desktop: fixed side panel (unchanged) ── */
  return (
    <div className="fixed top-4 right-4 w-72 panel-glass rounded-lg overflow-hidden z-40 select-none">
      {/* Header */}
      <div
        className="px-3 py-2 border-b border-wv-border flex items-center justify-between cursor-pointer"
        onClick={() => setVisible(!visible)}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-wv-cyan animate-pulse" />
          <span className="text-[10px] text-wv-muted tracking-widest uppercase">Intel Feed</span>
        </div>
        <span className="text-[10px] text-wv-muted">{visible ? '▼' : '▶'}</span>
      </div>
      {visible && feedList}
    </div>
  );
}

export type { IntelFeedItem };
