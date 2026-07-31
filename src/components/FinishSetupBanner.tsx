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
import { siteConnectionsSearch } from "@/lib/site-mapping";
import { PIN, PIN_FONT } from "@/lib/pin-shell-tokens";

const DISMISS_KEY = "pinspider:setup-banner-dismissed";

export function FinishSetupBanner() {
  const { data } = useSetupStatus();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(typeof window !== "undefined" && window.sessionStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  if (!data || !data.dismissedOnboarding) return null;
  // isFullyOnboarded staying true is what keeps this quiet for an
  // account that has everything except a Pinterest connection (optional
  // forever, by design). Unmapped sites are the one gap that must still
  // speak up through that silence: unlike connecting Pinterest, which a
  // user can legitimately defer indefinitely, a site pointed at no
  // account is a broken half-state -- it generates pins that can never
  // go anywhere.
  if (data.isFullyOnboarded && !data.unmappedSites.length) return null;

  const missing = getMissingRequiredSteps(data);
  if (!missing.length) return null;
  const next = missing[0]!;

  // Site -> Pinterest-account mapping, surfaced through this same
  // banner rather than a second bar of its own.
  //
  // Driven off data.unmappedSites directly, NOT off whether the mapping
  // step happens to sort first in `missing`. Those two disagree in a
  // reachable case, because the two facts come from different tables:
  // steps.pinterest_connected reads the legacy `integrations` row, while
  // unmappedSites reads `pinterest_connections`. A user who connected
  // from Settings (multi-account flow, which never writes `integrations`)
  // has pinterest_connected false forever, so ordering by `missing`
  // would show them "next: connect pinterest" -- telling them to connect
  // the account they just connected -- and suppress the mapping notice
  // they actually need. An unmapped site is the more specific, more
  // actionable fact, so it wins whenever it's present.
  //
  // Two further things make it behave differently from the other steps:
  //
  // 1. It is not dismissible. Every other step here is something the
  //    user could reasonably defer; an unmapped site silently cannot
  //    publish, so hiding the notice would hide the only signal that
  //    anything is wrong. There's no dismissed-flag to clear either --
  //    it's derived from live status, so mapping the site is what makes
  //    it go away, immediately and by itself.
  // 2. Its action doesn't go to the wizard, because the wizard can't
  //    fix it. It deep-links to the offending site's own Connections
  //    section instead -- or, with several unmapped sites, to the Sites
  //    page, since naming one of them would be arbitrary.
  const unmapped = data.unmappedSites;
  const isMappingNotice = unmapped.length > 0;

  if (dismissed && !isMappingNotice) return null;

  if (isMappingNotice) {
    const only = unmapped.length === 1 ? unmapped[0]! : null;
    return (
      <div style={bannerStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: PIN.textPrimary }}>
            {only
              ? `${only.name} isn't mapped to a Pinterest account`
              : `${unmapped.length} sites aren't mapped to a Pinterest account`}
            {" — "}
          </span>
          <span style={{ fontSize: 13, color: PIN.textSecondary }}>
            {only ? "its pins can't publish until it is." : "their pins can't publish until they are."}
          </span>
        </div>
        <Link
          to="/sites"
          search={only ? siteConnectionsSearch(only.id) : {}}
          style={actionStyle}
        >
          {only ? "Map now" : "Review sites"}
        </Link>
      </div>
    );
  }

  return (
    <div style={bannerStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: PIN.textPrimary }}>Finish setting up Pinspider — </span>
        <span style={{ fontSize: 13, color: PIN.textSecondary }}>
          {missing.length === 1 ? STEP_LABELS[next.id] : `${missing.length} steps left, next: ${STEP_LABELS[next.id].toLowerCase()}`}
        </span>
      </div>
      <Link to="/onboarding" search={{ step: next.wizardStep }} style={actionStyle}>
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

const bannerStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12, margin: "0 24px", marginTop: 12,
  padding: "10px 16px", borderRadius: 12, background: PIN.roseTint, border: `1px solid ${PIN.accent}33`,
  fontFamily: PIN_FONT,
};

const actionStyle: React.CSSProperties = {
  flexShrink: 0, fontSize: 13, fontWeight: 600, color: "#FFFFFF", background: PIN.accent,
  borderRadius: 999, padding: "6px 14px", textDecoration: "none",
};
