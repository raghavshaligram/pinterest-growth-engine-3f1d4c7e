// Site switcher chip + dropdown, rendered once in PinShell's shared
// header (see ShellHeader in PinShell.tsx) so it's present in the same
// spot on every page instead of only existing as a non-interactive
// label on Dashboard.
//
// Uses Radix's Popover primitive directly (not the pre-styled
// Popover/PopoverContent wrapper in components/ui/popover.tsx, and not
// components/ui/select.tsx) for click-outside/escape/positioning
// behavior only -- every className/style here is custom, deliberately
// not the generic shadcn popover/select look (rounded-md, shadow-md,
// bg-popover). See SW below for why.
import { useState, type ReactNode } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ChevronDown, Layers, Check } from "lucide-react";
import { useSiteContext, type SiteOption } from "@/lib/site-context";
import { PIN_FONT, hostOf } from "@/lib/pin-shell-tokens";

// Mirrors styles.css's --border / --border-subtle / --surface-hover /
// --accent tokens -- the palette Sites/Pages/Pins/Boards/Keywords/Logs/
// Settings' shadcn-driven page bodies already use -- rather than
// pin-shell-tokens.ts's PIN object, which is the Pinterest-red palette
// scoped to Dashboard/Schedule's own page content. The switcher lives in
// PinShell's shared chrome and is visible on every page including the
// shadcn-styled ones, so it draws from the token set common to the whole
// app instead of introducing a third palette on top of the two that
// already coexist here.
const SW = {
  card: "#FFFFFF",
  border: "#E4E1D9",
  borderSubtle: "#EFECE4",
  hoverTint: "#F1EEE7",
  selectedTint: "#EFECE4",
  textPrimary: "#1C1B19",
  textSecondary: "#8A867C",
  textMuted: "#B0AC9F",
  accent: "#C23B22",
} as const;

function siteLabel(site: SiteOption): string {
  return site.brand_name || hostOf(site.url);
}

export function SiteSwitcher() {
  const { sites, selectedSiteId, selectedSite, setSelectedSiteId, isLoading } = useSiteContext();
  const [open, setOpen] = useState(false);
  const [triggerHover, setTriggerHover] = useState(false);

  const triggerLabel = isLoading ? "Loading…" : selectedSite ? siteLabel(selectedSite) : "All sites";
  const triggerDotColor = selectedSite ? selectedSite.accent_color ?? SW.textMuted : null;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          onMouseEnter={() => setTriggerHover(true)}
          onMouseLeave={() => setTriggerHover(false)}
          style={{
            display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 14px",
            borderRadius: 999, border: `1px solid ${SW.border}`,
            background: open || triggerHover ? SW.hoverTint : SW.card,
            fontFamily: PIN_FONT, fontSize: 13, fontWeight: 500, color: SW.textPrimary,
            cursor: "pointer", transition: "background-color 120ms ease",
          }}
        >
          {triggerDotColor ? (
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: triggerDotColor, flexShrink: 0 }} />
          ) : (
            <Layers size={13} style={{ color: SW.textSecondary, flexShrink: 0 }} />
          )}
          <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {triggerLabel}
          </span>
          <ChevronDown
            size={14}
            style={{
              color: SW.textSecondary, flexShrink: 0,
              transition: "transform 120ms ease", transform: open ? "rotate(180deg)" : "none",
            }}
          />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          style={{
            width: 240, background: SW.card, border: `1px solid ${SW.border}`, borderRadius: 16,
            boxShadow: "none", padding: 6, fontFamily: PIN_FONT, zIndex: 50,
          }}
        >
          <SiteRow
            label="All sites"
            icon={<Layers size={14} style={{ color: SW.textSecondary }} />}
            selected={selectedSiteId === null}
            onClick={() => { setSelectedSiteId(null); setOpen(false); }}
          />
          {sites.length > 0 && <Divider />}
          {sites.map((site, i) => (
            <div key={site.id}>
              <SiteRow
                label={siteLabel(site)}
                dotColor={site.accent_color ?? SW.textMuted}
                selected={selectedSiteId === site.id}
                onClick={() => { setSelectedSiteId(site.id); setOpen(false); }}
              />
              {i < sites.length - 1 && <Divider />}
            </div>
          ))}
          {!sites.length && !isLoading && (
            <div style={{ padding: "10px 8px", fontSize: 12.5, color: SW.textMuted }}>No sites yet</div>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function Divider() {
  return <div style={{ height: 1, background: SW.borderSubtle, margin: "4px 2px" }} />;
}

function SiteRow({
  label, dotColor, icon, selected, onClick,
}: {
  label: string;
  dotColor?: string;
  icon?: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%", height: 34, padding: "0 8px",
        borderRadius: 10, border: "none", cursor: "pointer", textAlign: "left",
        background: selected ? SW.selectedTint : hover ? SW.hoverTint : "transparent",
        fontFamily: PIN_FONT, fontSize: 13, color: SW.textPrimary,
      }}
    >
      {icon ?? <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />}
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {selected && <Check size={14} style={{ color: SW.accent, flexShrink: 0 }} />}
    </button>
  );
}
