// UTM tagging for published pin destination links.
//
// This is a load-bearing prerequisite for the Insights page: GA4's
// `sessionManualContent` dimension is auto-populated from the
// `utm_content` query parameter on the landing URL. Without this file,
// every published pin's destination link is bare (see
// publisher.server.ts pre-existing `link: pageUrl`), so GA4 has no
// per-brief signal to report on at all -- the Insights page's join
// against pin_briefs would have nothing to attribute.
//
// utm_content is set to the brief id specifically (not the page id or
// template id) because a single page can produce many briefs/pins over
// time, and per-brief is the finest-grained attribution the Insights
// page's "template performance" view needs -- template/shape info is
// then joined locally from pin_briefs.template_id once sessions come
// back keyed by brief id.
export function buildUtmLink(pageUrl: string, briefId: string): string {
  if (!pageUrl) return pageUrl;
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    // Not a valid absolute URL -- return unchanged rather than throw,
    // publishing should never hard-fail because of a tagging helper.
    return pageUrl;
  }
  url.searchParams.set("utm_source", "pinterest");
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", "pinspider");
  url.searchParams.set("utm_content", briefId);
  return url.toString();
}
