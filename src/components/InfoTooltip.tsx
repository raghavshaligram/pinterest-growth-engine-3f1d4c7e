// Small, reusable inline "?" affordance for settings most likely to
// confuse a new user (see HelpMenu.tsx's own file comment for the
// broader help-panel this complements). Deliberately reuses the exact
// Tooltip/TooltipTrigger/TooltipContent/TooltipProvider primitives
// SerpTraceBadge.tsx already established for this app, rather than
// introducing a second tooltip pattern.
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

export function InfoTooltip({ text, className }: { text: string; className?: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={-1}
            aria-label="More info"
            className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground ${className ?? ""}`}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
