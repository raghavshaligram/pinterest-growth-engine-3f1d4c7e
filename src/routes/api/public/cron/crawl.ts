import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/crawl")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth, forEachUser } = await import("@/lib/cron.server");
        const bad = checkCronAuth(request);
        if (bad) return bad;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { parseSitemap, crawlPage } = await import("@/lib/crawler.server");
        const out = await forEachUser(async (uid) => {
          const { data: sites } = await supabaseAdmin.from("sites").select("*").eq("user_id", uid);
          let added = 0, updated = 0;
          for (const site of sites ?? []) {
            try {
              const url = site.sitemap_url ?? new URL("/sitemap.xml", site.url).toString();
              const urls = await parseSitemap(url);
              for (const u of urls.slice(0, 100)) {
                try {
                  const page = await crawlPage(u.loc);
                  const { data: existing } = await supabaseAdmin
                    .from("pages").select("id, content_hash").eq("site_id", site.id).eq("url", page.url).maybeSingle();
                  const row = {
                    site_id: site.id, user_id: uid, url: page.url,
                    title: page.title, h1: page.h1, meta_description: page.meta_description,
                    content_hash: page.content_hash,
                    headings: page.headings as unknown as never,
                    images: page.images as unknown as never,
                    jsonld: page.jsonld as unknown as never,
                    status: "active" as const,
                    last_crawled_at: new Date().toISOString(),
                  };
                  if (!existing) { await supabaseAdmin.from("pages").insert(row); added++; }
                  else if (existing.content_hash !== page.content_hash) {
                    await supabaseAdmin.from("pages").update(row).eq("id", existing.id); updated++;
                  }
                } catch { /* skip */ }
              }
            } catch { /* skip site */ }
          }
          return { added, updated };
        });
        return Response.json(out);
      },
    },
  },
});
