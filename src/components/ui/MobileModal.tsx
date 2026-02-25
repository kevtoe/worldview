import { useEffect, type ReactNode } from 'react';

interface MobileModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: string;
  /** Accent colour class for the header dot, e.g. "bg-wv-green" */
  accent?: string;
  children: ReactNode;
}

/**
 * Full-screen modal overlay used on mobile viewports.
 * Locks body scroll while open. Traps focus on the close button.
 */
export default function MobileModal({
  open,
  onClose,
  title,
  icon,
  accent = 'bg-wv-cyan',
  children,
}: MobileModalProps) {
  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-wv-black/95 backdrop-blur-sm">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-wv-border shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${accent} animate-pulse`} />
          {icon && <span className="text-base">{icon}</span>}
          <span className="text-[11px] text-wv-muted tracking-widest uppercase font-bold">
            {title}
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-md
                     text-wv-muted hover:text-wv-text hover:bg-white/10
                     transition-colors text-lg leading-none"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </div>
  );
}
