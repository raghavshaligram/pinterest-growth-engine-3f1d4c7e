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

// Where a step's action button should actually send the user.
//
// Until pinterest_site_mapping existed, this was implicit and always
// the same answer: SetupStepMeta.wizardStep, because every step was
// resolvable inside the onboarding wizard. Mapping is the first step
// that isn't -- it's changed on the Sites page and nowhere else -- so
// "which screen fixes this" is now a real question with two possible
// answers, and it gets one shared implementation rather than a
// copy-pasted `if` in each of the three surfaces that renders a step
// action (FinishSetupBanner, SetupSummaryBar, SetupChecklistCard).
//
// Without this, all three sent the user to /onboarding?step=6 -- the
// "You're set up" completion screen -- which says nothing about mapping
// and offers no way to do it.
export type StepTarget =
  | { kind: "wizard"; step: 1 | 2 | 3 | 4 | 5 | 6 }
  // siteId is set only when exactly ONE site is unmapped, so the link
  // can deep-link straight to that site's Connections section. With
  // several, naming one would be arbitrary -- the Sites page lists them
  // all, each with its own warning banner.
  | { kind: "sites"; siteId: string | null };

export function resolveStepTarget(step: SetupStepMeta, status: SetupStatus | null | undefined): StepTarget {
  if (step.id === "pinterest_site_mapping") {
    const unmapped = status?.unmappedSites ?? [];
    return { kind: "sites", siteId: unmapped.length === 1 ? unmapped[0]!.id : null };
  }
  return { kind: "wizard", step: step.wizardStep };
}
