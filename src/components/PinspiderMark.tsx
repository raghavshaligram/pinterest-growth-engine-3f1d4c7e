// Pinspider logo mark: a filled center node with 6 thin lines radiating
// to smaller outlined nodes -- the same "hub and spokes" grammar used by
// the Dashboard pipeline strip, so the mark reads as a small pipeline
// itself. Kept deliberately restrained (no gradients/shadows); the only
// color is the caller-supplied accent.

const NODES = [-90, -30, 30, 90, 150, 210].map((deg) => {
  const rad = (deg * Math.PI) / 180;
  const r = 8.5;
  return { x: 12 + r * Math.cos(rad), y: 12 + r * Math.sin(rad) };
});

export function PinspiderMark({
  size = 22,
  color = "var(--accent)",
  bg = "var(--bg-card)",
  className,
}: {
  size?: number;
  color?: string;
  bg?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="Pinspider"
      className={className}
    >
      {NODES.map((n, i) => (
        <line key={i} x1={12} y1={12} x2={n.x} y2={n.y} stroke={color} strokeWidth={1} opacity={0.55} />
      ))}
      {NODES.map((n, i) => (
        <circle key={i} cx={n.x} cy={n.y} r={1.8} fill={bg} stroke={color} strokeWidth={1.25} />
      ))}
      <circle cx={12} cy={12} r={3.2} fill={color} />
    </svg>
  );
}
