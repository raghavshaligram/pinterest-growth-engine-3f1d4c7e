// Single source of truth for how a SETUP_STEPS id is shown to a user --
// every surface that used to read `.title` directly (FinishSetupBanner,
// the Dashboard empty-state checklist, and its collapsed summary bar)
// now goes through STEP_LABELS instead, so there's exactly one place
// that could ever regress into rendering a raw id like "connect_openai"
// instead of "Connect OpenAI". Deliberately derived FROM SETUP_STEPS.title
// (not a hand-duplicated copy of it) -- this file has no opinion of its
// own about what the labels should say, it just gives the three
// consumers one shared import instead of three independent `.title`
// reads that could drift apart later.
import { SETUP_STEPS, type SetupStatus, type SetupStepId, type SetupStepMeta } from "@/lib/onboarding.functions";

export const STEP_LABELS: Record<SetupStepId, string> = Object.fromEntries(
  SETUP_STEPS.map((s) => [s.id, s.title]),
) as Record<SetupStepId, string>;

// The exact "still needs attention" definition FinishSetupBanner has
// always used (non-optional, not done) -- pulled out here so the new
// Dashboard summary bar (SetupSummaryBar, components/DashboardEmptyState.tsx)
// reads the same list instead of a second, separately-written filter
// that could disagree with the banner about what counts as missing.
export function getMissingRequiredSteps(status: SetupStatus | null | undefined): SetupStepMeta[] {
  if (!status) return [];
  return SETUP_STEPS.filter((s) => !s.optional && !status.steps[s.id]);
}
