interface AudioToggleProps {
  muted: boolean;
  onToggle: () => void;
  isMobile?: boolean;
}

/**
 * Compact mute/unmute button that sits in the bottom-right of the status bar area.
 * Uses a speaker icon rendered with plain CSS — no SVG deps.
 */
export default function AudioToggle({ muted, onToggle, isMobile = false }: AudioToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={`
        fixed z-50 select-none
        flex items-center justify-center rounded
        transition-all duration-200 group
        ${isMobile
          ? 'bottom-8 right-3 w-8 h-7'
          : 'bottom-9 right-4 w-7 h-7'
        }
        hover:bg-white/5
      `}
      aria-label={muted ? 'Unmute audio' : 'Mute audio'}
      title={muted ? 'Unmute audio' : 'Mute audio'}
    >
      {/* Speaker icon */}
      <span
        className={`
          text-[11px] tracking-tight font-mono
          transition-colors duration-200
          ${muted
            ? 'text-wv-muted/50'
            : 'text-wv-green/70 group-hover:text-wv-green'
          }
        `}
      >
        {muted ? '🔇' : '🔊'}
      </span>
    </button>
  );
}
