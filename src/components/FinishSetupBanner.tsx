// The persistent, dismissible "Finish setup" banner shown after a user
// skips the onboarding wizard (routes/onboarding.tsx). Reads the exact
// same getSetupStatus() the wizard's step-dots and the empty-state
// Dashboard's checklist card read (see lib/onboarding-gate.tsx) -- this
// is deliberately the ONLY place "is setup done" is computed, so the
// banner can never disagree with what the wizard or the gate hook think
// is true.
//
// Dismiss is per-browser-session only (sessionStorage, not a DB write)
// -- reappears next time the app is opened, same tradeoff
// SiteProvider's own localStorage-backed selection makes for
// non-critical UI state. It also just stops rendering entirely, with no
// dismiss needed, once readyToGenerate flips true -- no manual toggle.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useSetupStatus } from "@/lib/onboarding-gate";
import { SETUP_STEPS } from "@/lib/onboarding.functions";
import { PIN, PIN_FONT } from "@/lib/pin-shell-tokens";

const DISMISS_KEY = "pinspider:setup-banner-dismissed";

export function FinishSetupBanner() {
  const { data } = useSetupStatus();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(typeof window !== "undefined" && window.sessionStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  if (!data || data.readyToGenerate || dismissed) return null;

  const missing = SETUP_STEPS.filter((s) => !s.optional && !data.steps[s.id]);
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
          {missing.length === 1 ? next.title : `${missing.length} steps left, next: ${next.title.toLowerCase()}`}
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
