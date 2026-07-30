// Shared chrome for every Pinterest-native screen (Dashboard, Schedule,
// Boards, Sites, Pages, Pins, Keywords, Logs, Settings). Each of those
// routes opts out of the shared _authenticated layout entirely -- own
// beforeLoad auth guard duplicated per-route -- so this sidebar can be
// fully icon-rail/Pinterest-native everywhere rather than only on a
// subset of screens.
//
// All 9 destinations are first-class icons in the primary rail now
// (previously Pages/Pins/Keywords/Logs/Settings lived behind a
// collapsed "more" dropdown while their pages still rendered through
// the old AppShell -- now that every screen shares this chrome, there's
// no reason to hide them).
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Calendar, Layers, Globe, FileText, Images,
  KeyRound, Settings2, ScrollText, LogOut, BarChart3, PanelLeftClose, PanelLeft,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PIN, PIN_FONT } from "@/lib/pin-shell-tokens";
import { PinspiderMark } from "@/components/PinspiderMark";
import { SiteProvider } from "@/lib/site-context";
import { FinishSetupBanner } from "@/components/FinishSetupBanner";
import { HelpMenu } from "@/components/HelpMenu";
import { useSetupStatus } from "@/lib/onboarding-gate";
import { useEffect, useState, type ReactNode } from "react";

type NavKey = "dashboard" | "schedule" | "boards" | "sites" | "pages" | "pins" | "insights" | "keywords" | "logs" | "settings";

const NAV: ReadonlyArray<{ to: string; label: string; icon: typeof LayoutDashboard; key: NavKey }> = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, key: "dashboard" },
  { to: "/schedule", label: "Schedule", icon: Calendar, key: "schedule" },
  { to: "/boards", label: "Boards", icon: Layers, key: "boards" },
  { to: "/sites", label: "Sites", icon: Globe, key: "sites" },
  { to: "/pages", label: "Pages", icon: FileText, key: "pages" },
  { to: "/pins", label: "Pins", icon: Images, key: "pins" },
  // Distinct from Dashboard (what's queued/posted) and Settings
  // (connections/config) -- this answers "what worked," pulling live
  // GA4 data for the currently-selected site, so it gets its own
  // top-level rail icon rather than living inside either of those.
  { to: "/insights", label: "Insights", icon: BarChart3, key: "insights" },
  { to: "/keywords", label: "Keywords", icon: KeyRound, key: "keywords" },
  { to: "/logs", label: "Logs", icon: ScrollText, key: "logs" },
  { to: "/settings/integrations", label: "Settings", icon: Settings2, key: "settings" },
];

function RedMark({ size = 34 }: { size?: number }) {
  return <PinspiderMark size={size} />;
}

// Icon-only width (unchanged from before this change) vs. the
// expanded, label-showing width -- expanded is the DEFAULT (see
// SIDEBAR_COLLAPSED_KEY below): the spec calls for visible text labels
// next to each icon, not hover-only tooltips, so collapsing is an
// opt-in a user reaches for when they want the horizontal space back,
// not the default state.
const RAIL_WIDTH_COLLAPSED = 64;
const RAIL_WIDTH_EXPANDED = 208;
const SIDEBAR_COLLAPSED_KEY = "pinspider_sidebar_collapsed";

function railItemStyle(active: boolean, collapsed: boolean): React.CSSProperties {
  return {
    height: 40, borderRadius: 12, display: "flex", alignItems: "center",
    justifyContent: collapsed ? "center" : "flex-start",
    width: collapsed ? 40 : "100%",
    gap: 10, padding: collapsed ? 0 : "0 10px",
    background: active ? PIN.roseTint : "transparent",
    color: active ? PIN.accent : PIN.textSecondary,
    transition: "background-color 120ms ease, color 120ms ease",
  };
}

function Sidebar({ active, userEmail }: { active: NavKey; userEmail?: string | null }) {
  const navigate = useNavigate();
  // Read synchronously on mount (not in an effect) so the very first
  // render already reflects a returning user's saved preference --
  // avoids a one-frame flash of the wrong width. Same
  // typeof-window-guard pattern site-context.tsx already uses for its
  // own localStorage read.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <aside
      style={{
        width: collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH_EXPANDED, flexShrink: 0,
        display: "flex", flexDirection: "column", alignItems: collapsed ? "center" : "stretch",
        background: PIN.card, borderRight: `1px solid ${PIN.border}`, padding: "16px 12px",
        transition: "width 150ms ease", overflow: "hidden",
      }}
    >
      <Link to="/dashboard" aria-label="Dashboard" style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: collapsed ? 0 : 2, justifyContent: collapsed ? "center" : "flex-start" }}>
        <RedMark />
        {!collapsed && <span style={{ fontSize: 15, fontWeight: 700, color: PIN.textPrimary }}>Pinspider</span>}
      </Link>

      <nav
        className="no-scrollbar"
        style={{
          marginTop: 24, display: "flex", flexDirection: "column", gap: 4,
          overflowY: "auto", overflowX: "hidden", flex: 1, minHeight: 0, scrollbarWidth: "none",
        }}
      >
        {NAV.map(({ to, label, icon: Icon, key }) => (
          <Link key={to} to={to} title={label} style={railItemStyle(active === key, collapsed)}>
            <Icon size={19} style={{ flexShrink: 0 }} />
            {!collapsed && <span style={{ fontSize: 14, fontWeight: active === key ? 600 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>}
          </Link>
        ))}
      </nav>

      <button
        type="button"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={toggleCollapsed}
        style={{ ...railItemStyle(false, collapsed), border: "none", cursor: "pointer", marginTop: 8, background: "transparent" }}
      >
        {collapsed ? <PanelLeft size={18} style={{ flexShrink: 0 }} /> : <PanelLeftClose size={18} style={{ flexShrink: 0 }} />}
        {!collapsed && <span style={{ fontSize: 13, fontWeight: 500 }}>Collapse</span>}
      </button>

      <button
        type="button"
        title="Sign out"
        onClick={signOut}
        style={{ ...railItemStyle(false, collapsed), border: "none", cursor: "pointer", marginTop: 4, marginBottom: 12 }}
      >
        <LogOut size={19} style={{ flexShrink: 0 }} />
        {!collapsed && <span style={{ fontSize: 14, fontWeight: 500 }}>Sign out</span>}
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: collapsed ? 0 : 2, justifyContent: collapsed ? "center" : "flex-start" }}>
        <Avatar email={userEmail} />
        {!collapsed && <span style={{ fontSize: 13, color: PIN.textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{userEmail ?? "Account"}</span>}
      </div>
    </aside>
  );
}

function Avatar({ email }: { email?: string | null }) {
  return (
    <div
      style={{
        width: 32, height: 32, borderRadius: "50%", background: "#E8912D", color: "#FFFFFF",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700,
        fontFamily: PIN_FONT,
      }}
      title={email ?? "Account"}
    >
      {email ? email[0]!.toUpperCase() : "•"}
    </div>
  );
}

export function PinShell({
  active, userEmail, children,
}: {
  active: NavKey;
  userEmail?: string | null;
  children: ReactNode;
}) {
  // SiteProvider now lives here, once, instead of each route
  // (Dashboard/Schedule/Sites) mounting its own independent instance --
  // previously that meant three separate, unsynced copies of the same
  // selected-site state and sites list, and every other route (Pages,
  // Pins, Boards, Keywords, Logs, Settings) had no access to it at all.
  // A single instance here means one shared selection and one shared
  // sites-list query for the whole app.
  return (
    <SiteProvider>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: PIN.bg, fontFamily: PIN_FONT, color: PIN.textPrimary }}>
        <Sidebar active={active} userEmail={userEmail} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <OnboardingRedirectGuard />
          <HelpMenu />
          <FinishSetupBanner />
          {children}
        </div>
      </div>
    </SiteProvider>
  );
}

// Sends a not-yet-onboarded account into the wizard automatically, once,
// on first login -- every PinShell-rendered page mounts this (instead of
// duplicating the check into each route's own beforeLoad, the way the
// auth guard itself is currently duplicated 9x -- see the file-level
// comment above) so there's exactly one place this logic lives. Settings
// is deliberately excluded: it's both "onboarding, accessible again
// later" per the spec, and the Pinterest OAuth callback's landing page
// when a connect was started from inside the wizard (see
// StepIntegrations in routes/onboarding.tsx) -- redirecting away from it
// the instant it renders would yank a user off the very page confirming
// their Pinterest connection before they see it.
function OnboardingRedirectGuard() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data, isLoading, isFetching } = useSetupStatus();

  useEffect(() => {
    // isFetching (not just isLoading) matters here: right after "Skip
    // setup" or "Finish" writes dismissedOnboarding and the wizard
    // navigates here, react-query can still be holding the PREVIOUS
    // (stale, dismissedOnboarding: false) cached value for an instant
    // while the invalidated refetch is in flight -- isLoading is false
    // in that window because cached data already exists, so reading
    // only `data` here would redirect straight back into the wizard
    // before the fresh answer ever arrives. Waiting out isFetching too
    // closes that race. (The wizard also primes the cache directly via
    // setQueryData before navigating, as a second layer -- see
    // routes/onboarding.tsx -- but this guard shouldn't rely on that
    // alone either.)
    if (isLoading || isFetching || !data) return;
    if (data.isFullyOnboarded || data.dismissedOnboarding) return;
    if (pathname.startsWith("/settings") || pathname.startsWith("/onboarding")) return;
    navigate({ to: "/onboarding", search: { step: data.firstMissingWizardStep ?? 1 } });
  }, [isLoading, isFetching, data, pathname, navigate]);

  return null;
}

// The dedicated ShellHeader strip that used to live here (just the
// SiteSwitcher, alone, above everything) was removed -- the switcher
// now lives inline in the same search+filter row as every page's own
// TopBar (see components/PinTopBar.tsx), consistent with where it sits
// on Dashboard/Schedule, instead of on its own separate line. SiteProvider
// stays here as the single shared instance every page's TopBar and data
// queries read from.
