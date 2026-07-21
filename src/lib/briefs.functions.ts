import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getErrorMessage } from "@/lib/error-message";

export const PIN_STYLES = [
  "problem-solver", "how-to", "checklist", "comparison", "calculator",
  "mistakes-to-avoid", "before-after", "listicle", "faq", "quick-tip",
  "infographic", "photo", "illustration", "minimal", "seasonal",
] as const;

// ============ PIN TEMPLATE REGISTRY ============
// Keyed by (vertical, generation_mode, template_id). Replaces the old
// hardcoded two-family if/else in buildThemedPinPrompt so new site
// verticals (Etsy/e-commerce/general content) can get their own visual
// templates without touching shared code. `generation_mode` only has
// one value today ("illustrated") -- the axis exists so a future
// photo-real or product-shot mode can be added without a schema change.
export type SiteVertical = "garden_content" | "general_content" | "etsy_product" | "ecomm_product";
type GenerationMode = "illustrated";
type TemplateId =
  | "quick_tip_grid"
  | "editorial_before_after"
  | "problem_solution_headline"
  | "listicle"
  | "quote_stat_card"
  | "step_by_step";

interface PinTemplateEntry {
  visual_description: string;
  default_middle_prompt: (topic: string) => string;
  typography_direction: string;
  palette_fallback: string;
  // Appended after "...Pinterest-native" in the global rules block, e.g.
  // "gardening/home-improvement friendly". Omitted entirely for verticals
  // that shouldn't inherit a genre lock (see general_content below).
  genre_lock?: string;
}

type TemplateRegistry = Partial<
  Record<SiteVertical, Partial<Record<GenerationMode, Partial<Record<TemplateId, PinTemplateEntry>>>>>
>;

const TEMPLATE_REGISTRY: TemplateRegistry = {
  garden_content: {
    illustrated: {
      // Today's Family A, verbatim.
      quick_tip_grid: {
        visual_description: `THEME FAMILY: CLEAN ILLUSTRATED QUICK-TIP CARD GRID, matching the uploaded rainwater example. Light airy background, rounded white cards in a neat 2-column educational grid, thin teal/blue line icons, small leaf/water decorative accents at edges, crisp hierarchy, no photorealism.`,
        default_middle_prompt: (topic) =>
          `Create 4-6 compact visual tips about ${topic}, each with one simple icon and one short phrase. Keep text minimal and legible.`,
        typography_direction: "rounded friendly bold sans",
        palette_fallback: "deep garden green #2F5D1E, fresh blue #0B78B6, soft sky #EAF7FA, cream #FFFDF6, leaf green #49A35C",
        genre_lock: "gardening/home-improvement friendly",
      },
      // Today's Family B, verbatim.
      editorial_before_after: {
        visual_description: `THEME FAMILY: EDITORIAL PHOTO BEFORE/AFTER PIN, matching the uploaded soil calculator example. Cream top title band, large dark-green elegant serif title, two vertical photo panels separated by a thin cream gutter, natural garden realism, refined magazine look.`,
        default_middle_prompt: (topic) =>
          `Show a compelling garden transformation related to ${topic}: left side problem/unfinished/dry, right side lush/finished/healthy.`,
        typography_direction: "bold elegant editorial serif",
        palette_fallback: "deep garden green #2F5D1E, fresh blue #0B78B6, soft sky #EAF7FA, cream #FFFDF6, leaf green #49A35C",
        genre_lock: "gardening/home-improvement friendly",
      },
      // Pass B: Master Strategy template 3/6. Rewritten after an audit
      // found the original relied on a negative instruction ("not a
      // grid, not multiple panels") plus an unanchored text-placement
      // claim with no locked layout to back it -- too easily converges
      // toward editorial_before_after's "hero photo" register. New
      // device: a single diagonal peel/reveal cut, not a symmetric
      // panel split -- a different KIND of transition, not a
      // re-angled version of the two-panel mechanism.
      problem_solution_headline: {
        visual_description: `THEME FAMILY: DIAGONAL REVEAL HEADLINE PIN. One large bold headline stating the problem as a question sits across the top. Below it, a single diagonal peel line cuts across the canvas at roughly a 20-25 degree angle, like a page corner lifting: the muted, desaturated "problem" visual sits above/behind the peel, and lifting it reveals a vivid, full-color "solution" visual beneath, with a soft drop-shadow along the peeled edge. This is a single diagonal cut, not a side-by-side split -- no vertical panels, no symmetric left/right divide, no grid.`,
        default_middle_prompt: (topic) =>
          `A single diagonal peel/reveal about ${topic}: a muted, desaturated version of the problem sits above the peel line, lifting away to reveal a vivid full-color version of the solution beneath it, with a soft drop-shadow along the diagonal peeled edge -- minimal text overlay, let the visual carry the idea. No side-by-side panels, no grid.`,
        typography_direction: "bold condensed magazine-headline sans",
        palette_fallback: "deep garden green #2F5D1E, fresh blue #0B78B6, soft sky #EAF7FA, cream #FFFDF6, leaf green #49A35C",
        genre_lock: "gardening/home-improvement friendly",
      },
      // Pass B: Master Strategy template 4/6. Rewritten after an audit
      // found "vertical or grid arrangement" left the composition
      // ambiguous instead of locking one -- an image model can't
      // consistently "lock onto" an either/or choice. Committed to one
      // specific device: a single stacked column of full-width rows
      // (leaderboard/scoreboard), distinct in kind from
      // quick_tip_grid's discrete 2-column card tiles.
      listicle: {
        visual_description: `THEME FAMILY: STACKED NUMBERED ROWS LISTICLE PIN. A single vertical column of full-width horizontal rows stacked top to bottom, like a leaderboard or scoreboard -- one row per list item. Each row: a large bold numeral flush against the left edge, a small icon just beside it, then a short 3-5 word label filling the rest of the row, with a thin horizontal divider line separating each row from the next. This is one continuous stacked list, not a grid of cards or tiles.`,
        default_middle_prompt: (topic) =>
          `A vertical stack of 3-5 full-width numbered rows about ${topic}, leaderboard-style -- each row one large numeral flush left, one small icon, and a short 3-5 word label only, separated by thin divider lines -- minimal text overlay, let the visual carry the idea. No sentences, no paragraphs, no card grid.`,
        typography_direction: "bold rounded sans with oversized numerals",
        palette_fallback: "deep garden green #2F5D1E, fresh blue #0B78B6, soft sky #EAF7FA, cream #FFFDF6, leaf green #49A35C",
        genre_lock: "gardening/home-improvement friendly",
      },
      // Pass B: Master Strategy template 5/6. The deliberately
      // lowest-text-density template -- text IS the visual here, so this
      // is the one entry that doesn't get the "minimal text overlay"
      // instruction.
      quote_stat_card: {
        visual_description: `THEME FAMILY: QUOTE/STAT CARD PIN. One large number or short quote as the single dominant visual element, filling most of the canvas -- minimal surrounding decoration, generous white space. The deliberately lowest-text-density template: one big statement, nothing else competing for attention.`,
        default_middle_prompt: (topic) =>
          `One large, bold statistic or short quote about ${topic} as the dominant visual element -- this is the one template where the text IS the visual, so make it big and confident. No supporting icons, no card grid, no extra copy competing with it.`,
        typography_direction: "oversized bold display serif",
        palette_fallback: "deep garden green #2F5D1E, fresh blue #0B78B6, soft sky #EAF7FA, cream #FFFDF6, leaf green #49A35C",
        genre_lock: "gardening/home-improvement friendly",
      },
      // Pass B: Master Strategy template 6/6. Rewritten after an audit
      // found "vertical or horizontal flow" + "a simple line or arrow"
      // too loosely specified to lock onto consistently. Committed to
      // one device: a single continuous vertical thread running down
      // the canvas threading through numbered nodes -- distinct in kind
      // from listicle's discrete stacked rows, and a deliberate nod to
      // the Pinspider brand mark's thread/node motif per the original
      // template brief.
      step_by_step: {
        visual_description: `THEME FAMILY: THREADED STEP PATH PIN. One continuous vertical path line runs down the center of the canvas from top to bottom, threading through 3-4 circular numbered step nodes spaced evenly along it (a deliberate nod to the Pinspider brand mark's thread-and-node motif). Each node carries one small illustration and a short 2-4 word step label beside it. This is a single continuous vertical thread connecting the steps in sequence -- not a grid, not stacked rows, not separate panels.`,
        default_middle_prompt: (topic) =>
          `A single continuous vertical thread about ${topic}, threading through 3-4 numbered step nodes down the center of the canvas, each node with one small illustration and a short 2-4 word label -- minimal text overlay, let the visual carry the idea. No grid, no stacked rows -- one continuous vertical path.`,
        typography_direction: "rounded friendly bold sans with a clear numbered sequence",
        palette_fallback: "deep garden green #2F5D1E, fresh blue #0B78B6, soft sky #EAF7FA, cream #FFFDF6, leaf green #49A35C",
        genre_lock: "gardening/home-improvement friendly",
      },
    },
  },
  // Minimal placeholder so non-garden sites don't inherit gardening
  // imagery/palette/genre lock -- neutral until real general-content
  // templates are designed.
  general_content: {
    illustrated: {
      quick_tip_grid: {
        visual_description: `THEME FAMILY: CLEAN ILLUSTRATED QUICK-TIP CARD GRID. Light airy background, rounded white cards in a neat 2-column educational grid, thin line icons, crisp hierarchy, no photorealism.`,
        default_middle_prompt: (topic) =>
          `Create 4-6 compact visual tips about ${topic}, each with one simple icon and one short phrase. Keep text minimal and legible.`,
        typography_direction: "rounded friendly bold sans",
        palette_fallback: "charcoal #2B2B2B, warm white #FAF9F6, muted teal #3E7C7A, soft gray #D9D6D0, accent coral #E4633F",
        // Deliberately no genre_lock -- neutral/general content shouldn't
        // be pinned to any one industry look.
      },
    },
  },
  // No entries yet for etsy_product / ecomm_product -- out of scope for
  // this pass (see task: "add the vertical field", not "design every
  // vertical's templates"). buildThemedPinPrompt falls back to the
  // general_content placeholder above for these until real templates
  // land, rather than throwing.
  etsy_product: {},
  ecomm_product: {},
};

// Style -> template resolution. Ordered rules (first match wins) tested
// against the free-text style string an LLM returns for a brief (not
// guaranteed to exactly match a PIN_STYLES literal, hence regex
// substring matching rather than exact lookup -- same mechanism the
// original 2-family version used, now spanning all 6 templates instead
// of collapsing everything into just 2.
const STYLE_TEMPLATE_RULES: ReadonlyArray<{ test: RegExp; templateId: TemplateId }> = [
  { test: /problem-solver|faq/i, templateId: "problem_solution_headline" },
  { test: /how-to|illustration|seasonal/i, templateId: "step_by_step" },
  { test: /checklist|listicle/i, templateId: "listicle" },
  { test: /calculator|minimal/i, templateId: "quote_stat_card" },
  { test: /comparison|before-after|photo/i, templateId: "editorial_before_after" },
  { test: /mistakes|quick-tip|infographic/i, templateId: "quick_tip_grid" },
];

function resolveTemplateId(style?: string | null): TemplateId {
  const s = style ?? "";
  for (const rule of STYLE_TEMPLATE_RULES) {
    if (rule.test.test(s)) return rule.templateId;
  }
  return "quick_tip_grid";
}

export function buildThemedPinPrompt(input: {
  title: string;
  cta?: string | null;
  style?: string | null;
  topic?: string | null;
  primaryKeyword?: string | null;
  brandHost: string;
  brandColors?: string[];
  /** Overrides the registry entry's default typography_direction when present. */
  brandFont?: string | null;
  middlePrompt?: string | null;
  /** Defaults to "garden_content" when unset so existing callers/sites keep today's behavior. */
  vertical?: SiteVertical | null;
  /**
   * Hooks for a future pass (no SERP/trend data source exists yet) --
   * unused/undefined today, but the injection point exists so wiring
   * real data in later doesn't require touching this function again.
   */
  visualThemeHint?: string | null;
  trendSignal?: string | null;
}) {
  const vertical: SiteVertical = input.vertical ?? "garden_content";
  const generationMode: GenerationMode = "illustrated";
  const templateId = resolveTemplateId(input.style);

  const fallbackEntry = TEMPLATE_REGISTRY.general_content!.illustrated!.quick_tip_grid!;
  const entry = TEMPLATE_REGISTRY[vertical]?.[generationMode]?.[templateId] ?? fallbackEntry;

  const colors = input.brandColors?.filter(Boolean) ?? [];
  const palette = colors.length ? colors.join(", ") : entry.palette_fallback;
  const cta = input.cta || "Read More →";
  const title = input.title.replace(/\s+/g, " ").trim();
  const topic = input.topic || input.primaryKeyword || title;
  const typography = input.brandFont?.trim() || entry.typography_direction;
  const genreSuffix = entry.genre_lock ? `, ${entry.genre_lock}` : "";

  let middle = input.middlePrompt?.trim() || entry.default_middle_prompt(topic);
  if (input.visualThemeHint) {
    middle += ` Trending visual approach for this topic: ${input.visualThemeHint}. Incorporate where it fits the brand's identity.`;
  }
  if (input.trendSignal) {
    middle += ` Current trend signal: ${input.trendSignal}.`;
  }

  return `Create a vertical 2:3 Pinterest pin, 1000x1500. STRICTLY FOLLOW THIS LOCKED THEME — do not invent a new layout.

${entry.visual_description}

GLOBAL BRAND RULES:
- Palette only: ${palette}. No purple gradients, no random neon colors, no black/dark app UI, no generic AI glow.
- Typography: headline is ${typography}. Text must be large, correctly spelled, fully inside the canvas.
- Keep the entire design clean, bright, Pinterest-native${genreSuffix}.

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

    // Competitive-pattern signal: if a recent SERP sweep has already
    // summarized "what's working" for this page's primary keyword (see
    // keywords.functions.ts:summarizeAndStorePatterns), fold the title
    // patterns/themes into the prompt as inspiration. Stale (>7 days) or
    // missing data is skipped silently -- this is enrichment, not a
    // requirement, so most pages (no tracked keyword sweep yet, or Apify
    // simply isn't configured) generate exactly as before.
    const PATTERNS_FRESHNESS_DAYS = 7;
    const { data: serpSnap } = await context.supabase
      .from("serp_snapshots")
      .select("patterns, captured_at")
      .eq("keyword", analysis.primary_keyword)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const snapAgeDays = serpSnap?.captured_at
      ? (Date.now() - new Date(serpSnap.captured_at).getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;
    const patterns = snapAgeDays <= PATTERNS_FRESHNESS_DAYS
      ? (serpSnap?.patterns as { title_patterns?: string[]; themes?: string[]; summary?: string } | null)
      : null;
    const competitiveBlock = patterns && ((patterns.title_patterns?.length ?? 0) > 0 || (patterns.themes?.length ?? 0) > 0)
      ? `\n\nWHAT'S CURRENTLY WORKING FOR "${analysis.primary_keyword}" ON PINTEREST (from recent competitive research — use as inspiration for title/description angles, do not copy any title verbatim):
Title patterns seen: ${JSON.stringify(patterns.title_patterns ?? [])}
Recurring themes: ${JSON.stringify(patterns.themes ?? [])}${patterns.summary ? `\nSummary: ${patterns.summary}` : ""}`
      : "";

    // Style rotation memory: deprioritize (don't hard-exclude) styles used
    // in the last few briefs for this page, so back-to-back batches don't
    // keep landing on the same style. Falls back to the site's rolling
    // history when the page's own is too sparse to be meaningful yet
    // (e.g. the first batch generated for a brand-new page).
    const pageRecent = Array.isArray(page.recent_styles) ? (page.recent_styles as string[]) : [];
    const siteRecent = Array.isArray(site?.recent_styles) ? (site!.recent_styles as string[]) : [];
    const recentStyles = pageRecent.length >= 3 ? pageRecent : siteRecent;
    const recentSet = new Set(recentStyles);
    const shuffle = <T,>(arr: readonly T[]) => [...arr].sort(() => Math.random() - 0.5);
    const freshStyles = shuffle(PIN_STYLES.filter((s) => !recentSet.has(s)));
    const staleStyles = shuffle(PIN_STYLES.filter((s) => recentSet.has(s)));
    const stylesSubset = [...freshStyles, ...staleStyles].slice(0, Math.min(data.count, PIN_STYLES.length));
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
- intent: one of informational|tool|list|commercial.
If the user message includes a "WHAT'S CURRENTLY WORKING" competitive-research section, treat it as inspiration only for title/description angles — never copy a competitor's title or description verbatim.`,
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
Category: ${analysis.category ?? ""}${competitiveBlock}`,
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
          brandFont,
          vertical: (site?.vertical ?? null) as SiteVertical | null,
          middlePrompt: b.image_prompt,
        }),
        status: "image_pending" as const,
        // Traceability: record whether this batch used the competitive
        // "what's currently working" block, and from which keyword/
        // snapshot age, so the UI can show it after the fact instead of
        // it only existing inside a prompt no one sees again.
        used_serp_patterns: Boolean(competitiveBlock),
        serp_keyword: competitiveBlock ? analysis.primary_keyword : null,
        serp_patterns_captured_at: competitiveBlock ? serpSnap?.captured_at ?? null : null,
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

      // Roll the style-rotation memory forward: newest styles first,
      // deduped, capped at 5. Page-level always updates; site-level is
      // the shared fallback other pages on the same site can draw on.
      const ROTATION_MEMORY = 5;
      const dedupeCapped = (styles: string[]) =>
        styles.filter((s, i, arr) => arr.indexOf(s) === i).slice(0, ROTATION_MEMORY);
      await supabaseAdmin.from("pages")
        .update({ recent_styles: dedupeCapped([...chosenStyles, ...pageRecent]) })
        .eq("id", page.id);
      if (site) {
        await supabaseAdmin.from("sites")
          .update({ recent_styles: dedupeCapped([...chosenStyles, ...siteRecent]) })
          .eq("id", site.id);
      }

      await markIntegration(context.userId, "openai", "ok");
      return { created: inserted!.length };
    } catch (e) {
      const msg = getErrorMessage(e);
      await markIntegration(context.userId, "openai", "error", msg);
      throw e;
    }
  });

export const listBriefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("pin_briefs")
      .select("id, style, title, description, hashtags, alt_text, cta, status, page_id, created_at, used_serp_patterns, serp_keyword, serp_patterns_captured_at, pages(url, title), pin_images(storage_path, width, height)")
      .order("created_at", { ascending: false })
      .limit(500);
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



// Lets a caller store an already-final, manually-edited image_prompt
// (e.g. from a future brief-editing UI). The DB trigger
// trg_pin_briefs_image_prompt_edit stamps image_prompt_edited_at
// automatically on this update, which is what tells the image worker to
// use the prompt as-is instead of re-deriving it via
// buildThemedPinPrompt (see image-worker.server.ts).
export const updateBriefImagePrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { briefId: string; imagePrompt: string }) =>
    z.object({ briefId: z.string().uuid(), imagePrompt: z.string().min(1) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("pin_briefs")
      .update({ image_prompt: data.imagePrompt })
      .eq("id", data.briefId);
    if (error) throw error;
    return { ok: true };
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
      // Detach any scheduled pins from the old image so the FK delete succeeds
      // and the scheduler row is ready to be re-pointed at the new image.
      await supabaseAdmin.from("scheduled_pins")
        .update({ image_id: null })
        .eq("brief_id", data.briefId)
        .in("status", ["draft", "queued", "failed"]);
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
    const result = await processImageQueueForUser(context.userId, 1, { briefId: data.briefId });
    // processImageQueueForUser swallows per-job errors internally (so a
    // bulk queue run doesn't abort on one bad brief) and always resolves
    // without throwing -- previously this meant rerenderBrief returned
    // { ok: true } unconditionally even when the render had actually
    // failed, so the UI showed a false "Re-rendered" success toast while
    // the brief stayed stuck at status="image_pending" forever. Check the
    // outcome explicitly here and surface the real failure reason.
    if (result.fail) {
      const { data: failedJob } = await supabaseAdmin
        .from("jobs")
        .select("last_error")
        .eq("user_id", context.userId)
        .eq("kind", "generate_image")
        .filter("payload->>brief_id", "eq", data.briefId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      throw new Error(failedJob?.last_error || "Image generation failed. Check your Replicate integration and try again.");
    }
    // Repoint any scheduled_pins for this brief at the freshly rendered image
    // so the schedule view shows the new artwork instead of a blank slot.
    const { data: newImg } = await supabaseAdmin
      .from("pin_images").select("id").eq("brief_id", data.briefId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (newImg?.id) {
      await supabaseAdmin.from("scheduled_pins")
        .update({ image_id: newImg.id })
        .eq("brief_id", data.briefId)
        .is("image_id", null);
    }
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
