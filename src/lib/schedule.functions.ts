import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listScheduled = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("scheduled_pins")
      .select("id, scheduled_at, status, pinterest_pin_id, last_error, brief_id, board_id, image_id, pin_briefs(title, description, hashtags, alt_text, cta, page_id, pages(url, title)), boards(name, pinterest_board_id), pin_images(storage_path, width, height)")
      .order("scheduled_at", { ascending: true })
      .limit(500);
    if (error) throw error;
    // Resolve signed image URLs so the detail view can render them.
    const paths = Array.from(new Set((data ?? []).map((r) => r.pin_images?.storage_path).filter(Boolean) as string[]));
    const urlMap = new Map<string, string>();
    await Promise.all(paths.map(async (p) => {
      const { data: s } = await context.supabase.storage.from("pins").createSignedUrl(p, 3600);
      if (s?.signedUrl) urlMap.set(p, s.signedUrl);
    }));
    return (data ?? []).map((r) => ({ ...r, image_url: r.pin_images?.storage_path ? urlMap.get(r.pin_images.storage_path) ?? null : null }));
  });

// Pinterest anti-ban limits — conservative defaults per account.
// Keep tight so a fresh/warming account stays under the automated-spam radar.
const SAFETY = {
  maxPerAccountPerDay: 25,      // account-wide daily cap
  maxPerBoardPerDay: 10,        // board-level daily cap
  maxSameUrlPerAccountDay: 3,   // same destination URL, per day, all boards
  sameUrlBoardGapDays: 2,       // ≥ N days between reposts of same URL to same board
  sameUrlAccountGapHours: 4,    // ≥ N hours between any two pins to same URL
  minMinutesBetweenPins: 15,    // account-wide min gap between any two pins
} as const;

export const autoSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { days?: number; perDay?: number; hoursStart?: number; hoursEnd?: number }) =>
    z.object({
      days: z.number().int().min(1).max(60).default(14),
      perDay: z.number().int().min(1).max(SAFETY.maxPerAccountPerDay).default(18),
      hoursStart: z.number().int().min(0).max(23).default(8),
      hoursEnd: z.number().int().min(1).max(24).default(22),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Ready briefs with an image + page URL, oldest first so nothing starves.
    const { data: readyBriefs, error } = await supabaseAdmin
      .from("pin_briefs")
      .select("id, page_id, pages(url), pin_images(id, storage_path, prompt_hash)")
      .eq("user_id", context.userId)
      .eq("status", "ready")
      .order("created_at", { ascending: true })
      .limit(data.days * data.perDay * 2);
    if (error) throw error;
    if (!readyBriefs?.length) return { scheduled: 0, reason: "No ready briefs" };

    const { data: boards } = await supabaseAdmin.from("boards").select("id").eq("user_id", context.userId);
    if (!boards?.length) return { scheduled: 0, reason: "Add at least one board first" };

    // Existing scheduled/published pins in the planning window — enforce gaps against real history.
    const windowStart = new Date();
    const windowEnd = new Date(Date.now() + (data.days + SAFETY.sameUrlBoardGapDays) * 86400_000);
    const { data: existing } = await supabaseAdmin
      .from("scheduled_pins")
      .select("scheduled_at, board_id, brief_id, image_id, pin_briefs(page_id, pages(url))")
      .eq("user_id", context.userId)
      .in("status", ["draft", "queued", "publishing", "published", "exported"])
      .gte("scheduled_at", new Date(Date.now() - SAFETY.sameUrlBoardGapDays * 86400_000).toISOString())
      .lte("scheduled_at", windowEnd.toISOString());

    type Existing = {
      when: number; boardId: string | null;
      url: string; imageId: string | null;
    };
    const history: Existing[] = (existing ?? []).map((e) => ({
      when: new Date(e.scheduled_at).getTime(),
      boardId: e.board_id,
      url: ((e as { pin_briefs?: { pages?: { url?: string } } }).pin_briefs?.pages?.url) ?? "",
      imageId: e.image_id,
    }));
    const usedImageIds = new Set(history.map((h) => h.imageId).filter(Boolean) as string[]);

    const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
    const perDayAccount = new Map<string, number>();
    const perDayBoard = new Map<string, number>();          // key: `${day}|${boardId}`
    const perDayUrl = new Map<string, number>();            // key: `${day}|${url}`
    const lastByUrlBoard = new Map<string, number>();       // key: `${url}|${boardId}` -> ts
    const lastByUrl = new Map<string, number>();            // key: url -> ts
    const accountTimestamps: number[] = [];

    for (const h of history) {
      const dk = dayKey(h.when);
      perDayAccount.set(dk, (perDayAccount.get(dk) ?? 0) + 1);
      if (h.boardId) perDayBoard.set(`${dk}|${h.boardId}`, (perDayBoard.get(`${dk}|${h.boardId}`) ?? 0) + 1);
      if (h.url) {
        perDayUrl.set(`${dk}|${h.url}`, (perDayUrl.get(`${dk}|${h.url}`) ?? 0) + 1);
        const prevUrl = lastByUrl.get(h.url) ?? 0;
        if (h.when > prevUrl) lastByUrl.set(h.url, h.when);
        if (h.boardId) {
          const k = `${h.url}|${h.boardId}`;
          const prev = lastByUrlBoard.get(k) ?? 0;
          if (h.when > prev) lastByUrlBoard.set(k, h.when);
        }
      }
      accountTimestamps.push(h.when);
    }

    const scheduled: { id: string; scheduled_at: string; brief_id: string; image_id: string; board_id: string; user_id: string; status: "draft" }[] = [];

    // Candidate slot generator: iterates days/hours in order, jittering minute.
    const totalHours = Math.max(1, data.hoursEnd - data.hoursStart);
    const slotsPerDay = Math.min(data.perDay, SAFETY.maxPerAccountPerDay);
    const gapH = Math.max(1, Math.floor(totalHours / slotsPerDay));

    function nextSlot(day: number, slot: number): { when: number; day: number; slot: number } | null {
      let d = day, s = slot;
      while (d < data.days) {
        const at = new Date();
        at.setUTCDate(at.getUTCDate() + d);
        at.setUTCHours(data.hoursStart + s * gapH, Math.floor(Math.random() * 60), 0, 0);
        return { when: at.getTime(), day: d, slot: s };
      }
      return null;
    }

    let boardIdx = 0;
    let day = 0, slot = 0;

    for (const brief of readyBriefs) {
      const img = brief.pin_images?.[0];
      const pageUrl = (brief as { pages?: { url?: string } }).pages?.url ?? "";
      if (!img || !pageUrl) continue;
      // Never repost the exact same rendered image
      if (usedImageIds.has(img.id)) continue;

      let placed = false;
      let tries = 0;
      while (!placed && tries < data.days * slotsPerDay * boards.length) {
        tries++;
        const cand = nextSlot(day, slot);
        if (!cand) break;
        // advance cursor for next iteration
        slot++;
        if (slot >= slotsPerDay) { slot = 0; day++; }

        const when = cand.when;
        const dk = dayKey(when);

        // Account daily cap
        if ((perDayAccount.get(dk) ?? 0) >= SAFETY.maxPerAccountPerDay) continue;

        // Account-wide min-gap between any two pins
        if (accountTimestamps.some((t) => Math.abs(t - when) < SAFETY.minMinutesBetweenPins * 60_000)) continue;

        // Same-URL account daily + gap
        if ((perDayUrl.get(`${dk}|${pageUrl}`) ?? 0) >= SAFETY.maxSameUrlPerAccountDay) continue;
        const lastUrl = lastByUrl.get(pageUrl) ?? 0;
        if (lastUrl && Math.abs(when - lastUrl) < SAFETY.sameUrlAccountGapHours * 3600_000) continue;

        // Try boards round-robin, respecting per-board caps and same-URL/board gap
        let chosenBoard: string | null = null;
        for (let b = 0; b < boards.length; b++) {
          const board = boards[(boardIdx + b) % boards.length];
          if ((perDayBoard.get(`${dk}|${board.id}`) ?? 0) >= SAFETY.maxPerBoardPerDay) continue;
          const lastOnBoard = lastByUrlBoard.get(`${pageUrl}|${board.id}`) ?? 0;
          if (lastOnBoard && Math.abs(when - lastOnBoard) < SAFETY.sameUrlBoardGapDays * 86400_000) continue;
          chosenBoard = board.id;
          boardIdx = (boardIdx + b + 1) % boards.length;
          break;
        }
        if (!chosenBoard) continue;

        // Commit
        scheduled.push({
          id: crypto.randomUUID(),
          scheduled_at: new Date(when).toISOString(),
          brief_id: brief.id,
          image_id: img.id,
          board_id: chosenBoard,
          user_id: context.userId,
          status: "draft",
        });
        perDayAccount.set(dk, (perDayAccount.get(dk) ?? 0) + 1);
        perDayBoard.set(`${dk}|${chosenBoard}`, (perDayBoard.get(`${dk}|${chosenBoard}`) ?? 0) + 1);
        perDayUrl.set(`${dk}|${pageUrl}`, (perDayUrl.get(`${dk}|${pageUrl}`) ?? 0) + 1);
        lastByUrl.set(pageUrl, when);
        lastByUrlBoard.set(`${pageUrl}|${chosenBoard}`, when);
        accountTimestamps.push(when);
        usedImageIds.add(img.id);
        placed = true;
      }
    }

    if (!scheduled.length) return { scheduled: 0, reason: "No safe slot found within limits (per-day cap, per-board cap, or same-URL gap)" };
    const { error: insErr } = await supabaseAdmin.from("scheduled_pins").insert(scheduled);
    if (insErr) throw insErr;
    await supabaseAdmin.from("pin_briefs").update({ status: "scheduled" }).in("id", scheduled.map((s) => s.brief_id));
    return { scheduled: scheduled.length };
  });

// Manual bulk pipeline: analyze pending pages, generate briefs for analyzed
// pages that don't have any yet, and enqueue image jobs for briefs missing images.
// Throttled and capped so a single run stays well inside upstream rate limits.
export const runFullPipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { maxAnalyze?: number; maxBriefs?: number; maxImages?: number }) =>
    z.object({
      maxAnalyze: z.number().int().min(1).max(50).default(10),
      maxBriefs: z.number().int().min(1).max(50).default(10),
      maxImages: z.number().int().min(1).max(100).default(30),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { analyzePage } = await import("./pages.functions");
    const { generateBriefs } = await import("./briefs.functions");

    const result = { analyzed: 0, briefsFor: 0, imagesQueued: 0, errors: [] as string[] };

    // 1) Analyze pages missing last_analyzed_at
    const { data: toAnalyze } = await supabaseAdmin
      .from("pages")
      .select("id")
      .eq("user_id", context.userId)
      .eq("excluded", false)
      .is("last_analyzed_at", null)
      .limit(data.maxAnalyze);
    for (const p of toAnalyze ?? []) {
      try {
        await analyzePage({ data: { pageId: p.id } });
        result.analyzed++;
        await new Promise((r) => setTimeout(r, 400)); // throttle
      } catch (e) {
        result.errors.push(`analyze ${p.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 2) Generate briefs for analyzed pages that currently have zero briefs
    const { data: analyzedPages } = await supabaseAdmin
      .from("pages")
      .select("id, pin_briefs(id)")
      .eq("user_id", context.userId)
      .eq("excluded", false)
      .not("last_analyzed_at", "is", null)
      .limit(data.maxBriefs * 3);
    const needBriefs = (analyzedPages ?? [])
      .filter((p) => !((p as { pin_briefs?: unknown[] }).pin_briefs?.length))
      .slice(0, data.maxBriefs);
    for (const p of needBriefs) {
      try {
        await generateBriefs({ data: { pageId: p.id, count: 10 } });
        result.briefsFor++;
        await new Promise((r) => setTimeout(r, 400));
      } catch (e) {
        result.errors.push(`briefs ${p.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 3) Queue image jobs for briefs that have no image yet and no queued job
    const { data: briefsNoImage } = await supabaseAdmin
      .from("pin_briefs")
      .select("id, pin_images(id)")
      .eq("user_id", context.userId)
      .eq("status", "image_pending")
      .limit(data.maxImages * 2);
    const toQueue = (briefsNoImage ?? [])
      .filter((b) => !((b as { pin_images?: unknown[] }).pin_images?.length))
      .slice(0, data.maxImages);
    if (toQueue.length) {
      // Skip briefs that already have a queued/running job
      const { data: existingJobs } = await supabaseAdmin
        .from("jobs")
        .select("payload")
        .eq("user_id", context.userId)
        .eq("kind", "generate_image")
        .in("status", ["queued", "running"]);
      const already = new Set(
        (existingJobs ?? [])
          .map((j) => (j.payload as { brief_id?: string } | null)?.brief_id)
          .filter(Boolean) as string[],
      );
      const rows = toQueue
        .filter((b) => !already.has(b.id))
        .map((b) => ({
          user_id: context.userId,
          kind: "generate_image" as const,
          status: "queued" as const,
          payload: { brief_id: b.id },
          run_at: new Date().toISOString(),
          attempts: 0,
        }));
      if (rows.length) {
        const { error: jobErr } = await supabaseAdmin.from("jobs").insert(rows);
        if (jobErr) result.errors.push(`queue images: ${jobErr.message}`);
        else result.imagesQueued = rows.length;
      }
    }

    return result;
  });

export const runPublisher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { processDuePinsForUser } = await import("./publisher.server");
    return await processDuePinsForUser(context.userId);
  });

export const rescheduleOrCancel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; scheduled_at?: string; cancel?: boolean }) =>
    z.object({ id: z.string().uuid(), scheduled_at: z.string().optional(), cancel: z.boolean().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    if (data.cancel) {
      // Delete the scheduled pin entirely so it disappears from the calendar
      // and the underlying brief becomes eligible for auto-fill again.
      const { data: row } = await context.supabase
        .from("scheduled_pins")
        .select("brief_id, status")
        .eq("id", data.id)
        .maybeSingle();
      const { error } = await context.supabase.from("scheduled_pins").delete().eq("id", data.id);
      if (error) throw error;
      if (row?.brief_id && row.status !== "published") {
        await context.supabase.from("pin_briefs").update({ status: "ready" }).eq("id", row.brief_id);
      }
    } else if (data.scheduled_at) {
      const { error } = await context.supabase.from("scheduled_pins").update({ scheduled_at: data.scheduled_at }).eq("id", data.id);
      if (error) throw error;
    }
    return { ok: true };
  });

export const queuePins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { ids?: string[]; all?: boolean }) =>
    z.object({ ids: z.array(z.string().uuid()).optional(), all: z.boolean().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("scheduled_pins").update({ status: "queued" }).eq("status", "draft");
    if (data.ids?.length) q = q.in("id", data.ids);
    else if (!data.all) return { queued: 0 };
    const { data: rows, error } = await q.select("id");
    if (error) throw error;
    return { queued: rows?.length ?? 0 };
  });
