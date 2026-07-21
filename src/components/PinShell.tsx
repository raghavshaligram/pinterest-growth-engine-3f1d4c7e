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
import { Link, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Calendar, Layers, Globe, FileText, Images,
  KeyRound, Settings2, ScrollText, LogOut,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PIN, PIN_FONT } from "@/lib/pin-shell-tokens";
import { PinspiderMark } from "@/components/PinspiderMark";
import { SiteProvider } from "@/lib/site-context";
import { SiteSwitcher } from "@/components/SiteSwitcher";
import type { ReactNode } from "react";

type NavKey = "dashboard" | "schedule" | "boards" | "sites" | "pages" | "pins" | "keywords" | "logs" | "settings";

const NAV: ReadonlyArray<{ to: string; label: string; icon: typeof LayoutDashboard; key: NavKey }> = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, key: "dashboard" },
  { to: "/schedule", label: "Schedule", icon: Calendar, key: "schedule" },
  { to: "/boards", label: "Boards", icon: Layers, key: "boards" },
  { to: "/sites", label: "Sites", icon: Globe, key: "sites" },
  { to: "/pages", label: "Pages", icon: FileText, key: "pages" },
  { to: "/pins", label: "Pins", icon: Images, key: "pins" },
  { to: "/keywords", label: "Keywords", icon: KeyRound, key: "keywords" },
  { to: "/logs", label: "Logs", icon: ScrollText, key: "logs" },
  { to: "/settings/integrations", label: "Settings", icon: Settings2, key: "settings" },
];

function RedMark({ size = 34 }: { size?: number }) {
  return <PinspiderMark size={size} />;
}

function railItemStyle(active: boolean): React.CSSProperties {
  return {
    width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
    background: active ? PIN.roseTint : "transparent",
    color: active ? PIN.accent : PIN.textSecondary,
    transition: "background-color 120ms ease, color 120ms ease",
  };
}

function Sidebar({ active, userEmail }: { active: NavKey; userEmail?: string | null }) {
  const navigate = useNavigate();
  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <aside
      style={{
        width: 64, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center",
        background: PIN.card, borderRight: `1px solid ${PIN.border}`, padding: "16px 0",
      }}
    >
      <Link to="/dashboard" aria-label="Dashboard">
        <RedMark />
      </Link>

      <nav
        style={{
          marginTop: 24, display: "flex", flexDirection: "column", gap: 6,
          overflowY: "auto", flex: 1, minHeight: 0,
        }}
      >
        {NAV.map(({ to, label, icon: Icon, key }) => (
          <Link key={to} to={to} title={label} style={railItemStyle(active === key)}>
            <Icon size={19} />
          </Link>
        ))}
      </nav>

      <button
        type="button"
        title="Sign out"
        onClick={signOut}
        style={{ ...railItemStyle(false), border: "none", cursor: "pointer", marginTop: 12, marginBottom: 12 }}
      >
        <LogOut size={19} />
      </button>

      <Avatar email={userEmail} />
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
      <div style={{ display: "flex", height: "100vh", background: PIN.bg, fontFamily: PIN_FONT, color: PIN.textPrimary }}>
        <Sidebar active={active} userEmail={userEmail} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <ShellHeader />
          {children}
        </div>
      </div>
    </SiteProvider>
  );
}

// Persistent strip above every page's own content, holding the site
// switcher (see SiteSwitcher.tsx) -- previously the only site indicator
// anywhere was a non-interactive label inside Dashboard's own
// FilterPillsRow, and every other page had none at all. Deliberately
// minimal (no page title, no breadcrumbs) since each page still renders
// its own header content directly inside `children`; this row's only
// job is a consistent, always-present site switcher.
function ShellHeader() {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", padding: "12px 24px",
        borderBottom: "1px solid #EFECE4", background: PIN.card, flexShrink: 0,
      }}
    >
      <SiteSwitcher />
    </div>
  );
}
