import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { dashboardStats } from "@/lib/dashboard.functions";
import { SiteProvider, useSiteContext } from "@/lib/site-context";
import { PinspiderMark } from "@/components/PinspiderMark";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Image, Calendar, LayoutGrid, Globe, Bell, Search, SlidersHorizontal, Plus,
  ChevronDown, Layers, AlertTriangle, Clock, TrendingUp, Unlink2,
} from "lucide-react";

// This route intentionally opts out of the shared _authenticated layout
// (AppShell) so the Pinterest-native shell below (sidebar + header +
// masonry feed) can fully replace the SaaS-admin chrome on this one page
// without restyling Sites/Pages/Pins/Schedule/Boards/Keywords/Settings,
// which all still render through the untouched AppShell. The auth guard
// below is a duplicate of _authenticated/route.tsx's beforeLoad -- the
// two need to be kept in sync if the auth check ever changes.
export const Route = createFileRoute("/dashboard")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  head: () => ({ meta: [{ title: "Dashboard — Pinspider" }] }),
  component: () => (
    <SiteProvider>
      <DashboardPage />
    </SiteProvider>
  ),
});

// Dashboard-only design tokens -- a different palette from the shared
// styles.css theme on purpose (Pinterest-native feed vs the admin-panel
// look everywhere else). Scoped to this file via inline styles so no
// other route is affected.
const TOKENS = {
  bg: "#FFFFFF",
  textPrimary: "#111111",
  textSecondary: "#767676",
  textMuted: "#AFAFAF",
  accent: "#E60023",
  successTint: "#4F7A5C",
  fieldBg: "#F5F5F5",
};
const FONT = '"DM Sans", ui-sans-serif, system-ui, sans-serif';
const FALLBACK_SITE_COLOR = "#8A867C";

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function DashboardPage() {
  const { selectedSiteId } = useSiteContext();
  const stats = useServerFn(dashboardStats);
  const { data } = useQuery({
    queryKey: ["dash", selectedSiteId],
    queryFn: () => stats({ data: { siteId: selectedSiteId } }),
  });

  // Everything below is derived from the existing dashboardStats() shape
  // (pipeline, publishedThisWeek/Total, recentLogs, integrations) built
  // in earlier work -- no new queries, no new server logic.
  const pins = data?.publishedThisWeek ?? [];
  const errorLogs = (data?.recentLogs ?? []).filter((l) => l.level === "error");
  const errorCount = errorLogs.length;
  const pinterestRow = data?.integrations.find((i) => i.provider === "pinterest");
  const pinterestConnected = pinterestRow?.status === "ok";
  const showSiteTint = selectedSiteId === null;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: TOKENS.bg, fontFamily: FONT }}>
      <Sidebar
        errorCount={errorCount}
        needsAttention={data?.needsAttention}
        pipeline={data?.pipeline}
        pinterestConnected={pinterestConnected}
        lastUpdatedAt={data?.lastUpdatedAt ?? null}
      />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <HeaderRow />
        <MasonryFeed
          pins={pins}
          showSiteTint={showSiteTint}
          publishedThisWeekTotal={data?.publishedThisWeekTotal ?? 0}
          scheduled={data?.pipeline?.scheduled ?? 0}
          errorCount={errorCount}
          pinterestConnected={pinterestConnected}
        />
      </div>
    </div>
  );
}

// ---------- Sidebar ----------

const NAV_PRIMARY = [
  { to: "/dashboard", label: "Pins", icon: Image },
  { to: "/schedule", label: "Schedule", icon: Calendar },
  { to: "/boards", label: "Boards", icon: LayoutGrid },
] as const;

function Sidebar({
  errorCount, needsAttention, pipeline, pinterestConnected, lastUpdatedAt,
}: {
  errorCount: number;
  needsAttention?: string;
  pipeline?: { pages: number; briefs: number; images: number; scheduled: number; published: number };
  pinterestConnected: boolean;
  lastUpdatedAt: string | null;
}) {
  return (
    <aside
      style={{
        width: 190, flexShrink: 0, display: "flex", flexDirection: "column",
        borderRight: "1px solid #EFEFEF", padding: "20px 16px", fontFamily: FONT,
      }}
    >
      <div
        style={{
          width: 34, height: 34, borderRadius: "50%", background: TOKENS.accent,
          display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 28,
        }}
      >
        <PinspiderMark size={20} color="#FFFFFF" bg={TOKENS.accent} />
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {NAV_PRIMARY.map(({ to, label, icon: Icon }) => {
          const active = label === "Pins"; // this page presents itself as the Pins feed/home
          return (
            <Link
              key={to}
              to={to}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "7px 4px",
                color: TOKENS.textPrimary, fontWeight: active ? 700 : 400, fontSize: 14,
                textDecoration: "none",
              }}
            >
              <Icon size={17} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div style={{ marginTop: 22, marginBottom: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: TOKENS.textMuted }}>
        SITE
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Link
          to="/sites"
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 4px", color: TOKENS.textPrimary, fontSize: 14, textDecoration: "none" }}
        >
          <Globe size={17} />
          Sites & pages
        </Link>
        <Link
          to="/logs"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 4px", color: TOKENS.textPrimary, fontSize: 14, textDecoration: "none" }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Bell size={17} />
            Alerts
          </span>
          {errorCount > 0 && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                minWidth: 16, height: 16, borderRadius: 999, background: TOKENS.accent,
                color: "#FFFFFF", fontSize: 10, fontWeight: 700, padding: "0 4px",
              }}
            >
              {errorCount}
            </span>
          )}
        </Link>
      </nav>

      <div style={{ flex: 1 }} />

      <StatusCard
        pinterestConnected={pinterestConnected}
        needsAttention={needsAttention}
        pipeline={pipeline}
      />
      <SiteChip lastUpdatedAt={lastUpdatedAt} />
    </aside>
  );
}

function StatusCard({
  pinterestConnected, needsAttention, pipeline,
}: {
  pinterestConnected: boolean;
  needsAttention?: string;
  pipeline?: { pages: number; briefs: number; images: number; scheduled: number; published: number };
}) {
  // "Most actionable at the time" -- reuses whichever signal is more
  // urgent from data already fetched: a disconnected Pinterest account
  // blocks publishing entirely, so it outranks a routine pipeline
  // backlog nudge.
  const attentionLabel: Record<string, string> = {
    pages: "pages need briefs generated",
    briefs: "briefs need images rendered",
    images: "images are ready to schedule",
    scheduled: "pins are queued to publish",
  };
  const count = needsAttention && pipeline ? backlogCountFor(needsAttention, pipeline) : 0;

  return (
    <Link
      to={pinterestConnected ? "/pages" : "/settings/integrations"}
      style={{
        display: "block", borderRadius: 16, padding: 14, marginBottom: 10,
        background: "linear-gradient(135deg, #FFE1E8 0%, #FFF3F5 100%)",
        textDecoration: "none", color: TOKENS.textPrimary,
      }}
    >
      {!pinterestConnected ? (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Connect Pinterest</div>
          <div style={{ fontSize: 12, color: TOKENS.textSecondary }}>Required to publish pins directly.</div>
        </>
      ) : needsAttention && count > 0 ? (
        <>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "IBM Plex Mono, ui-monospace, monospace" }}>{count}</div>
          <div style={{ fontSize: 12, color: TOKENS.textSecondary }}>{attentionLabel[needsAttention]}</div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>All caught up</div>
          <div style={{ fontSize: 12, color: TOKENS.textSecondary }}>Nothing needs attention right now.</div>
        </>
      )}
    </Link>
  );
}

function backlogCountFor(stage: string, pipeline: { pages: number; briefs: number; images: number; scheduled: number; published: number }): number {
  if (stage === "pages") return Math.max(pipeline.pages - pipeline.briefs, 0);
  if (stage === "briefs") return pipeline.briefs;
  if (stage === "images") return pipeline.images;
  if (stage === "scheduled") return pipeline.scheduled;
  return 0;
}

function SiteChip({ lastUpdatedAt }: { lastUpdatedAt: string | null }) {
  // Reuses the same SiteProvider/useSiteContext state and selection
  // persistence as the existing site-switcher work -- only the trigger's
  // presentation is new, to match this page's Pinterest-native tokens
  // instead of the shared light-workspace theme's chip styling.
  const { sites, selectedSiteId, selectedSite, setSelectedSiteId } = useSiteContext();
  const label = selectedSite ? (selectedSite.brand_name || hostOf(selectedSite.url)) : "All sites";
  const color = selectedSite?.accent_color ?? FALLBACK_SITE_COLOR;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 6px",
            border: "1px solid #EFEFEF", borderRadius: 12, background: "#FFFFFF", cursor: "pointer",
          }}
        >
          {selectedSite ? (
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
          ) : (
            <Layers size={14} style={{ color: TOKENS.textSecondary, flexShrink: 0 }} />
          )}
          <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: TOKENS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {label}
            </div>
            <div style={{ fontSize: 10, color: TOKENS.textMuted }}>
              {lastUpdatedAt ? `synced ${formatRelative(lastUpdatedAt)}` : "not synced"}
            </div>
          </span>
          <ChevronDown size={14} style={{ color: TOKENS.textMuted, flexShrink: 0 }} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={() => setSelectedSiteId(null)} className="gap-2">
          <Layers className="h-3.5 w-3.5" />
          <span style={{ fontWeight: selectedSiteId === null ? 600 : 400 }}>All sites</span>
        </DropdownMenuItem>
        {sites.map((s) => (
          <DropdownMenuItem key={s.id} onClick={() => setSelectedSiteId(s.id)} className="gap-2">
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: s.accent_color ?? FALLBACK_SITE_COLOR }} />
            <span style={{ fontWeight: selectedSiteId === s.id ? 600 : 400 }}>{s.brand_name || hostOf(s.url)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// ---------- Header ----------

function HeaderRow() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 24px", fontFamily: FONT }}>
      <div
        style={{
          flex: 1, display: "flex", alignItems: "center", gap: 8, background: TOKENS.fieldBg,
          borderRadius: 999, padding: "10px 16px", maxWidth: 480,
        }}
      >
        <Search size={16} style={{ color: TOKENS.textSecondary, flexShrink: 0 }} />
        <span style={{ fontSize: 14, color: TOKENS.textMuted }}>Search pins, boards, pages...</span>
      </div>
      <button
        type="button"
        title="Filters"
        style={{
          width: 40, height: 40, borderRadius: 10, background: TOKENS.fieldBg, border: "none",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
        }}
      >
        <SlidersHorizontal size={17} style={{ color: TOKENS.textSecondary }} />
      </button>
      <Link
        to="/sites"
        title="Add a site or page"
        style={{
          width: 40, height: 40, borderRadius: 10, background: "#111111",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
      >
        <Plus size={19} style={{ color: "#FFFFFF" }} />
      </Link>
    </div>
  );
}

// ---------- Masonry feed ----------

type PublishedPin = { id: string; pageTitle: string; thumbUrl: string; siteId: string | null; siteColor: string };
type FeedItem =
  | { kind: "pin"; pin: PublishedPin }
  | { kind: "stat"; key: string };

function MasonryFeed({
  pins, showSiteTint, publishedThisWeekTotal, scheduled, errorCount, pinterestConnected,
}: {
  pins: PublishedPin[];
  showSiteTint: boolean;
  publishedThisWeekTotal: number;
  scheduled: number;
  errorCount: number;
  pinterestConnected: boolean;
}) {
  const statKeys = ["published", "scheduled", "errors", ...(pinterestConnected ? [] : ["pinterest"])];

  // Weave stat tiles in every ~3 pins so they read as part of the board
  // instead of clustering at the top or bottom.
  const items: FeedItem[] = [];
  let statIdx = 0;
  pins.forEach((pin, i) => {
    items.push({ kind: "pin", pin });
    if ((i + 1) % 3 === 0 && statIdx < statKeys.length) {
      items.push({ kind: "stat", key: statKeys[statIdx++] });
    }
  });
  while (statIdx < statKeys.length) items.push({ kind: "stat", key: statKeys[statIdx++] });

  return (
    <div style={{ padding: "0 24px 32px", fontFamily: FONT }} className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-3">
      {items.map((item, i) =>
        item.kind === "pin" ? (
          <div key={`pin-${item.pin.id}`} className="break-inside-avoid mb-[18px]">
            <PinTile pin={item.pin} showSiteTint={showSiteTint} />
          </div>
        ) : (
          <div key={`stat-${item.key}-${i}`} className="break-inside-avoid mb-[18px]">
            <StatTile
              statKey={item.key}
              publishedThisWeekTotal={publishedThisWeekTotal}
              scheduled={scheduled}
              errorCount={errorCount}
            />
          </div>
        ),
      )}
      {!pins.length && (
        <div className="break-inside-avoid mb-[18px]">
          <StatTile statKey="published" publishedThisWeekTotal={publishedThisWeekTotal} scheduled={scheduled} errorCount={errorCount} />
        </div>
      )}
    </div>
  );
}

function PinTile({ pin, showSiteTint }: { pin: PublishedPin; showSiteTint: boolean }) {
  return (
    <div style={{ borderRadius: 16, overflow: "hidden", position: "relative", background: TOKENS.fieldBg }}>
      <span
        style={{
          position: "absolute", top: 8, left: 8, zIndex: 1, borderRadius: 999,
          background: "rgba(17,17,17,0.85)", color: "#FFFFFF", fontSize: 10, fontWeight: 700,
          letterSpacing: "0.04em", padding: "3px 8px",
        }}
      >
        PUBLISHED
      </span>
      <img src={pin.thumbUrl} alt={pin.pageTitle} style={{ width: "100%", height: "auto", display: "block", borderRadius: 16 }} loading="lazy" />
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 2px 0" }}>
        <span
          style={{ width: 16, height: 16, borderRadius: "50%", background: showSiteTint ? pin.siteColor : TOKENS.accent, flexShrink: 0 }}
        />
        <span
          style={{
            fontSize: 13, color: TOKENS.textPrimary, overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap", minWidth: 0,
          }}
          title={pin.pageTitle}
        >
          {pin.pageTitle}
        </span>
      </div>
    </div>
  );
}

const STAT_CONFIG: Record<string, { label: string; icon: typeof TrendingUp; tone: "positive" | "attention"; to?: string }> = {
  published: { label: "pins published this week", icon: TrendingUp, tone: "positive" },
  scheduled: { label: "scheduled, not yet published", icon: Clock, tone: "positive" },
  errors: { label: "errors need attention", icon: AlertTriangle, tone: "attention", to: "/logs" },
  pinterest: { label: "Pinterest not connected", icon: Unlink2, tone: "attention", to: "/settings/integrations" },
};

function StatTile({
  statKey, publishedThisWeekTotal, scheduled, errorCount,
}: {
  statKey: string;
  publishedThisWeekTotal: number;
  scheduled: number;
  errorCount: number;
}) {
  const cfg = STAT_CONFIG[statKey];
  const Icon = cfg.icon;
  const value = statKey === "published" ? publishedThisWeekTotal
    : statKey === "scheduled" ? scheduled
    : statKey === "errors" ? errorCount
    : null;

  const positive = cfg.tone === "positive";
  const content = (
    <div
      style={{
        height: 220, borderRadius: 16, padding: 18, display: "flex", flexDirection: "column",
        background: positive ? `linear-gradient(135deg, ${TOKENS.accent} 0%, #FF4D67 100%)` : "#FFFFFF",
        border: positive ? "none" : `1.5px solid ${TOKENS.textPrimary}`,
        color: positive ? "#FFFFFF" : TOKENS.accent,
      }}
    >
      <Icon size={20} style={{ color: positive ? "#FFFFFF" : TOKENS.accent }} />
      <div style={{ flex: 1 }} />
      {value !== null && (
        <div style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 30, fontWeight: 600, lineHeight: 1 }}>
          {value}
        </div>
      )}
      <div style={{ fontSize: 13, marginTop: 6, color: positive ? "rgba(255,255,255,0.9)" : TOKENS.textPrimary }}>
        {cfg.label}
      </div>
    </div>
  );

  return cfg.to ? <Link to={cfg.to} style={{ textDecoration: "none" }}>{content}</Link> : content;
}
