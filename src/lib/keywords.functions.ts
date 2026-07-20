import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type TopPin = { url?: string; title?: string; description?: string; image?: string; board?: string; saves?: number };

export type SerpPatterns = {
  title_patterns: string[];
  themes: string[];
  high_performers: { title: string; saves: number | null }[];
  summary: string;
  generated_at: string;
};

// Summarize a keyword's scraped top pins into structured "what's working"
// patterns via OpenAI, and store them on the serp_snapshot row (the
// `patterns` column existed in the schema but was never populated until
// now). This is enrichment on top of the sweep, not core to it -- if the
// user hasn't configured OpenAI, or the summarization call fails, we log
// via markIntegration and move on rather than failing the whole sweep.
async function summarizeAndStorePatterns(userId: string, snapshotId: string, keyword: string, topPins: TopPin[]) {
  const { getIntegration, markIntegration } = await import("./integrations.server");
  const { openaiJSON } = await import("./openai.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const cfg = await getIntegration(userId, "openai");
  if (!cfg?.api_key) return; // optional enrichment -- no key configured, skip quietly

  const pinsForPrompt = topPins
    .filter((p) => p.title)
    .map((p) => ({ title: p.title, description: p.description?.slice(0, 300), saves: p.saves ?? null }));
  if (!pinsForPrompt.length) return;

  try {
    type PatternsResp = {
      title_patterns: string[];
      themes: string[];
      high_performers: { title: string; saves: number | null }[];
      summary: string;
    };
    const resp = await openaiJSON<PatternsResp>({
      apiKey: cfg.api_key,
      model: "gpt-4o-mini",
      system: `You are a Pinterest competitive-research analyst. You'll be given the top-ranking pins currently showing for a Pinterest search. Return strict JSON summarizing PATTERNS ACROSS them, not a description of any single pin:
- title_patterns: 3-6 short strings describing recurring TITLE FORMATS ("N ways to ___", "X vs Y comparisons", "question-format hooks", "before/after framing"). Describe the pattern, don't copy a title verbatim.
- themes: 3-6 short strings describing recurring THEMES/ANGLES in the descriptions.
- high_performers: up to 5 pins from the input whose saves count is notably high relative to the rest of the set — {title, saves}. If save counts are missing or not meaningfully different across pins, return an empty array rather than guessing.
- summary: one or two plain-English sentences on what's currently working for this keyword on Pinterest.`,
      user: `Keyword: ${keyword}\n\nTop pins currently ranking (title, description, saves):\n${JSON.stringify(pinsForPrompt)}`,
    });

    const patterns: SerpPatterns = { ...resp, generated_at: new Date().toISOString() };
    await supabaseAdmin.from("serp_snapshots").update({ patterns }).eq("id", snapshotId).eq("user_id", userId);
    await markIntegration(userId, "openai", "ok");
  } catch (e) {
    await markIntegration(userId, "openai", "error", e instanceof Error ? e.message : String(e));
  }
}

export const listKeywords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // serp_snapshots is keyed by free-text `keyword`, not a keyword_id FK
    // (multiple snapshot rows can exist per keyword, one per sweep run),
    // so there's no embeddable relationship to join here. Fetch the
    // lightweight (keyword, captured_at) columns for recent snapshots and
    // reduce to "most recent per keyword" in JS instead -- same pattern
    // used for dashboard.functions.ts's pins-by-board tally.
    const [{ data, error }, { data: snapRows }] = await Promise.all([
      context.supabase
        .from("keywords")
        .select("id, keyword, kind, tracked, page_id, pages(url, title)")
        .order("keyword")
        .limit(1000),
      context.supabase
        .from("serp_snapshots")
        .select("keyword, captured_at")
        .order("captured_at", { ascending: false })
        .limit(500),
    ]);
    if (error) throw error;
    const lastSweptMap = new Map<string, string>();
    for (const s of (snapRows ?? []) as { keyword: string; captured_at: string }[]) {
      if (!lastSweptMap.has(s.keyword)) lastSweptMap.set(s.keyword, s.captured_at);
    }
    return (data ?? []).map((k) => ({ ...k, lastSweptAt: lastSweptMap.get(k.keyword) ?? null }));
  });

// Most recent serp_snapshots row for one keyword -- fetched lazily when a
// Keywords-page row is expanded, rather than eagerly for every keyword
// (top_pins/patterns are the heavy columns; listKeywords above only pulls
// the lightweight captured_at timestamp).
export const getSerpSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { keyword: string }) => z.object({ keyword: z.string().min(1) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: snap, error } = await context.supabase
      .from("serp_snapshots")
      .select("id, keyword, captured_at, top_pins, patterns")
      .eq("keyword", data.keyword)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return snap ?? null;
  });

export const setKeywordTracked = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; tracked: boolean }) =>
    z.object({ id: z.string().uuid(), tracked: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("keywords").update({ tracked: data.tracked }).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const runSerpSweep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getIntegration, DEFAULT_APIFY_ACTOR, markIntegration } = await import("./integrations.server");
    const { runApifyActor } = await import("./apify.server");
    const cfg = await getIntegration(context.userId, "apify");
    if (!cfg) return { swept: 0, note: "Apify not configured" };
    const { data: kws } = await supabaseAdmin
      .from("keywords").select("keyword").eq("user_id", context.userId).eq("tracked", true).limit(20);
    if (!kws?.length) return { swept: 0, note: "No tracked keywords" };
    let swept = 0;
    for (const { keyword } of kws) {
      try {
        const items = await runApifyActor<{ pinUrl?: string; title?: string; description?: string; imageUrl?: string; boardName?: string; saves?: number }>({
          token: cfg.api_token,
          actorId: cfg.actor_id ?? DEFAULT_APIFY_ACTOR,
          input: { searches: [keyword], maxItems: 25 },
        });
        const top_pins = items.slice(0, 25).map((p) => ({
          url: p.pinUrl, title: p.title, description: p.description, image: p.imageUrl, board: p.boardName, saves: p.saves,
        }));
        const { data: snapshot } = await supabaseAdmin
          .from("serp_snapshots")
          .insert({ user_id: context.userId, keyword, top_pins })
          .select("id")
          .single();
        swept++;
        // Best-effort: summarize into `patterns` for brief generation to
        // use later. Failure here shouldn't fail the sweep itself -- the
        // snapshot's raw top_pins are already saved either way.
        if (snapshot?.id) {
          await summarizeAndStorePatterns(context.userId, snapshot.id, keyword, top_pins);
        }
      } catch (e) {
        await markIntegration(context.userId, "apify", "error", e instanceof Error ? e.message : String(e));
      }
    }
    await markIntegration(context.userId, "apify", "ok");
    return { swept };
  });
