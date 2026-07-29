// Standalone route -- the redirect target for useSiteStyleGate
// (site-style-gate.ts) when a batch-generation action is blocked
// because the selected site has never completed Pin Style Setup
// (sites.style_locked_at is null), and also reachable directly from the
// Sites page for any site still showing that prompt. Opts out of the
// shared _authenticated layout the same way every other PinShell route
// in this app does; beforeLoad duplicates that route's auth guard.
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PinShell } from "@/components/PinShell";
import { PinStyleSetupPanel } from "@/components/PinStyleSetupPanel";
import { getSitesOverview } from "@/lib/sites.functions";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/sites/style-setup")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => z.object({ siteId: z.string().uuid() }).parse(search),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  head: () => ({ meta: [{ title: "Pin Style Setup — Pinspider" }] }),
  component: () => <StyleSetupRoute />,
});

function StyleSetupRoute() {
  const { user } = Route.useRouteContext();
  const { siteId } = Route.useSearch();
  const navigate = useNavigate();
  const listFn = useServerFn(getSitesOverview);
  const { data: sites, isLoading } = useQuery({ queryKey: ["sites-overview"], queryFn: () => listFn() });
  const site = sites?.find((s) => s.id === siteId);

  return (
    <PinShell active="sites" userEmail={user?.email}>
      <div className="flex-1 overflow-y-auto px-8 py-6 no-scrollbar" style={{ scrollbarWidth: "none" }}>
        <div className="mx-auto max-w-2xl">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />Loading…
            </div>
          )}
          {!isLoading && !site && (
            <p className="text-sm text-muted-foreground">Site not found.</p>
          )}
          {site && (
            <PinStyleSetupPanel
              site={site}
              onDone={() => navigate({ to: "/sites" })}
              onAdjust={() => navigate({ to: "/sites" })}
            />
          )}
        </div>
      </div>
    </PinShell>
  );
}
