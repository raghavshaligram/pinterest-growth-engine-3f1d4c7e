import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SAFETY, buildScheduleState, findSafeBoard, commitPlacement, type ExistingRow } from "@/lib/scheduling-safety.server";

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

    const history: ExistingRow[] = (existing ?? []).map((e) => ({
      when: new Date(e.scheduled_at).getTime(),
      boardId: e.board_id,
      url: ((e as { pin_briefs?: { pages?: { url?: string } } }).pin_briefs?.pages?.url) ?? "",
      imageId: e.image_id,
      pageId: ((e as { pin_briefs?: { page_id?: string } }).pin_briefs?.page_id) ?? null,
    }));
    const state = buildScheduleState(history);

    const scheduled: { id: string; scheduled_at: string; brief_id: string; image_id: string; board_id: string; user_id: string; status: "draft" }[] = [];

    // Round-robin by page so early days pull from every page instead of
    // draining one page's briefs before moving to the next.
    const byPage = new Map<string, typeof readyBriefs>();
    for (const b of readyBriefs) {
      const pid = (b as { page_id?: string }).page_id ?? "";
      if (!byPage.has(pid)) byPage.set(pid, [] as unknown as typeof readyBriefs);
      byPage.get(pid)!.push(b);
    }
    const queues = [...byPage.values()];
    const pageCount = Math.max(1, queues.length);
    const ordered: typeof readyBriefs = [] as unknown as typeof readyBriefs;
    while (queues.some((q) => q.length)) {
      for (const q of queues) {
        const next = q.shift();
        if (next) ordered.push(next);
      }
    }

    // Candidate slot generator: spread `perDay` slots evenly (in minutes) across
    // the daily window so cadences like 20/day don't stack into a single hour.
    const totalMinutes = Math.max(60, (data.hoursEnd - data.hoursStart) * 60);
    const slotsPerDay = Math.min(data.perDay, SAFETY.maxPerAccountPerDay);
    const gapMin = Math.max(SAFETY.minMinutesBetweenPins, Math.floor(totalMinutes / slotsPerDay));
    // If the caller wants more pins/day than the account cap allows per-page (1),
    // widen the per-page/day cap just enough that the target is reachable.
    // Example: 20/day across 15 pages -> allow up to 2 per page per day.
    const perPageCap = Math.max(SAFETY.maxPerPagePerDay, Math.ceil(slotsPerDay / pageCount));
    const limits = { ...SAFETY, maxPerPagePerDay: perPageCap };

    function nextSlot(day: number, slot: number): { when: number; day: number; slot: number } | null {
      if (day >= data.days) return null;
      const minuteOffset = slot * gapMin + Math.floor(Math.random() * Math.min(15, gapMin));
      const at = new Date();
      at.setUTCDate(at.getUTCDate() + day);
      at.setUTCHours(data.hoursStart, minuteOffset, 0, 0);
      return { when: at.getTime(), day, slot };
    }

    let boardIdx = 0;
    let day = 0, slot = 0;
    const boardIds = boards.map((b) => b.id);

    for (const brief of ordered) {
      const img = brief.pin_images?.[0];
      const pageUrl = (brief as { pages?: { url?: string } }).pages?.url ?? "";
      const pageId = (brief as { page_id?: string }).page_id ?? "";
      if (!img || !pageUrl) continue;
      // Never repost the exact same rendered image
      if (state.usedImageIds.has(img.id)) continue;

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
        const found = findSafeBoard(state, limits, { when, pageId, pageUrl, boardIds, boardIdx });
        if (!found) continue;

        // Commit
        scheduled.push({
          id: crypto.randomUUID(),
          scheduled_at: new Date(when).toISOString(),
          brief_id: brief.id,
          image_id: img.id,
          board_id: found.boardId,
          user_id: context.userId,
          status: "draft",
        });
        commitPlacement(state, { when, boardId: found.boardId, pageId, pageUrl, imageId: img.id });
        boardIdx = found.nextBoardIdx;
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

// Publish a single scheduled pin immediately, ignoring its scheduled_at.
export const publishNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    // Flip to queued and move scheduled_at to now so the publisher picks it up.
    const { error: upErr } = await context.supabase
      .from("scheduled_pins")
      .update({ status: "queued", scheduled_at: new Date().toISOString() })
      .eq("id", data.id)
      .in("status", ["draft", "queued", "failed"]);
    if (upErr) throw upErr;
    const { processDuePinsForUser } = await import("./publisher.server");
    return await processDuePinsForUser(context.userId, 1, data.id);
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

// Mark a scheduled pin as manually posted (user pinned it themselves).
export const markPosted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; pinterestPinId?: string; unmark?: boolean }) =>
    z.object({
      id: z.string().uuid(),
      pinterestPinId: z.string().trim().max(64).optional(),
      unmark: z.boolean().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    if (data.unmark) {
      const { error } = await context.supabase
        .from("scheduled_pins")
        .update({ status: "queued", published_at: null, pinterest_pin_id: null })
        .eq("id", data.id);
      if (error) throw error;
      await context.supabase.from("publish_logs").insert({
        user_id: context.userId, scheduled_pin_id: data.id, level: "info",
        message: "Manual post mark cleared",
      });
      return { ok: true, unmarked: true };
    }
    const { error } = await context.supabase
      .from("scheduled_pins")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        pinterest_pin_id: data.pinterestPinId ?? null,
        last_error: null,
      })
      .eq("id", data.id);
    if (error) throw error;
    await context.supabase.from("publish_logs").insert({
      user_id: context.userId, scheduled_pin_id: data.id, level: "info",
      message: `Marked as manually posted${data.pinterestPinId ? ` (${data.pinterestPinId})` : ""}`,
    });
    return { ok: true };
  });

// Wipe every scheduled pin the user hasn't already sent to Pinterest, and flip
// the underlying briefs back to "ready" so auto-fill can pick them up again.
export const deleteAllScheduled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { includePublished?: boolean }) =>
    z.object({ includePublished: z.boolean().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const statuses = (data.includePublished
      ? ["draft", "queued", "publishing", "failed", "canceled", "exported", "published"]
      : ["draft", "queued", "failed", "canceled", "exported"]) as ("draft" | "queued" | "publishing" | "failed" | "canceled" | "exported" | "published")[];
    const { data: rows } = await context.supabase
      .from("scheduled_pins").select("id, brief_id, status")
      .in("status", statuses);
    const ids = (rows ?? []).map((r) => r.id);
    if (!ids.length) return { deleted: 0 };
    const briefIds = Array.from(new Set((rows ?? [])
      .filter((r) => r.status !== "published")
      .map((r) => r.brief_id).filter(Boolean) as string[]));
    const { error } = await context.supabase.from("scheduled_pins").delete().in("id", ids);
    if (error) throw error;
    if (briefIds.length) {
      await context.supabase.from("pin_briefs").update({ status: "ready" }).in("id", briefIds);
    }
    return { deleted: ids.length };
  });

// Swap the brief/image on a scheduled_pin to another ready brief.
// Keeps the same slot (scheduled_at, board, status) but points at a fresh pin.
export const replaceScheduledPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error: rowErr } = await supabaseAdmin
      .from("scheduled_pins")
      .select("id, status, brief_id, image_id, pin_briefs(page_id)")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (rowErr) throw rowErr;
    if (!row) throw new Error("Scheduled pin not found");
    if (row.status === "published" || row.status === "publishing") {
      throw new Error("Cannot replace a pin that has already published");
    }

    const currentPageId = (row as { pin_briefs?: { page_id?: string } }).pin_briefs?.page_id ?? null;

    // Images already used anywhere in the schedule — don't pick a duplicate.
    const { data: usedRows } = await supabaseAdmin
      .from("scheduled_pins")
      .select("image_id, brief_id")
      .eq("user_id", context.userId);
    const usedImages = new Set((usedRows ?? []).map((r) => r.image_id).filter(Boolean) as string[]);
    const usedBriefs = new Set((usedRows ?? []).map((r) => r.brief_id).filter(Boolean) as string[]);

    // Candidate: any ready brief with a rendered image that isn't in the schedule.
    const { data: candidates, error: candErr } = await supabaseAdmin
      .from("pin_briefs")
      .select("id, page_id, pin_images(id)")
      .eq("user_id", context.userId)
      .eq("status", "ready")
      .order("created_at", { ascending: true })
      .limit(200);
    if (candErr) throw candErr;

    const eligible = (candidates ?? [])
      .map((c) => ({ id: c.id, page_id: (c as { page_id?: string }).page_id ?? null, image_id: (c.pin_images?.[0]?.id) as string | undefined }))
      .filter((c) => c.image_id && !usedImages.has(c.image_id) && !usedBriefs.has(c.id) && c.id !== row.brief_id);

    // Prefer a brief from a different page than the current one.
    const pick = eligible.find((c) => c.page_id && c.page_id !== currentPageId) ?? eligible[0];
    if (!pick || !pick.image_id) throw new Error("No other ready pin available to swap in");

    const { error: updErr } = await supabaseAdmin
      .from("scheduled_pins")
      .update({ brief_id: pick.id, image_id: pick.image_id, last_error: null })
      .eq("id", row.id);
    if (updErr) throw updErr;

    await supabaseAdmin.from("pin_briefs").update({ status: "scheduled" }).eq("id", pick.id);
    if (row.brief_id) {
      await supabaseAdmin.from("pin_briefs").update({ status: "ready" }).eq("id", row.brief_id);
    }

    return { ok: true, briefId: pick.id };
  });

// Clones an existing scheduled/published pin's content (brief + image +
// board) into a new "draft" slot one day later at the same time-of-day.
// Used by the Dashboard/Schedule hover "Duplicate" action -- a plain
// insert, no safety-limit bypassing beyond what a human clicking "auto
// schedule" would already be able to do, and it never touches the row
// being duplicated.
export const duplicateScheduledPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error: rowErr } = await supabaseAdmin
      .from("scheduled_pins")
      .select("brief_id, image_id, board_id, scheduled_at")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (rowErr) throw rowErr;
    if (!row) throw new Error("Scheduled pin not found");

    const nextAt = new Date(new Date(row.scheduled_at).getTime() + 24 * 60 * 60 * 1000);
    const newId = crypto.randomUUID();
    const { error: insErr } = await supabaseAdmin.from("scheduled_pins").insert({
      id: newId,
      user_id: context.userId,
      brief_id: row.brief_id,
      image_id: row.image_id,
      board_id: row.board_id,
      scheduled_at: nextAt.toISOString(),
      status: "draft",
    });
    if (insErr) throw insErr;

    return { ok: true, id: newId, scheduledAt: nextAt.toISOString() };
  });

// Pulls a pin off the calendar without touching its content -- the
// opposite of a hard delete. scheduled_at is NOT NULL (a scheduled_pins
// row *is* a booking, there's no such thing as one with no time), so
// "clearing its slot" means removing the row itself; what actually gets
// preserved is the brief + rendered image, and the brief goes back to
// "ready" -- the exact status a freshly-rendered, never-yet-scheduled
// pin has. That's deliberate, not "draft": both the manual autoSchedule()
// tool and the nightly materializer only ever pick up pin_briefs with
// status "ready" (see schedule.functions.ts:autoSchedule and
// cron/materialize.ts), so setting it to "draft" instead would silently
// stop this pin from ever being rescheduled automatically again.
export const unscheduleScheduledPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error: rowErr } = await context.supabase
      .from("scheduled_pins")
      .select("brief_id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (rowErr) throw rowErr;
    if (!row) throw new Error("Scheduled pin not found");
    if (row.status === "published" || row.status === "publishing") {
      throw new Error("Cannot unschedule a pin that has already published");
    }

    const { error: delErr } = await context.supabase.from("scheduled_pins").delete().eq("id", data.id);
    if (delErr) throw delErr;

    if (row.brief_id) {
      await context.supabase.from("pin_briefs").update({ status: "ready" }).eq("id", row.brief_id);
    }
    return { ok: true };
  });
