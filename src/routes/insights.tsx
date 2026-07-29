// Standalone route, same Pinterest-native chrome as Dashboard/Schedule
// (see components/PinShell.tsx) -- beforeLoad duplicates the
// _authenticated route's auth guard, same pattern as every other
// PinShell-based route.
//
// Read-through only: every load calls GA4 live via getSiteInsights
// (insights.functions.ts), nothing here is persisted. react-query's
// default cache means a client-side nav away and back reuses the last
// answer for this session; a full page refresh clears it, matching the
// "cache per-session, clears on refresh" requirement.
import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PinShell } from "@/components/PinShell";
import { useSiteContext } from "@/lib/site-context";
import { getSiteInsights, type TemplatePerformanceRow } from "@/lib/insights.functions";
import { PIN, PIN_FONT } from "@/lib/pin-shell-tokens";
import { BarChart3, Link2, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/insights")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  head: () => ({ meta: [{ title: "Insights — Pinspider" }] }),
  component: () => <InsightsPage />,
});

function InsightsPage() {
  const { user } = Route.useRouteContext();
  return (
    <PinShell active="insights" userEmail={user?.email}>
      <div className="flex-1 overflow-y-auto px-8 py-6 no-scrollbar" style={{ scrollbarWidth: "none" }}>
        <InsightsContent />
      </div>
    </PinShell>
  );
}

function InsightsContent() {
  const { selectedSiteId, selectedSite, isLoading: sitesLoading } = useSiteContext();
  const getInsights = useServerFn(getSiteInsights);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["insights", selectedSiteId],
    queryFn: () => getInsights({ data: { siteId: selectedSiteId! } }),
    enabled: !!selectedSiteId,
  });

  return (
    <div className="space-y-6" style={{ fontFamily: PIN_FONT }}>
      <header>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: PIN.textPrimary, letterSpacing: -0.5 }}>Insights</h1>
        <p style={{ fontSize: 13, color: PIN.textSecondary, marginTop: 4 }}>
          What worked — GA4 traffic for {selectedSite ? (selectedSite.brand_name || selectedSite.url) : "the selected site"}, attributed back to the pin templates that drove it.
        </p>
      </header>

      {!selectedSiteId && !sitesLoading && (
        <EmptyPanel
          icon={BarChart3}
          title="Pick a site to see its Insights"
          body="Template performance is tracked per site — use the site switcher above the sidebar to choose one."
        />
      )}

      {selectedSiteId && (isLoading || isFetching) && !data && (
        <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <TileSkeleton key={i} />)}
        </div>
      )}

      {selectedSiteId && error && (
        <EmptyPanel icon={BarChart3} title="Couldn't load Insights" body={error instanceof Error ? error.message : "Something went wrong talking to Google Analytics."} />
      )}

      {selectedSiteId && data?.state === "not_connected" && (
        <EmptyPanel
          icon={Link2}
          title="Google Analytics isn't connected for this site"
          body="Map a GA4 property under this site's Connections section (Sites page) to start seeing which templates drive traffic."
          action={{ to: "/sites", label: "Go to Sites →" }}
        />
      )}

      {selectedSiteId && data?.state === "zero_traffic" && (
        <EmptyPanel
          icon={TrendingUp}
          title="No traffic yet"
          body={`${data.propertyLabel} hasn't recorded any sessions in the last 30 days.`}
        />
      )}

      {selectedSiteId && data?.state === "no_utm_traffic" && (
        <EmptyPanel
          icon={TrendingUp}
          title="Connected, but nothing tagged yet"
          body={`${data.propertyLabel} has traffic, but none of it carries Pinspider's UTM tags. Newly-published pins are tagged automatically — this fills in as those get clicked (subject to GA4's normal data-processing delay).`}
        />
      )}

      {selectedSiteId && data?.state === "ok" && <TemplatePerformanceGrid rows={data.rows} totalSessions={data.totalSessions} propertyLabel={data.propertyLabel} />}
    </div>
  );
}

function TemplatePerformanceGrid({ rows, totalSessions, propertyLabel }: { rows: TemplatePerformanceRow[]; totalSessions: number; propertyLabel: string }) {
  return (
    <>
      <p style={{ fontSize: 12, color: PIN.textMuted }}>{totalSessions} tagged sessions · last 30 days · {propertyLabel}</p>
      <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-3">
        {rows.map((row) => (
          <div key={row.templateId} className="mb-3 break-inside-avoid">
            <TemplateTile row={row} />
          </div>
        ))}
      </div>
    </>
  );
}

// Deliberately built off the same visual language as Dashboard's
// StatTile ("stat tile styled as pin") -- rounded-16px card, big bold
// number, short label, colored tint circle -- so this page reads as a
// variant of the pin masonry feed showing numbers instead of images,
// not a bolted-on analytics dashboard with charts/tables.
function TemplateTile({ row }: { row: TemplatePerformanceRow }) {
  return (
    <div
      style={{
        borderRadius: 16, border: `1px solid ${PIN.border}`, background: PIN.card, padding: 18,
        display: "flex", flexDirection: "column", gap: 10,
      }}
    >
      <div
        style={{
          width: 36, height: 36, borderRadius: "50%",
          background: `${row.color}22`, display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <span style={{ width: 14, height: 14, borderRadius: "50%", background: row.color, display: "block" }} />
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: PIN.textPrimary, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
        {row.sessions.toLocaleString()}
      </div>
      <div style={{ fontSize: 13, color: PIN.textSecondary }}>sessions · {row.label}</div>
      <div style={{ fontSize: 11.5, color: PIN.textMuted }}>{row.briefCount} pin{row.briefCount === 1 ? "" : "s"} in this template</div>
    </div>
  );
}

function TileSkeleton() {
  return (
    <div style={{ borderRadius: 16, border: `1px solid ${PIN.border}`, background: PIN.card, padding: 18, marginBottom: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#F0F0F0" }} />
      <div style={{ width: 60, height: 24, borderRadius: 6, background: "#F0F0F0", marginTop: 10 }} />
      <div style={{ width: 100, height: 12, borderRadius: 6, background: "#F0F0F0", marginTop: 8 }} />
    </div>
  );
}

function EmptyPanel({
  icon: Icon, title, body, action,
}: {
  icon: typeof BarChart3;
  title: string;
  body: string;
  action?: { to: string; label: string };
}) {
  return (
    <div
      style={{
        borderRadius: 16, border: `1px dashed ${PIN.borderStrong}`, background: PIN.card,
        padding: 32, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10,
      }}
    >
      <div style={{ width: 44, height: 44, borderRadius: "50%", background: PIN.roseTint, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={20} style={{ color: PIN.roseIcon }} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: PIN.textPrimary }}>{title}</div>
      <p style={{ fontSize: 13, color: PIN.textSecondary, maxWidth: 420 }}>{body}</p>
      {action && (
        <Link to={action.to} style={{ fontSize: 13, fontWeight: 600, color: PIN.accent }}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
