import { useState } from 'react';

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
}

export default function IntelFeed({ items }: IntelFeedProps) {
  const [visible, setVisible] = useState(true);

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

      {/* Feed items */}
      {visible && (
        <div className="max-h-64 overflow-y-auto p-2">
          {allItems.map((item) => (
            <div key={item.id} className="flex gap-2 py-0.5 text-[9px] leading-tight">
              <span className="text-wv-muted shrink-0">{item.time}</span>
              <span className={`shrink-0 font-bold ${TYPE_STYLES[item.type]}`}>
                [{TYPE_LABELS[item.type]}]
              </span>
              <span className="text-wv-text/80">{item.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export type { IntelFeedItem };
