import { TrendingUp } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

// Small indicator shown on a generated pin brief when it was created
// using serp_snapshots.patterns competitive data (see
// briefs.functions.ts:generateBriefs -- competitiveBlock). Renders
// nothing when a brief was generated without it, which is still the
// common case until keywords have recent tracked SERP sweeps.
export function SerpTraceBadge({
  usedSerpPatterns,
  serpKeyword,
  serpPatternsCapturedAt,
  className,
}: {
  usedSerpPatterns?: boolean | null;
  serpKeyword?: string | null;
  serpPatternsCapturedAt?: string | null;
  className?: string;
}) {
  if (!usedSerpPatterns) return null;
  const ageDays = serpPatternsCapturedAt
    ? Math.floor((Date.now() - new Date(serpPatternsCapturedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const freshness = ageDays === null ? "" : ageDays <= 0 ? " (swept today)" : ` (swept ${ageDays}d ago)`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary ${className ?? ""}`}
          >
            <TrendingUp className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Used competitive patterns for "{serpKeyword ?? "unknown keyword"}"{freshness}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
