import { useState, useEffect, useRef } from 'react';
import type { AudioControls } from '../../hooks/useAudio';
import type { SoundEffect } from '../../lib/audio';

interface SplashScreenProps {
  onComplete: () => void;
  audio?: AudioControls;
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
  'CONNECTING GLOBAL CCTV NETWORK.......... OK',
  'COMPILING POST-PROCESSING SHADERS....... OK',
  'BUILDING TACTICAL DISPLAY OVERLAY....... OK',
  '',
  'ALL SYSTEMS NOMINAL',
  '',
  '▶ PRESS ANY KEY TO ENTER',
];

/** Pick the right sound effect based on line content. */
function getSoundForLine(line: string): SoundEffect | null {
  if (line === '') return null;
  if (line.includes('WORLDVIEW')) return 'bootSweep';
  if (line.includes('═')) return 'bootSeparator';
  if (line.includes('NOMINAL')) return 'bootReady';
  if (line.includes('PRESS')) return 'bootOk';
  if (line.includes('CONNECTING')) return 'bootConnect';
  if (line.includes('LOADING') || line.includes('COMPILING') || line.includes('BUILDING') || line.includes('INITIALISING')) return 'bootLoad';
  return 'bootTick';
}

/** Typing speed per character for lines that use the typewriter effect. */
const CHAR_SPEED = 12; // ms per character

export default function SplashScreen({ onComplete, audio }: SplashScreenProps) {
  const [visibleLines, setVisibleLines] = useState(0);
  const [typedChars, setTypedChars] = useState(0); // chars revealed in the current line
  const [ready, setReady] = useState(false);
  const soundPlayedRef = useRef<Set<number>>(new Set());

  // Current line being typed
  const currentLine = BOOT_LINES[visibleLines] ?? '';
  const isTypingLine = visibleLines < BOOT_LINES.length && currentLine.length > 0;
  const isFullyTyped = typedChars >= currentLine.length;

  // Play sound when a new line starts typing
  useEffect(() => {
    if (visibleLines >= BOOT_LINES.length) return;
    if (soundPlayedRef.current.has(visibleLines)) return;

    const line = BOOT_LINES[visibleLines];
    const sound = getSoundForLine(line);
    if (sound) {
      soundPlayedRef.current.add(visibleLines);
      audio?.play(sound);
    }
  }, [visibleLines, audio]);

  // Typewriter: reveal one character at a time for non-empty lines
  useEffect(() => {
    if (visibleLines >= BOOT_LINES.length) return;
    const line = BOOT_LINES[visibleLines];

    // Empty lines: advance immediately
    if (line === '') {
      const timer = setTimeout(() => {
        setTypedChars(0);
        setVisibleLines((v) => v + 1);
      }, 80);
      return () => clearTimeout(timer);
    }

    // Still typing the current line
    if (typedChars < line.length) {
      const timer = setTimeout(() => {
        setTypedChars((c) => c + 1);
      }, CHAR_SPEED + Math.random() * 8);
      return () => clearTimeout(timer);
    }

    // Line fully typed — pause, then move to the next
    const pauseMs = line.includes('NOMINAL') ? 400 : line.includes('WORLDVIEW') ? 300 : 120;
    const timer = setTimeout(() => {
      setTypedChars(0);
      setVisibleLines((v) => v + 1);
    }, pauseMs);
    return () => clearTimeout(timer);
  }, [visibleLines, typedChars]);

  // All lines done — ready to enter
  useEffect(() => {
    if (visibleLines >= BOOT_LINES.length && !ready) {
      setReady(true);
    }
  }, [visibleLines, ready]);

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
        {/* Fully revealed lines */}
        {BOOT_LINES.slice(0, visibleLines).map((line, i) => (
          <div
            key={i}
            className={`text-[11px] leading-relaxed ${getLineClass(line)}`}
          >
            {line || '\u00A0'}
          </div>
        ))}

        {/* Currently typing line */}
        {isTypingLine && (
          <div className={`text-[11px] leading-relaxed ${getLineClass(currentLine)}`}>
            {currentLine.slice(0, typedChars)}
            {/* Blinking cursor at typing position */}
            {!isFullyTyped && (
              <span className="inline-block w-[6px] h-[11px] bg-wv-green ml-[1px] animate-pulse align-middle" />
            )}
          </div>
        )}

        {/* Blinking cursor on empty state */}
        {visibleLines < BOOT_LINES.length && !isTypingLine && (
          <span className="inline-block w-2 h-3 bg-wv-green animate-pulse" />
        )}
      </div>
    </div>
  );
}

function getLineClass(line: string): string {
  if (line.includes('OK')) return 'text-wv-green';
  if (line.includes('PRESS')) return 'text-wv-cyan glow-cyan animate-pulse';
  if (line.includes('═')) return 'text-wv-border';
  if (line.includes('NOMINAL')) return 'text-wv-green glow-green font-bold';
  if (line.includes('WORLDVIEW')) return 'text-wv-cyan glow-cyan font-bold text-sm';
  return 'text-wv-muted';
}
