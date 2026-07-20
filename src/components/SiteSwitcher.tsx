import { ChevronDown, Layers } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSiteContext } from "@/lib/site-context";

const FALLBACK_COLOR = "#8A867C";

function siteName(site: { url: string; brand_name: string | null }): string {
  if (site.brand_name) return site.brand_name;
  try {
    return new URL(site.url).hostname.replace(/^www\./, "");
  } catch {
    return site.url;
  }
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

export function SiteSwitcher() {
  const { sites, isLoading, selectedSiteId, selectedSite, setSelectedSiteId } = useSiteContext();

  if (isLoading) {
    return <div className="h-8 w-36 animate-pulse rounded-md bg-muted" />;
  }

  const label = selectedSite ? siteName(selectedSite) : "All sites";
  const swatchColor = selectedSite ? selectedSite.accent_color ?? FALLBACK_COLOR : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent"
          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
        >
          {swatchColor ? <Swatch color={swatchColor} /> : <Layers className="h-3.5 w-3.5" style={{ color: "var(--text-secondary)" }} />}
          <span>{label}</span>
          <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--text-secondary)" }} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={() => setSelectedSiteId(null)} className="gap-2">
          <Layers className="h-3.5 w-3.5" style={{ color: "var(--text-secondary)" }} />
          <span className={selectedSiteId === null ? "font-medium" : undefined}>All sites</span>
        </DropdownMenuItem>
        {sites.length > 0 && <div className="my-1 h-px" style={{ backgroundColor: "var(--border-subtle)" }} />}
        {sites.map((s) => (
          <DropdownMenuItem key={s.id} onClick={() => setSelectedSiteId(s.id)} className="gap-2">
            <Swatch color={s.accent_color ?? FALLBACK_COLOR} />
            <span className={selectedSiteId === s.id ? "font-medium" : undefined}>{siteName(s)}</span>
          </DropdownMenuItem>
        ))}
        {sites.length === 0 && (
          <div className="px-2 py-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
            No sites yet
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
