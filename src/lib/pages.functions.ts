import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("pages")
      .select("id, url, title, status, last_crawled_at, last_analyzed_at, excluded, pin_briefs(id, status, pin_images(storage_path))")
      .order("last_crawled_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []).map((p) => {
      const briefs = (p as { pin_briefs?: { id: string; status: string; pin_images?: { storage_path: string }[] }[] }).pin_briefs ?? [];
      const briefsTotal = briefs.length;
      const imagesReady = briefs.filter((b) => b.pin_images?.length).length;
      const thumb = briefs.find((b) => b.pin_images?.[0]?.storage_path)?.pin_images?.[0]?.storage_path ?? null;
      return {
        id: p.id, url: p.url, title: p.title, status: p.status,
        last_crawled_at: p.last_crawled_at, last_analyzed_at: p.last_analyzed_at, excluded: p.excluded,
        briefs_total: briefsTotal,
        images_ready: imagesReady,
        images_pending: briefsTotal - imagesReady,
        thumb,
      };
    });
  });


export const setPageExcluded = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { pageId: string; excluded: boolean }) =>
    z.object({ pageId: z.string().uuid(), excluded: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("pages").update({ excluded: data.excluded }).eq("id", data.pageId);
    if (error) throw error;
    return { ok: true };
  });

const EXCLUDE_PATTERNS = [
  /\/(about|about-us|contact|contact-us|methodology|privacy|privacy-policy|terms|terms-of-service|tos|legal|disclaimer|cookies?|cookie-policy|refund|shipping|returns|faq|support|help|login|signin|signup|register|account|cart|checkout|thank-?you|search|sitemap|author|authors|team|careers|jobs|press|media-kit|affiliate|advertise|dmca|accessibility|imprint|impressum)(\/|$|\?)/i,
  /\/(tag|tags|category|categories|archive|archives|page)\/[0-9]+/i,
];

export const autoExcludePages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: pages, error } = await context.supabase
      .from("pages").select("id, url").eq("excluded", false);
    if (error) throw error;
    const toExclude = (pages ?? []).filter((p) => EXCLUDE_PATTERNS.some((rx) => rx.test(p.url)));
    if (toExclude.length) {
      await context.supabase.from("pages").update({ excluded: true }).in("id", toExclude.map((p) => p.id));
    }
    return { excluded: toExclude.length };
  });

export const getPage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: page, error } = await context.supabase.from("pages").select("*").eq("id", data.id).single();
    if (error) throw error;
    const { data: briefs } = await context.supabase
      .from("pin_briefs")
      .select("id, style, title, description, status, image_prompt, created_at, pin_images(storage_path)")
      .eq("page_id", data.id)
      .order("created_at", { ascending: false });
    return { page, briefs: briefs ?? [] };
  });

export const analyzePage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { pageId: string }) => z.object({ pageId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { requireIntegration, markIntegration } = await import("./integrations.server");
    const { openaiJSON } = await import("./openai.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = await requireIntegration(context.userId, "openai");
    const { data: page, error } = await context.supabase.from("pages").select("*").eq("id", data.pageId).single();
    if (error || !page) throw error ?? new Error("Page not found");

    try {
      type Analysis = {
        topic: string;
        primary_keyword: string;
        secondary_keywords: string[];
        lsi_keywords: string[];
        questions: string[];
        intent: string;
        category: string;
        audience: string;
        seasonality: string;
        pin_opportunities: number;
      };
      const analysis = await openaiJSON<Analysis>({
        apiKey: cfg.api_key,
        model: "gpt-4o-mini",
        system: "You are a Pinterest SEO strategist. Return strict JSON.",
        user: `Analyze this page for Pinterest SEO. Return JSON with keys: topic, primary_keyword, secondary_keywords (5-10), lsi_keywords (5-10), questions (5-8), intent, category, audience, seasonality, pin_opportunities (integer 5-25).

URL: ${page.url}
Title: ${page.title ?? ""}
H1: ${page.h1 ?? ""}
Meta: ${page.meta_description ?? ""}
Headings: ${JSON.stringify(((page.headings as unknown as unknown[]) ?? []).slice(0, 12))}`,
      });

      await supabaseAdmin.from("pages").update({
        analysis,
        last_analyzed_at: new Date().toISOString(),
      }).eq("id", page.id);

      // Sync keywords
      await supabaseAdmin.from("keywords").delete().eq("page_id", page.id);
      const rows = [
        { keyword: analysis.primary_keyword, kind: "primary" as const },
        ...analysis.secondary_keywords.map((k) => ({ keyword: k, kind: "secondary" as const })),
        ...analysis.lsi_keywords.map((k) => ({ keyword: k, kind: "lsi" as const })),
        ...analysis.questions.map((k) => ({ keyword: k, kind: "question" as const })),
      ].map((r) => ({ ...r, user_id: context.userId, page_id: page.id, tracked: r.kind === "primary" }));
      if (rows.length) await supabaseAdmin.from("keywords").insert(rows);

      await markIntegration(context.userId, "openai", "ok");
      return analysis;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markIntegration(context.userId, "openai", "error", msg);
      throw e;
    }
  });
