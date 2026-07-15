import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listBoards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("boards").select("*").order("name");
    if (error) throw error;
    return data ?? [];
  });

export const upsertBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: {
    id?: string;
    name: string;
    pinterest_board_id?: string;
    keywords?: string[];
    topics?: string[];
    site_ids?: string[];
    category?: string;
    description?: string;
  }) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1),
      pinterest_board_id: z.string().optional(),
      keywords: z.array(z.string()).default([]),
      topics: z.array(z.string()).default([]),
      site_ids: z.array(z.string().uuid()).default([]),
      category: z.string().optional(),
      description: z.string().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: out, error } = await context.supabase
      .from("boards").upsert({ ...data, user_id: context.userId }).select().single();
    if (error) throw error;
    return out;
  });

export const deleteBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("boards").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// Pull the user's Pinterest boards via API v5 and upsert them.
export const syncPinterestBoards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireIntegration, markIntegration } = await import("./integrations.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pin = await requireIntegration(context.userId, "pinterest");
    const token = pin.access_token;
    if (!token) throw new Error("Pinterest access token missing — reconnect Pinterest in Settings → Integrations.");

    try {
      // Paginate through /v5/boards
      type PBoard = {
        id: string; name: string; description?: string; pin_count?: number;
        media?: { image_cover_url?: string };
      };
      const boards: PBoard[] = [];
      let bookmark: string | undefined;
      let guard = 0;
      do {
        const url = new URL("https://api.pinterest.com/v5/boards");
        url.searchParams.set("page_size", "100");
        if (bookmark) url.searchParams.set("bookmark", bookmark);
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error(`Pinterest ${r.status}: ${await r.text()}`);
        const j = await r.json() as { items: PBoard[]; bookmark?: string };
        boards.push(...(j.items ?? []));
        bookmark = j.bookmark;
        guard++;
      } while (bookmark && guard < 20);

      // Upsert. Preserve existing site_ids / topics / keywords by using onConflict on the
      // unique index (user_id, pinterest_board_id) and only setting sync-owned fields.
      const now = new Date().toISOString();
      let created = 0;
      let updated = 0;
      for (const b of boards) {
        const { data: existing } = await supabaseAdmin
          .from("boards").select("id").eq("user_id", context.userId).eq("pinterest_board_id", b.id).maybeSingle();
        if (existing) {
          await supabaseAdmin.from("boards").update({
            name: b.name,
            description: b.description ?? null,
            image_url: b.media?.image_cover_url ?? null,
            pin_count: b.pin_count ?? 0,
            synced_at: now,
          }).eq("id", existing.id);
          updated++;
        } else {
          await supabaseAdmin.from("boards").insert({
            user_id: context.userId,
            name: b.name,
            pinterest_board_id: b.id,
            description: b.description ?? null,
            image_url: b.media?.image_cover_url ?? null,
            pin_count: b.pin_count ?? 0,
            synced_at: now,
          });
          created++;
        }
      }
      await markIntegration(context.userId, "pinterest", "ok");
      return { created, updated, total: boards.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markIntegration(context.userId, "pinterest", "error", msg);
      throw e;
    }
  });

// Score a set of terms against a board's text signals. Simple word-overlap match:
// tokenized keywords/topics/name/description, case-insensitive, whole-word.
function tokenize(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2),
  );
}

// Given a brief's page context (primary + secondary keywords + topic), suggest
// the best-matching board out of the user's boards. Returns ranked list.
export const suggestBoards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { pageId: string }) => z.object({ pageId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: page, error: pErr } = await context.supabase.from("pages")
      .select("id, site_id, analysis").eq("id", data.pageId).single();
    if (pErr || !page) throw pErr ?? new Error("Page not found");
    const analysis = (page.analysis ?? {}) as {
      topic?: string; primary_keyword?: string; secondary_keywords?: string[]; category?: string;
    };
    const terms = new Set<string>();
    tokenize(analysis.primary_keyword).forEach((t) => terms.add(t));
    tokenize(analysis.topic).forEach((t) => terms.add(t));
    tokenize(analysis.category).forEach((t) => terms.add(t));
    (analysis.secondary_keywords ?? []).forEach((k) => tokenize(k).forEach((t) => terms.add(t)));

    const { data: boards, error: bErr } = await context.supabase.from("boards").select("*");
    if (bErr) throw bErr;

    const scored = (boards ?? []).map((b) => {
      const boardTerms = new Set<string>();
      tokenize(b.name).forEach((t) => boardTerms.add(t));
      tokenize(b.description).forEach((t) => boardTerms.add(t));
      tokenize(b.category).forEach((t) => boardTerms.add(t));
      (b.keywords ?? []).forEach((k: string) => tokenize(k).forEach((t) => boardTerms.add(t)));
      (b.topics ?? []).forEach((k: string) => tokenize(k).forEach((t) => boardTerms.add(t)));
      let overlap = 0;
      for (const t of terms) if (boardTerms.has(t)) overlap++;
      // Site scoping: if the board is scoped to specific sites, penalize non-members.
      const siteBonus = !b.site_ids?.length || b.site_ids.includes(page.site_id) ? 0 : -100;
      return { board: b, score: overlap + siteBonus, overlap };
    }).sort((a, b) => b.score - a.score);

    return scored.filter((s) => s.score > -50);
  });
