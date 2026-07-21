// Pinspider logo mark: red squircle containing a 6-spoke pin-and-thread
// network — a central white node with 6 thin white threads radiating to
// 6 smaller white nodes. Matches the node-and-thread grammar used in
// the Dashboard pipeline visualization.

export function PinspiderMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  // viewBox 100 for easy proportional math
  const cx = 50;
  const cy = 50;
  const centerR = 11; // ~11% of container
  const nodeR = 6;
  const spokeR = 34; // distance from center to outer nodes
  const stroke = 4.5; // ~4.5% of container

  const nodes = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
    return { x: cx + spokeR * Math.cos(a), y: cy + spokeR * Math.sin(a) };
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
      <rect x="0" y="0" width="100" height="100" rx="28" ry="28" fill="#E60023" />
      {nodes.map((n, i) => (
        <line
          key={`l-${i}`}
          x1={cx}
          y1={cy}
          x2={n.x}
          y2={n.y}
          stroke="#FFFFFF"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
      ))}
      {nodes.map((n, i) => (
        <circle key={`n-${i}`} cx={n.x} cy={n.y} r={nodeR} fill="#FFFFFF" />
      ))}
      <circle cx={cx} cy={cy} r={centerR} fill="#FFFFFF" />
    </svg>
  );
}
