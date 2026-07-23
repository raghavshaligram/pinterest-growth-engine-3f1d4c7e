import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getErrorMessage } from "@/lib/error-message";

type PipelineStatus = "images_ready" | "in_progress" | "not_started" | "error";

type ListPageBrief = {
  id: string;
  status: string;
  pin_images?: { storage_path: string }[];
  scheduled_pins?: { status: string }[];
};

export const listPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i?: { siteId?: string | null }) =>
    z.object({ siteId: z.string().uuid().nullable().optional() }).parse(i ?? {}),
  )
  .handler(async ({ data: input, context }) => {
    // pages carries site_id directly -- a plain .eq() filter, unlike
    // pin_briefs/keywords/scheduled_pins below which need an id-list
    // resolution first (see briefs.functions.ts/keywords.functions.ts/
    // schedule.functions.ts).
    let query = context.supabase
      .from("pages")
      .select(
        "id, url, title, status, last_crawled_at, last_analyzed_at, updated_at, excluded, " +
          "pin_briefs(id, status, pin_images(storage_path), scheduled_pins(status))",
      )
      .order("last_crawled_at", { ascending: false })
      .limit(200);
    if (input.siteId) query = query.eq("site_id", input.siteId);

    // Images stage is the only stage with a real backend "in progress"
    // signal: jobs rows created by generateBriefs/renderImagesForPage
    // (see briefs.functions.ts) with kind="generate_image". Analyze and
    // Brief are synchronous server functions with no jobs row ever
    // created for them, so there is no backend signal to poll for those
    // two -- the list route drives their in-progress dot from client-side
    // mutation-pending state instead (same pattern already used for the
    // existing render-all button). Scoped to queued/running only (not a
    // resolved id list), so this stays a small, bounded query regardless
    // of how many pages/briefs the user has -- the fix applied to
    // listBriefs/listKeywords/listScheduled after the HeadersOverflowError
    // incident.
    const activeJobsQuery = context.supabase
      .from("jobs")
      .select("payload")
      .eq("user_id", context.userId)
      .eq("kind", "generate_image")
      .in("status", ["queued", "running"]);

    const [{ data, error }, { data: activeJobs, error: jobsError }] = await Promise.all([
      query,
      activeJobsQuery,
    ]);
    if (error) throw error;
    if (jobsError) throw jobsError;

    const activeBriefIds = new Set(
      (activeJobs ?? [])
        .map((j) => (j.payload as { brief_id?: string } | null)?.brief_id)
        .filter((id): id is string => !!id),
    );

    return (data ?? []).map((p) => {
      const briefs = (p as { pin_briefs?: ListPageBrief[] }).pin_briefs ?? [];
      const briefsTotal = briefs.length;
      const imagesReady = briefs.filter((b) => b.pin_images?.length).length;
      const imagesError = briefs.filter((b) => b.status === "failed").length;
      const imagesActive = briefs.filter((b) => activeBriefIds.has(b.id)).length;
      const scheduledCount = briefs.reduce(
        (n, b) => n + (b.scheduled_pins ?? []).filter((s) => s.status !== "canceled").length,
        0,
      );
      const thumb = briefs.find((b) => b.pin_images?.[0]?.storage_path)?.pin_images?.[0]?.storage_path ?? null;

      let pipelineStatus: PipelineStatus;
      if (imagesError > 0) pipelineStatus = "error";
      else if (briefsTotal === 0) pipelineStatus = "not_started";
      else if (imagesReady === briefsTotal) pipelineStatus = "images_ready";
      else pipelineStatus = "in_progress";

      return {
        id: p.id, url: p.url, title: p.title, status: p.status,
        last_crawled_at: p.last_crawled_at, last_analyzed_at: p.last_analyzed_at,
        updated_at: (p as { updated_at?: string }).updated_at ?? null,
        excluded: p.excluded,
        briefs_total: briefsTotal,
        images_ready: imagesReady,
        images_pending: briefsTotal - imagesReady,
        images_error: imagesError,
        images_active: imagesActive,
        scheduled_count: scheduledCount,
        pipeline_status: pipelineStatus,
        thumb,
        // No word_count field exists anywhere in this schema -- omitted
        // rather than approximated from an unrelated column.
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
    const briefsQuery = context.supabase
      .from("pin_briefs")
      // template_id is the classifier's stored shape decision (see
      // pin_briefs_template_id migration) -- the Pin Assets grid on the
      // detail page reads this directly rather than re-deriving a shape
      // guess from the style label, since template_id is what actually
      // drove the image prompt for that brief.
      .select(
        "id, style, title, description, status, template_id, image_prompt, created_at, used_serp_patterns, serp_keyword, serp_patterns_captured_at, " +
          "pin_images(storage_path, width, height), scheduled_pins(scheduled_at, status)",
      )
      .eq("page_id", data.id)
      .order("created_at", { ascending: false });

    // Same bounded, non-id-list jobs check as listPages (see there for
    // why this can't just be `.in("brief_id", briefIds)` -- kept
    // consistent even though a single page's brief count is small enough
    // that it wouldn't hit the URL-size crash, so the pattern doesn't
    // silently diverge between the two places that need it).
    const activeJobsQuery = context.supabase
      .from("jobs")
      .select("payload")
      .eq("user_id", context.userId)
      .eq("kind", "generate_image")
      .in("status", ["queued", "running"]);

    const [{ data: briefs }, { data: activeJobs }] = await Promise.all([briefsQuery, activeJobsQuery]);
    const activeBriefIds = new Set(
      (activeJobs ?? [])
        .map((j) => (j.payload as { brief_id?: string } | null)?.brief_id)
        .filter((id): id is string => !!id),
    );
    const briefsWithActive = (briefs ?? []).map((b) => ({ ...b, is_rendering: activeBriefIds.has(b.id) }));
    return { page, briefs: briefsWithActive };
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
      const msg = getErrorMessage(e);
      await markIntegration(context.userId, "openai", "error", msg);
      throw e;
    }
  });
