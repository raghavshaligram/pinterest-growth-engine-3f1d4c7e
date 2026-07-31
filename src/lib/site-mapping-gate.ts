// Client-only companion to lib/site-mapping.ts. Split out because that
// module is imported by SERVER code too (getSetupStatus builds its
// unmapped-site list with siteDisplayName; getPinterestConnectionForSite
// builds the deep-linked publish error with withMapSiteLink) -- and this
// module pulls in React hooks, the router and sonner. Keeping the two
// apart is what stops that client-only chain being dragged into the
// server bundle.
//
// Named to match site-style-gate.ts, the per-site prerequisite this sits
// alongside -- with one deliberate difference: that one GATES (redirects,
// blocks the action), this one only WARNS.
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useSetupStatus } from "@/lib/onboarding-gate";
import { parseMapSiteError, siteConnectionsSearch } from "@/lib/site-mapping";

// Warns (never gates) that pins about to be generated have nowhere to
// publish. Generating for an unmapped site is legitimate -- you may map
// it later, and pins are reviewable without any Pinterest account at
// all -- so this never blocks the action or redirects. It exists so the
// user learns about the gap BEFORE spending their own API credits on
// rendered images, instead of at publish time afterwards.
//
// Reads the account-wide unmapped list from setup status rather than
// useSiteContext's selected site. That distinction matters: the actions
// this guards (runFullPipeline, the Dashboard's first batch) are
// themselves account-wide, and selectedSiteId is null until the user
// explicitly picks a site in the SiteSwitcher -- which is exactly the
// state a just-onboarded account is in when it clicks Generate for the
// very first time, the single most expensive moment to stay silent.
// Scoping to the selection would have made the warning almost never
// fire precisely when it mattered most.
export function useSiteMappingWarning() {
  const { data: status } = useSetupStatus();
  const navigate = useNavigate();

  // Pass a siteId to ask about one specific site (the Pages detail
  // view, whose actions are scoped to that page's own site -- NOT to
  // whatever the SiteSwitcher happens to be showing). Omit it for
  // account-wide actions.
  function warnIfUnmapped(siteId?: string | null): void {
    const unmapped = status?.unmappedSites ?? [];
    if (!unmapped.length) return;

    const target = siteId ? unmapped.find((s) => s.id === siteId) : (unmapped.length === 1 ? unmapped[0]! : null);
    // Asked about one site and that site is fine -- say nothing.
    if (siteId && !target) return;

    const message = target
      ? `${target.name} isn't mapped to a Pinterest account — these pins won't be able to publish until it is.`
      : `${unmapped.length} of your sites aren't mapped to a Pinterest account — pins for them won't be able to publish.`;

    toast.warning(message, {
      duration: 8000,
      action: {
        label: target ? "Map now" : "Review sites",
        onClick: () => navigate({
          to: "/sites",
          search: target ? siteConnectionsSearch(target.id) : {},
        }),
      },
    });
  }

  return { warnIfUnmapped };
}

// Toasts a failed publish, turning the "site isn't mapped" case into an
// actionable toast with a real deep link instead of a dead sentence with
// a raw [map-site:<uuid>] token hanging off the end.
//
// Exists because that error reaches the client as a plain string (it
// crosses the server-fn boundary, and for the cron path it's also
// round-tripped through scheduled_pins.last_error), so the only way to
// carry "which site" was to append it to the message. Every surface
// that shows such a message must therefore either parse it (this hook,
// PinDetailDialog) or strip it (the Logs page) -- rendering the raw
// string shows the user an internal token.
//
// Shared by the two identical Publish-now call sites (Schedule and
// Dashboard, which drive the same PinDetailDialog) so they can't drift.
export function usePublishErrorToast() {
  const navigate = useNavigate();

  return function toastPublishError(message: string): void {
    const mapping = parseMapSiteError(message);
    if (!mapping) {
      toast.error(message);
      return;
    }
    toast.error(mapping.text, {
      duration: 10000,
      action: {
        label: "Map now",
        onClick: () => navigate({ to: "/sites", search: siteConnectionsSearch(mapping.siteId) }),
      },
    });
  };
}
