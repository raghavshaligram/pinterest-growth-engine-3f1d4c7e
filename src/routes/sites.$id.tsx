// Standalone route — opts out of the shared _authenticated layout
// (AppShell) so PinShell renders the Pinterest-native chrome, matching
// Dashboard/Schedule/Boards/Sites. beforeLoad duplicates the
// _authenticated route's auth guard; keep both in sync if that check
// ever changes.
//
// The site EDITOR, split out of the site LIST (routes/sites.tsx).
//
// Those two were previously one screen: every card on /sites carried a
// full inline editor behind two disclosure toggles. That is what pushed
// brand palette, typography and image-gen notes into an "Advanced"
// bucket — not a judgement that they matter less (they feed image
// generation directly), but simply that a card in a three-column grid
// had nowhere to put them. Giving the editor its own route removes the
// constraint, so nothing here is hidden.
//
// /sites/style-setup is a sibling static route and still wins over this
// dynamic one, so "style-setup" is never read as a site id.
import { createFileRoute, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PinShell } from "@/components/PinShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ChevronLeft, RefreshCcw, Loader2, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PinStyleSetupPanel } from "@/components/PinStyleSetupPanel";
import { getSitesOverview, upsertSite, crawlSite, type SiteOverviewRow, type SiteType } from "@/lib/sites.functions";
import { DEFAULT_WEBSITE_VERTICAL } from "@/lib/sites.functions";
import type { SiteVertical } from "@/lib/briefs.functions";
import { getErrorMessage } from "@/lib/error-message";
import { SETUP_STATUS_QUERY_KEY } from "@/lib/onboarding-gate";
import {
  BrandEditorFields, SiteConnectionsSection, ACCENT_PRESETS, hostFromUrl, formatShortDate,
} from "@/routes/sites";

// Height of the sticky save bar plus a gap, used to lift the toast
// stack clear of it. Named rather than inlined so the two places that
// care (this offset and the card's own bottom padding) can't drift.
const SAVE_BAR_CLEARANCE_PX = 88;

const TABS = ["brand", "connections", "activity"] as const;
export type SiteDetailTab = (typeof TABS)[number];

export const Route = createFileRoute("/sites/$id")({
  ssr: false,
  // Tab lives in the URL so it's linkable and survives a reload. Every
  // "map this site" deep link in the app targets ?tab=connections (see
  // lib/site-mapping.ts) — an unknown or absent value falls back to
  // brand rather than erroring, so an old or hand-edited link still
  // lands somewhere sensible.
  validateSearch: (search: Record<string, unknown>): { tab?: SiteDetailTab } => ({
    tab: TABS.includes(search.tab as SiteDetailTab) ? (search.tab as SiteDetailTab) : undefined,
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  head: () => ({ meta: [{ title: "Site — Pinspider" }] }),
  component: () => <SiteDetailRoute />,
});

function SiteDetailRoute() {
  const { user } = Route.useRouteContext();
  return (
    <PinShell active="sites" userEmail={user.email}>
      <div className="flex-1 overflow-y-auto px-8 py-6 no-scrollbar" style={{ scrollbarWidth: "none" }}>
        <SiteDetailPage />
      </div>
    </PinShell>
  );
}

function SiteDetailPage() {
  const { id } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const overviewFn = useServerFn(getSitesOverview);
  const crawlFn = useServerFn(crawlSite);

  // Same query/queryKey the list page uses, so navigating in from a card
  // paints immediately from cache rather than refetching. There is no
  // single-site server function and adding one was out of scope — the
  // overview is already loaded in almost every path that reaches here.
  const { data: sites, isLoading } = useQuery({ queryKey: ["sites-overview"], queryFn: () => overviewFn() });
  const site = (sites ?? []).find((s) => s.id === id) as SiteOverviewRow | undefined;

  const activeTab: SiteDetailTab = tab ?? "brand";
  const setTab = (next: SiteDetailTab) =>
    navigate({ to: "/sites/$id", params: { id }, search: { tab: next }, replace: true });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["sites-overview"] });
    qc.invalidateQueries({ queryKey: ["sites-switcher"] });
    qc.invalidateQueries({ queryKey: ["sites"] });
    // Brand name and the Pinterest mapping both feed getSetupStatus —
    // see the same invalidation on the list page for why this matters.
    qc.invalidateQueries({ queryKey: SETUP_STATUS_QUERY_KEY });
  }

  const crawlMut = useMutation({
    mutationFn: () => crawlFn({ data: { siteId: id } }),
    onSuccess: (r) => { toast.success(`Crawl: +${r.added} added, ${r.updated} updated, ${r.errors} errors`); invalidate(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!site) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">That site no longer exists.</p>
        <Link to="/sites" className="text-sm font-medium text-primary hover:underline">← Back to My Sites</Link>
      </div>
    );
  }

  const host = hostFromUrl(site.url);

  return (
    <div className="space-y-6">
      <div>
        <Link to="/sites" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />My Sites
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-display text-3xl">{site.brand_name || host}</h1>
            <p className="text-sm text-muted-foreground">{host}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => crawlMut.mutate()} disabled={crawlMut.isPending}>
            {crawlMut.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-1 h-3.5 w-3.5" />}
            Crawl
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors ${
              activeTab === t
                ? "border-[#E60023] text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Brand stays MOUNTED and is hidden rather than unmounted. Its
          seven fields are local state, so unmounting on a tab switch
          would silently throw away edits the save bar is at that moment
          advertising as "Unsaved changes" — and setTab uses replace, so
          Back wouldn't bring them either. The other two tabs hold no
          unsaved state and mount on demand. */}
      <div hidden={activeTab !== "brand"}>
        <BrandTab site={site} onSaved={invalidate} active={activeTab === "brand"} />
      </div>
      {activeTab === "connections" && (
        <Card className="p-5"><SiteConnectionsSection site={site} onSaved={invalidate} bare /></Card>
      )}
      {activeTab === "activity" && <ActivityTab site={site} onSaved={invalidate} />}
    </div>
  );
}

// ---------- Brand ----------

function BrandTab({ site, onSaved, active }: {
  site: SiteOverviewRow;
  onSaved: () => void;
  // This tab stays mounted while hidden (see the call site), so the
  // toast offset below has to key off visibility rather than mount —
  // otherwise the stack would sit lifted on the Connections and
  // Activity tabs, which have no save bar.
  active: boolean;
}) {
  const upsert = useServerFn(upsertSite);
  const [brandName, setBrandName] = useState(site.brand_name ?? "");
  const [tagline, setTagline] = useState(site.tagline ?? "");
  const [accentColor, setAccentColor] = useState(site.accent_color ?? ACCENT_PRESETS[0]);
  const [brandColors, setBrandColors] = useState<string[]>(Array.isArray(site.brand_colors) ? (site.brand_colors as string[]) : []);
  const [typography, setTypography] = useState(site.brand_font ?? "");
  const [notes, setNotes] = useState(site.brand_notes ?? "");
  const [vertical, setVertical] = useState<SiteVertical>(site.vertical ?? DEFAULT_WEBSITE_VERTICAL);

  const host = hostFromUrl(site.url);

  // Lift the toast stack above the save bar while this editor is on
  // screen, so a "Brand saved" toast can't land underneath the button
  // that produced it.
  //
  // Set on documentElement, NOT on the bar itself. The Toaster renders
  // as a sibling of <Outlet/> in __root.tsx, so it is not a descendant
  // of anything this component draws — and CSS custom properties
  // inherit downward only. A value declared on the bar would be
  // invisible to the toaster, and the var() would silently fall back to
  // its default. Cleared on unmount so every other screen goes back to
  // the normal 24px.
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.style.setProperty("--app-toast-bottom", `${SAVE_BAR_CLEARANCE_PX}px`);
    return () => { root.style.removeProperty("--app-toast-bottom"); };
  }, [active]);

  // Compared against the values this form loaded with, so the save bar
  // can say "nothing to save" honestly rather than being permanently
  // enabled. Arrays are compared as sorted joins because palette order
  // carries no meaning — reordering the same colours is not a change.
  const dirty = useMemo(() => {
    const initialColors = (Array.isArray(site.brand_colors) ? (site.brand_colors as string[]) : []).slice().sort().join("|");
    return (
      brandName !== (site.brand_name ?? "") ||
      tagline !== (site.tagline ?? "") ||
      accentColor !== (site.accent_color ?? ACCENT_PRESETS[0]) ||
      brandColors.slice().sort().join("|") !== initialColors ||
      typography !== (site.brand_font ?? "") ||
      notes !== (site.brand_notes ?? "") ||
      vertical !== (site.vertical ?? DEFAULT_WEBSITE_VERTICAL)
    );
  }, [brandName, tagline, accentColor, brandColors, typography, notes, vertical, site]);

  const saveMut = useMutation({
    mutationFn: () => upsert({
      data: {
        id: site.id, url: site.url, sitemap_url: site.sitemap_url ?? undefined,
        site_type: site.site_type,
        // Sent raw, NOT `value || undefined`. upsertSite spreads its
        // payload into a PostgREST upsert, which only writes the columns
        // present — so an undefined key means "leave this alone", and
        // clearing a field would silently do nothing while the save bar
        // stayed stuck on "Unsaved changes" forever (the local "" never
        // matching the unchanged stored value). Empty string is valid
        // per the validator and clears the column.
        brand_name: brandName,
        tagline: tagline,
        accent_color: accentColor,
        brand_colors: brandColors,
        brand_font: typography,
        brand_notes: notes,
        // Website-only, same reasoning as the add-site wizard — never
        // send this for etsy/ecomm sites so nothing can override their
        // trigger-assigned vertical through this form.
        vertical: site.site_type === "website" ? vertical : undefined,
      },
    }),
    onSuccess: () => { toast.success("Brand saved"); onSaved(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    // Bottom padding clears the sticky bar so the last field is never
    // trapped underneath it.
    <Card className="relative p-5 pb-24">
      <BrandEditorFields
        brandName={brandName} onBrandName={setBrandName}
        tagline={tagline} onTagline={setTagline}
        accentColor={accentColor} onAccentColor={setAccentColor}
        brandColors={brandColors}
        onToggleBrandColor={(hex) => setBrandColors((cur) => (cur.includes(hex) ? cur.filter((c) => c !== hex) : [...cur, hex]))}
        onRemoveLegacyColor={(hex) => setBrandColors((cur) => cur.filter((c) => c !== hex))}
        typography={typography} onTypography={setTypography}
        notes={notes} onNotes={setNotes}
        siteType={site.site_type as SiteType} vertical={vertical} onVertical={setVertical}
        previewLabel={host}
        previewHost={host}
      />

      {/* Sticky within the card, not fixed to the viewport: it tracks the
          bottom of the editor as you scroll but never floats over the
          rest of the app. */}
      <div className="sticky bottom-0 -mx-5 -mb-24 mt-8 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-5 py-3 backdrop-blur">
        <span className="text-xs text-muted-foreground">
          {saveMut.isPending ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <Button onClick={() => saveMut.mutate()} disabled={!dirty || saveMut.isPending}>
          {saveMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save brand
        </Button>
      </div>
    </Card>
  );
}

// ---------- Activity ----------

function ActivityTab({ site, onSaved }: { site: SiteOverviewRow; onSaved: () => void }) {
  const [styleSetupOpen, setStyleSetupOpen] = useState(false);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold">Activity</h3>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Stat label="Pages crawled" value={String(site.pageCount)} />
          <Stat label="Pins created" value={String(site.pinsCreated)} />
          <Stat
            label={site.site_type === "website" ? "Last crawled" : "Last indexed"}
            value={site.lastCrawledAt ? formatShortDate(site.lastCrawledAt) : "Never"}
          />
          <Stat label="Boards publishing here" value={String(site.boardsMappedCount)} />
          <Stat label="Sitemap" value={site.sitemap_url ? site.sitemap_url.replace(/^https?:\/\//, "") : "Not linked"} />
          <Stat label="Added" value={formatShortDate(site.created_at)} />
        </dl>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold">Pin style</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {site.style_locked_at
            ? `Previewed and locked in on ${formatShortDate(site.style_locked_at)}. Re-run it to change the look of future pins.`
            : "Not previewed yet — required before pins can be generated for this site."}
        </p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => setStyleSetupOpen(true)}>
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          {site.style_locked_at ? "Re-run pin style setup" : "Set up pin style"}
        </Button>
      </Card>

      <Dialog open={styleSetupOpen} onOpenChange={setStyleSetupOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pin Style Setup</DialogTitle>
          </DialogHeader>
          <PinStyleSetupPanel
            site={site}
            onDone={() => { setStyleSetupOpen(false); onSaved(); }}
            onAdjust={() => setStyleSetupOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{value}</dd>
    </div>
  );
}
