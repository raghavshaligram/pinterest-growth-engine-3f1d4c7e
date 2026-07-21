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
import { PinspiderMark } from "@/components/PinspiderMark";
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
