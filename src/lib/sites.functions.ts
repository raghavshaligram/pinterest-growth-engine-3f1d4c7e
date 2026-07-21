import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const SITE_TYPES = ["website", "etsy", "ecomm"] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export const listSites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("sites").select("*").order("created_at");
    if (error) throw error;
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
  brand_colors: unknown;
  brand_font: string | null;
  brand_notes: string | null;
  created_at: string;
  // Computed, not stored -- see getSitesOverview.
  pageCount: number;
  pinsCreated: number;
  lastCrawledAt: string | null;
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
    if (error) throw error;
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

    return sites.map((site: Record<string, unknown>) => ({
      ...site,
      pageCount: pageCountBySite.get(site.id as string) ?? 0,
      pinsCreated: briefCountBySite.get(site.id as string) ?? 0,
      lastCrawledAt: lastCrawledBySite.get(site.id as string) ?? null,
    })) as SiteOverviewRow[];
  });

export const upsertSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: {
    id?: string; url: string; sitemap_url?: string; timezone?: string;
    site_type?: SiteType; brand_name?: string; tagline?: string;
    accent_color?: string; brand_colors?: string[]; brand_font?: string; brand_notes?: string;
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
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const row = { ...data, user_id: context.userId };
    const { data: out, error } = await context.supabase.from("sites").upsert(row).select().single();
    if (error) throw error;
    return out;
  });

export const deleteSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("sites").delete().eq("id", data.id);
    if (error) throw error;
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
          if (error) throw error;
          added++;
        } else if (existing.content_hash !== page.content_hash) {
          const { error } = await supabaseAdmin.from("pages").update(row).eq("id", existing.id);
          if (error) throw error;
          updated++;
        }
      } catch { errors++; }
    }
    return { discovered: urls.length, added, updated, errors };
  });
