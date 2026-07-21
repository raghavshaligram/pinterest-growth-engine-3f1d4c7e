// Pinspider logo mark: red squircle with a white node-and-thread mark —
// a central node connected by six thin threads to six outer nodes.

export function PinspiderMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  // 6 outer nodes on a circle of radius R around center (50,50)
  const cx = 50;
  const cy = 50;
  const R = 30;
  const outer = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2; // start at top
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      role="img"
      aria-label="Pinspider"
      className={className}
    >
      <rect x="0" y="0" width="100" height="100" rx="26" ry="26" fill="#E60023" />
      {/* threads */}
      <g stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round">
        {outer.map((p, i) => (
          <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} />
        ))}
      </g>
      {/* outer nodes */}
      <g fill="#FFFFFF">
        {outer.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="5" />
        ))}
        {/* central node */}
        <circle cx={cx} cy={cy} r="7" />
      </g>
    </svg>
  );
}
