// Shared search + filter + site-switcher row, used at the top of every
// PinShell-rendered page. Dashboard and Schedule previously each
// defined their own near-identical local `TopBar` function; extracted
// here once the SiteSwitcher needed to join this same row on six pages
// instead of two, to avoid six copies of the same ~25 lines drifting
// out of sync. `children` is the trailing action slot (Dashboard's
// "Create Pin" link, Schedule's "Schedule" dropdown) -- left out
// entirely on pages that already have their own primary action button
// in their own header just below (Pages/Pins/Boards/Keywords), so the
// action isn't duplicated in two places on the same page.
import type { ReactNode } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { PIN } from "@/lib/pin-shell-tokens";
import { SiteSwitcher } from "@/components/SiteSwitcher";

export function TopBar({
  search, onSearch, placeholder = "Search...", children,
}: {
  search: string;
  onSearch: (v: string) => void;
  placeholder?: string;
  children?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 24px 12px" }}>
      <SiteSwitcher />
      <div
        style={{
          flex: 1, display: "flex", alignItems: "center", gap: 10, background: PIN.fieldBg,
          borderRadius: 999, padding: "0 14px", height: 36,
        }}
      >
        <Search size={18} style={{ color: PIN.textSecondary, flexShrink: 0 }} />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder}
          style={{ border: "none", outline: "none", background: "transparent", fontSize: 14, color: PIN.textPrimary, width: "100%" }}
        />
      </div>
      <button
        type="button"
        title="Filters"
        style={{
          width: 36, height: 36, borderRadius: 10, background: PIN.fieldBg, border: "none",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
      >
        <SlidersHorizontal size={17} style={{ color: PIN.textSecondary }} />
      </button>
      {children}
    </div>
  );
}
