interface CrosshairProps {
  visible?: boolean;
}

export default function Crosshair({ visible = true }: CrosshairProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center">
      {/* Centre crosshair */}
      <svg width="48" height="48" viewBox="0 0 48 48" className="opacity-40">
        {/* Horizontal lines */}
        <line x1="0" y1="24" x2="18" y2="24" stroke="#00D4FF" strokeWidth="0.5" />
        <line x1="30" y1="24" x2="48" y2="24" stroke="#00D4FF" strokeWidth="0.5" />
        {/* Vertical lines */}
        <line x1="24" y1="0" x2="24" y2="18" stroke="#00D4FF" strokeWidth="0.5" />
        <line x1="24" y1="30" x2="24" y2="48" stroke="#00D4FF" strokeWidth="0.5" />
        {/* Centre dot */}
        <circle cx="24" cy="24" r="1.5" fill="none" stroke="#00D4FF" strokeWidth="0.5" />
        {/* Corner brackets */}
        <path d="M 8,8 L 8,14 M 8,8 L 14,8" fill="none" stroke="#00D4FF" strokeWidth="0.5" />
        <path d="M 40,8 L 40,14 M 40,8 L 34,8" fill="none" stroke="#00D4FF" strokeWidth="0.5" />
        <path d="M 8,40 L 8,34 M 8,40 L 14,40" fill="none" stroke="#00D4FF" strokeWidth="0.5" />
        <path d="M 40,40 L 40,34 M 40,40 L 34,40" fill="none" stroke="#00D4FF" strokeWidth="0.5" />
      </svg>
    </div>
  );
}
