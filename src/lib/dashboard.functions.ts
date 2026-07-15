import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const dashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const s = context.supabase;
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const [pages, briefs, scheduled, published, failed, queuedJobs, integrations] = await Promise.all([
      s.from("pages").select("id", { count: "estimated", head: true }),
      s.from("pin_briefs").select("id", { count: "estimated", head: true }),
      s.from("scheduled_pins").select("id", { count: "estimated", head: true }).eq("status", "queued"),
      s.from("scheduled_pins").select("id", { count: "estimated", head: true }).eq("status", "published").gte("published_at", dayStart.toISOString()),
      s.from("scheduled_pins").select("id", { count: "estimated", head: true }).eq("status", "failed"),
      s.from("jobs").select("id", { count: "estimated", head: true }).eq("status", "queued"),
      s.from("integrations").select("provider, status"),
    ]);
    const { data: recentLogs } = await s.from("publish_logs").select("at, level, message").order("at", { ascending: false }).limit(10);
    return {
      pages: pages.count ?? 0,
      briefs: briefs.count ?? 0,
      scheduled: scheduled.count ?? 0,
      publishedToday: published.count ?? 0,
      failed: failed.count ?? 0,
      queuedJobs: queuedJobs.count ?? 0,
      integrations: integrations.data ?? [],
      recentLogs: recentLogs ?? [],
    };
  });
