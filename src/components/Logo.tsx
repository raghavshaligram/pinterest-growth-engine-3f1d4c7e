// Single source of truth for the Pinspider brand mark. Renders the
// real brand asset that already lives at public/favicon.svg (the same
// red-circle node-and-thread mark components/PinspiderMark.tsx draws
// programmatically) instead of the lucide Sparkles-in-a-rounded-square
// placeholder that used to stand in for it on the login page. No new
// asset needed -- favicon.svg predates this component and was already
// being served correctly (it's been in the root route's <head> links
// since before this component existed), so reusing it directly avoids
// depending on a brand-new public/ path that may not have synced
// through the deploy pipeline the same way.
// PinspiderMark.tsx itself is left alone -- DashboardEmptyState.tsx
// still uses it deliberately, for its "How it works" illustration that
// reuses the mark's node-and-thread visual language rather than as the
// literal brand mark (see that file's own comment) -- so it isn't a
// placeholder occurrence and is out of scope here.
import { cn } from "@/lib/utils";

const MARK_SRC = "/favicon.svg";

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
