import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getErrorMessage } from "@/lib/error-message";

export const PIN_STYLES = [
  "problem-solver", "how-to", "checklist", "comparison", "calculator",
  "mistakes-to-avoid", "before-after", "listicle", "faq", "quick-tip",
  "infographic", "photo", "illustration", "minimal", "seasonal",
] as const;

// ============ PIN SHAPE REGISTRY ============
// Keyed by (generation_mode, template_id) ONLY -- shapes are
// compositional mechanisms (grid, panel-split, diagonal reveal, stacked
// rows, ...) and are vertical-agnostic by design: any site, in any
// vertical, can use any shape. `generation_mode` only has one value
// today ("illustrated") -- the axis exists so a future photo-real or
// product-shot mode can be added without a schema change.
//
// Previously these were keyed by (vertical, generation_mode,
// template_id), which meant every shape only actually existed under
// garden_content -- a non-garden site had exactly one (duplicated,
// neutered) template available. Genre/palette/typography defaults now
// live in VERTICAL_FLAVOR_REGISTRY below; a shape's own
// typography_direction (see note on that field) still wins when set,
// since it's tied to the compositional device, not the vertical.
export type SiteVertical = "garden_content" | "general_content" | "etsy_product" | "ecomm_product";
type GenerationMode = "illustrated";
export type TemplateId =
  | "quick_tip_grid"
  | "editorial_before_after"
  | "problem_solution_headline"
  | "listicle"
  | "quote_stat_card"
  | "step_by_step"
  | "myth_vs_fact"
  | "definition_card"
  | "scale_comparison"
  | "seasonal_timeline"
  | "tool_result_preview";

interface ShapeTemplateEntry {
  visual_description: string;
  default_middle_prompt: (topic: string) => string;
  // Tied to the compositional device itself (oversized numerals for a
  // numeral-driven list, elegant serif for a magazine-style split,
  // UI sans for a mock-interface card, ...) rather than to any one
  // vertical's genre -- every shape defines its own, and a brand_font
  // override still wins over this when set. Unlike genre_lock/
  // palette_fallback (identical across every shape under the old
  // per-vertical registry), typography genuinely varied per shape, so
  // it stays here rather than collapsing into one per-vertical default
  // -- doing otherwise would silently homogenize all 11 shapes'
  // typography and change already-shipped output.
  typography_direction: string;
  // One-line description of what kind of page content this shape suits
  // best. Not consumed by any selection logic yet -- there is no
  // content-aware classifier in this codebase (only the style-label
  // regex below). This field exists so that metadata is ready the
  // moment one gets built, without re-touching every entry again.
  content_fit: string;
}

type ShapeRegistry = Partial<Record<GenerationMode, Partial<Record<TemplateId, ShapeTemplateEntry>>>>;

const SHAPE_REGISTRY: ShapeRegistry = {
  illustrated: {
    // Today's Family A. Genericized: previously said "matching the
    // uploaded rainwater example" and "leaf/water decorative accents",
    // which baked a garden-specific motif into a shape every vertical
    // now shares. The card-grid mechanism itself is unchanged.
    quick_tip_grid: {
      visual_description: `THEME FAMILY: CLEAN ILLUSTRATED QUICK-TIP CARD GRID. Light airy background, rounded white cards in a neat 2-column educational grid, thin line icons, small decorative accents at the edges relevant to the topic, crisp hierarchy, no photorealism.`,
      default_middle_prompt: (topic) =>
        `Create 4-6 compact visual tips about ${topic}, each with one simple icon and one short phrase. Keep text minimal and legible.`,
      typography_direction: "rounded friendly bold sans",
      content_fit: "best for general list-of-tips or how-to content with several short, roughly equal-weight points -- no single dominant idea.",
    },
    // Today's Family B. Genericized: previously said "matching the
    // uploaded soil calculator example," "natural garden realism," and
    // framed the middle visual as a "garden transformation" with
    // "dry"/"lush" language. The two-panel split mechanism itself, and
    // the cream title band, are unchanged.
    editorial_before_after: {
      visual_description: `THEME FAMILY: EDITORIAL PHOTO BEFORE/AFTER PIN. Cream top title band, large elegant serif title, two vertical photo panels separated by a thin cream gutter, photo-realistic, refined magazine look.`,
      default_middle_prompt: (topic) =>
        `Show a compelling before/after transformation related to ${topic}: left side shows the problem or unfinished state, right side shows the improved, finished state.`,
      typography_direction: "bold elegant editorial serif",
      content_fit: "best for transformation/renovation content where a literal before-and-after visual comparison tells the story.",
    },
    // Pass B: Master Strategy template 3/6, later rewritten after an
    // audit found the original relied on a negative instruction ("not a
    // grid, not multiple panels") plus an unanchored text-placement
    // claim -- too easily converged toward editorial_before_after's
    // "hero photo" register. Device: a single diagonal peel/reveal cut,
    // not a symmetric panel split -- a different KIND of transition.
    // Genericized here: the illustrative example headline was a
    // garden-specific question ("Why Is My Soil So Compacted?"),
    // replaced with a description of the pattern instead of a literal
    // garden instance.
    problem_solution_headline: {
      visual_description: `THEME FAMILY: DIAGONAL REVEAL HEADLINE PIN. One large bold headline stating the problem as a question sits across the top (e.g. a single specific pain point framed as a question). Below it, a single diagonal peel line cuts across the canvas at roughly a 20-25 degree angle, like a page corner lifting: the muted, desaturated "problem" visual sits above/behind the peel, and lifting it reveals a vivid, full-color "solution" visual beneath, with a soft drop-shadow along the peeled edge. This is a single diagonal cut, not a side-by-side split -- no vertical panels, no symmetric left/right divide, no grid.`,
      default_middle_prompt: (topic) =>
        `A single diagonal peel/reveal about ${topic}: a muted, desaturated version of the problem sits above the peel line, lifting away to reveal a vivid full-color version of the solution beneath it, with a soft drop-shadow along the diagonal peeled edge -- minimal text overlay, let the visual carry the idea. No side-by-side panels, no grid.`,
      typography_direction: "bold condensed magazine-headline sans",
      content_fit: "best for content framed as answering a single specific problem or question, where one clear visual can carry the whole idea.",
    },
    // Pass B: Master Strategy template 4/6, rewritten after an audit
    // found "vertical or grid arrangement" left the composition
    // ambiguous. Committed to one device: a single stacked column of
    // full-width rows (leaderboard/scoreboard), distinct in kind from
    // quick_tip_grid's discrete 2-column card tiles.
    listicle: {
      visual_description: `THEME FAMILY: STACKED NUMBERED ROWS LISTICLE PIN. A single vertical column of full-width horizontal rows stacked top to bottom, like a leaderboard or scoreboard -- one row per list item. Each row: a large bold numeral flush against the left edge, a small icon just beside it, then a short 3-5 word label filling the rest of the row, with a thin horizontal divider line separating each row from the next. This is one continuous stacked list, not a grid of cards or tiles.`,
      default_middle_prompt: (topic) =>
        `A vertical stack of 3-5 full-width numbered rows about ${topic}, leaderboard-style -- each row one large numeral flush left, one small icon, and a short 3-5 word label only, separated by thin divider lines -- minimal text overlay, let the visual carry the idea. No sentences, no paragraphs, no card grid.`,
      typography_direction: "bold rounded sans with oversized numerals",
      content_fit: "best for ranked or countable list content (top N, X tips/mistakes) where each item deserves its own short label.",
    },
    // Pass B: Master Strategy template 5/6. The deliberately
    // lowest-text-density template -- text IS the visual here, so this
    // is the one entry that doesn't get the "minimal text overlay"
    // instruction. Tightened in Pass C to explicitly rule out UI chrome
    // now that tool_result_preview (also a large-prominent-number
    // template) exists alongside it.
    quote_stat_card: {
      visual_description: `THEME FAMILY: QUOTE/STAT CARD PIN. One large number or short quote as the single dominant visual element, filling most of the canvas -- minimal surrounding decoration, generous white space. The deliberately lowest-text-density template: one big statement, nothing else competing for attention. Bare typographic treatment only -- no interface chrome, no input fields, no browser-window framing, no card border (see tool_result_preview for the UI-mimicry version of a large number).`,
      default_middle_prompt: (topic) =>
        `One large, bold statistic or short quote about ${topic} as the dominant visual element -- this is the one template where the text IS the visual, so make it big and confident. No supporting icons, no card grid, no extra copy competing with it, no UI chrome or input fields.`,
      typography_direction: "oversized bold display serif",
      content_fit: "best for content anchored on one compelling statistic, fact, or quotable claim.",
    },
    // Pass B: Master Strategy template 6/6, rewritten after an audit
    // found "vertical or horizontal flow" + "a simple line or arrow"
    // too loosely specified. Committed to one device: a single
    // continuous vertical thread running down the canvas threading
    // through numbered nodes -- distinct in kind from listicle's
    // discrete stacked rows, and a deliberate nod to the Pinspider
    // brand mark's thread/node motif (an app-brand reference, not tied
    // to any content vertical, so it stays as-is here).
    step_by_step: {
      visual_description: `THEME FAMILY: THREADED STEP PATH PIN. One continuous vertical path line runs down the center of the canvas from top to bottom, threading through 3-4 circular numbered step nodes spaced evenly along it (a deliberate nod to the Pinspider brand mark's thread-and-node motif). Each node carries one small illustration and a short 2-4 word step label beside it. This is a single continuous vertical thread connecting the steps in sequence -- not a grid, not stacked rows, not separate panels.`,
      default_middle_prompt: (topic) =>
        `A single continuous vertical thread about ${topic}, threading through 3-4 numbered step nodes down the center of the canvas, each node with one small illustration and a short 2-4 word label -- minimal text overlay, let the visual carry the idea. No grid, no stacked rows -- one continuous vertical path.`,
      typography_direction: "rounded friendly bold sans with a clear numbered sequence",
      content_fit: "best for sequential how-to/process content where steps must happen in a specific order.",
    },
    // Pass C: bringing the total to 10, then 11 with tool_result_preview.
    // Fact-check graphic, not a transformation -- stamped MYTH/FACT
    // badges + strike-through/checkmark iconography + a bold solid
    // divider (not a blank gutter) distinguish it from
    // editorial_before_after's photo-realist two-panel split. The
    // red/green semantics here are a universal correctness convention,
    // not a vertical-specific brand color, so they stay as-is.
    myth_vs_fact: {
      visual_description: `THEME FAMILY: MYTH VS FACT CORRECTION PIN. Two columns divided by a bold solid vertical divider line (not a thin blank gutter). The left column is stamped with a "MYTH" badge label at the top and a large diagonal red strike-through/X mark drawn across its illustration, rendered in muted grayscale tones. The right column is stamped with a "FACT" badge label at the top and a large green checkmark badge beside its illustration, rendered in full vivid color. This is a fact-check/correction graphic, not a transformation -- the left side is marked FALSE, not "before," and the right side is marked TRUE, not "after."`,
      default_middle_prompt: (topic) =>
        `A myth-vs-fact correction about ${topic}: left column stamped "MYTH" with a red strike-through/X over a muted grayscale illustration of the misconception, right column stamped "FACT" with a green checkmark beside a vivid full-color illustration of the truth, divided by a bold solid vertical line -- minimal text overlay beyond the two badge labels, let the visual carry the correction.`,
      typography_direction: "bold condensed sans for the MYTH/FACT badge labels",
      content_fit: "best for content that corrects a common misconception -- pages framed around debunking a myth or clarifying what's actually true.",
    },
    // Dictionary/glossary-entry hierarchy (headword, then a distinct
    // definition block, then one icon) distinguishes it from
    // quote_stat_card's single unbroken statement with nothing else
    // competing for attention.
    definition_card: {
      visual_description: `THEME FAMILY: DEFINITION CARD PIN. Dictionary/glossary-entry layout: the term itself set in large bold type as a headword at the top, directly followed by one clear definition block in smaller body-weight type immediately below it -- a two-tier text hierarchy, term then definition, not a single unbroken statement -- plus exactly one supporting icon positioned to the side of the definition block. Clean reference-card feel, explanatory in tone rather than a punchy claim.`,
      default_middle_prompt: (topic) =>
        `A dictionary-style definition card for ${topic}: the term as a large bold headword, one clear definition sentence in smaller body type directly below it, and exactly one supporting icon beside the definition -- minimal text overlay beyond the headword and definition themselves, let the two-tier hierarchy carry the explanation. No card grid, no numbered list.`,
      typography_direction: "bold serif headword over clean sans-serif definition body text",
      content_fit: "best for glossary/definition-style content explaining what a term means.",
    },
    // A graduated axis with markers at PROPORTIONAL heights (magnitude
    // encoded by position) distinguishes it from step_by_step's
    // equally-weighted sequential nodes -- this is about relative size,
    // not order of action.
    scale_comparison: {
      visual_description: `THEME FAMILY: SCALE COMPARISON PIN. A single graduated axis -- like a ruler or thermometer -- runs the length of the canvas (vertical orientation) with visible tick marks at regular intervals. 2-4 icons are placed directly on the axis at heights proportional to the magnitude or size they represent (larger values sit higher, smaller values sit lower), each with a short label beside its tick mark. Unlike a sequence of equally-weighted steps, position along the axis encodes actual relative size or quantity, not order of action.`,
      default_middle_prompt: (topic) =>
        `A graduated ruler/thermometer-style axis with visible tick marks about ${topic}, with 2-4 icons positioned at heights proportional to the size or magnitude each represents, each with a short label at its tick mark -- minimal text overlay, let the proportional positioning carry the comparison. No connecting path or arrows between icons -- position on the axis alone encodes the comparison.`,
      typography_direction: "bold rounded sans for axis labels",
      content_fit: "best for measurement, sizing, or quantity-comparison content, especially calculator/estimator pages comparing magnitudes.",
    },
    // A horizontal calendar strip of flush, equal-width, unconnected
    // segments distinguishes it from step_by_step's vertical threaded
    // path -- adjacency along a calendar ribbon, not a connecting line
    // between action nodes.
    seasonal_timeline: {
      visual_description: `THEME FAMILY: SEASONAL TIMELINE PIN. A single horizontal strip spans the full width of the canvas, divided into equal-width adjacent segments -- one segment per month or season -- like a calendar strip. Each segment contains one small icon and a short label (the month or season name) directly beneath it. Segments sit flush against each other with a thin vertical divider between them; there is no connecting thread, path, or arrow linking them -- adjacency along the calendar strip alone conveys the passage of time.`,
      default_middle_prompt: (topic) =>
        `A horizontal calendar strip about ${topic}, divided into 3-4 equal-width month/season segments sitting flush side by side, each with one small icon and a short month/season label beneath it -- minimal text overlay, let the calendar segments carry the timing. No connecting thread or arrows between segments, no vertical stacking.`,
      typography_direction: "rounded friendly bold sans for month/season labels",
      content_fit: "best for content organized around a calendar (monthly/seasonal or recurring maintenance schedules).",
    },
    // The only shape depicting UI/interface chrome -- distinguishes it
    // from quote_stat_card (which also has one large prominent number)
    // via browser-chrome framing and labeled input fields, which
    // quote_stat_card explicitly rules out.
    tool_result_preview: {
      visual_description: `THEME FAMILY: TOOL RESULT PREVIEW PIN. A stylized mock interface: a rounded card with browser-chrome framing (a thin top bar with 3 small circular dots, like a window's title bar) containing 2-3 labeled input fields with plausible sample values already filled in, and one large, visually highlighted result output area below the inputs showing a computed answer -- styled to look like a real tool that was just used, not a generic screenshot or icon. This is the only template depicting UI/interface chrome; no other template uses input fields, browser-window framing, or a filled-in form.`,
      default_middle_prompt: (topic) =>
        `A stylized mock tool interface for ${topic}: a rounded browser-chrome-framed card with 2-3 labeled input fields showing plausible sample values already entered, and one large highlighted result area below showing a computed answer -- make it look like a real calculator/tool that was just used, not a blank form or generic screenshot. Minimal text overlay beyond the field labels and result themselves.`,
      typography_direction: "clean modern UI sans, like a real app interface",
      content_fit: "best for pages describing or centered on an interactive calculator/tool, where showing the tool in use is the strongest visual.",
    },
  },
};

// ============ VERTICAL FLAVOR REGISTRY ============
// Keyed by (vertical, generation_mode). This is where genre language,
// palette, and a typography *fallback* live -- the part of the prompt
// that should vary by site vertical while the compositional shape
// (above) stays fixed. garden_content legitimately keeps the
// gardening-specific genre lock and green/cream palette that used to
// be duplicated across all 11 shape entries; other verticals get
// neutral equivalents instead of inheriting garden language.
interface VerticalFlavorEntry {
  // Appended after "...Pinterest-native" in the global rules block, e.g.
  // "gardening/home-improvement friendly". Omitted entirely for
  // verticals that shouldn't be pinned to one industry look.
  genre_lock?: string;
  palette_fallback: string;
  // Fallback only -- every shape above defines its own
  // typography_direction, which wins whenever present (see
  // ShapeTemplateEntry.typography_direction for why typography stays
  // per-shape rather than per-vertical). This exists for a future shape
  // that doesn't specify one, so nothing is ever left without a
  // typography instruction.
  typography_default: string;
}

type FlavorRegistry = Partial<Record<SiteVertical, Partial<Record<GenerationMode, VerticalFlavorEntry>>>>;

const VERTICAL_FLAVOR_REGISTRY: FlavorRegistry = {
  garden_content: {
    illustrated: {
      genre_lock: "gardening/home-improvement friendly",
      palette_fallback: "deep garden green #2F5D1E, fresh blue #0B78B6, soft sky #EAF7FA, cream #FFFDF6, leaf green #49A35C",
      typography_default: "clean bold sans",
    },
  },
  // Neutral flavor -- deliberately no genre_lock, so general-content
  // sites aren't pinned to any one industry look.
  general_content: {
    illustrated: {
      palette_fallback: "charcoal #2B2B2B, warm white #FAF9F6, muted teal #3E7C7A, soft gray #D9D6D0, accent coral #E4633F",
      typography_default: "clean modern sans",
    },
  },
  // No flavor entries yet for etsy_product / ecomm_product -- out of
  // scope for this pass. buildThemedPinPrompt falls back to
  // general_content's neutral flavor for these until real flavor
  // profiles land, rather than throwing.
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
  /**
   * The classifier's own shape decision (see generateBriefs), stored per
   * brief and passed through explicitly. Takes priority over deriving a
   * template from `style` -- the regex only covers 6 of 11 shapes and
   * would silently downgrade any brief classified into one of the 5
   * newly-reachable shapes. `style` remains as a fallback purely for
   * legacy callers/rows that predate template_id (e.g. image-worker
   * re-rendering an old brief that never had a stored decision).
   */
  templateId?: TemplateId | null;
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
  const templateId = input.templateId ?? resolveTemplateId(input.style);

  // Shape (compositional mechanism) and flavor (genre/palette/
  // typography-fallback) are resolved independently now -- any shape is
  // available to any vertical. Both fall back to a safe default rather
  // than throwing if a lookup is ever empty.
  const shapeFallback = SHAPE_REGISTRY.illustrated!.quick_tip_grid!;
  const shape = SHAPE_REGISTRY[generationMode]?.[templateId] ?? shapeFallback;

  const flavorFallback = VERTICAL_FLAVOR_REGISTRY.general_content!.illustrated!;
  const flavor = VERTICAL_FLAVOR_REGISTRY[vertical]?.[generationMode] ?? flavorFallback;

  const colors = input.brandColors?.filter(Boolean) ?? [];
  const palette = colors.length ? colors.join(", ") : flavor.palette_fallback;
  const cta = input.cta || "Read More →";
  const title = input.title.replace(/\s+/g, " ").trim();
  const topic = input.topic || input.primaryKeyword || title;
  // brand_font > shape's own typography (tied to the compositional
  // device) > vertical's typography_default (safety net only).
  const typography = input.brandFont?.trim() || shape.typography_direction || flavor.typography_default;
  const genreSuffix = flavor.genre_lock ? `, ${flavor.genre_lock}` : "";

  let middle = input.middlePrompt?.trim() || shape.default_middle_prompt(topic);
  if (input.visualThemeHint) {
    middle += ` Trending visual approach for this topic: ${input.visualThemeHint}. Incorporate where it fits the brand's identity.`;
  }
  if (input.trendSignal) {
    middle += ` Current trend signal: ${input.trendSignal}.`;
  }

  return `Create a vertical 2:3 Pinterest pin, 1000x1500. STRICTLY FOLLOW THIS LOCKED THEME — do not invent a new layout.

${shape.visual_description}

GLOBAL BRAND RULES:
- Palette only: ${palette}. No purple gradients, no random neon colors, no black/dark app UI, no generic AI glow.
- Typography: headline is ${typography}. Text must be large, correctly spelled, fully inside the canvas.
- Keep the entire design clean, bright, Pinterest-native${genreSuffix}.

LOCKED LAYOUT:
- Top 16-18% is a clean title zone. Place this exact title text, uppercase when it suits the theme: "${title}".
- Middle 72-76% is the main themed visual: ${middle}
- CTA appears as a small tasteful accent near the lower third only if it fits, exact text: "${cta}".
- Bottom 5% is a full-width solid brand-color URL bar, flush to bottom, containing only centered light-colored small sans text: "${input.brandHost}".
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

    // Content-aware template classifier. Replaces the old style-label
    // regex (resolveTemplateId/STYLE_TEMPLATE_RULES) as the routing
    // mechanism -- that regex only ever reached 6 of the 11 registered
    // shapes and couldn't be extended to the other 5 without either
    // stealing style-label coverage from shapes that already worked or
    // faking a semantic fit that wasn't really there. The LLM already
    // sees each brief's full context (topic, angle, style) in this same
    // call, so it picks the best-fitting shape directly from the real
    // catalog instead.
    const vertical: SiteVertical = (site?.vertical as SiteVertical | null) ?? "garden_content";
    const flavor = VERTICAL_FLAVOR_REGISTRY[vertical]?.illustrated ?? VERTICAL_FLAVOR_REGISTRY.general_content!.illustrated!;
    const shapeCatalog = Object.entries(SHAPE_REGISTRY.illustrated!)
      .map(([id, shape]) => `- ${id}: ${shape!.content_fit}`)
      .join("\n");
    const validTemplateIds = new Set(Object.keys(SHAPE_REGISTRY.illustrated!));

    // Shared brand context for the LLM's own copy/content decisions.
    // Deliberately NOT a theme/family description anymore -- which shape
    // a pin uses is the classifier's job (below) and buildThemedPinPrompt
    // owns 100% of the actual frame/layout text; restating it here (the
    // old brandBlock described only 2 hardcoded, garden-flavored
    // families) was both stale now that 11 shapes exist and would have
    // silently biased every LLM-written image_prompt toward garden
    // imagery regardless of the site's actual vertical.
    const brandBlock = `Brand context:
- Palette: ${brandColors.join(", ") || flavor.palette_fallback}.
${brandFont ? `- Typography direction: ${brandFont}.\n` : ""}${brandNotes ? `- Brand notes: ${brandNotes}.\n` : ""}`;

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
          template_id: string;
          intent: "informational" | "tool" | "list" | "commercial";
          title: string;
          description: string;
          hashtags: string[];
          alt_text: string;
          cta: string;
          image_prompt: string;
        }>;
      };
      // First line of defense: the model is told explicitly, twice
      // (system + user), to return exactly data.count items. This alone
      // is NOT relied on to guarantee the count -- see the length check
      // and retry immediately below, which is the real fix. A prompt
      // instruction can be (and has been observed to be) under-fulfilled
      // by the model, especially as per-item constraints add up (copy +
      // CTA-pool compliance + template classification all at once).
      const system = `You are a Pinterest SEO strategist and visual-template classifier. Return strict JSON. Every pin has:
- title: <=100 chars, PRIMARY KEYWORD in the first 40 chars, curiosity-driven, no clickbait, no ALL CAPS.
- description: 150-450 chars, natural sentences, primary keyword in first 50 chars, weave in 2-3 secondary keywords, end with the CTA phrase as a call to action.
- alt_text: <=250 chars, LITERAL visual description of what's in the image, include primary keyword once, NOT marketing copy.
- hashtags: 4-6, lowercase, no spaces, include the primary keyword as a hashtag plus secondaries; no # in the strings.
- cta: chosen from the intent-matched pool ONLY.
- intent: one of informational|tool|list|commercial.
- template_id: the single best-fitting visual template for THIS brief's specific content angle, chosen from the template catalog given in the user message (use the id exactly as written). Judge fit by what the brief is actually about, not by its style label -- e.g. a brief that corrects a common misconception belongs in myth_vs_fact regardless of which style tag it also carries.
- image_prompt: a SHORT description of ONLY the middle visual content specific to this brief (subject matter and mood) -- the chosen template supplies its own composition, typography, palette, and border/URL-bar automatically, so do not describe layout, frame, or text placement yourself.
The briefs array in your JSON response MUST contain EXACTLY the requested number of items -- never fewer. If you run low on genuinely distinct angles, vary style, intent, or template_id more aggressively rather than returning an incomplete array.
If the user message includes a "WHAT'S CURRENTLY WORKING" competitive-research section, treat it as inspiration only for title/description angles — never copy a competitor's title or description verbatim.`;
      const user = `Create ${data.count} unique Pinterest pin briefs for this page. You MUST return exactly ${data.count} items in the briefs array -- no fewer. Use each style once from this list where possible: ${JSON.stringify(chosenStyles)}.

Return JSON: { briefs: [{ style, template_id, intent, title, description, hashtags: [], alt_text, cta, image_prompt }] }.

CTA & INTENT RULES:
${ctaGuidance}

VISUAL TEMPLATE CATALOG -- pick the single best-fitting template_id per brief from this exact list (id on the left, use it verbatim):
${shapeCatalog}

Vary template_id across the batch where the content genuinely supports different templates -- don't collapse every brief onto the same one or two templates if the page's content angles are diverse enough to justify more variety.

${brandBlock}

Page: ${page.url}
Topic: ${analysis.topic ?? ""}
Primary keyword: ${analysis.primary_keyword}
Secondary: ${JSON.stringify(analysis.secondary_keywords ?? [])}
Audience: ${analysis.audience ?? ""}
Category: ${analysis.category ?? ""}${competitiveBlock}`;

      let resp = await openaiJSON<BriefsResp>({ apiKey: cfg.api_key, model: "gpt-4o-mini", system, user });

      // The real fix: don't trust the prompt instruction alone. If the
      // model returned fewer than requested, retry ONCE with an amended
      // prompt that states exactly how short the first attempt was. If
      // still short after the retry, accept what we have rather than
      // looping indefinitely or failing the whole batch -- but report
      // the shortfall honestly in the return value instead of silently
      // persisting fewer briefs than the user asked for (see `requested`
      // vs `created` below, and the toast update in pages.$id.tsx).
      if (resp.briefs.length < data.count) {
        const shortBy = data.count - resp.briefs.length;
        const retryUser = `${user}

IMPORTANT -- RETRY: your previous response returned only ${resp.briefs.length} of the required ${data.count} items (${shortBy} short). This time you MUST return exactly ${data.count} complete items in the briefs array. Do not stop early, and do not omit items for being "similar enough" to earlier ones -- vary style, intent, and template_id further if needed to reach the full count.`;
        const retryResp = await openaiJSON<BriefsResp>({ apiKey: cfg.api_key, model: "gpt-4o-mini", system, user: retryUser });
        resp = retryResp;
      }

      const rows = resp.briefs.slice(0, data.count).map((b) => {
        // Defensive fallback only: an LLM occasionally returns a
        // template_id outside the given catalog (typo, omission, older
        // cached response shape). Falls back to the narrower style-label
        // regex rather than crashing the batch -- this is a safety net,
        // not a routing mechanism. Normal path always uses the
        // classifier's own choice.
        const templateId = validTemplateIds.has(b.template_id)
          ? (b.template_id as TemplateId)
          : resolveTemplateId(b.style);
        return {
        user_id: context.userId,
        page_id: page.id,
        style: b.style,
        template_id: templateId,
        intent: (["informational", "tool", "list", "commercial"].includes(b.intent) ? b.intent : defaultIntent),
        title: b.title,
        description: b.description,
        hashtags: b.hashtags ?? [],
        alt_text: b.alt_text ?? null,
        cta: b.cta ?? null,
        image_prompt: buildThemedPinPrompt({
          title: b.title,
          cta: b.cta,
          templateId,
          topic: analysis.topic,
          primaryKeyword: analysis.primary_keyword,
          brandHost,
          brandColors,
          brandFont,
          vertical,
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
        };
      });
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
      // Report both numbers -- created can legitimately be less than
      // requested even after the retry above (rare, but the retry is a
      // best-effort, not a guarantee). Callers/UI must not assume
      // created === requested silently; pages.$id.tsx surfaces this
      // explicitly in its toast.
      return { requested: data.count, created: inserted!.length };
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

// Was hardcoded to 8, well under realistic batch sizes (default 10,
// max 30 -- see generateBriefs' count validator) -- meant a single
// worker/render-images click could never clear a normal-sized batch in
// one pass even when nothing was actually wrong. Raised to comfortably
// cover a full max-size batch in one query; the page-scoped render flow
// additionally loops passes until the queue is drained (see
// renderImagesForPage callers in pages.$id.tsx), so this number just
// needs to be a reasonable per-pass size, not an absolute ceiling.
const DEFAULT_IMAGE_WORKER_LIMIT = 20;

export const runImageWorker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { processImageQueueForUser } = await import("./image-worker.server");
    return await processImageQueueForUser(context.userId, DEFAULT_IMAGE_WORKER_LIMIT);
  });

export const renderImagesForPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { pageId: string; limit?: number }) =>
    z.object({ pageId: z.string().uuid(), limit: z.number().int().min(1).max(30).default(DEFAULT_IMAGE_WORKER_LIMIT) }).parse(i),
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
