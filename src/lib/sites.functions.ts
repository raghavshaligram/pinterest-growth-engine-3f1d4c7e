import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SiteVertical } from "@/lib/briefs.functions";
import { VERTICAL_UI_META } from "@/lib/briefs.functions";

export const SITE_TYPES = ["website", "etsy", "ecomm"] as const;
export type SiteType = (typeof SITE_TYPES)[number];

// Derived from VERTICAL_UI_META (briefs.functions.ts), NOT a second
// hardcoded list of vertical ids -- adding a new selectable content
// vertical is a one-place change (that map) and it shows up here and in
// the Sites wizard's Content Vertical picker automatically. Etsy/eComm
// sites don't get a choice here at all -- a DB trigger
// (tg_sites_default_vertical, see the pin_gen_vertical_and_rotation
// migration) auto-derives etsy_product/ecomm_product for those
// site_types on insert, which is why VERTICAL_UI_META deliberately omits
// them (see its own comment) rather than this array filtering them out.
export const WEBSITE_VERTICAL_OPTIONS: ReadonlyArray<{ value: SiteVertical; label: string; description: string }> =
  (Object.entries(VERTICAL_UI_META) as [SiteVertical, { label: string; description: string }][]).map(
    ([value, meta]) => ({ value, ...meta }),
  );
export const DEFAULT_WEBSITE_VERTICAL: SiteVertical = "general_content";

// Which image-generation backend a site uses. Per-site (not account-wide
// like Integrations) since it needs to sit alongside the other
// generation-influencing brand settings (brand_colors/brand_font/vertical)
// and different sites plausibly want different providers.
export const IMAGE_PROVIDERS = ["replicate", "openai"] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];

// Supabase/PostgREST errors cross the server->client RPC boundary through
// TanStack Start's ShallowErrorPlugin, which only preserves `.message` --
// the `.code`/`.details`/`.hint` PostgrestError carries (e.g. "23502" for a
// not-null violation, "42501" for an RLS denial, "23514" for a check
// constraint) are otherwise silently dropped. Fold the code into the
// message itself so it survives and the real cause is diagnosable from the
// client-side toast, not just from server logs.
function throwPgError(error: { message: string; code?: string } | null): never {
  if (!error) throw new Error("Unknown database error");
  throw new Error(error.code ? `${error.message} (code: ${error.code})` : error.message);
}

export const listSites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("sites").select("*").order("created_at");
    if (error) throwPgError(error);
    return data ?? [];
  });

// How many pages/briefs we'll aggregate per user for the My Sites
// overview -- a soft cap, not real pagination, on the assumption a
// single account's crawled-page and generated-brief counts stay well
// under this for the foreseeable future (see similar limits in
// dashboard.functions.ts).
const SITE_PAGES_FETCH_LIMIT = 5000;
const SITE_BRIEFS_FETCH_LIMIT = 10000;

export type SiteOverviewRow = {
  id: string;
  url: string;
  sitemap_url: string | null;
  site_type: SiteType;
  brand_name: string | null;
  tagline: string | null;
  accent_color: string | null;
  brand_colors: string[] | null;
  brand_font: string | null;
  brand_notes: string | null;
  // Defaults to 'openai' at the DB level -- see the
  // openai_default_provider migration, which also backfilled existing
  // sites (originally defaulted to 'replicate' before that migration).
  image_provider: ImageProvider;
  // DB-level NOT NULL (auto-derived by tg_sites_default_vertical when
  // not explicitly set at insert) -- see the vertical selector in
  // BrandEditorFields, which is website-only; etsy/ecomm sites carry
  // etsy_product/ecomm_product here without ever showing a picker.
  vertical: SiteVertical;
  // GA4 mapping -- set via the site's Connections section (upsertSite).
  // google_connection_id points at a row in the separate multi-account
  // google_connections table (see 20260730100000 migration); a site has
  // at most one active GA4 mapping even though a user can hold several
  // Google connections overall.
  google_connection_id: string | null;
  ga4_property_id: string | null;
  ga4_property_label: string | null;
  // Same pattern, for Pinterest -- points at a row in the separate
  // multi-account pinterest_connections table (see the
  // pinterest_connections migration). NULL for every new site by
  // default; only set explicitly (or via the one-time legacy backfill,
  // see pinterest-connections.server.ts) -- never inferred from any
  // account-wide status. This is the fix for the site-isolation bug
  // where a brand-new site showed "Connected" with another site's real
  // boards: that read a single account-wide integrations row instead of
  // this per-site column.
  pinterest_connection_id: string | null;
  created_at: string;
  // Computed, not stored -- see getSitesOverview.
  pageCount: number;
  pinsCreated: number;
  lastCrawledAt: string | null;
  // Count of boards that would actually publish to this site --
  // DELIBERATELY strict here: only boards with this site explicitly
  // listed in board.site_ids count. This is a narrower rule than
  // boards.functions.ts's own site-selection scoring (which treats an
  // empty site_ids as "any site" for content-generation purposes, and
  // stays that way -- unchanged, still correct for its own purpose).
  // Reusing that same "empty = any site" semantic for this display tile
  // was the second half of the site-isolation bug: every unrestricted
  // board (the common case, since restricting a board to specific sites
  // is a manual extra step) counted for every site, new or not, making
  // a brand-new untouched site show the same board count as an
  // established one.
  boardsMappedCount: number;
};

// Richer version of listSites for the My Sites page: folds in a
// per-site page count (labeled "posts"/"listings"/"products" in the UI
// depending on site_type -- it's the same underlying crawled-page count
// either way, since the Etsy/e-commerce adapters that would populate
// type-specific data are planned separately, not built yet), a
// pins-created count, and the most recent crawl timestamp. pin_briefs
// doesn't carry site_id directly, so this resolves site -> pages ->
// briefs in two queries and aggregates in memory, same pattern as
// dashboard.functions.ts uses for per-site scoping.
export const getSitesOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SiteOverviewRow[]> => {
    const s = context.supabase;
    const { data: siteRows, error } = await s.from("sites").select("*").order("created_at");
    if (error) throwPgError(error);
    const sites = siteRows ?? [];
    if (sites.length === 0) return [];

    const siteIds = sites.map((r: { id: string }) => r.id);
    const { data: pageRows } = await s
      .from("pages")
      .select("id, site_id, last_crawled_at")
      .in("site_id", siteIds)
      .limit(SITE_PAGES_FETCH_LIMIT);
    const pages = (pageRows ?? []) as { id: string; site_id: string; last_crawled_at: string | null }[];
    const pageIds = pages.map((p) => p.id);

    const { data: briefRows } = pageIds.length
      ? await s.from("pin_briefs").select("id, page_id").in("page_id", pageIds).limit(SITE_BRIEFS_FETCH_LIMIT)
      : { data: [] as { id: string; page_id: string }[] };

    const pageToSite = new Map(pages.map((p) => [p.id, p.site_id]));
    const pageCountBySite = new Map<string, number>();
    const lastCrawledBySite = new Map<string, string | null>();
    for (const p of pages) {
      pageCountBySite.set(p.site_id, (pageCountBySite.get(p.site_id) ?? 0) + 1);
      const cur = lastCrawledBySite.get(p.site_id) ?? null;
      if (p.last_crawled_at && (!cur || p.last_crawled_at > cur)) lastCrawledBySite.set(p.site_id, p.last_crawled_at);
    }
    const briefCountBySite = new Map<string, number>();
    for (const b of (briefRows ?? []) as { id: string; page_id: string }[]) {
      const siteId = pageToSite.get(b.page_id);
      if (!siteId) continue;
      briefCountBySite.set(siteId, (briefCountBySite.get(siteId) ?? 0) + 1);
    }

    const { data: boardRows } = await s.from("boards").select("id, site_ids");
    const boards = (boardRows ?? []) as { id: string; site_ids: string[] | null }[];
    const boardsMappedCountBySite = new Map<string, number>();
    for (const siteId of siteIds) {
      // Strict inclusion only -- see boardsMappedCount's own comment on
      // SiteOverviewRow for why this deliberately does NOT treat an
      // empty site_ids as "any site" the way boards.functions.ts's
      // generation-time scoring does.
      const count = boards.filter((b) => (Array.isArray(b.site_ids) ? b.site_ids : []).includes(siteId)).length;
      boardsMappedCountBySite.set(siteId, count);
    }

    return sites.map((site: Record<string, unknown>) => ({
      ...site,
      pageCount: pageCountBySite.get(site.id as string) ?? 0,
      pinsCreated: briefCountBySite.get(site.id as string) ?? 0,
      lastCrawledAt: lastCrawledBySite.get(site.id as string) ?? null,
      boardsMappedCount: boardsMappedCountBySite.get(site.id as string) ?? 0,
    })) as SiteOverviewRow[];
  });

export const upsertSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: {
    id?: string; url: string; sitemap_url?: string; timezone?: string;
    site_type?: SiteType; brand_name?: string; tagline?: string;
    accent_color?: string; brand_colors?: string[]; brand_font?: string; brand_notes?: string;
    image_provider?: ImageProvider; vertical?: SiteVertical;
    google_connection_id?: string | null; ga4_property_id?: string | null; ga4_property_label?: string | null;
    pinterest_connection_id?: string | null;
  }) =>
    z.object({
      id: z.string().uuid().optional(),
      url: z.string().url(),
      sitemap_url: z.string().url().optional(),
      timezone: z.string().default("UTC"),
      site_type: z.enum(SITE_TYPES).optional(),
      brand_name: z.string().optional(),
      tagline: z.string().optional(),
      accent_color: z.string().optional(),
      brand_colors: z.array(z.string()).optional(),
      brand_font: z.string().optional(),
      brand_notes: z.string().optional(),
      image_provider: z.enum(IMAGE_PROVIDERS).optional(),
      // sites.vertical is a plain `text` column at the DB level (no
      // CHECK constraint/enum -- see the pin_gen_vertical_followup
      // migration's own comment), so this zod enum is the only real
      // ceiling on which strings can land here. Keep it in sync with
      // SiteVertical's full union (briefs.functions.ts) whenever a new
      // vertical is added, content-selectable or trigger-only alike --
      // etsy_product/ecomm_product remain valid values here even though
      // WEBSITE_VERTICAL_OPTIONS never offers them in the UI, since the
      // DB trigger assigns them directly.
      vertical: z.enum([
        "garden_content", "general_content", "travel_content", "food_content", "lifestyle_content",
        "etsy_product", "ecomm_product",
      ]).optional(),
      // Nullable (not just optional) so the Connections section can
      // explicitly clear a mapping (e.g. after disconnecting the
      // underlying Google account) by sending null rather than needing
      // a separate "unset" endpoint.
      google_connection_id: z.string().uuid().nullable().optional(),
      ga4_property_id: z.string().nullable().optional(),
      ga4_property_label: z.string().nullable().optional(),
      pinterest_connection_id: z.string().uuid().nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const row = { ...data, user_id: context.userId };
    const { data: out, error } = await context.supabase.from("sites").upsert(row as never).select().single();
    if (error) throwPgError(error);
    return out;
  });

export const deleteSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("sites").delete().eq("id", data.id);
    if (error) throwPgError(error);
    return { ok: true };
  });

export const crawlSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { siteId: string }) => z.object({ siteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { parseSitemap, crawlPage } = await import("./crawler.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: site, error: sErr } = await context.supabase.from("sites").select("*").eq("id", data.siteId).single();
    if (sErr || !site) throw sErr ?? new Error("Site not found");
    const sitemapUrl = site.sitemap_url ?? new URL("/sitemap.xml", site.url).toString();
    const urls = await parseSitemap(sitemapUrl);
    let added = 0, updated = 0, errors = 0;
    for (const u of urls.slice(0, 200)) {
      try {
        const page = await crawlPage(u.loc);
        const { data: existing } = await supabaseAdmin
          .from("pages").select("id, content_hash").eq("site_id", site.id).eq("url", page.url).maybeSingle();
        const row = {
          site_id: site.id,
          user_id: context.userId,
          url: page.url,
          title: page.title,
          h1: page.h1,
          meta_description: page.meta_description,
          content_hash: page.content_hash,
          headings: page.headings as unknown as never,
          images: page.images as unknown as never,
          jsonld: page.jsonld as unknown as never,
          status: "active" as const,
          last_crawled_at: new Date().toISOString(),
        };
        if (!existing) {
          const { error } = await supabaseAdmin.from("pages").insert(row);
          if (error) throwPgError(error);
          added++;
        } else if (existing.content_hash !== page.content_hash) {
          const { error } = await supabaseAdmin.from("pages").update(row).eq("id", existing.id);
          if (error) throwPgError(error);
          updated++;
        }
      } catch { errors++; }
    }
    return { discovered: urls.length, added, updated, errors };
  });
