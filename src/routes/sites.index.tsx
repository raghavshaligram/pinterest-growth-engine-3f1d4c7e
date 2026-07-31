// Standalone route — the /sites LIST. Owns its own PinShell chrome, as
// every other page-level route does; sites.tsx is now a bare layout that
// only renders an <Outlet/> (see the note there for why).
//
// Read-only cards. All editing moved to /sites/$id — that split is what
// made it possible to delete the "Advanced" disclosure, which only ever
// existed because a card in a three-column grid had nowhere to put brand
// palette, typography and image-gen notes.
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PinShell } from "@/components/PinShell";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { getSitesOverview, deleteSite, crawlSite, type SiteOverviewRow } from "@/lib/sites.functions";
import { getErrorMessage } from "@/lib/error-message";
import { SETUP_STATUS_QUERY_KEY } from "@/lib/onboarding-gate";
import type { SiteFocusSearch } from "@/lib/site-mapping";
import { AddSiteWizard, SiteCard } from "@/routes/sites";

export const Route = createFileRoute("/sites/")({
  ssr: false,
  // Legacy deep-link shape: /sites?site=<id>&section=connections, which
  // is where every "map this site" link pointed before the site editor
  // had its own route. Still accepted and redirected below, so links
  // already in the wild — a toast the user hasn't clicked, an error
  // stored on a scheduled pin — keep working.
  validateSearch: (search: Record<string, unknown>): SiteFocusSearch => ({
    site: typeof search.site === "string" ? search.site : undefined,
    section: search.section === "connections" ? "connections" : undefined,
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  head: () => ({ meta: [{ title: "Sites — Pinspider" }] }),
  // SiteProvider lives inside PinShell itself (see components/PinShell.tsx).
  component: () => <SitesRoute />,
});

function SitesRoute() {
  const { user } = Route.useRouteContext();
  return (
    <PinShell active="sites" userEmail={user.email}>
      <div className="flex-1 overflow-y-auto px-8 py-6 no-scrollbar" style={{ scrollbarWidth: "none" }}>
        <SitesPage />
      </div>
    </PinShell>
  );
}

function SitesPage() {
  const qc = useQueryClient();
  const overviewFn = useServerFn(getSitesOverview);
  const delFn = useServerFn(deleteSite);
  const crawlFn = useServerFn(crawlSite);

  const { data: sites } = useQuery({ queryKey: ["sites-overview"], queryFn: () => overviewFn() });
  const [wizardOpen, setWizardOpen] = useState(false);
  // Legacy ?site=&section=connections links (shipped before the detail
  // route existed) are redirected to /sites/$id?tab=connections rather
  // than 404ing or silently doing nothing.
  const focus = Route.useSearch();
  const navigate = useNavigate();
  useEffect(() => {
    if (focus.site && focus.section === "connections") {
      navigate({ to: "/sites/$id", params: { id: focus.site }, search: { tab: "connections" as const }, replace: true });
    }
  }, [focus.site, focus.section, navigate]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["sites-overview"] });
    // SiteSwitcher/SiteProvider (Dashboard/Schedule) read the lighter
    // listSites query — keep both in sync on any change here.
    qc.invalidateQueries({ queryKey: ["sites-switcher"] });
    // getSetupStatus() derives site_connected/brand_identity straight
    // from the sites table — any add/edit/delete here can flip either,
    // and the Dashboard checklist, FinishSetupBanner, and the
    // onboarding wizard's own step logic all read this same cached
    // query. Without this, deleting a site (especially the last one)
    // leaves every one of those surfaces showing stale "done" state
    // until something unrelated happens to refetch it.
    qc.invalidateQueries({ queryKey: SETUP_STATUS_QUERY_KEY });
  }

  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Site removed"); invalidate(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const crawlMut = useMutation({
    mutationFn: (id: string) => crawlFn({ data: { siteId: id } }),
    onSuccess: (r) => { toast.success(`Crawl: +${r.added} added, ${r.updated} updated, ${r.errors} errors`); invalidate(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const rows = (sites ?? []) as SiteOverviewRow[];
  const totalPins = rows.reduce((sum, s) => sum + s.pinsCreated, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">My Sites</h1>
          <p className="text-sm text-muted-foreground">{rows.length} connected · {totalPins} total pins created</p>
        </div>
        {wizardOpen ? (
          <Button className="bg-black text-white hover:bg-neutral-900" onClick={() => setWizardOpen(false)}>
            <X className="mr-1.5 h-4 w-4" />Cancel
          </Button>
        ) : (
          <Button className="bg-[#E60023] text-white hover:bg-[#E60023]/90" onClick={() => setWizardOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />Add a site
          </Button>
        )}
      </header>

      {wizardOpen && (
        <AddSiteWizard onCancel={() => setWizardOpen(false)} onCreated={() => { setWizardOpen(false); invalidate(); }} />
      )}

      {/* items-start so a card that grows (extra warning rows, a longer
          brand name) can't stretch its neighbours to match. */}
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((site) => (
          <SiteCard
            key={site.id}
            site={site}
            onDelete={() => delMut.mutate(site.id)}
            onCrawl={() => crawlMut.mutate(site.id)}
            crawlPending={crawlMut.isPending}
          />
        ))}
      </div>
      {!rows.length && !wizardOpen && (
        <p className="text-sm text-muted-foreground">No sites yet — add one to get started.</p>
      )}
    </div>
  );
}
