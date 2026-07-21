// Pinspider logo mark: red squircle with a white 6-spoke asterisk
// (three crossed lines with round caps) centered inside.

export function PinspiderMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
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
      <g stroke="#FFFFFF" strokeWidth="8" strokeLinecap="round">
        {/* vertical */}
        <line x1="50" y1="26" x2="50" y2="74" />
        {/* 60° diagonal */}
        <line x1="29.2" y1="38" x2="70.8" y2="62" />
        {/* -60° diagonal */}
        <line x1="29.2" y1="62" x2="70.8" y2="38" />
      </g>
    </svg>
  );
}
