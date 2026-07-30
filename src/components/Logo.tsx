// Single source of truth for the Pinspider brand mark. Renders the real
// static asset (public/brand/pinspider-mark.svg) instead of the lucide
// Sparkles-in-a-rounded-square placeholder that used to stand in for it
// on the login page, or the hand-coded approximation
// (components/PinspiderMark.tsx) other screens used in the meantime.
// PinspiderMark.tsx itself is left alone -- DashboardEmptyState.tsx
// still uses it deliberately, for its "How it works" illustration that
// reuses the mark's node-and-thread visual language rather than as the
// literal brand mark (see that file's own comment) -- so it isn't a
// placeholder occurrence and is out of scope here.
import { cn } from "@/lib/utils";

const MARK_SRC = "/brand/pinspider-mark.svg";

export function Logo({
  size = 32,
  withWordmark = false,
  wordmarkClassName,
  className,
}: {
  size?: number;
  // Convenience lockup (mark + "Pinspider" text) for the common case.
  // Call sites whose wordmark needs different text (e.g. "Pinspider
  // setup") or bespoke sizing (e.g. the login page's large hero
  // wordmark) render their own text next to a mark-only <Logo /> instead.
  withWordmark?: boolean;
  wordmarkClassName?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {/* The asset already includes its own background and rounded
          corners -- no wrapper background/border-radius here, or it'd
          double up on top of what's baked into the SVG. */}
      <img
        src={MARK_SRC}
        alt="Pinspider"
        width={size}
        height={size}
        style={{ width: size, height: size, flexShrink: 0 }}
      />
      {withWordmark && (
        <span className={wordmarkClassName ?? "font-display text-lg font-semibold"}>
          Pinspider
        </span>
      )}
    </span>
  );
}
