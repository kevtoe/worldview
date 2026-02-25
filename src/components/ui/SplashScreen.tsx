import { useState, useEffect } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
}

const BOOT_LINES = [
  'WORLDVIEW TACTICAL INTELLIGENCE SYSTEM',
  '═════════════════════════════════════',
  '',
  'INITIALISING CESIUM 3D ENGINE............ OK',
  'LOADING GOOGLE PHOTOREALISTIC 3D TILES.. OK',
  'CONNECTING OPENSKY NETWORK.............. OK',
  'LOADING CELESTRAK SATELLITE DATA........ OK',
  'CONNECTING USGS SEISMIC FEED............ OK',
  'COMPILING POST-PROCESSING SHADERS....... OK',
  'BUILDING TACTICAL DISPLAY OVERLAY....... OK',
  '',
  'ALL SYSTEMS NOMINAL',
  '',
  '▶ PRESS ANY KEY TO ENTER',
];

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [visibleLines, setVisibleLines] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (visibleLines < BOOT_LINES.length) {
      const delay = BOOT_LINES[visibleLines] === '' ? 100 : 120 + Math.random() * 80;
      const timer = setTimeout(() => setVisibleLines((v) => v + 1), delay);
      return () => clearTimeout(timer);
    } else {
      setReady(true);
    }
  }, [visibleLines]);

  useEffect(() => {
    if (!ready) return;
    const handler = () => onComplete();
    window.addEventListener('keydown', handler);
    window.addEventListener('click', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('click', handler);
    };
  }, [ready, onComplete]);

  return (
    <div className="fixed inset-0 bg-wv-black z-[100] flex items-center justify-center">
      <div className="w-full max-w-xl p-8">
        {BOOT_LINES.slice(0, visibleLines).map((line, i) => (
          <div
            key={i}
            className={`text-[11px] leading-relaxed ${
              line.includes('OK')
                ? 'text-wv-green'
                : line.includes('PRESS')
                ? 'text-wv-cyan glow-cyan animate-pulse'
                : line.includes('═')
                ? 'text-wv-border'
                : line.includes('NOMINAL')
                ? 'text-wv-green glow-green font-bold'
                : line.includes('WORLDVIEW')
                ? 'text-wv-cyan glow-cyan font-bold text-sm'
                : 'text-wv-muted'
            }`}
          >
            {line || '\u00A0'}
          </div>
        ))}
        {/* Blinking cursor */}
        {visibleLines < BOOT_LINES.length && (
          <span className="inline-block w-2 h-3 bg-wv-green animate-pulse" />
        )}
      </div>
    </div>
  );
}
