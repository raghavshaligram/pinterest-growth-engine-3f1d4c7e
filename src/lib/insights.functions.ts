import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TEMPLATE_LABELS, type TemplateId } from "@/lib/briefs.functions";

// Per-brief attribution, aggregated up to template level for display.
// This is read-through only -- no traffic data is ever persisted here,
// GA4 is queried live on every call and the result isn't cached beyond
// react-query's normal per-session client cache (see insights.tsx,
// which uses a plain useQuery with no persistence).
export type TemplatePerformanceRow = {
  templateId: TemplateId | "unknown";
  label: string;
  color: string;
  sessions: number;
  briefCount: number;
};

export type InsightsResult =
  | { state: "not_connected" }
  | { state: "no_utm_traffic"; propertyLabel: string }
  | { state: "zero_traffic"; propertyLabel: string }
  | { state: "ok"; propertyLabel: string; rows: TemplatePerformanceRow[]; totalSessions: number };

const RECENT_BRIEFS_FETCH_LIMIT = 5000;

export const getSiteInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { siteId: string; days?: number }) =>
    z.object({ siteId: z.string().uuid(), days: z.number().int().min(1).max(90).default(30) }).parse(i),
  )
  .handler(async ({ data, context }): Promise<InsightsResult> => {
    const s = context.supabase;
    const { data: site, error: siteErr } = await s
      .from("sites")
      .select("id, google_connection_id, ga4_property_id, ga4_property_label")
      .eq("id", data.siteId)
      .single();
    if (siteErr || !site) throw siteErr ?? new Error("Site not found");

    if (!site.google_connection_id || !site.ga4_property_id) {
      return { state: "not_connected" };
    }

    const { getValidAccessToken, runGa4SessionsByUtmContent } = await import("@/lib/google-analytics.server");
    const accessToken = await getValidAccessToken(site.google_connection_id, context.userId);
    const report = await runGa4SessionsByUtmContent(accessToken, site.ga4_property_id, data.days ?? 30);

    const propertyLabel = site.ga4_property_label ?? site.ga4_property_id;

    // Genuinely zero sessions in range (tagged or not) vs. real traffic
    // that just isn't UTM-tagged are two different empty states per
    // spec -- rawTotalSessions (see google-analytics.server.ts) is what
    // makes that distinction possible from this one API call.
    if (report.rawTotalSessions === 0) {
      return { state: "zero_traffic", propertyLabel };
    }
    if (report.rows.length === 0) {
      return { state: "no_utm_traffic", propertyLabel };
    }

    // pin_briefs doesn't carry site_id directly (same indirection
    // sites.functions.ts/dashboard.functions.ts already resolve through
    // pages) -- fetch this site's page ids, then the briefs on those
    // pages, and join utm_content (== brief.id) against that set locally
    // rather than trusting any brief id GA4 happens to report.
    const { data: pageRows } = await s.from("pages").select("id").eq("site_id", data.siteId).limit(RECENT_BRIEFS_FETCH_LIMIT);
    const pageIds = (pageRows ?? []).map((p: { id: string }) => p.id);
    const { data: briefRows } = pageIds.length
      ? await s.from("pin_briefs").select("id, template_id").in("page_id", pageIds).limit(RECENT_BRIEFS_FETCH_LIMIT)
      : { data: [] as { id: string; template_id: string | null }[] };
    const briefTemplate = new Map((briefRows ?? []).map((b: { id: string; template_id: string | null }) => [b.id, b.template_id]));

    const byTemplate = new Map<string, { sessions: number; briefIds: Set<string> }>();
    let matchedAny = false;
    for (const { utmContent, sessions } of report.rows) {
      const templateId = briefTemplate.get(utmContent);
      // utm_content values GA4 reports that don't match any brief_id on
      // this site (traffic to another site sharing the same GA4
      // property, or a link tagged before its brief was deleted) are
      // dropped from the per-template breakdown -- they're real tagged
      // sessions, just not attributable to a live brief on this site.
      if (templateId === undefined) continue;
      matchedAny = true;
      const key = templateId ?? "unknown";
      const entry = byTemplate.get(key) ?? { sessions: 0, briefIds: new Set<string>() };
      entry.sessions += sessions;
      entry.briefIds.add(utmContent);
      byTemplate.set(key, entry);
    }

    if (!matchedAny) {
      return { state: "no_utm_traffic", propertyLabel };
    }

    const rows: TemplatePerformanceRow[] = Array.from(byTemplate.entries())
      .map(([key, v]) => {
        const known = key !== "unknown" ? TEMPLATE_LABELS[key as TemplateId] : undefined;
        return {
          templateId: (key as TemplateId | "unknown"),
          label: known?.label ?? "Other",
          color: known?.color ?? "#8A867C",
          sessions: v.sessions,
          briefCount: v.briefIds.size,
        };
      })
      .sort((a, b) => b.sessions - a.sessions);

    const totalSessions = rows.reduce((sum, r) => sum + r.sessions, 0);

    return { state: "ok", propertyLabel, rows, totalSessions };
  });
