// Per-site counterpart to useSetupGate (onboarding-gate.tsx). That hook
// gates on ACCOUNT-level readiness (integrations connected, etc.) and
// redirects into the onboarding wizard; this one gates a specific
// site's batch-generation actions on that site having completed Pin
// Style Setup at least once (sites.style_locked_at), same "redirect to
// the missing step instead of letting the action run and fail" pattern.
//
// Deliberately reads useSiteContext's selectedSite rather than taking a
// siteId prop -- this only wires cleanly into UI that's already scoped
// to "the currently selected site" (Pages' "Generate All" button), which
// is exactly where the spec calls for this gate. Pages' own per-page
// "Generate briefs" button relies on the server-side check in
// generateBriefs instead (see its own comment) since that view doesn't
// otherwise load the page's site record.
import { useNavigate } from "@tanstack/react-router";
import { useSiteContext } from "@/lib/site-context";

export function useSiteStyleGate() {
  const { selectedSiteId, selectedSite } = useSiteContext();
  const navigate = useNavigate();

  function guard(): boolean {
    // No specific site selected ("All sites") -- can't gate on one
    // site's lock state from here. The server-side check inside
    // generateBriefs (called per-page by runFullPipeline) still blocks
    // any individual page whose site isn't style-locked; this client
    // gate is a pre-emptive UX nicety on top of that, not the real
    // enforcement boundary.
    if (!selectedSiteId || !selectedSite) return true;
    if (selectedSite.style_locked_at) return true;
    navigate({ to: "/sites/style-setup", search: { siteId: selectedSiteId } });
    return false;
  }

  return { guard };
}
