// Framework-agnostic — no server-only imports here on purpose. Shared
// between the Activity feed (dashboard.functions.ts, server-rendered)
// and the Account Health card (settings.integrations.tsx, client) so an
// account_cap_events row reads identically in both places.
export type CapEvent = {
  event_type: string;
  from_tier: string | null;
  to_tier: string | null;
  from_cap: number | null;
  to_cap: number | null;
  detail: unknown;
};

export function describeCapEvent(e: CapEvent): string {
  const d = (e.detail && typeof e.detail === "object" ? e.detail : {}) as Record<string, unknown>;
  switch (e.event_type) {
    case "onboarded":
      return `Publishing profile created — tier set to "${e.to_tier}"`;
    case "reconciled":
      return `Tier adjusted ${e.from_tier} → ${e.to_tier} based on Pinterest account activity`;
    case "tier_changed":
      return `Tier updated ${e.from_tier} → ${e.to_tier}`;
    case "age_growth":
      return `Daily cap increased ${e.from_cap} → ${e.to_cap} (${String(d.daysSinceOnboarding ?? d.threshold ?? "?")} days since connecting Pinterest)`;
    case "consistency_gap":
      return `Daily cap reduced ${e.from_cap} → ${e.to_cap} — ${String(d.daysWithoutActivity ?? "several")} of the last ${String(d.windowDays ?? 30)} days had no published activity`;
    case "api_error_brake":
      return `Daily cap reduced ${e.from_cap} → ${e.to_cap} — ${String(d.errorCount ?? "multiple")} publish errors in the past ${String(d.windowDays ?? 7)} days`;
    case "manual_override":
      return d.action === "switched_to_auto"
        ? `Switched back to automatic cap control (cap ${e.to_cap})`
        : `Switched to manual cap control (cap set to ${e.to_cap})`;
    default:
      return `Cap event: ${e.event_type}`;
  }
}

// "Warning" treatment (same visual language as a publish error row) vs.
// neutral/positive. Growth, onboarding, and manual-override notices are
// neutral; the two automatic penalty triggers get the warning treatment
// since they mean the account got throttled for a real reason.
export function capEventIsWarning(eventType: string): boolean {
  return eventType === "consistency_gap" || eventType === "api_error_brake";
}
