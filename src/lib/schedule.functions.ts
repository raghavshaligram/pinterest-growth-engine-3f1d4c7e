import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { SAFETY, buildScheduleState, findSafeBoard, commitPlacement, type ExistingRow } from "@/lib/scheduling-safety.server";
import { getErrorMessage } from "@/lib/error-message";

type AppSupabaseClient = SupabaseClient<Database>;

// Guard for publishNow (below) -- the Dashboard/Schedule calendar's
// "Publish now", which always operates on an existing scheduled_pins
// row. That is the ONLY user-initiated publish path in the app: the
// Pins/Pages per-pin button schedules (see scheduleBrief) and never
// publishes, so publishing happens exclusively from the Schedule
// screen or the nightly cron, both of which funnel through
// processDuePinsForUser.
//
// Runs the daily-cap check FIRST, before touching the row at all, so a
// capped-out account gets a clear "daily limit reached" error instead
// of a confusing Pinterest-side failure or a silently re-queued pin
// that just sits there.
async function assertDailyCapNotExceeded(userId: string, supabase: AppSupabaseClient): Promise<void> {
  const { getEffectiveLimits } = await import("./publishing-profile.server");
  const effective = await getEffectiveLimits(userId);
  // Accounts that haven't completed the publishing-profile onboarding
  // step have no tier yet -- fall back to the same flat ceiling the
  // manual autoSchedule() tool uses, so this is still capped, never
  // unlimited, for a not-yet-onboarded account.
  const limit = effective?.limits.maxPerAccountPerDay ?? SAFETY.maxPerAccountPerDay;

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from("scheduled_pins")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "published")
    .gte("published_at", startOfDay.toISOString());
  if (error) throw error;
  const publishedToday = count ?? 0;
  if (publishedToday >= limit) {
    throw new Error(
      `Daily posting limit reached (${publishedToday}/${limit} pins published today) -- try again tomorrow, or raise your cap in Settings -> Integrations.`,
    );
  }
}

// The actual "publish this one scheduled_pins row right now" logic.
// See the comment on the exported publishNow below for why this checks
// and throws on failure instead of trusting processDuePinsForUser's
// always-resolving summary.
async function runPublishNow(
  scheduledPinId: string,
  userId: string,
  supabase: AppSupabaseClient,
): Promise<{ processed: number; ok: number; fail: number; exported: number; pinterestPinId: string | null }> {
  await assertDailyCapNotExceeded(userId, supabase);

  // Flip to queued and move scheduled_at to now so the publisher picks it up.
  const { error: upErr } = await supabase
    .from("scheduled_pins")
    .update({ status: "queued", scheduled_at: new Date().toISOString() })
    .eq("id", scheduledPinId)
    .in("status", ["draft", "queued", "failed"]);
  if (upErr) throw upErr;
  const { processDuePinsForUser } = await import("./publisher.server");
  const result = await processDuePinsForUser(userId, 1, scheduledPinId);

  const { data: row } = await supabase
    .from("scheduled_pins")
    .select("pinterest_pin_id, last_error")
    .eq("id", scheduledPinId)
    .maybeSingle();

  if (result.fail > 0) {
    throw new Error(row?.last_error || "Publish failed");
  }
  return { ...result, pinterestPinId: row?.pinterest_pin_id ?? null };
}

export const listScheduled = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i?: { siteId?: string | null }) =>
    z.object({ siteId: z.string().uuid().nullable().optional() }).parse(i ?? {}),
  )
  .handler(async ({ data: input, context }) => {
    // scheduled_pins has no direct site_id column. Filter by user_id here
    // (avoids massive .in(brief_id, [...]) URLs that overflow HTTP headers),
    // then narrow to the requested site in-memory using the pages join.
    let query = context.supabase
      .from("scheduled_pins")
      .select("id, scheduled_at, status, pinterest_pin_id, last_error, brief_id, board_id, image_id, pin_briefs(title, description, hashtags, alt_text, cta, page_id, pages(url, title, site_id)), boards(name, pinterest_board_id), pin_images(storage_path, width, height)")
      .eq("user_id", context.userId)
      .order("scheduled_at", { ascending: true })
      .limit(500);
    const { data, error } = await query;
    if (error) throw error;
    const filtered = input.siteId
      ? (data ?? []).filter((r) => {
          const siteId = (r as { pin_briefs?: { pages?: { site_id?: string } } })
            .pin_briefs?.pages?.site_id;
          return siteId === input.siteId;
        })
      : (data ?? []);
    // Resolve signed image URLs so the detail view can render them.
    const paths = Array.from(new Set(filtered.map((r) => r.pin_images?.storage_path).filter(Boolean) as string[]));
    const urlMap = new Map<string, string>();
    await Promise.all(paths.map(async (p) => {
      const { data: s } = await context.supabase.storage.from("pins").createSignedUrl(p, 3600);
      if (s?.signedUrl) urlMap.set(p, s.signedUrl);
    }));
    return filtered.map((r) => ({ ...r, image_url: r.pin_images?.storage_path ? urlMap.get(r.pin_images.storage_path) ?? null : null }));
  });


// ---------------------------------------------------------------------
// Shared scheduling planner
//
// ONE implementation of "which board may this pin go to, and which slot
// is free" -- used by both the bulk autoSchedule() tool and the
// single-pin scheduleBrief() action behind the Pins/Pages "Schedule"
// button.
//
// An earlier pickBoardForSite() helper reimplemented board eligibility
// separately for the single-pin case, which meant two code paths that
// could (and did) disagree about which boards belong to a site's
// Pinterest connection -- handing back a board owned by a different
// connection, which Pinterest then correctly 403s at publish time. Both
// user-facing scheduling paths now go through buildPlanner /
// findPlacement below.
//
// NOT yet shared: the nightly lane-aware materializer
// (routes/api/public/cron/materialize.ts) still carries its own copy of
// boardIdsForSite + slot walk, currently identical to this one but
// free to drift. Folding it in here is the obvious next step; it is out
// of scope for this change because it also owns tier-cap resolution.
// ---------------------------------------------------------------------

// `slotsPerDay` is grid RESOLUTION -- how finely the day is probed for a
// free time -- and is deliberately independent of the per-day caps in
// `limits`. autoSchedule sets it to the cadence the user asked for
// (one probe per pin it intends to place); the single-pin path sets it
// much finer, so it can find a gap BETWEEN pins an earlier bulk run
// already booked. The account/board/page caps are what actually limit
// volume; a fine grid just means "check more possible times".
export type PlannerWindow = { days: number; slotsPerDay: number; hoursStart: number; hoursEnd: number };

type Planner = {
  state: ReturnType<typeof buildScheduleState>;
  limits: typeof SAFETY;
  slotsPerDay: number;
  days: number;
  // Boards this site's Pinterest connection may publish to, scoped-first
  // then universal (see the ordering note inside).
  boardIdsForSite: (siteId: string | null) => string[];
  // Stable key for a site's board pool, so per-pool round-robin cursors
  // don't collide across sites sharing one connection.
  boardPoolKey: (siteId: string | null) => string;
  // Absolute ms timestamp for the (day, slot) coordinate, or null past
  // the end of the planning window.
  slotAt: (day: number, slot: number) => number | null;
};

// Loads boards, the site -> Pinterest-connection map, and the existing
// scheduled/published history in the planning window, and returns the
// planner both callers walk. Returns a reason instead of throwing for
// the two "you haven't set this up yet" cases, so autoSchedule can
// surface them as a no-op result and scheduleBrief as an error.
async function buildPlanner(
  userId: string,
  window: PlannerWindow,
  opts: { perPageCap: number },
): Promise<{ ok: true; planner: Planner } | { ok: false; reason: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: boards } = await supabaseAdmin
    .from("boards").select("id, pinterest_connection_id, pinterest_board_id").eq("user_id", userId);
  if (!boards?.length) return { ok: false, reason: "Add at least one board first" };


  // Map each site to the Pinterest connection it actually publishes
  // through, so board selection is scoped the same way
  // publisher.server.ts already scopes token resolution at publish time.
  const { data: sitesForConn } = await supabaseAdmin
    .from("sites").select("id, pinterest_connection_id").eq("user_id", userId);
  const siteConnectionMap = new Map<string, string | null>(
    (sitesForConn ?? []).map((s) => [s.id, (s as { pinterest_connection_id: string | null }).pinterest_connection_id]),
  );

  // Untagged boards -- added via upsertBoard ("Add board manually" on the
  // Boards page, which never sets pinterest_connection_id and lets the
  // Pinterest board id be typed in by hand), or synced before that column
  // existed.
  //
  // These used to count as usable by ANY site, on a "no assignment =
  // universal" convention. That convention has no way to be true: an
  // untagged board carrying a real pinterest_board_id came from SOME
  // Pinterest account, and nothing recorded which. Publishing resolves
  // the token from the site's own connection
  // (getPinterestConnectionForSite) and the board id from
  // boards.pinterest_board_id; if those are different accounts,
  // Pinterest answers the pin-create with
  //   403 {"code":29,"message":"You are not permitted to access that resource."}
  //
  // Counting connections is NOT a sufficient guard, which a first
  // attempt at this got wrong. A board id typed in by hand can come from
  // anywhere -- most obviously the user's real Pinterest account while
  // their only connection is a Sandbox one, since sandbox and production
  // are separate namespaces with non-interchangeable tokens (see
  // pinterest-environment.ts). "Only one connection" therefore does not
  // imply "untagged boards belong to it".
  //
  // So the rule is possession of proof, not absence of contradiction: a
  // board is eligible for a mapped site only if it is tagged with that
  // exact connection, or it has no pinterest_board_id at all and so is
  // never sent to Pinterest's API (webhook mode uses it; api mode
  // already fails fast on it -- see publisher.server.ts).
  //
  // Legacy untagged boards have a one-click migration: syncPinterestBoards
  // re-tags on every sync, not just on insert.
  const universalBoardIds = boards
    .filter((b) => {
      const row = b as { pinterest_connection_id: string | null; pinterest_board_id: string | null };
      return !row.pinterest_connection_id && !row.pinterest_board_id;
    })
    .map((b) => b.id);
  const scopedCache = new Map<string, string[]>();
  const connectionForSite = (siteId: string | null): string | null =>
    siteId ? (siteConnectionMap.get(siteId) ?? null) : null;
  const boardIdsForSite = (siteId: string | null): string[] => {
    const connectionId = connectionForSite(siteId);
    if (!connectionId) return universalBoardIds;
    const cached = scopedCache.get(connectionId);
    if (cached) return cached;
    const scoped = boards
      .filter((b) => (b as { pinterest_connection_id: string | null }).pinterest_connection_id === connectionId)
      .map((b) => b.id);
    const combined = [...scoped, ...universalBoardIds];
    scopedCache.set(connectionId, combined);
    return combined;
  };
  const boardPoolKey = (siteId: string | null): string => connectionForSite(siteId) ?? "universal";

  // Existing scheduled/published pins around the planning window --
  // enforce gaps against real history, not just what this run planned.
  const windowEnd = new Date(Date.now() + (window.days + SAFETY.sameUrlBoardGapDays) * 86400_000);
  const { data: existing } = await supabaseAdmin
    .from("scheduled_pins")
    .select("scheduled_at, board_id, brief_id, image_id, pin_briefs(page_id, pages(url))")
    .eq("user_id", userId)
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

  // Spread the day's slots evenly (in minutes) across the window so
  // cadences like 20/day don't stack into a single hour. gapMin never
  // drops below the account-wide minimum gap -- probing finer than that
  // could only ever produce candidates findSafeBoard rejects anyway.
  const totalMinutes = Math.max(60, (window.hoursEnd - window.hoursStart) * 60);
  const slotsPerDay = Math.max(1, window.slotsPerDay);
  const gapMin = Math.max(SAFETY.minMinutesBetweenPins, Math.floor(totalMinutes / slotsPerDay));

  const slotAt = (day: number, slot: number): number | null => {
    if (day >= window.days) return null;
    const minuteOffset = slot * gapMin + Math.floor(Math.random() * Math.min(15, gapMin));
    const at = new Date();
    at.setUTCDate(at.getUTCDate() + day);
    at.setUTCHours(window.hoursStart, minuteOffset, 0, 0);
    return at.getTime();
  };

  return {
    ok: true,
    planner: {
      state: buildScheduleState(history),
      limits: { ...SAFETY, maxPerPagePerDay: opts.perPageCap },
      slotsPerDay,
      days: window.days,
      boardIdsForSite,
      boardPoolKey,
      slotAt,
    },
  };
}

// A (day, slot) walk position. Mutated in place as findPlacement
// consumes candidate slots, so a bulk run can carry one cursor across
// every brief and never retry a slot it already rejected.
type PlacementCursor = { day: number; slot: number };

// Walks candidate slots from `cursor` forward and returns the first
// (slot, board) pair that clears every safety gate, or null if the whole
// remaining window is exhausted. Does NOT commit -- the caller calls
// commitPlacement() once it decides to take the slot.
function findPlacement(
  planner: Planner,
  cursor: PlacementCursor,
  candidate: { pageId: string; pageUrl: string; boardIds: string[]; boardIdx: number; notBefore?: number },
): { when: number; boardId: string; nextBoardIdx: number } | null {
  const maxTries = planner.days * planner.slotsPerDay * Math.max(1, candidate.boardIds.length);
  for (let tries = 0; tries < maxTries; tries++) {
    const when = planner.slotAt(cursor.day, cursor.slot);
    if (when === null) return null;
    // Advance before evaluating, so a rejected slot is never re-tried.
    cursor.slot++;
    if (cursor.slot >= planner.slotsPerDay) { cursor.slot = 0; cursor.day++; }

    // Single-pin callers pass notBefore so "next available slot" can
    // never resolve to a time that has already passed today (which would
    // make the next publisher run fire it immediately).
    if (candidate.notBefore !== undefined && when < candidate.notBefore) continue;

    const found = findSafeBoard(planner.state, planner.limits, {
      when,
      pageId: candidate.pageId,
      pageUrl: candidate.pageUrl,
      boardIds: candidate.boardIds,
      boardIdx: candidate.boardIdx,
    });
    if (found) return { when, boardId: found.boardId, nextBoardIdx: found.nextBoardIdx };
  }
  return null;
}

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
    // pages(url, site_id) -- site_id is what resolves each brief's own
    // Pinterest connection below, so a board synced under a DIFFERENT
    // site's connection can never be assigned to it (see boardIdsForSite).
    const { data: readyBriefs, error } = await supabaseAdmin
      .from("pin_briefs")
      .select("id, page_id, pages(url, site_id), pin_images(id, storage_path, prompt_hash)")
      .eq("user_id", context.userId)
      .eq("status", "ready")
      .order("created_at", { ascending: true })
      .limit(data.days * data.perDay * 2);
    if (error) throw error;
    if (!readyBriefs?.length) return { scheduled: 0, reason: "No ready briefs" };

    // Round-robin cursor kept per eligible board set (keyed by connection,
    // "universal" for unconnected sites) rather than one shared index --
    // each site's own board pool spreads independently.
    const boardIdxBySite = new Map<string, number>();

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

    // If the caller wants more pins/day than the account cap allows per-page (1),
    // widen the per-page/day cap just enough that the target is reachable.
    // Example: 20/day across 15 pages -> allow up to 2 per page per day.
    const slotsPerDay = Math.min(data.perDay, SAFETY.maxPerAccountPerDay);
    const perPageCap = Math.max(SAFETY.maxPerPagePerDay, Math.ceil(slotsPerDay / pageCount));

    const built = await buildPlanner(
      context.userId,
      { days: data.days, slotsPerDay, hoursStart: data.hoursStart, hoursEnd: data.hoursEnd },
      { perPageCap },
    );
    if (!built.ok) return { scheduled: 0, reason: built.reason };
    const planner = built.planner;

    // One cursor for the whole run: each brief picks up where the last
    // one left off, so slots already rejected are never re-walked.
    const cursor: PlacementCursor = { day: 0, slot: 0 };

    for (const brief of ordered) {
      const img = brief.pin_images?.[0];
      const pageUrl = (brief as { pages?: { url?: string } }).pages?.url ?? "";
      const pageId = (brief as { page_id?: string }).page_id ?? "";
      const siteId = (brief as { pages?: { site_id?: string } }).pages?.site_id ?? null;
      if (!img || !pageUrl) continue;
      // Never repost the exact same rendered image
      if (planner.state.usedImageIds.has(img.id)) continue;

      const boardIds = planner.boardIdsForSite(siteId ?? null);
      if (!boardIds.length) continue; // this site's connection has no eligible boards yet
      const boardIdxKey = planner.boardPoolKey(siteId ?? null);
      const boardIdx = boardIdxBySite.get(boardIdxKey) ?? 0;

      const placement = findPlacement(planner, cursor, { pageId, pageUrl, boardIds, boardIdx });
      if (!placement) continue;

      scheduled.push({
        id: crypto.randomUUID(),
        scheduled_at: new Date(placement.when).toISOString(),
        brief_id: brief.id,
        image_id: img.id,
        board_id: placement.boardId,
        user_id: context.userId,
        status: "draft",
      });
      commitPlacement(planner.state, {
        when: placement.when, boardId: placement.boardId, pageId, pageUrl, imageId: img.id,
      });
      boardIdxBySite.set(boardIdxKey, placement.nextBoardIdx);
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
        result.errors.push(`analyze ${p.id}: ${getErrorMessage(e)}`);
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
        result.errors.push(`briefs ${p.id}: ${getErrorMessage(e)}`);
      }
    }

    // 3) Queue image jobs for briefs that have no image yet and no queued job.
    // Excludes briefs whose page has since been marked excluded -- this
    // step (unlike steps 1/2 above) queries pin_briefs directly rather
    // than starting from pages, so it needs its own exclusion check or a
    // page excluded AFTER its briefs were generated would still get
    // images rendered for it indefinitely.
    const { data: excludedPages } = await supabaseAdmin
      .from("pages").select("id").eq("user_id", context.userId).eq("excluded", true);
    const excludedPageIds = new Set((excludedPages ?? []).map((p) => p.id));
    const { data: briefsNoImage } = await supabaseAdmin
      .from("pin_briefs")
      .select("id, page_id, pin_images(id)")
      .eq("user_id", context.userId)
      .eq("status", "image_pending")
      .limit(data.maxImages * 2);
    const toQueue = (briefsNoImage ?? [])
      .filter((b) => !((b as { pin_images?: unknown[] }).pin_images?.length) && !excludedPageIds.has(b.page_id))
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
//
// processDuePinsForUser catches every per-pin failure internally and
// ALWAYS resolves (never rejects) with a { processed, ok, fail } summary
// -- correct for its other caller, the nightly batch cron (runPublisher),
// where one bad pin must never abort the rest of the batch. But this is
// the single-pin, user-initiated "Publish now" call site: the client
// mutation's onSuccess/onError split only works if a real failure
// actually rejects the promise, so runPublishNow (above) checks the
// summary itself and throws when the one pin it asked for didn't
// actually publish -- surfacing the real error scheduled_pins.last_error
// already recorded, rather than letting a resolved-but-failed result
// read as success. Also runs the daily-cap check (see
// assertDailyCapNotExceeded) before touching anything -- this button
// previously bypassed the cap entirely, unlike autoSchedule and the
// nightly materializer.
//
// This is the app's only user-initiated publish, and it lives on the
// Schedule screen (and the Dashboard's calendar tiles, which are the
// same PinDetailDialog). The Pins and Pages views schedule instead --
// see scheduleBrief below.
export const publishNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    return runPublishNow(data.id, context.userId, context.supabase);
  });

// Planning window for the single-pin "Schedule" action.
//
// Same 9am-9pm posting window the Schedule screen's auto-fill uses, so a
// pin booked here lands at the same kind of time. Two deliberate
// differences from a bulk run:
//
// - slotsPerDay is the FINEST useful grid (one probe per
//   minMinutesBetweenPins across the window) rather than a cadence. A
//   bulk run's grid is coarse -- "Auto-fill next 14 days" probes 5 times
//   a day -- and after such a run every one of those positions is
//   occupied. Probing on the same coarse grid would collide with an
//   existing pin every time and the button would report "no safe slot"
//   on a calendar with hours of genuinely free space. The caps below,
//   not the grid, are what limit volume.
// - days is longer than the bulk default. perPageCap stays at the strict
//   SAFETY value (1/page/day) -- autoSchedule widens it only so a bulk
//   run can hit a user-requested volume target, which means nothing for
//   one pin -- so a page that already has a pin on every day of a
//   14-day auto-fill needs somewhere further out to land.
const SINGLE_PIN_WINDOW: PlannerWindow = {
  days: 30,
  slotsPerDay: Math.floor((21 - 9) * 60 / SAFETY.minMinutesBetweenPins),
  hoursStart: 9,
  hoursEnd: 21,
};

// "Schedule" for the Pins and Pages views.
//
// Books exactly one pin into the next available safe slot and stops
// there. It does NOT publish: publishing is the Schedule screen's job
// (publishNow above) and the nightly cron's. That separation is the
// whole point of this action -- the button used to publish immediately,
// which meant a pin could go live from a screen that shows no calendar,
// no slot, and no cap context.
//
// Board assignment and slot selection come from buildPlanner /
// findPlacement -- the exact same code autoSchedule runs -- so a pin
// booked here is indistinguishable from one the bulk tool created, and
// publishes down the identical path.
export const scheduleBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { briefId: string }) => z.object({ briefId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: brief, error: briefErr } = await supabaseAdmin
      .from("pin_briefs")
      .select("id, page_id, pin_images(id), pages(url, site_id)")
      .eq("id", data.briefId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (briefErr) throw briefErr;
    if (!brief) throw new Error("Pin not found");

    // Reuse any existing row for this brief rather than booking a second
    // slot for the same pin.
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("scheduled_pins")
      .select("id, status, scheduled_at, board_id, pinterest_pin_id, boards(name)")
      .eq("brief_id", data.briefId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingErr) throw existingErr;

    if (existing) {
      if (existing.status === "published") {
        throw new Error(
          `This pin was already published${existing.pinterest_pin_id ? ` (Pinterest id ${existing.pinterest_pin_id})` : ""}.`,
        );
      }
      if (existing.status === "publishing") {
        throw new Error("This pin is being published right now -- give it a moment and refresh.");
      }
      if (existing.status === "draft" || existing.status === "queued") {
        // Already on the calendar. Idempotent: hand back the slot it's
        // in so the UI can point at it, rather than double-booking or
        // silently moving a slot the user may have set deliberately.
        return {
          id: existing.id,
          scheduledAt: existing.scheduled_at,
          boardId: existing.board_id,
          boardName: (existing as { boards?: { name?: string } }).boards?.name ?? null,
          alreadyScheduled: true,
        };
      }
      // failed / canceled / exported -- fall through and re-slot this
      // same row into a fresh slot below.
    }

    const image = brief.pin_images?.[0];
    if (!image) throw new Error("This pin has no rendered image yet.");
    const siteId = (brief as { pages?: { site_id?: string } }).pages?.site_id ?? null;
    const pageUrl = (brief as { pages?: { url?: string } }).pages?.url ?? "";
    if (!pageUrl) throw new Error("This pin's source page has no URL.");

    const built = await buildPlanner(context.userId, SINGLE_PIN_WINDOW, {
      perPageCap: SAFETY.maxPerPagePerDay,
    });
    if (!built.ok) throw new Error(built.reason);
    const planner = built.planner;

    const boardIds = planner.boardIdsForSite(siteId);
    if (!boardIds.length) {
      // Deliberately specific: the most common cause is boards that were
      // added manually (so carry no connection) on an account with more
      // than one Pinterest connection, where guessing would mean handing
      // back a board the publishing token can't post to.
      throw new Error(
        "No board belongs to this site's Pinterest account yet — run \"Sync from Pinterest\" on the Boards page with that account selected. Boards added manually aren't tied to an account, so they can't be used when you have more than one connected.",
      );
    }

    // notBefore: now. Day 0's slots are anchored to today at hoursStart,
    // so without this a click after 09:00 UTC would book a slot that has
    // already passed. (A past-dated *draft* doesn't auto-publish --
    // processDuePinsForUser only picks up "queued" -- but it would show
    // up behind the current day on the calendar and go out the moment
    // anyone ran "Queue all drafts".)
    const placement = findPlacement(planner, { day: 0, slot: 0 }, {
      pageId: brief.page_id ?? "",
      pageUrl,
      boardIds,
      boardIdx: 0,
      notBefore: Date.now(),
    });
    if (!placement) {
      throw new Error(
        `No slot in the next ${SINGLE_PIN_WINDOW.days} days clears the posting-safety limits on this site's ${boardIds.length} eligible board${boardIds.length === 1 ? "" : "s"} (per-day cap, per-board cap, or same-URL repost gap) — this page has likely been pinned to all of them recently. Try again once some scheduled pins have gone out, or sync more boards.`,
      );
    }

    const scheduledAt = new Date(placement.when).toISOString();
    const rowId = existing?.id ?? crypto.randomUUID();
    if (existing) {
      // Status-guarded, and re-checked against the statuses we decided
      // were re-slottable when we read the row above. Between that read
      // and this write, "Publish now" on the Schedule screen can take a
      // "failed" row (runPublishNow accepts failed), publish it, and
      // write status/published_at/pinterest_pin_id. Without the guard
      // this update would clobber the record of a pin that really did go
      // out and re-arm it to publish the same image twice.
      const { data: updated, error: updErr } = await supabaseAdmin
        .from("scheduled_pins")
        .update({
          image_id: image.id,
          board_id: placement.boardId,
          scheduled_at: scheduledAt,
          status: "draft",
          last_error: null,
          published_at: null,
          pinterest_pin_id: null,
        })
        .eq("id", rowId)
        .eq("user_id", context.userId)
        .in("status", ["failed", "canceled", "exported"])
        .select("id");
      if (updErr) throw updErr;
      if (!updated?.length) {
        throw new Error("This pin changed while you were scheduling it -- refresh and try again.");
      }
    } else {
      const { error: insErr } = await supabaseAdmin.from("scheduled_pins").insert({
        id: rowId,
        user_id: context.userId,
        brief_id: data.briefId,
        image_id: image.id,
        board_id: placement.boardId,
        scheduled_at: scheduledAt,
        status: "draft",
      });
      if (insErr) throw insErr;
    }
    await supabaseAdmin.from("pin_briefs").update({ status: "scheduled" }).eq("id", data.briefId);

    // Board name is for the confirmation copy only -- the assignment
    // itself is already decided above.
    const { data: board } = await supabaseAdmin
      .from("boards").select("name").eq("id", placement.boardId).maybeSingle();

    return {
      id: rowId,
      scheduledAt,
      boardId: placement.boardId,
      boardName: board?.name ?? null,
      alreadyScheduled: false,
    };
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
