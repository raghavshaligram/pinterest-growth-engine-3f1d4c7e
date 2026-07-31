// The persistent, dismissible "Finish setup" banner shown after a user
// skips the onboarding wizard (routes/onboarding.tsx). Reads the exact
// same getSetupStatus() the wizard's step-dots and the empty-state
// Dashboard's checklist card read (see lib/onboarding-gate.tsx) -- this
// is deliberately the ONLY place "is setup done" is computed, so the
// banner can never disagree with what the wizard or the gate hook think
// is true.
//
// Only ever shows once the user has explicitly clicked "Skip setup" (or
// finished the wizard) -- dismissedOnboarding, persisted server-side --
// AND onboarding still isn't genuinely complete (isFullyOnboarded,
// which unlike readyToGenerate also requires first_batch, so this can't
// go quiet just because site/brand/OpenAI are done while no pins have
// actually been generated yet). Someone who's never seen the wizard at
// all wouldn't hit this banner anyway -- PinShell's
// OnboardingRedirectGuard would already have sent them into it.
//
// The per-session dismiss below (sessionStorage, not a DB write) is a
// separate, softer thing on top of that -- reappears next time the app
// is opened even if onboarding is still incomplete, same tradeoff
// SiteProvider's own localStorage-backed selection makes for
// non-critical UI state. It also just stops rendering entirely, with no
// dismiss needed, once isFullyOnboarded flips true -- no manual toggle.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useSetupStatus } from "@/lib/onboarding-gate";
import { getMissingRequiredSteps, STEP_LABELS } from "@/lib/setup-checklist-copy";
import { PIN, PIN_FONT } from "@/lib/pin-shell-tokens";

const DISMISS_KEY = "pinspider:setup-banner-dismissed";

export function FinishSetupBanner() {
  const { data } = useSetupStatus();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(typeof window !== "undefined" && window.sessionStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  if (!data || !data.dismissedOnboarding || data.isFullyOnboarded || dismissed) return null;

  const missing = getMissingRequiredSteps(data);
  if (!missing.length) return null;
  const next = missing[0]!;

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12, margin: "0 24px", marginTop: 12,
        padding: "10px 16px", borderRadius: 12, background: PIN.roseTint, border: `1px solid ${PIN.accent}33`,
        fontFamily: PIN_FONT,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: PIN.textPrimary }}>Finish setting up Pinspider — </span>
        <span style={{ fontSize: 13, color: PIN.textSecondary }}>
          {missing.length === 1 ? STEP_LABELS[next.id] : `${missing.length} steps left, next: ${STEP_LABELS[next.id].toLowerCase()}`}
        </span>
      </div>
      <Link
        to="/onboarding"
        search={{ step: next.wizardStep }}
        style={{
          flexShrink: 0, fontSize: 13, fontWeight: 600, color: "#FFFFFF", background: PIN.accent,
          borderRadius: 999, padding: "6px 14px", textDecoration: "none",
        }}
      >
        Finish setup
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => { window.sessionStorage.setItem(DISMISS_KEY, "1"); setDismissed(true); }}
        style={{ flexShrink: 0, border: "none", background: "transparent", cursor: "pointer", color: PIN.textMuted, display: "flex" }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
