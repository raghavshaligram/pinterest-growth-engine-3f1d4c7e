import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listSites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("sites").select("*").order("created_at");
    if (error) throw error;
    return data ?? [];
  });

export const upsertSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id?: string; url: string; sitemap_url?: string; timezone?: string }) =>
    z.object({
      id: z.string().uuid().optional(),
      url: z.string().url(),
      sitemap_url: z.string().url().optional(),
      timezone: z.string().default("UTC"),
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
