import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PIN_STYLES = [
  "problem-solver", "how-to", "checklist", "comparison", "calculator",
  "mistakes-to-avoid", "before-after", "listicle", "faq", "quick-tip",
  "infographic", "photo", "illustration", "minimal", "seasonal",
] as const;

export const generateBriefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { pageId: string; count?: number }) =>
    z.object({ pageId: z.string().uuid(), count: z.number().int().min(1).max(30).default(10) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { requireIntegration, markIntegration } = await import("./integrations.server");
    const { openaiJSON } = await import("./openai.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = await requireIntegration(context.userId, "openai");

    const { data: page, error } = await context.supabase.from("pages").select("*").eq("id", data.pageId).single();
    if (error || !page) throw error ?? new Error("Page not found");
    const analysis = (page.analysis ?? {}) as {
      topic?: string; primary_keyword?: string; secondary_keywords?: string[]; audience?: string; category?: string;
    };
    if (!analysis.primary_keyword) throw new Error("Analyze the page first.");

    const { data: site } = await context.supabase.from("sites").select("*").eq("id", page.site_id).single();
    const brandName = site?.brand_name ?? (site ? new URL(site.url).hostname.replace(/^www\./, "") : "");
    const brandHost = site ? new URL(site.url).hostname.replace(/^www\./, "") : "";
    const brandColors = Array.isArray(site?.brand_colors) ? (site!.brand_colors as string[]) : [];
    const brandFont = site?.brand_font ?? "";
    const brandNotes = site?.brand_notes ?? "";
    const paletteLine = brandColors.length
      ? `Use ONLY this brand color palette: ${brandColors.join(", ")}. Backgrounds, accents, and overlay text must come from this palette.`
      : `Use a cohesive palette derived from the page's topic; keep it consistent across all 10 pins for this batch.`;
    const isCalculatorPage = /calculator|calc|tool/i.test(`${page.url} ${page.title ?? ""} ${analysis.topic ?? ""} ${analysis.category ?? ""}`);
    const ctaGuidance = isCalculatorPage
      ? `This is a CALCULATOR / TOOL page. Every CTA must push people to try the tool. Use punchy 2-4 word action phrases like "Calculate Yours →", "Try the Calculator", "Get Your Number", "Run the Numbers", "Free Calculator →". Vary them across the 10 pins.`
      : `Every pin needs a strong action CTA (2-4 words) matching intent: "Read More →", "Get the Guide", "See the List", "Save This", "Try It Free".`;
    const brandBlock = `BRAND LOCK (must appear on every image):
- Brand name overlay near the top or as a small wordmark: "${brandName}".
- Website URL centered at the BOTTOM of the pin (bottom center, ~6% margin, small caps or clean sans, high contrast, no box): "${brandHost}".
- CTA BUTTON: a clearly designed pill/rectangle button in the lower third of the pin (above the URL footer, roughly 70-80% down), high-contrast against the background, using an accent color from the brand palette. Button label = the brief's cta text, in bold sans, with a trailing arrow "→" when it fits. This button MUST be present on every pin.
- ${paletteLine}
${brandFont ? `- Typography direction: ${brandFont}.\n` : ""}${brandNotes ? `- Brand notes: ${brandNotes}.\n` : ""}- Do NOT invent a different URL or brand name. No fake logos.`;

    const stylesSubset = [...PIN_STYLES].sort(() => Math.random() - 0.5).slice(0, Math.min(data.count, PIN_STYLES.length));
    const chosenStyles = stylesSubset.length >= data.count
      ? stylesSubset.slice(0, data.count)
      : [...stylesSubset, ...Array(data.count - stylesSubset.length).fill("how-to")];

    try {
      type BriefsResp = {
        briefs: Array<{
          style: string;
          title: string;
          description: string;
          hashtags: string[];
          alt_text: string;
          cta: string;
          image_prompt: string;
        }>;
      };
      const resp = await openaiJSON<BriefsResp>({
        apiKey: cfg.api_key,
        model: "gpt-4o-mini",
        system: "You are a Pinterest pin strategist. Return strict JSON. Titles under 100 chars, descriptions 150-450 chars, natural keyword use (no stuffing), 5-8 hashtags including the primary keyword. Every pin has an action CTA.",
        user: `Create ${data.count} unique Pinterest pin briefs for this page. Use each style once from this list where possible: ${JSON.stringify(chosenStyles)}.

Return JSON: { briefs: [{ style, title, description, hashtags: [], alt_text, cta, image_prompt }] }.

CTA RULES: ${ctaGuidance}

The image_prompt is for a text-to-image model producing a vertical 2:3 Pinterest pin at 1000x1500. Include composition, style (photography/illustration/flat/vintage/infographic/split/minimal etc), and any overlay text WITH exact typography direction. Vary composition/style per brief, but keep the brand lock IDENTICAL on every pin. The image_prompt MUST explicitly describe a visible CTA button rendering the exact cta text.

${brandBlock}

Every image_prompt MUST end with this exact line: "CTA button (lower third): [cta text] →. Bottom-center footer text: ${brandHost}. Small wordmark: ${brandName}. Palette: ${brandColors.join(", ") || "cohesive brand palette"}." — replace [cta text] with this brief's cta value.

Page: ${page.url}
Topic: ${analysis.topic ?? ""}
Primary keyword: ${analysis.primary_keyword}
Secondary: ${JSON.stringify(analysis.secondary_keywords ?? [])}
Audience: ${analysis.audience ?? ""}
Category: ${analysis.category ?? ""}`,
      });

      const rows = resp.briefs.slice(0, data.count).map((b) => ({
        user_id: context.userId,
        page_id: page.id,
        style: b.style,
        title: b.title,
        description: b.description,
        hashtags: b.hashtags ?? [],
        alt_text: b.alt_text ?? null,
        cta: b.cta ?? null,
        image_prompt: b.image_prompt,
        status: "image_pending" as const,
      }));
      const { data: inserted, error: insErr } = await supabaseAdmin.from("pin_briefs").insert(rows).select("id");
      if (insErr) throw insErr;

      // Enqueue image jobs
      const jobs = inserted!.map((r) => ({
        user_id: context.userId,
        kind: "generate_image" as const,
        payload: { brief_id: r.id },
      }));
      await supabaseAdmin.from("jobs").insert(jobs);

      await markIntegration(context.userId, "openai", "ok");
      return { created: inserted!.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markIntegration(context.userId, "openai", "error", msg);
      throw e;
    }
  });

export const listBriefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("pin_briefs")
      .select("id, style, title, status, page_id, created_at, pin_images(storage_path)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return data ?? [];
  });

export const runImageWorker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { processImageQueueForUser } = await import("./image-worker.server");
    return await processImageQueueForUser(context.userId, 5);
  });

export const rerenderBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { briefId: string }) => z.object({ briefId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: brief } = await context.supabase.from("pin_briefs").select("id, user_id").eq("id", data.briefId).single();
    if (!brief || brief.user_id !== context.userId) throw new Error("Brief not found");
    // Remove any existing images for this brief (both DB row and storage object)
    const { data: imgs } = await supabaseAdmin.from("pin_images").select("id, storage_path").eq("brief_id", data.briefId);
    if (imgs?.length) {
      const paths = imgs.map((i) => i.storage_path).filter(Boolean) as string[];
      if (paths.length) await supabaseAdmin.storage.from("pins").remove(paths);
      await supabaseAdmin.from("pin_images").delete().eq("brief_id", data.briefId);
    }
    await supabaseAdmin.from("pin_briefs").update({ status: "image_pending" }).eq("id", data.briefId);
    await supabaseAdmin.from("jobs").insert({
      user_id: context.userId,
      kind: "generate_image" as const,
      payload: { brief_id: data.briefId, force: true },
    });
    // Kick the worker inline so the user sees it render immediately
    const { processImageQueueForUser } = await import("./image-worker.server");
    await processImageQueueForUser(context.userId, 1);
    return { ok: true };
  });
