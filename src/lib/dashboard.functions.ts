import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// How many "ready to publish" pin thumbnails the dashboard pulls signed
// URLs for. Only a handful render (the rest collapse into a "+N more"
// tile), but we fetch a small buffer past that in case some rows are
// missing a resolvable image.
const READY_TO_PUBLISH_FETCH_LIMIT = 8;
const READY_TO_PUBLISH_SHOW_LIMIT = 5;

export const dashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const s = context.supabase;
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const [pages, briefs, scheduled, published, failed, queuedJobs, integrations, readyBriefs, recentLogs] = await Promise.all([
      s.from("pages").select("id", { count: "estimated", head: true }),
      s.from("pin_briefs").select("id", { count: "estimated", head: true }),
      s.from("scheduled_pins").select("id", { count: "estimated", head: true }).eq("status", "queued"),
      s.from("scheduled_pins").select("id", { count: "estimated", head: true }).eq("status", "published").gte("published_at", dayStart.toISOString()),
      s.from("scheduled_pins").select("id", { count: "estimated", head: true }).eq("status", "failed"),
      s.from("jobs").select("id", { count: "estimated", head: true }).eq("status", "queued"),
      s.from("integrations").select("provider, status"),
      // "Ready to publish" = briefs with a rendered image that haven't been
      // scheduled yet. count: "exact" here is independent of the limit
      // below, so it still reflects the true total for the "+N more" tile.
      s.from("pin_briefs")
        .select("id, title, pages(title, url), pin_images(storage_path)", { count: "exact" })
        .eq("status", "ready")
        .order("created_at", { ascending: false })
        .limit(READY_TO_PUBLISH_FETCH_LIMIT),
      s.from("publish_logs").select("at, level, message").order("at", { ascending: false }).limit(15),
    ]);

    // Sign thumbnail URLs for the ready-to-publish rail. Storage paths are
    // per-user-prefixed, so a 1h signed URL is fine for a dashboard view
    // that's expected to be reloaded/refetched well within that window.
    type ReadyRow = { id: string; title: string; pages?: { title?: string | null; url?: string | null } | null; pin_images?: { storage_path: string }[] };
    const readyRows = (readyBriefs.data ?? []) as unknown as ReadyRow[];
    const paths = Array.from(new Set(
      readyRows.map((r) => r.pin_images?.[0]?.storage_path).filter(Boolean) as string[],
    ));
    const urlMap = new Map<string, string>();
    await Promise.all(paths.map(async (p) => {
      const { data: signed } = await s.storage.from("pins").createSignedUrl(p, 3600);
      if (signed?.signedUrl) urlMap.set(p, signed.signedUrl);
    }));
    const readyToPublish = readyRows
      .map((r) => {
        const path = r.pin_images?.[0]?.storage_path;
        return {
          id: r.id,
          pageTitle: r.pages?.title || r.pages?.url || r.title || "Untitled page",
          thumbUrl: path ? urlMap.get(path) ?? null : null,
        };
      })
      .filter((r): r is { id: string; pageTitle: string; thumbUrl: string } => Boolean(r.thumbUrl))
      .slice(0, READY_TO_PUBLISH_SHOW_LIMIT);

    return {
      pages: pages.count ?? 0,
      briefs: briefs.count ?? 0,
      scheduled: scheduled.count ?? 0,
      publishedToday: published.count ?? 0,
      failed: failed.count ?? 0,
      queuedJobs: queuedJobs.count ?? 0,
      integrations: integrations.data ?? [],
      recentLogs: recentLogs.data ?? [],
      readyToPublish,
      readyToPublishTotal: readyBriefs.count ?? readyRows.length,
    };
  });
