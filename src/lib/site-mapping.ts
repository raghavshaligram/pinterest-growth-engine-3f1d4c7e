// Site -> Pinterest-account mapping: the one place that knows how to
// point a user at the exact screen that fixes it.
//
// Mapping is an invisible prerequisite. A site with no
// pinterest_connection_id generates pins perfectly happily and only
// fails at publish, which is the worst possible moment to find out --
// the images have already been rendered on the user's own API key. The
// surfaces that now warn about it (the Sites card banner, the
// Integrations mapping summary, FinishSetupBanner, the generation
// warning below, and the publish error itself) all route through the
// helpers here so they agree on where "map it" actually goes.
//
// Deliberately does NOT touch mapping logic or the connections data
// model -- reading sites.pinterest_connection_id is still the only
// question anyone asks; this file is about surfacing the answer.

// Search params for /sites that focus one site and expand its
// Connections section. Every "map it" link in the app builds its target
// through this, so the route's validateSearch (routes/sites.tsx) and the
// links can't drift apart on param names.
export type SiteFocusSearch = { site?: string; section?: "connections" };

export function siteConnectionsSearch(siteId: string): Required<SiteFocusSearch> {
  return { site: siteId, section: "connections" };
}

// Server-thrown errors are plain strings by the time they reach the
// client (they cross the server-fn boundary and land in
// getErrorMessage), so a structured "which site" field wouldn't
// survive. Instead the site id rides along in a trailing token that the
// client strips before display and turns into a real link.
//
// The token is appended, never interpolated mid-sentence, so stripping
// it always leaves a grammatical message even if a caller renders the
// raw string without parsing.
const MAP_SITE_TOKEN = /\s*\[map-site:([0-9a-fA-F-]{36})\]\s*$/;

export function withMapSiteLink(message: string, siteId: string): string {
  return `${message} [map-site:${siteId}]`;
}

// Returns the display text plus the site to link to, or null when this
// isn't a mapping error at all (every other error passes through
// untouched).
export function parseMapSiteError(message: string | null | undefined): { text: string; siteId: string } | null {
  if (!message) return null;
  const match = MAP_SITE_TOKEN.exec(message);
  if (!match) return null;
  return { text: message.replace(MAP_SITE_TOKEN, "").trim(), siteId: match[1]! };
}

// For surfaces that can only render a string (toasts without an action,
// plain-text logs): keep the sentence, drop the token.
export function stripMapSiteToken(message: string | null | undefined): string {
  return (message ?? "").replace(MAP_SITE_TOKEN, "").trim();
}

// Human label for a site in warning copy -- brand name when the user
// has set one, hostname otherwise. Matches how the Sites page titles a
// card (brand_name || host) so the banner names a site the same way the
// page the user is being sent to does.
export function siteDisplayName(site: { brand_name?: string | null; url?: string | null }): string {
  const brand = (site.brand_name ?? "").trim();
  if (brand) return brand;
  const url = site.url ?? "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "This site";
  }
}
