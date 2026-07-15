import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PIN_STYLES = [
  "problem-solver", "how-to", "checklist", "comparison", "calculator",
  "mistakes-to-avoid", "before-after", "listicle", "faq", "quick-tip",
  "infographic", "photo", "illustration", "minimal", "seasonal",
] as const;

export function buildThemedPinPrompt(input: {
  title: string;
  cta?: string | null;
  style?: string | null;
  topic?: string | null;
  primaryKeyword?: string | null;
  brandHost: string;
  brandColors?: string[];
  middlePrompt?: string | null;
}) {
  const colors = input.brandColors?.filter(Boolean) ?? [];
  const palette = colors.length
    ? colors.join(", ")
    : "deep garden green #2F5D1E, fresh blue #0B78B6, soft sky #EAF7FA, cream #FFFDF6, leaf green #49A35C";
  const cta = input.cta || "Read More →";
  const title = input.title.replace(/\s+/g, " ").trim();
  const topic = input.topic || input.primaryKeyword || title;
  const isTipTheme = /quick-tip|checklist|how-to|faq|infographic|listicle|mistakes/i.test(input.style ?? "");
  const theme = isTipTheme
    ? `THEME FAMILY: CLEAN ILLUSTRATED QUICK-TIP CARD GRID, matching the uploaded rainwater example. Light airy background, rounded white cards in a neat 2-column educational grid, thin teal/blue line icons, small leaf/water decorative accents at edges, crisp hierarchy, no photorealism.`
    : `THEME FAMILY: EDITORIAL PHOTO BEFORE/AFTER PIN, matching the uploaded soil calculator example. Cream top title band, large dark-green elegant serif title, two vertical photo panels separated by a thin cream gutter, natural garden realism, refined magazine look.`;
  const middle = input.middlePrompt?.trim() || (isTipTheme
    ? `Create 4-6 compact visual tips about ${topic}, each with one simple icon and one short phrase. Keep text minimal and legible.`
    : `Show a compelling garden transformation related to ${topic}: left side problem/unfinished/dry, right side lush/finished/healthy.`);

  return `Create a vertical 2:3 Pinterest pin, 1000x1500. STRICTLY FOLLOW THIS LOCKED THEME — do not invent a new layout.

${theme}

GLOBAL BRAND RULES:
- Palette only: ${palette}. No purple gradients, no random neon colors, no black/dark app UI, no generic AI glow.
- Typography: headline is bold elegant editorial serif for photo/comparison pins; rounded friendly bold sans for quick-tip card-grid pins. Text must be large, correctly spelled, fully inside the canvas.
- Keep the entire design clean, bright, Pinterest-native, gardening/home-improvement friendly.

LOCKED LAYOUT:
- Top 16-18% is a clean title zone. Place this exact title text, uppercase when it suits the theme: "${title}".
- Middle 72-76% is the main themed visual: ${middle}
- CTA appears as a small tasteful accent near the lower third only if it fits, exact text: "${cta}".
- Bottom 5% is a full-width solid dark green/brand-color URL bar, flush to bottom, containing only centered cream small sans text: "${input.brandHost}".
- No logo, no wordmark, no tagline, no social handle, no extra URL, no watermark.

QUALITY CONTROL:
- Must look like the same brand/template as the uploaded references.
- Must not crop title, CTA, URL, card text, or panel images.
- No misspelled words. No extra paragraphs. No unrelated objects.`;
}

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
    // Intent detection drives the CTA pool so a tips pin gets "Read the Guide →",
    // not "Try It Free". Model can override per-brief in its returned intent.
    const haystack = `${page.url} ${page.title ?? ""} ${analysis.topic ?? ""} ${analysis.category ?? ""}`.toLowerCase();
    const defaultIntent: "informational" | "tool" | "list" | "commercial" =
      /calculator|calc|\/tool|estimator/.test(haystack) ? "tool"
      : /\bvs\b|versus|compare|comparison|best\s+\d|top\s+\d|listicle/.test(haystack) ? "list"
      : /pricing|signup|sign-up|trial|buy|checkout|plans/.test(haystack) ? "commercial"
      : "informational";
    const ctaPools: Record<string, string[]> = {
      informational: ["Read the Guide →", "See All Tips →", "Learn How →", "Get the Full Guide →", "Read More →"],
      tool: ["Calculate Yours →", "Try the Calculator →", "Run the Numbers →", "Get Your Number →", "Free Calculator →"],
      list: ["See the List →", "Compare Options →", "See the Comparison →", "View All →", "See Which Wins →"],
      commercial: ["Try It Free →", "Get Started →", "Start Free →", "Sign Up Free →", "Try Now →"],
    };
    const ctaGuidance = `Each brief has an intent: "informational" | "tool" | "list" | "commercial". Default intent for THIS page = "${defaultIntent}"; you MAY set a different intent per brief when the angle differs (e.g. a comparison pin on a tool page = "list"). Then pick cta EXCLUSIVELY from the matching pool:
- informational: ${JSON.stringify(ctaPools.informational)}
- tool: ${JSON.stringify(ctaPools.tool)}
- list: ${JSON.stringify(ctaPools.list)}
- commercial: ${JSON.stringify(ctaPools.commercial)}
Never mix pools. Never invent CTAs outside the pools. Vary CTAs across the batch.`;
    const brandBlock = `LOCKED PIN THEME — every image must belong to one of these two reusable families, matching the user's uploaded references:
1) EDITORIAL PHOTO BEFORE/AFTER PIN: cream top title band, huge dark-green elegant serif title, two vertical photo panels with a thin cream divider, realistic gardening/home-improvement transformation.
2) CLEAN ILLUSTRATED QUICK-TIP CARD GRID: pale blue/cream airy background, big rounded blue title, 2-column grid of white rounded cards, teal/blue line icons, short tip text, subtle leaf/water accents.

Global rules for both families:
- Aspect ratio 2:3, 1000x1500.
- Palette only: ${brandColors.join(", ") || "deep garden green, clear blue, soft sky, cream, leaf green"}. No random colors, no purple gradients, no dark tech UI.
- Bottom bar is mandatory: full-width dark green/brand-color bar, flush to bottom, ~5% tall, containing ONLY the centered URL "${brandHost}" in cream small sans. No logo, no wordmark, no tagline, no social handle.
- Text must be correctly spelled, large, clean, and never cropped.
${brandFont ? `- Typography direction (title): ${brandFont}.\n` : ""}${brandNotes ? `- Brand notes: ${brandNotes}.\n` : ""}`;

    const stylesSubset = [...PIN_STYLES].sort(() => Math.random() - 0.5).slice(0, Math.min(data.count, PIN_STYLES.length));
    const chosenStyles = stylesSubset.length >= data.count
      ? stylesSubset.slice(0, data.count)
      : [...stylesSubset, ...Array(data.count - stylesSubset.length).fill("how-to")];

    try {
      type BriefsResp = {
        briefs: Array<{
          style: string;
          intent: "informational" | "tool" | "list" | "commercial";
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
        system: `You are a Pinterest SEO strategist. Return strict JSON. Every pin has:
- title: <=100 chars, PRIMARY KEYWORD in the first 40 chars, curiosity-driven, no clickbait, no ALL CAPS.
- description: 150-450 chars, natural sentences, primary keyword in first 50 chars, weave in 2-3 secondary keywords, end with the CTA phrase as a call to action.
- alt_text: <=250 chars, LITERAL visual description of what's in the image ("gloved hand digging beside green rain barrel next to garden shed"), include primary keyword once, NOT marketing copy.
- hashtags: 4-6, lowercase, no spaces, include the primary keyword as a hashtag plus secondaries; no # in the strings.
- cta: chosen from the intent-matched pool ONLY.
- intent: one of informational|tool|list|commercial.`,
        user: `Create ${data.count} unique Pinterest pin briefs for this page. Use each style once from this list where possible: ${JSON.stringify(chosenStyles)}.

Return JSON: { briefs: [{ style, intent, title, description, hashtags: [], alt_text, cta, image_prompt }] }.

CTA & INTENT RULES:
${ctaGuidance}

The image_prompt is for a text-to-image model producing a vertical 2:3 Pinterest pin at 1000x1500. Describe the middle illustration/photo, composition, and mood. Vary the middle imagery per brief. The universal template below is IDENTICAL on every pin — describe it verbatim at the end of every image_prompt.

${brandBlock}

Every image_prompt MUST END with this exact line (substitute [cta text] with this brief's cta):
"UNIVERSAL FRAME: Title in cream serif across the top over brand-color overlay. CTA button in warm accent color at ~75% down reading [cta text]. Bottom bar: solid dark brand-color band, full width, containing only the centered URL text \\"${brandHost}\\" in cream small sans. No wordmark, no logo, no tagline — URL only in the bottom bar. Palette: ${brandColors.join(", ") || "cohesive brand palette"}."

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
        intent: (["informational", "tool", "list", "commercial"].includes(b.intent) ? b.intent : defaultIntent),
        title: b.title,
        description: b.description,
        hashtags: b.hashtags ?? [],
        alt_text: b.alt_text ?? null,
        cta: b.cta ?? null,
        image_prompt: buildThemedPinPrompt({
          title: b.title,
          cta: b.cta,
          style: b.style,
          topic: analysis.topic,
          primaryKeyword: analysis.primary_keyword,
          brandHost,
          brandColors,
          middlePrompt: b.image_prompt,
        }),
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
      .limit(60);
    if (error) throw error;
    return data ?? [];
  });

export const runImageWorker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { processImageQueueForUser } = await import("./image-worker.server");
    return await processImageQueueForUser(context.userId, 8);
  });

export const renderImagesForPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { pageId: string; limit?: number }) =>
    z.object({ pageId: z.string().uuid(), limit: z.number().int().min(1).max(20).default(8) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Ensure image jobs exist for every pending brief on this page
    const { data: briefs } = await supabaseAdmin
      .from("pin_briefs")
      .select("id, status, pin_images(id)")
      .eq("user_id", context.userId)
      .eq("page_id", data.pageId);
    const needQueue = (briefs ?? [])
      .filter((b) => !((b as { pin_images?: unknown[] }).pin_images?.length))
      .map((b) => b.id);
    if (needQueue.length) {
      const { data: existing } = await supabaseAdmin
        .from("jobs")
        .select("payload")
        .eq("user_id", context.userId)
        .eq("kind", "generate_image")
        .in("status", ["queued", "running"]);
      const already = new Set(
        (existing ?? []).map((j) => (j.payload as { brief_id?: string } | null)?.brief_id).filter(Boolean) as string[],
      );
      const rows = needQueue
        .filter((id) => !already.has(id))
        .map((id) => ({
          user_id: context.userId,
          kind: "generate_image" as const,
          status: "queued" as const,
          payload: { brief_id: id },
          run_at: new Date().toISOString(),
          attempts: 0,
        }));
      if (rows.length) await supabaseAdmin.from("jobs").insert(rows);
    }
    const { processImageQueueForUser } = await import("./image-worker.server");
    return await processImageQueueForUser(context.userId, data.limit, { pageId: data.pageId });
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
      run_at: new Date().toISOString(),
    });
    // Kick the worker inline for THIS brief only, so other queued jobs don't steal the slot
    const { processImageQueueForUser } = await import("./image-worker.server");
    await processImageQueueForUser(context.userId, 1, { briefId: data.briefId });
    return { ok: true };
  });

// Fully delete a pin brief: removes generated image (storage + row), any
// scheduled publish entries, queued render jobs, then the brief itself.
export const deleteBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { briefId: string }) => z.object({ briefId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: brief } = await context.supabase
      .from("pin_briefs").select("id, user_id").eq("id", data.briefId).single();
    if (!brief || brief.user_id !== context.userId) throw new Error("Brief not found");

    const { data: imgs } = await supabaseAdmin
      .from("pin_images").select("storage_path").eq("brief_id", data.briefId);
    const paths = (imgs ?? []).map((i) => i.storage_path).filter(Boolean) as string[];
    if (paths.length) await supabaseAdmin.storage.from("pins").remove(paths);

    // Only remove pins that haven't already gone out to Pinterest.
    await supabaseAdmin.from("scheduled_pins")
      .delete().eq("brief_id", data.briefId)
      .in("status", ["draft", "queued", "failed", "canceled", "exported"]);
    await supabaseAdmin.from("pin_images").delete().eq("brief_id", data.briefId);
    await supabaseAdmin.from("jobs")
      .delete().eq("kind", "generate_image").eq("user_id", context.userId)
      .in("status", ["queued", "failed"])
      .filter("payload->>brief_id", "eq", data.briefId);
    await supabaseAdmin.from("pin_briefs").delete().eq("id", data.briefId);
    return { ok: true };
  });
