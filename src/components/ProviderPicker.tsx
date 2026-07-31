// Shared "one recommended provider surfaced, the rest behind an
// expandable list" layout -- used by onboarding's image-provider
// sub-step (routes/onboarding.tsx:StepApiKeys) and Settings' Image
// Generation card (routes/settings.integrations.tsx:GenerationProvidersCard)
// so both surfaces present the same 7-provider list the same way,
// instead of onboarding hand-limiting itself to a curated 2-provider
// subset (its old behavior) or Settings showing all 7 flat and
// always-expanded (its old behavior) -- one picker, two different
// per-provider renderers passed in via `renderProvider`, since what
// each surface actually needs to show for a given provider (a full
// multi-key management card in Settings vs. a simpler
// select-then-add-a-key flow in onboarding) is genuinely different and
// this component has no opinion about that at all. Collapsed
// (recommended-only) is always the initial state -- never ships
// expanded.
import { useState } from "react";
import { ChevronDown } from "lucide-react";

export function ProviderPicker<T extends { provider: string }>({
  providers, recommendedProvider, recommendedBadge = "Recommended",
  renderProvider,
}: {
  providers: T[];
  recommendedProvider: string;
  recommendedBadge?: string;
  renderProvider: (meta: T) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const recommended = providers.find((p) => p.provider === recommendedProvider);
  const rest = providers.filter((p) => p.provider !== recommendedProvider);

  // Defensive fallback -- if the caller ever passes a recommendedProvider
  // id that isn't actually in the list (a typo, a provider removed from
  // the array), fail open to showing everything rather than silently
  // hiding providers behind a toggle with nothing recommended above it.
  if (!recommended) {
    return <div className="space-y-2">{providers.map((p) => <div key={p.provider}>{renderProvider(p)}</div>)}</div>;
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{recommendedBadge}</div>
        {renderProvider(recommended)}
      </div>

      {rest.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="h-3.5 w-3.5 transition-transform" style={{ transform: expanded ? "rotate(180deg)" : "none" }} />
            {expanded ? "Hide other providers" : `Show ${rest.length} more provider${rest.length === 1 ? "" : "s"}`}
          </button>
          {expanded && (
            <div className="mt-2 space-y-2">
              {rest.map((p) => <div key={p.provider}>{renderProvider(p)}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
