import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// How many "published this week" pin thumbnails we pull signed URLs for.
// Only a handful render (the rest collapse into a "+N more" tile), but we
// fetch a small buffer past that in case some rows are missing a
// resolvable image.
const PUBLISHED_FETCH_LIMIT = 12;
const PUBLISHED_SHOW_LIMIT = 5;
const FALLBACK_SITE_COLOR = "#8A867C";

export const dashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i?: { siteId?: string | null }) =>
    z.object({ siteId: z.string().uuid().nullable().optional() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const s = context.supabase;
    const siteId = data.siteId ?? null;
    const scoped = siteId !== null;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // pin_briefs / pin_images / scheduled_pins / publish_logs don't carry
    // site_id directly, so scoping them to one site means resolving id
    // lists here rather than relying on multi-level embedded-filter dot
    // paths (a.b.c) we have no live PostgREST instance to verify against
    // in this environment. Each step below is a plain, safe query.
    let pageIds: string[] = [];
    let briefIds: string[] = [];
    if (scoped) {
      const { data: pageRows } = await s.from("pages").select("id").eq("site_id", siteId);
      pageIds = (pageRows ?? []).map((r: { id: string }) => r.id);
      if (pageIds.length > 0) {
        const { data: briefRows } = await s.from("pin_briefs").select("id").in("page_id", pageIds);
        briefIds = (briefRows ?? []).map((r: { id: string }) => r.id);
      }
    }

    // Small helper so each query below reads as "base query, optionally
    // narrowed to the resolved id list" instead of repeating an if/else
    // per query.
    function scopeBy<T extends { in: (col: string, vals: string[]) => T }>(q: T, col: string, ids: string[]): T {
      return scoped ? q.in(col, ids) : q;
    }

    const pagesTotalP = scoped
      ? Promise.resolve({ count: pageIds.length })
      : s.from("pages").select("id", { count: "estimated", head: true });
    const briefsTotalP = scopeBy(s.from("pin_briefs").select("id", { count: "estimated", head: true }), "page_id", pageIds);
    const imagesTotalP = scopeBy(s.from("pin_images").select("id", { count: "estimated", head: true }), "brief_id", briefIds);
    const scheduledQueuedP = scopeBy(
      s.from("scheduled_pins").select("id", { count: "estimated", head: true }).eq("status", "queued"),
      "brief_id",
      briefIds,
    );
    const publishedTotalP = scopeBy(
      s.from("scheduled_pins").select("id", { count: "estimated", head: true }).eq("status", "published"),
      "brief_id",
      briefIds,
    );
    const briefsBacklogP = scopeBy(
      s.from("pin_briefs").select("id", { count: "estimated", head: true }).in("status", ["draft", "image_pending"]),
      "page_id",
      pageIds,
    );
    const imagesBacklogP = scopeBy(
      s.from("pin_briefs").select("id", { count: "estimated", head: true }).eq("status", "ready"),
      "page_id",
      pageIds,
    );
    const integrationsP = s.from("integrations").select("provider, status");
    const lastCrawledBaseQ = s.from("pages").select("last_crawled_at").order("last_crawled_at", { ascending: false }).limit(1);
    const lastCrawledP = scoped ? lastCrawledBaseQ.eq("site_id", siteId) : lastCrawledBaseQ;
    const sitesColorP = s.from("sites").select("id, accent_color");
    const publishedRowsP = scopeBy(
      s
        .from("scheduled_pins")
        .select("id, published_at, pin_briefs(page_id, title, pages(site_id, title, url)), pin_images(storage_path)")
        .eq("status", "published")
        .gte("published_at", weekAgo)
        .order("published_at", { ascending: false })
        .limit(PUBLISHED_FETCH_LIMIT),
      "brief_id",
      briefIds,
    );

    const [
      pagesTotalRes,
      briefsTotalRes,
      imagesTotalRes,
      scheduledQueuedRes,
      publishedTotalRes,
      briefsBacklogRes,
      imagesBacklogRes,
      integrationsRes,
      lastCrawledRes,
      sitesColorRes,
      publishedRowsRes,
    ] = await Promise.all([
      pagesTotalP,
      briefsTotalP,
      imagesTotalP,
      scheduledQueuedP,
      publishedTotalP,
      briefsBacklogP,
      imagesBacklogP,
      integrationsP,
      lastCrawledP,
      sitesColorP,
      publishedRowsP,
    ]);

    // Recent activity: resolve which scheduled_pins ids are in scope (via
    // the same brief_id chain) before filtering publish_logs -- same
    // reasoning as above, no deep embedded dot-path filters.
    let recentLogsQuery = s.from("publish_logs").select("at, level, message").order("at", { ascending: false }).limit(15);
    if (scoped) {
      const { data: scheduledRows } = await s.from("scheduled_pins").select("id").in("brief_id", briefIds);
      const scheduledIds = (scheduledRows ?? []).map((r: { id: string }) => r.id);
      recentLogsQuery = recentLogsQuery.in("scheduled_pin_id", scheduledIds);
    }
    const { data: recentLogs } = await recentLogsQuery;

    const pagesTotal = pagesTotalRes.count ?? 0;
    const briefsTotal = briefsTotalRes.count ?? 0;
    const imagesTotal = imagesTotalRes.count ?? 0;
    const scheduledQueued = scheduledQueuedRes.count ?? 0;
    const publishedTotal = publishedTotalRes.count ?? 0;

    // "Needs attention" pipeline highlight: a real comparison of backlog
    // (work waiting to move to the next stage) across the non-terminal
    // stages, not a hardcoded stage. Pages backlog = pages that haven't
    // produced a brief yet; briefs backlog = briefs without a rendered
    // image; images backlog = rendered briefs not yet scheduled;
    // scheduled backlog = currently queued for publish. Published has no
    // "next stage", so it's excluded from the comparison.
    const backlog = {
      pages: Math.max(pagesTotal - briefsTotal, 0),
      briefs: briefsBacklogRes.count ?? 0,
      images: imagesBacklogRes.count ?? 0,
      scheduled: scheduledQueued,
    };
    const needsAttention = (Object.keys(backlog) as (keyof typeof backlog)[]).reduce(
      (max, key) => (backlog[key] > backlog[max] ? key : max),
      "pages" as keyof typeof backlog,
    );

    const siteColorMap = new Map<string, string>(
      (sitesColorRes.data ?? []).map((row: { id: string; accent_color: string | null }) => [
        row.id,
        row.accent_color ?? FALLBACK_SITE_COLOR,
      ]),
    );

    type PublishedRow = {
      id: string;
      published_at: string | null;
      pin_briefs?: {
        page_id?: string;
        title?: string;
        pages?: { site_id?: string; title?: string | null; url?: string | null } | null;
      } | null;
      pin_images?: { storage_path: string }[] | { storage_path: string } | null;
    };
    const publishedRows = (publishedRowsRes.data ?? []) as unknown as PublishedRow[];
    const storagePaths = Array.from(
      new Set(
        publishedRows
          .map((r) => (Array.isArray(r.pin_images) ? r.pin_images[0]?.storage_path : r.pin_images?.storage_path))
          .filter(Boolean) as string[],
      ),
    );
    const signedUrlMap = new Map<string, string>();
    await Promise.all(
      storagePaths.map(async (p) => {
        const { data: signed } = await s.storage.from("pins").createSignedUrl(p, 3600);
        if (signed?.signedUrl) signedUrlMap.set(p, signed.signedUrl);
      }),
    );

    const publishedThisWeek = publishedRows
      .map((r) => {
        const path = Array.isArray(r.pin_images) ? r.pin_images[0]?.storage_path : r.pin_images?.storage_path;
        const pageInfo = r.pin_briefs?.pages;
        const rowSiteId = pageInfo?.site_id ?? null;
        return {
          id: r.id,
          pageTitle: pageInfo?.title || pageInfo?.url || r.pin_briefs?.title || "Untitled page",
          thumbUrl: path ? signedUrlMap.get(path) ?? null : null,
          siteId: rowSiteId,
          siteColor: rowSiteId ? siteColorMap.get(rowSiteId) ?? FALLBACK_SITE_COLOR : FALLBACK_SITE_COLOR,
        };
      })
      .filter(
        (r): r is { id: string; pageTitle: string; thumbUrl: string; siteId: string | null; siteColor: string } =>
          Boolean(r.thumbUrl),
      )
      .slice(0, PUBLISHED_SHOW_LIMIT);

    return {
      pipeline: {
        pages: pagesTotal,
        briefs: briefsTotal,
        images: imagesTotal,
        scheduled: scheduledQueued,
        published: publishedTotal,
      },
      needsAttention,
      publishedThisWeek,
      publishedThisWeekTotal: publishedRowsRes.count ?? publishedRows.length,
      lastUpdatedAt: lastCrawledRes.data?.[0]?.last_crawled_at ?? null,
      recentLogs: recentLogs ?? [],
      integrations: integrationsRes.data ?? [],
    };
  });
