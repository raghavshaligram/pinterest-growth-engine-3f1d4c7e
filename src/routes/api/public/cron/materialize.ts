// Nightly lane-aware auto-fill. Unlike autoSchedule() (schedule.functions.ts,
// user-triggered, plans N days at an explicit perDay the user chose), this
// runs unattended once a night per user and tops up the schedule up to
// their account_publishing_profiles.reconciled_tier's daily cap — no more.
//
// Safety: shares buildScheduleState/findSafeBoard/commitPlacement with
// autoSchedule (see scheduling-safety.server.ts), so it always evaluates
// gaps against the *same* real scheduled_pins history autoSchedule does.
// It only ever INSERTs new "draft" rows into slots that pass those gates —
// it never updates or deletes an existing scheduled_pins row, so anything
// already queued or published is untouched. Because it re-derives
// "remaining capacity" from live DB state every run, running it twice in
// a row (or a manual autoSchedule run right before/after it) just fills
// whatever gap is left rather than double-booking; once a day/board/tier
// cap is hit it becomes a safe no-op for that slot.
import { createFileRoute } from "@tanstack/react-router";
import type { ExistingRow } from "@/lib/scheduling-safety.server";
import type { Lane } from "@/lib/lane.server";
import { boardCanPublishVia, siteSkipMessage, type BoardOwnership, type SiteSkipReason } from "@/lib/board-eligibility";
import { siteDisplayName } from "@/lib/site-mapping";

const HORIZON_DAYS = 3;
const HOURS_START = 8;
const HOURS_END = 22;

export const Route = createFileRoute("/api/public/cron/materialize")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth, forEachUser } = await import("@/lib/cron.server");
        const bad = checkCronAuth(request);
        if (bad) return bad;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { getEffectiveLimits } = await import("@/lib/publishing-profile.server");
        const { buildScheduleState, findSafeBoard, commitPlacement } =
          await import("@/lib/scheduling-safety.server");
        const { classifyLane, lanePriority } = await import("@/lib/lane.server");

        const out = await forEachUser(async (uid) => {
          // Gate: only users who've completed the onboarding prompt get
          // automated nightly scheduling at all. getEffectiveLimits also
          // folds in current_daily_cap/manual_cap on top of the tier's
          // base SafetyLimits (see publishing-profile.server.ts) — this
          // is the one place both the reconciled tier AND the
          // weekly-adjusted/manual cap actually take effect.
          const effective = await getEffectiveLimits(uid);
          if (!effective) return { scheduled: 0, reason: "not onboarded" };
          const { tier, limits } = effective;

          const { data: boards } = await supabaseAdmin
            .from("boards").select("id, pinterest_connection_id, pinterest_board_id").eq("user_id", uid);
          if (!boards?.length) return { scheduled: 0, reason: "no boards" };

          // Map each site to the Pinterest connection it actually
          // publishes through, so board selection below is scoped the
          // same way publisher.server.ts already scopes token resolution
          // at publish time -- a board synced under one site's connection
          // must never be assignable to a different site's brief.
          const { data: sitesForConn } = await supabaseAdmin
            .from("sites").select("id, pinterest_connection_id, brand_name, url").eq("user_id", uid);
          const siteConnectionMap = new Map<string, string | null>(
            (sitesForConn ?? []).map((s) => [s.id, (s as { pinterest_connection_id: string | null }).pinterest_connection_id]),
          );
          // Same predicate the planner and the publish guard use — see
          // lib/board-eligibility.ts. This copy of the selection loop
          // exists only because the materializer also owns tier-cap
          // resolution; the eligibility rule itself is no longer
          // duplicated.
          const universalBoardIds = boards
            .filter((b) => boardCanPublishVia(b as BoardOwnership, null))
            .map((b) => b.id);
          const scopedBoardIdsCache = new Map<string, string[]>();
          function boardIdsForSite(siteId: string | null): string[] {
            const connectionId = siteId ? (siteConnectionMap.get(siteId) ?? null) : null;
            if (!connectionId) return universalBoardIds;
            const cached = scopedBoardIdsCache.get(connectionId);
            if (cached) return cached;
            const scoped = boards
              .filter((b) => (b as BoardOwnership).pinterest_connection_id === connectionId)
              .map((b) => b.id);
            const combined = [...scoped, ...universalBoardIds];
            scopedBoardIdsCache.set(connectionId, combined);
            return combined;
          }
          // Round-robin cursor kept per eligible board set (keyed by
          // connection, "universal" for unconnected sites) rather than
          // one shared index -- each site's own board pool spreads
          // independently.
          const boardIdxBySite = new Map<string, number>();

          // First skip reason per site, same precedence as autoSchedule:
          // a configuration problem outranks a transient capacity one.
          const skips = new Map<string, { siteName: string; reason: SiteSkipReason; connectionId: string | null }>();
          const siteMeta = new Map<string, { name: string; connectionId: string | null }>(
            (sitesForConn ?? []).map((r) => {
              const row = r as { id: string; brand_name: string | null; url: string | null; pinterest_connection_id: string | null };
              return [row.id, { name: siteDisplayName(row), connectionId: row.pinterest_connection_id }];
            }),
          );
          function noteSkip(siteId: string | null, reason: SiteSkipReason) {
            const key = siteId ?? "unmapped";
            if (skips.has(key)) return;
            const meta = (siteId ? siteMeta.get(siteId) : undefined) ?? { name: "This site", connectionId: null };
            skips.set(key, { siteName: meta.name, reason, connectionId: meta.connectionId });
          }

          type ReadyBrief = {
            id: string;
            page_id: string | null;
            pages: { url?: string; site_id?: string; created_at?: string; last_crawled_at?: string | null } | null;
            pin_images: { id: string }[] | null;
          };
          const { data: readyBriefs } = await supabaseAdmin
            .from("pin_briefs")
            .select("id, page_id, pages(url, site_id, created_at, last_crawled_at), pin_images(id, storage_path, prompt_hash)")
            .eq("user_id", uid)
            .eq("status", "ready")
            .order("created_at", { ascending: true })
            .limit(limits.maxPerAccountPerDay * HORIZON_DAYS * 3) as { data: ReadyBrief[] | null };
          if (!readyBriefs?.length) return { scheduled: 0, reason: "no ready briefs" };

          const windowEnd = new Date(Date.now() + (HORIZON_DAYS + limits.sameUrlBoardGapDays) * 86_400_000);
          const { data: existing } = await supabaseAdmin
            .from("scheduled_pins")
            .select("scheduled_at, board_id, brief_id, image_id, pin_briefs(page_id, pages(url))")
            .eq("user_id", uid)
            .in("status", ["draft", "queued", "publishing", "published", "exported"])
            .gte("scheduled_at", new Date(Date.now() - limits.sameUrlBoardGapDays * 86_400_000).toISOString())
            .lte("scheduled_at", windowEnd.toISOString());

          const history: ExistingRow[] = (existing ?? []).map((e) => ({
            when: new Date(e.scheduled_at).getTime(),
            boardId: e.board_id,
            url: ((e as { pin_briefs?: { pages?: { url?: string } } }).pin_briefs?.pages?.url) ?? "",
            imageId: e.image_id,
            pageId: ((e as { pin_briefs?: { page_id?: string } }).pin_briefs?.page_id) ?? null,
          }));
          const state = buildScheduleState(history);

          // Group by lane, then round-robin by page within each lane so a
          // single fresh page doesn't eat the whole burst allowance.
          const byLane: Record<Lane, Map<string, ReadyBrief[]>> = {
            fresh: new Map(), deep_drip: new Map(), evergreen: new Map(),
          };
          for (const b of readyBriefs) {
            const lane = classifyLane(b.pages ?? {});
            const pid = b.page_id ?? "";
            const m = byLane[lane];
            if (!m.has(pid)) m.set(pid, []);
            m.get(pid)!.push(b);
          }
          const lanesInOrder = (Object.keys(byLane) as Lane[]).sort((a, b) => lanePriority(a) - lanePriority(b));
          const ordered: ReadyBrief[] = [];
          for (const lane of lanesInOrder) {
            const queues = [...byLane[lane].values()];
            while (queues.some((q) => q.length)) {
              for (const q of queues) {
                const next = q.shift();
                if (next) ordered.push(next);
              }
            }
          }

          const totalMinutes = Math.max(60, (HOURS_END - HOURS_START) * 60);
          const slotsPerDay = limits.maxPerAccountPerDay;
          const gapMin = Math.max(limits.minMinutesBetweenPins, Math.floor(totalMinutes / slotsPerDay));

          function nextSlot(day: number, slot: number): number | null {
            if (day >= HORIZON_DAYS) return null;
            const minuteOffset = slot * gapMin + Math.floor(Math.random() * Math.min(15, gapMin));
            const at = new Date();
            at.setUTCDate(at.getUTCDate() + day);
            at.setUTCHours(HOURS_START, minuteOffset, 0, 0);
            return at.getTime();
          }

          const scheduled: { id: string; scheduled_at: string; brief_id: string; image_id: string; board_id: string; user_id: string; status: "draft" }[] = [];
          const laneCounts: Record<Lane, number> = { fresh: 0, deep_drip: 0, evergreen: 0 };
          let day = 0, slot = 0;

          for (const brief of ordered) {
            const img = brief.pin_images?.[0];
            const pageUrl = brief.pages?.url ?? "";
            const pageId = brief.page_id ?? "";
            const siteId = brief.pages?.site_id ?? null;
            if (!img || !pageUrl) continue;
            if (state.usedImageIds.has(img.id)) continue;

            const boardIds = boardIdsForSite(siteId);
            if (!boardIds.length) {
              // Recorded and logged, not swallowed. Unattended runs are
              // exactly where a silently-skipped site stays broken
              // longest -- nobody is watching a toast at 3am, so this
              // has to leave a trace the Logs page will show.
              noteSkip(siteId, "no-eligible-boards");
              continue;
            }
            const boardIdxKey = siteId ? (siteConnectionMap.get(siteId) ?? "universal") ?? "universal" : "universal";
            let boardIdx = boardIdxBySite.get(boardIdxKey) ?? 0;

            let placed = false;
            let tries = 0;
            while (!placed && tries < HORIZON_DAYS * slotsPerDay * boardIds.length) {
              tries++;
              const when = nextSlot(day, slot);
              if (when === null) break;
              slot++;
              if (slot >= slotsPerDay) { slot = 0; day++; }

              const found = findSafeBoard(state, limits, { when, pageId, pageUrl, boardIds, boardIdx });
              if (!found) continue;

              scheduled.push({
                id: crypto.randomUUID(),
                scheduled_at: new Date(when).toISOString(),
                brief_id: brief.id,
                image_id: img.id,
                board_id: found.boardId,
                user_id: uid,
                status: "draft",
              });
              commitPlacement(state, { when, boardId: found.boardId, pageId, pageUrl, imageId: img.id });
              boardIdx = found.nextBoardIdx;
              boardIdxBySite.set(boardIdxKey, boardIdx);
              laneCounts[classifyLane(brief.pages ?? {})]++;
              placed = true;
            }
            if (!placed) noteSkip(siteId, "no-safe-slot");
          }

          // Leave a trace for every skipped site. Unattended runs are
          // where a silently-skipped site stays broken longest -- there
          // is no toast at 3am -- so these go to publish_logs, which is
          // what the Logs page reads. scheduled_pin_id is nullable
          // precisely for account-level entries like this.
          const skipped = [...skips.values()];
          if (skipped.length) {
            await supabaseAdmin.from("publish_logs").insert(
              skipped.map((sk) => ({
                user_id: uid,
                scheduled_pin_id: null,
                level: sk.reason === "no-eligible-boards" ? "error" : "info",
                message: `Nightly auto-fill skipped a site — ${siteSkipMessage(sk.reason, sk.siteName)}`,
                payload: { reason: sk.reason, connection_id: sk.connectionId },
              })),
            );
          }

          if (!scheduled.length) {
            const blocking = skipped.find((sk) => sk.reason === "no-eligible-boards") ?? skipped[0];
            return {
              scheduled: 0,
              tier,
              reason: blocking ? siteSkipMessage(blocking.reason, blocking.siteName) : "no safe slot within tier caps",
              skipped,
            };
          }
          const { error: insErr } = await supabaseAdmin.from("scheduled_pins").insert(scheduled);
          if (insErr) throw insErr;
          await supabaseAdmin.from("pin_briefs").update({ status: "scheduled" }).in("id", scheduled.map((s) => s.brief_id));

          return { scheduled: scheduled.length, tier, laneCounts, skipped };
        });

        return Response.json(out);
      },
    },
  },
});
