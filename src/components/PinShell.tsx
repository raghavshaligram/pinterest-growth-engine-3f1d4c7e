// Shared chrome for the Pinterest-native Dashboard/Schedule pair (see
// routes/dashboard.tsx, routes/schedule.tsx). Both routes opt out of the
// shared _authenticated layout (AppShell) entirely -- own beforeLoad auth
// guard duplicated from _authenticated/route.tsx -- so this sidebar can
// go fully icon-rail/Pinterest-native without restyling
// Sites/Pages/Pins/Boards/Keywords/Logs/Settings, which all still render
// through the untouched AppShell.
//
// The reference Figma only shows 3 icons (dashboard/schedule/boards) --
// intentional for a 2-screen mockup, but this app has more real
// destinations than that. Rather than strand the user once they're on
// Dashboard/Schedule, the remaining nav (Sites, Pages, Pins, Keywords,
// Logs, Settings) lives behind a compact "more" icon at the bottom of
// the rail, so nothing that works today stops working.
import { Link, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Calendar, Layers, MoreHorizontal, Globe, FileText, Images,
  KeyRound, Settings2, ScrollText, LogOut,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { PIN, PIN_FONT } from "@/lib/pin-shell-tokens";
import type { ReactNode } from "react";

const PRIMARY_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/schedule", label: "Schedule", icon: Calendar },
  { to: "/boards", label: "Boards", icon: Layers },
] as const;

const MORE_NAV = [
  { to: "/sites", label: "Sites", icon: Globe },
  { to: "/pages", label: "Pages", icon: FileText },
  { to: "/pins", label: "Pins", icon: Images },
  { to: "/keywords", label: "Keywords", icon: KeyRound },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/settings/integrations", label: "Settings", icon: Settings2 },
] as const;

function RedMark({ size = 34 }: { size?: number }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%", background: PIN.accent,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}
      role="img"
      aria-label="Pinspider"
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2C6.48 2 2 6.13 2 11.23c0 3.9 2.44 7.23 5.9 8.57-.08-.73-.15-1.85.03-2.65.17-.72 1.1-4.6 1.1-4.6s-.28-.56-.28-1.38c0-1.29.75-2.26 1.68-2.26.79 0 1.17.6 1.17 1.31 0 .8-.51 2-.77 3.11-.22.93.47 1.69 1.39 1.69 1.67 0 2.96-1.76 2.96-4.31 0-2.25-1.62-3.83-3.94-3.83-2.68 0-4.26 2.01-4.26 4.09 0 .81.31 1.68.7 2.15a.28.28 0 0 1 .06.27c-.07.3-.23.93-.26 1.06-.04.17-.14.21-.32.13-1.2-.56-1.95-2.31-1.95-3.72 0-3.03 2.2-5.81 6.34-5.81 3.33 0 5.92 2.37 5.92 5.54 0 3.31-2.08 5.97-4.98 5.97-.97 0-1.88-.5-2.2-1.1l-.6 2.28c-.22.83-.8 1.87-1.19 2.5.9.28 1.85.43 2.85.43 5.52 0 10-4.13 10-9.23S17.52 2 12 2Z"
          fill="#FFFFFF"
        />
      </svg>
    </div>
  );
}

function railItemStyle(active: boolean): React.CSSProperties {
  return {
    width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
    background: active ? PIN.roseTint : "transparent",
    color: active ? PIN.accent : PIN.textSecondary,
    transition: "background-color 120ms ease, color 120ms ease",
  };
}

function Sidebar({ active, userEmail }: { active: "dashboard" | "schedule" | "boards"; userEmail?: string | null }) {
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

      <nav style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 8 }}>
        {PRIMARY_NAV.map(({ to, label, icon: Icon }) => {
          const key = to === "/dashboard" ? "dashboard" : to === "/schedule" ? "schedule" : "boards";
          return (
            <Link key={to} to={to} title={label} style={railItemStyle(active === key)}>
              <Icon size={19} />
            </Link>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" title="More" style={{ ...railItemStyle(false), border: "none", cursor: "pointer", marginBottom: 12 }}>
            <MoreHorizontal size={19} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="w-48">
          {MORE_NAV.map(({ to, label, icon: Icon }) => (
            <DropdownMenuItem key={to} asChild className="gap-2">
              <Link to={to}><Icon className="h-4 w-4" />{label}</Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut} className="gap-2">
            <LogOut className="h-4 w-4" />Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
  active: "dashboard" | "schedule" | "boards";
  userEmail?: string | null;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", height: "100vh", background: PIN.bg, fontFamily: PIN_FONT, color: PIN.textPrimary }}>
      <Sidebar active={active} userEmail={userEmail} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}
