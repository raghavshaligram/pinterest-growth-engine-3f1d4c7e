// Standalone route -- opts out of the shared _authenticated layout
// (AppShell) so PinShell renders the Pinterest-native chrome, matching
// Dashboard/Schedule/Boards/Sites. beforeLoad duplicates the
// _authenticated route's auth guard; keep both in sync if that check
// ever changes.
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PinShell } from "@/components/PinShell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listIntegrations, saveIntegration, testIntegration, deleteIntegration, startPinterestOAuth } from "@/lib/integrations.functions";
import {
  listApiKeyConnections, addApiKeyConnection, updateApiKeyConnection,
  renameApiKeyConnection, testApiKeyConnection, deleteApiKeyConnection,
} from "@/lib/api-key-connections.functions";
import type { ApiKeyConnectionSummary } from "@/lib/api-key-connections.server";
import { listGoogleConnections, startGoogleOAuth, disconnectGoogleConnection } from "@/lib/google.functions";
import { listPinterestConnections, startPinterestConnectionOAuth, disconnectPinterestConnection, setPinterestConnectionPublishMode } from "@/lib/pinterest-connections.functions";
import { getPublishingProfile, savePublishingProfile, getAccountHealth, setCapMode } from "@/lib/publishing-profile.functions";
import { describeCapEvent, capEventIsWarning, type CapEvent } from "@/lib/cap-event-copy";

// Mirrors SAFETY.maxPerAccountPerDay in scheduling-safety.server.ts (a
// server-only module, not imported client-side) — the true clamp is
// enforced server-side in publishing-profile.functions.ts:setCapMode;
// this is just the input's UI-level max hint.
const MAX_DAILY_CAP = 25;
import { Link as RouterLink } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InfoTooltip } from "@/components/InfoTooltip";
import { getAccountProviderDefaults, setAccountProviderDefault } from "@/lib/account-provider-defaults.functions";
import { useSiteContext } from "@/lib/site-context";
import { listSites, upsertSite, type SiteType } from "@/lib/sites.functions";
import { hostFromUrl } from "@/routes/sites";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useState, useEffect, type ReactNode } from "react";
import { CheckCircle2, AlertCircle, Trash2, Beaker, KeyRound, LinkIcon, Plus } from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";

type Provider =
  | "openai" | "replicate" | "apify" | "pinterest"
  | "fal" | "gemini" | "ideogram" | "recraft" | "stability" | "anthropic";

// Minimal shape this page needs from each site to render/edit the
// "Used by" picker on a key row -- id/url/sitemap_url/site_type are
// what upsertSite requires on every call (see sites.functions.ts), the
// rest is what's actually displayed or checked against.
type PickableSite = {
  id: string;
  url: string;
  sitemap_url: string | null;
  site_type: SiteType;
  brand_name: string | null;
  image_connection_override_id: string | null;
  copy_connection_override_id: string | null;
};

export const Route = createFileRoute("/settings/integrations")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  head: () => ({ meta: [{ title: "Integrations — Pinspider" }] }),
  component: () => <IntegrationsRoute />,
});

function IntegrationsRoute() {
  const { user } = Route.useRouteContext();
  return (
    <PinShell active="settings" userEmail={user?.email}>
      <div className="flex-1 overflow-y-auto px-8 py-6 no-scrollbar" style={{ scrollbarWidth: "none" }}>
        <IntegrationsPage />
      </div>
    </PinShell>
  );
}

function IntegrationsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listIntegrations);
  const getProfile = useServerFn(getPublishingProfile);
  const { data } = useQuery({ queryKey: ["integrations"], queryFn: () => list() });
  const [showAgePrompt, setShowAgePrompt] = useState(false);

  const getDefaults = useServerFn(getAccountProviderDefaults);
  const setDefault = useServerFn(setAccountProviderDefault);
  const { data: providerDefaults } = useQuery({ queryKey: ["account-provider-defaults"], queryFn: () => getDefaults() });
  const setDefaultMut = useMutation({
    mutationFn: (vars: { kind: "image" | "copy"; connectionId: string }) => setDefault({ data: vars }),
    onSuccess: (_r, vars) => {
      toast.success(`Default ${vars.kind === "image" ? "image" : "copy"} generation key updated`);
      qc.invalidateQueries({ queryKey: ["account-provider-defaults"] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  // Multi-connection API-key providers (Image/Copy Generation cards
  // below) -- a separate query from ["integrations"] (which now only
  // covers Apify + Pinterest's legacy row) since these 8 providers
  // moved to their own real multi-row table.
  const listConns = useServerFn(listApiKeyConnections);
  const { data: apiKeyConnections } = useQuery({ queryKey: ["api-key-connections"], queryFn: () => listConns() });
  const invalidateConnections = () => {
    qc.invalidateQueries({ queryKey: ["api-key-connections"] });
    qc.invalidateQueries({ queryKey: ["account-provider-defaults"] });
  };

  // Every site this account has, for the "Used by" picker on each key
  // row below -- this is where a site's provider override now gets
  // ASSIGNED from (see ApiKeyConnectionRow); the site's own Connections
  // section (Sites page) still shows the result but is read-only there,
  // linking back here to change it. Same ["sites"] query key
  // boards.tsx's own listSites call already uses -- React Query dedupes.
  const listSitesFn = useServerFn(listSites);
  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: () => listSitesFn() });

  // The default-key description below links out to a site's own
  // Connections section -- as of this pass that section is read-only
  // (it just shows the result), since per-site assignment now happens
  // right here via each key row's "Used by" picker. The link's still
  // useful for reviewing a specific site's current mapping alongside
  // its Pinterest/GA4 connections, just no longer where you'd change
  // it. Links straight to whichever site is currently selected via the
  // site-switcher context (same selectedSiteId every other page reads)
  // and jumps to that site's own card (SiteCard sets id={`site-card-
  // ${site.id}`}) via a hash anchor. Falls back to a plain /sites link
  // when nothing's selected ("All sites").
  const { selectedSiteId } = useSiteContext();
  const connectionsHash = selectedSiteId ? `site-card-${selectedSiteId}` : undefined;
  const connectionsLink = (
    <Link
      to="/sites"
      hash={connectionsHash}
      className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
    >
      that site's Connections section
    </Link>
  );

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s = p.get("pinterest");
    if (s === "connected") {
      toast.success("Pinterest connected");
      qc.invalidateQueries({ queryKey: ["integrations"] });
      window.history.replaceState({}, "", window.location.pathname);
      // First-time connect: ask how old the account is so the nightly
      // auto-publisher can pick a safe starting pace. Skipped entirely
      // if they've already answered this once.
      getProfile()
        .then((profile) => { if (!profile) setShowAgePrompt(true); })
        .catch(() => { /* non-fatal — just skip the prompt if the check fails */ });
    } else if (s === "error") {
      toast.error(`Pinterest connect failed: ${p.get("reason") ?? "unknown"}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
    const g = p.get("google");
    if (g === "connected") {
      toast.success("Google account connected");
      qc.invalidateQueries({ queryKey: ["google-connections"] });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (g === "error") {
      toast.error(`Google connect failed: ${p.get("reason") ?? "unknown"}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
    const pc = p.get("pinterest_connection");
    if (pc === "connected") {
      toast.success("Pinterest account connected");
      qc.invalidateQueries({ queryKey: ["pinterest-connections"] });
      qc.invalidateQueries({ queryKey: ["sites-overview"] });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [qc]);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Integrations</h1>
          <p className="text-sm text-muted-foreground">Bring your own credentials. Values are encrypted at rest with AES-256-GCM. Never leaves the server.</p>
        </div>
        {/* Re-opens the same wizard the account either finished or
            skipped on first login (routes/onboarding.tsx) -- no ?step=
            here on purpose, so the wizard's own resume logic picks the
            right step from real data (e.g. straight to the Pinterest
            age-bucket question if that's the only genuine gap) instead
            of this link guessing a fixed step number. Doesn't touch any
            real data, just re-opens the guided flow. */}
        <RouterLink
          to="/onboarding"
          className="inline-flex h-9 shrink-0 items-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
        >
          Setup guide
        </RouterLink>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <GenerationProvidersCard
          title="Image Generation"
          description={
            <>
              Sets the account-wide default for pin artwork. Expand a key below and check a site under "Used by" to pin that site to this exact key instead -- {connectionsLink} shows the result per site, but assigning happens here.
            </>
          }
          providers={IMAGE_GEN_PROVIDERS}
          connections={apiKeyConnections ?? []}
          sites={sites ?? []}
          kind="image"
          onChanged={invalidateConnections}
          currentDefaultConnectionId={providerDefaults?.default_image_connection_id}
          onSetDefault={(connectionId) => setDefaultMut.mutate({ kind: "image", connectionId })}
        />
        <GenerationProvidersCard
          title="Copy Generation"
          description={
            <>
              Sets the account-wide default for pin titles, taglines, and calls-to-action. Expand a key below and check a site under "Used by" to pin that site to this exact key instead -- {connectionsLink} shows the result per site, but assigning happens here.
            </>
          }
          providers={COPY_GEN_PROVIDERS}
          connections={apiKeyConnections ?? []}
          sites={sites ?? []}
          kind="copy"
          onChanged={invalidateConnections}
          currentDefaultConnectionId={providerDefaults?.default_copy_connection_id}
          onSetDefault={(connectionId) => setDefaultMut.mutate({ kind: "copy", connectionId })}
        />
        <IntegrationCard
          provider="apify"
          title="Apify"
          description="Runs fatihtahta/pinterest-scraper-search for daily SERP + ranking data."
          fields={[
            { name: "api_token", label: "API token", placeholder: "apify_api_…", type: "password" },
            { name: "actor_id", label: "Actor ID", placeholder: "fatihtahta~pinterest-scraper-search", type: "text" },
          ]}
          status={data?.find((i) => i.provider === "apify")}
          onChanged={() => qc.invalidateQueries({ queryKey: ["integrations"] })}
        />
        <PinterestConnectionsCard />
        <GoogleConnectionsCard />
      </div>

      <AccountHealthSection />

      <PublishingAgePrompt open={showAgePrompt} onOpenChange={setShowAgePrompt} />
    </div>
  );
}

// Shown once, right after a successful Pinterest OAuth connect, if the
// user hasn't answered it before. Three buttons, not a form — this only
// sets a starting point; reconcileTier() (publishing-profile.server.ts)
// keeps adjusting it against real account activity afterward.
export function PublishingAgePrompt({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const save = useServerFn(savePublishingProfile);
  const mut = useMutation({
    mutationFn: (ageBucket: "new" | "warming" | "established") => save({ data: { ageBucket } }),
    onSuccess: (r) => {
      toast.success(
        r.adjusted
          ? `Posting pace set to "${r.tier}" — adjusted from your answer based on the account's current activity.`
          : `Posting pace set to "${r.tier}".`,
      );
      qc.invalidateQueries({ queryKey: ["publishing-profile"] });
      qc.invalidateQueries({ queryKey: ["account-health"] });
      // Also shared by the onboarding wizard's Pinterest sub-step
      // (routes/onboarding.tsx) -- this is what flips pinterest_connected
      // to done there (it requires a profile row to exist, not just a
      // working OAuth token, so answering this question is the thing
      // that actually completes that step).
      qc.invalidateQueries({ queryKey: ["setup-status"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>How old is this Pinterest account?</DialogTitle>
          <DialogDescription>
            This sets how many pins we auto-publish per day. Newer accounts get a much more
            conservative pace to stay well clear of Pinterest's spam filters — we'll keep
            adjusting it automatically as the account grows, so this is just a starting point.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          {(
            [
              { key: "new" as const, label: "Brand new", hint: "Under 3 months old" },
              { key: "warming" as const, label: "Getting established", hint: "3–12 months old" },
              { key: "established" as const, label: "Well established", hint: "Over a year old" },
            ]
          ).map((opt) => (
            <Button
              key={opt.key}
              type="button"
              variant="outline"
              className="h-auto justify-start py-3"
              onClick={() => mut.mutate(opt.key)}
              disabled={mut.isPending}
            >
              <div className="text-left">
                <div className="font-medium">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.hint}</div>
              </div>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PinterestConnectButton({ returnTo }: { returnTo?: "settings" | "onboarding" }) {
  const start = useServerFn(startPinterestOAuth);
  const connect = useMutation({
    mutationFn: () => start({ data: { returnTo } }),
    onSuccess: (r) => { window.location.href = r.authorizeUrl; },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <Button type="button" size="sm" onClick={() => connect.mutate()} disabled={connect.isPending}>
      <LinkIcon className="mr-1 h-4 w-4" />
      {connect.isPending ? "Redirecting…" : "Connect Pinterest"}
    </Button>
  );
}

// Read-only example of the payload the "Webhook" publish path POSTs — kept
// in sync by hand with webhookPublish()'s body in pinterest.server.ts,
// which deliberately mirrors apiPublish()'s Pinterest-facing field names.
const WEBHOOK_PAYLOAD_EXAMPLE = `{
  "board_id": "<pinterest board id>",
  "title": "<pin title>",
  "description": "<pin description>",
  "alt_text": "<pin alt text>",
  "link": "<destination page URL>",
  "image_url": "<signed pin image URL, valid 24h>"
}`;

// Animates height smoothly between a collapsed (0fr) and expanded (1fr) row
// using the CSS grid-template-rows trick, instead of a raw conditional
// that snaps between two different-height blocks. Both `open` and `!open`
// content stay mounted the whole time — only the row's fraction (and thus
// its rendered height) changes — so toggling never unmounts/remounts
// whatever's inside, and the transition animates smoothly regardless of
// how tall either side's content actually is.
function CollapsibleSection(props: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: props.open ? "1fr" : "0fr",
        transition: "grid-template-rows 250ms ease",
      }}
      aria-hidden={!props.open}
    >
      <div className="overflow-hidden">{props.children}</div>
    </div>
  );
}


type GenProviderField = { name: string; label: string; placeholder?: string; type: "text" | "password" };
export type GenProviderMeta = {
  provider: Provider;
  title: string;
  fields: GenProviderField[];
  // Documented compositing/image-input capability -- only set for image
  // providers (see IMAGE_GEN_PROVIDERS below), left undefined for copy
  // providers where it doesn't apply. Confirmed against each provider's
  // own docs at implementation time (see fal-image.server.ts etc.'s own
  // comments for the specific endpoints); a provider with no compositing
  // support at all would say so explicitly here instead of omitting it,
  // per the "don't invent characteristics without evidence" rule --
  // in practice every provider checked here does support it.
  compositingNote?: string;
  defaultNote?: string;
};

// Image Generation providers. "replicate" here is specifically Nano
// Banana 2 (google/nano-banana-2) -- unchanged from before this card
// existed. Adding a future provider is one entry in this array plus a
// branch in pin-render.server.ts, never a new top-level card.
export const IMAGE_GEN_PROVIDERS: GenProviderMeta[] = [
  {
    provider: "replicate", title: "Nano Banana 2 (Replicate)",
    fields: [{ name: "api_token", label: "API token", placeholder: "r8_…", type: "password" }],
    compositingNote: "Supports image compositing/editing (Replicate's broader model catalog).",
    defaultNote: "Historically stronger at accurate on-image text rendering -- worth testing on text-heavy templates (listicle, quick_tip_grid) per side-by-side testing.",
  },
  {
    provider: "openai", title: "OpenAI",
    fields: [{ name: "api_key", label: "API key", placeholder: "sk-…", type: "password" }],
    compositingNote: "Supports image editing/compositing via /v1/images/edits.",
    defaultNote: "Cleaner on minimal/text-light templates (quote_stat_card, problem_solution_headline) per side-by-side testing. Current default.",
  },
  {
    provider: "fal", title: "fal.ai",
    fields: [{ name: "api_key", label: "API key", placeholder: "API key…", type: "password" }],
    compositingNote: "Supports image compositing/editing via its Kontext model family.",
    defaultNote: "Not yet benchmarked.",
  },
  {
    provider: "gemini", title: "Google Gemini",
    fields: [{ name: "api_key", label: "API key", placeholder: "AIza…", type: "password" }],
    compositingNote: "Supports blending/editing multiple images in a single call.",
    defaultNote: "Not yet benchmarked.",
  },
  {
    provider: "ideogram", title: "Ideogram",
    fields: [{ name: "api_key", label: "API key", placeholder: "API key…", type: "password" }],
    compositingNote: "Supports image editing/compositing via its Edit, Remix, and Replace Background endpoints.",
    defaultNote: "Not yet benchmarked.",
  },
  {
    provider: "recraft", title: "Recraft",
    fields: [{ name: "api_key", label: "API key", placeholder: "API key…", type: "password" }],
    compositingNote: "Supports image compositing/editing via its imageToImage endpoint.",
    defaultNote: "Not yet benchmarked.",
  },
  {
    provider: "stability", title: "Stability AI",
    fields: [{ name: "api_key", label: "API key", placeholder: "sk-…", type: "password" }],
    compositingNote: "Supports image compositing/editing via its image-to-image mode.",
    defaultNote: "Not yet benchmarked.",
  },
];

// Copy Generation providers -- write pin titles/taglines/CTAs. OpenAI
// appears in both this card and Image Generation above -- it's the same
// PROVIDER either way, but as of the multi-connection pass, each card
// only ever offers/lists that provider's connections relevant to the
// generation kind it's showing -- a single OpenAI connection can be
// picked as the default (or a site's override) for image OR copy
// independently, expanding either row lists the same underlying
// connections.
export const COPY_GEN_PROVIDERS: GenProviderMeta[] = [
  { provider: "openai", title: "OpenAI", fields: [{ name: "api_key", label: "API key", placeholder: "sk-…", type: "password" }] },
  { provider: "anthropic", title: "Anthropic (Claude)", fields: [{ name: "api_key", label: "API key", placeholder: "sk-ant-…", type: "password" }] },
];

// One row per CONNECTION (a specific labeled key) -- collapsed by
// default (label, status, quiet expand link), expandable to rotate
// that connection's own credential + Test/Delete. A provider can now
// have several of these (ProviderKeyGroup below renders one per
// connection, e.g. two separate OpenAI keys for two different
// clients), unlike the old one-row-per-provider model this replaces.
// Reuses the exact CollapsibleSection + status-badge pattern
// PinterestConnectionRow already established, just scoped to one
// API-key credential instead of publish_mode/webhook_url.
function ApiKeyConnectionRow({
  connection, meta, sites, kind, onChanged,
}: {
  connection: ApiKeyConnectionSummary;
  meta: GenProviderMeta;
  // Both optional: FirstApiKeySetup (onboarding's own simpler single-
  // provider setup UI) reuses this same row but never passes them,
  // since a brand-new account has no meaningful site-assignment
  // decision to make yet -- the "Used by" section below just doesn't
  // render without a kind to know which site column it'd read/write.
  sites?: PickableSite[];
  kind?: "image" | "copy";
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState(connection.label);
  const [vals, setVals] = useState<Record<string, string>>({});
  const update = useServerFn(updateApiKeyConnection);
  const rename = useServerFn(renameApiKeyConnection);
  const test = useServerFn(testApiKeyConnection);
  const del = useServerFn(deleteApiKeyConnection);
  const upsert = useServerFn(upsertSite);

  const saveMut = useMutation({
    mutationFn: () => update({ data: { id: connection.id, config: Object.fromEntries(Object.entries(vals).filter(([, v]) => v)) } }),
    onSuccess: () => { toast.success("Saved"); setVals({}); onChanged(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const renameMut = useMutation({
    mutationFn: () => rename({ data: { id: connection.id, label: label.trim() || connection.label } }),
    onSuccess: () => { toast.success("Renamed"); setRenaming(false); onChanged(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const testMut = useMutation({
    mutationFn: () => test({ data: { id: connection.id } }),
    onSuccess: (r) => {
      const prefix = "Testing saved credential — ";
      r.ok ? toast.success(prefix + r.message) : toast.error(prefix + r.message);
      onChanged();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const delMut = useMutation({
    mutationFn: () => del({ data: { id: connection.id } }),
    onSuccess: () => { toast.success("Deleted"); onChanged(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  // Assigns/unassigns THIS specific connection as a site's provider
  // override -- this is the feature that moved here from the site's
  // own Connections section (ProviderOverrideCard, sites.tsx, now
  // read-only). Writes the exact same image_connection_override_id /
  // copy_connection_override_id field upsertSite already accepted --
  // no data-model change, just a different screen setting it.
  const overrideField = kind === "image" ? "image_connection_override_id" : "copy_connection_override_id";
  const assignMut = useMutation({
    mutationFn: (vars: { site: PickableSite; checked: boolean }) =>
      upsert({
        data: {
          id: vars.site.id, url: vars.site.url, sitemap_url: vars.site.sitemap_url ?? undefined, site_type: vars.site.site_type,
          [overrideField]: vars.checked ? connection.id : null,
        },
      }),
    onSuccess: (_r, vars) => {
      const siteName = vars.site.brand_name || hostFromUrl(vars.site.url);
      toast.success(vars.checked ? `${siteName} now uses this key` : `${siteName} no longer pinned to this key`);
      qc.invalidateQueries({ queryKey: ["sites"] });
      qc.invalidateQueries({ queryKey: ["sites-overview"] });
      qc.invalidateQueries({ queryKey: ["sites-switcher"] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="rounded-md border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form
              onSubmit={(e) => { e.preventDefault(); renameMut.mutate(); }}
              className="flex items-center gap-1.5"
            >
              <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-7 max-w-[12rem] text-xs" autoFocus />
              <Button type="submit" size="sm" className="h-7 px-2 text-xs" disabled={renameMut.isPending}>Save</Button>
              <Button
                type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs"
                onClick={() => { setRenaming(false); setLabel(connection.label); }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <button
              type="button"
              className="truncate text-left text-sm font-medium underline-offset-2 hover:underline"
              onClick={() => setRenaming(true)}
              title="Click to rename this key"
            >
              {connection.label}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {connection.status === "ok" ? (
            <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" />Connected</span>
          ) : connection.status === "error" ? (
            <span className="flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-3 w-3" />Error</span>
          ) : (
            <span className="text-xs text-muted-foreground">Not configured</span>
          )}
          <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide" : "Configure"}
          </button>
        </div>
      </div>

      <CollapsibleSection open={expanded}>
        <div className="mt-3 space-y-3 border-t pt-3">
          <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} className="space-y-3">
            {meta.fields.map((f) => (
              <div key={f.name}>
                <Label>{f.label}</Label>
                <Input
                  type={f.type}
                  placeholder="•••••••• (saved — leave blank to keep)"
                  value={vals[f.name] ?? ""}
                  onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))}
                  autoComplete="new-password"
                />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={saveMut.isPending}>Save new key</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => testMut.mutate()} disabled={testMut.isPending}>
                <Beaker className="mr-1 h-4 w-4" />Test
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => delMut.mutate()} disabled={delMut.isPending}>
                <Trash2 className="mr-1 h-4 w-4" />Delete
              </Button>
            </div>
            {connection.last_error && <p className="text-xs text-destructive">{connection.last_error}</p>}
          </form>

          {kind && sites && (
            <div className="border-t pt-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <Label className="text-xs">Used by</Label>
                <InfoTooltip text="Check a site to pin it to this exact key, regardless of the account default. Unchecked sites may still use this key if it's the account default -- they just aren't explicitly pinned to it." />
              </div>
              {sites.length === 0 ? (
                <p className="text-xs text-muted-foreground">No sites yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {sites.map((s) => {
                    const checked = s[overrideField] === connection.id;
                    const siteName = s.brand_name || hostFromUrl(s.url);
                    return (
                      <label key={s.id} className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={checked}
                          disabled={assignMut.isPending}
                          onCheckedChange={(v) => assignMut.mutate({ site: s, checked: Boolean(v) })}
                        />
                        <span className="truncate">{siteName}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}

// Inline "+ Add another key" form -- creates a brand NEW connection for
// this provider, distinct from ApiKeyConnectionRow's own Save (which
// rotates an EXISTING connection's credential in place).
function AddKeyForm({
  meta, onDone, onCancel,
}: {
  meta: GenProviderMeta;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const add = useServerFn(addApiKeyConnection);

  const addMut = useMutation({
    mutationFn: () => add({ data: { provider: meta.provider, label: label.trim() || "My key", config: vals } }),
    onSuccess: () => { toast.success("Key added"); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); addMut.mutate(); }} className="space-y-3 rounded-md border border-dashed px-3 py-3">
      <div>
        <Label className="text-xs">Label</Label>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`e.g. "Client A's key"`}
          className="h-8 text-xs"
        />
      </div>
      {meta.fields.map((f) => (
        <div key={f.name}>
          <Label className="text-xs">{f.label}</Label>
          <Input
            type={f.type}
            placeholder={f.placeholder}
            value={vals[f.name] ?? ""}
            onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))}
            autoComplete="new-password"
            className="h-8 text-xs"
          />
        </div>
      ))}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={addMut.isPending}>Save key</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

// Minimal single-provider connection manager for onboarding's
// first-run setup (StepIntegrations, routes/onboarding.tsx) -- reuses
// the exact same ApiKeyConnectionRow/AddKeyForm the consolidated cards
// below use, scoped to one provider at a time, so the very first key
// a brand-new account saves (or adds later, revisiting the step) is a
// real api_key_connections row, not a parallel one-off form. Starts
// with the add form already open when there's no existing connection
// yet, since that's the only thing to do on a fresh account.
export function FirstApiKeySetup({
  meta, connections, onChanged,
}: {
  meta: GenProviderMeta;
  connections: ApiKeyConnectionSummary[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(connections.length === 0);
  return (
    <div className="space-y-2">
      {connections.map((c) => (
        <ApiKeyConnectionRow key={c.id} connection={c} meta={meta} onChanged={onChanged} />
      ))}
      {adding ? (
        <AddKeyForm
          meta={meta}
          onDone={() => { setAdding(false); onChanged(); }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-4 w-4" />Add another key
        </Button>
      )}
    </div>
  );
}

// One provider group -- collapsed by default (icon, title, summary
// status), expandable to that provider's own connections list, "+ Add
// another key," and its Notes field. Reuses the exact same
// CollapsibleSection + independent per-row useState(false) toggle
// pattern PinterestConnectionRow already established for the
// Pinterest-accounts list (confirmed: each Pinterest/Google row
// manages its own expanded state independently -- opening one doesn't
// collapse another -- so this does the same, just one level up, at
// the provider-group level instead of the individual-connection level
// ApiKeyConnectionRow already collapses at).
function ProviderKeyGroup({
  meta, connections, sites, kind, onChanged,
}: {
  meta: GenProviderMeta;
  connections: ApiKeyConnectionSummary[];
  sites: PickableSite[];
  kind: "image" | "copy";
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);

  // Same lightweight per-user preference pattern PinShell's sidebar-
  // collapse state and site-context.tsx's selected-site already use --
  // not the encrypted table, since notes aren't secret and shouldn't
  // vanish just because a specific key gets deleted.
  const notesKey = `pinspider_provider_note_${meta.provider}`;
  const [note, setNote] = useState(() => {
    if (typeof window === "undefined") return meta.defaultNote ?? "";
    return window.localStorage.getItem(notesKey) ?? meta.defaultNote ?? "";
  });
  function saveNote(v: string) {
    setNote(v);
    if (typeof window !== "undefined") window.localStorage.setItem(notesKey, v);
  }

  return (
    <div className="rounded-md border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white" style={{ background: "#6B7280" }} aria-hidden>
            <KeyRound className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 truncate text-sm font-medium">{meta.title}</div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {connections.length > 0 ? `${connections.length} key${connections.length > 1 ? "s" : ""} connected` : "Not configured"}
          </span>
          <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide" : "Configure"}
          </button>
        </div>
      </div>

      <CollapsibleSection open={expanded}>
        <div className="mt-2.5">
          {meta.compositingNote && <p className="mb-2 text-xs text-muted-foreground">{meta.compositingNote}</p>}

          {connections.length > 0 && (
            <div className="space-y-2">
              {connections.map((c) => (
                <ApiKeyConnectionRow key={c.id} connection={c} meta={meta} sites={sites} kind={kind} onChanged={onChanged} />
              ))}
            </div>
          )}

          <div className="mt-2.5">
            {adding ? (
              <AddKeyForm meta={meta} onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus className="mr-1 h-4 w-4" />
                {connections.length > 0 ? "Add another key" : "Add key"}
              </Button>
            )}
          </div>

          <div className="mt-2.5">
            <div className="mb-1 flex items-center gap-1.5">
              <Label className="text-xs">Notes</Label>
              <InfoTooltip text="Your own reference notes on this provider -- e.g. which templates it renders best. Saved locally to this browser, not shared across devices." />
            </div>
            <Textarea
              value={note}
              onChange={(e) => saveNote(e.target.value)}
              rows={2}
              className="text-xs"
              placeholder="Notes on this provider…"
            />
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}

// Card shell shared by Image Generation and Copy Generation -- same
// Card/header/status-badge/description shape as PinterestConnectionsCard
// below, just listing ProviderKeyGroup instead of PinterestConnectionRow.
function GenerationProvidersCard({
  title, description, providers, connections, sites, kind, onChanged, currentDefaultConnectionId, onSetDefault,
}: {
  title: string;
  description: ReactNode;
  providers: GenProviderMeta[];
  connections: ApiKeyConnectionSummary[];
  // This account's sites, threaded down to each ApiKeyConnectionRow's
  // "Used by" picker -- `kind` tells that picker which of a site's two
  // override columns (image_connection_override_id vs
  // copy_connection_override_id) it's reading/writing, since the SAME
  // connection (e.g. one OpenAI key) can independently appear as a row
  // in both this card and its sibling, and a site's image/copy
  // assignments are fully independent of each other.
  sites: PickableSite[];
  kind: "image" | "copy";
  onChanged: () => void;
  // Account-level default CONNECTION for this card's generation kind
  // (image or copy) -- per-site overrides (now assigned via each key
  // row's "Used by" picker, ProviderOverrideCard in sites.tsx is
  // read-only) fall back to whatever this is set to. Flattened across
  // every provider in this card, so "OpenAI (My key)" and "OpenAI
  // (Client A's key)" are both selectable independently even though
  // they're the same provider.
  currentDefaultConnectionId?: string | null;
  onSetDefault: (connectionId: string) => void;
}) {
  const providerTitle: Record<string, string> = Object.fromEntries(providers.map((p) => [p.provider, p.title]));
  const relevantConnections = connections.filter((c) => providers.some((p) => p.provider === c.provider));
  const connectedCount = relevantConnections.length;

  return (
    <Card className="p-6">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h3 className="text-lg font-semibold">{title}</h3>
        </div>
        <Badge variant={connectedCount > 0 ? "default" : "secondary"}>
          {connectedCount > 0 ? <><CheckCircle2 className="mr-1 h-3 w-3" />{connectedCount} key{connectedCount > 1 ? "s" : ""}</> : "Not configured"}
        </Badge>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{description}</p>

      {connectedCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <Label className="shrink-0 text-xs font-medium text-muted-foreground">Default key</Label>
          <Select value={currentDefaultConnectionId ?? undefined} onValueChange={onSetDefault}>
            <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="Choose a default…" /></SelectTrigger>
            <SelectContent>
              {relevantConnections.map((c) => (
                <SelectItem key={c.id} value={c.id}>{providerTitle[c.provider]} ({c.label})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <InfoTooltip text="Every site inherits this unless it has its own override set in that site's Connections section." />
        </div>
      )}

      <div className="space-y-2">
        {providers.map((p) => (
          <ProviderKeyGroup
            key={p.provider}
            meta={p}
            connections={connections.filter((c) => c.provider === p.provider)}
            sites={sites}
            kind={kind}
            onChanged={onChanged}
          />
        ))}
      </div>
    </Card>
  );
}

// Multi-account Pinterest connections -- this is now the ONLY Pinterest
// card in Settings. The original single-account card (account-wide
// "Connect Pinterest" + API/Webhook toggle, reading/writing the legacy
// `integrations` row) has been retired now that publishing itself
// (publisher.server.ts) and board syncing (boards.functions.ts) both
// read from pinterest_connections instead -- keeping that old card
// around would have let someone reconfigure a connection the real
// pipeline no longer consults. The legacy `integrations` row and its
// OAuth mechanism (PinterestConnectButton, startPinterestOAuth) still
// exist underneath, used only by the onboarding wizard's Pinterest step
// and the one-time lazy backfill that reads it -- not exposed here
// anymore. This list is what the per-site Connections picker (sites.tsx)
// actually draws from, and each row now owns its own publish_mode/
// webhook_url (see PinterestConnectionRow below).
function PinterestConnectionsCard() {
  const qc = useQueryClient();
  const list = useServerFn(listPinterestConnections);
  const startOAuth = useServerFn(startPinterestConnectionOAuth);
  const disconnect = useServerFn(disconnectPinterestConnection);

  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["pinterest-connections"], queryFn: () => list() });

  const connectMut = useMutation({
    mutationFn: () => startOAuth(),
    onSuccess: (r) => { window.location.href = r.authorizeUrl; },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const disconnectMut = useMutation({
    mutationFn: (id: string) => disconnect({ data: { id } }),
    onSuccess: () => {
      toast.success("Pinterest account disconnected");
      qc.invalidateQueries({ queryKey: ["pinterest-connections"] });
      // Any site mapped to this connection loses its mapping too (ON
      // DELETE SET NULL on sites.pinterest_connection_id) -- refresh the
      // site-data queries the Connections card actually reads.
      qc.invalidateQueries({ queryKey: ["sites-overview"] });
      qc.invalidateQueries({ queryKey: ["sites-switcher"] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const connections = data ?? [];

  return (
    <Card className="p-6">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h3 className="text-lg font-semibold">Pinterest accounts</h3>
        </div>
        <Badge variant={connections.length > 0 ? "default" : "secondary"}>
          {connections.length > 0
            ? <><CheckCircle2 className="mr-1 h-3 w-3" />{connections.length} connected</>
            : "Not configured"}
        </Badge>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Map each site to its own Pinterest account below (Sites page → that site's Connections section). Each connection has its own publish mode -- expand a row to set API vs. webhook for that specific account.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-sm text-destructive">Couldn't load Pinterest accounts — {getErrorMessage(error)}</p>
          <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" onClick={() => refetch()}>
            Try again
          </button>
        </div>
      )}
      {!isLoading && !isError && connections.length === 0 && (
        <p className="mb-4 text-sm text-muted-foreground">No Pinterest accounts connected yet.</p>
      )}

      {connections.length > 0 && (
        <div className="mb-4 space-y-2">
          {connections.map((conn) => (
            <PinterestConnectionRow
              key={conn.id}
              connection={conn}
              onDisconnect={() => disconnectMut.mutate(conn.id)}
              disconnectPending={disconnectMut.isPending}
            />
          ))}
        </div>
      )}

      <Button type="button" size="sm" variant="outline" onClick={() => connectMut.mutate()} disabled={connectMut.isPending}>
        <Plus className="mr-1 h-4 w-4" />
        {connectMut.isPending ? "Redirecting…" : "Connect another Pinterest account"}
      </Button>
    </Card>
  );
}

// Deliberately a list of rows, not a single fixed card like the other
// providers -- google_connections is a genuinely multi-row table (one
// user can connect several Google accounts, e.g. an agency managing
// multiple clients), unlike openai/replicate/apify/pinterest which are
// UNIQUE(user_id, provider) and can only ever have one row. Styled to
// match PinterestCard/IntegrationCard's existing look (same Card,
// KeyRound-weight icon slot, status dot+text, quiet text actions)
// rather than a data-table with columns/checkboxes.
function GoogleConnectionsCard() {
  const qc = useQueryClient();
  const list = useServerFn(listGoogleConnections);
  const startOAuth = useServerFn(startGoogleOAuth);
  const disconnect = useServerFn(disconnectGoogleConnection);

  const { data, isLoading } = useQuery({ queryKey: ["google-connections"], queryFn: () => list() });

  const connectMut = useMutation({
    mutationFn: () => startOAuth(),
    onSuccess: (r) => { window.location.href = r.authorizeUrl; },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const disconnectMut = useMutation({
    mutationFn: (id: string) => disconnect({ data: { id } }),
    onSuccess: () => {
      toast.success("Google account disconnected");
      qc.invalidateQueries({ queryKey: ["google-connections"] });
      // Any site mapped to this connection loses its GA4 mapping too
      // (ON DELETE SET NULL on sites.google_connection_id) -- refresh
      // both site-data query keys sites.tsx actually uses so that's
      // reflected (ga4_property_id/_label are left stale on the row
      // itself, but the "mapped" check reads google_connection_id and
      // that's genuinely nulled, so this doesn't show as connected).
      qc.invalidateQueries({ queryKey: ["sites-overview"] });
      qc.invalidateQueries({ queryKey: ["sites-switcher"] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const connections = data ?? [];

  return (
    <Card className="p-6">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h3 className="text-lg font-semibold">Google Analytics</h3>
        </div>
        <Badge variant={connections.length > 0 ? "default" : "secondary"}>
          {connections.length > 0
            ? <><CheckCircle2 className="mr-1 h-3 w-3" />{connections.length} connected</>
            : "Not configured"}
        </Badge>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Connect one or more Google accounts to read GA4 traffic on the Insights page and each site's Connections section — read-only, never modifies your Analytics data.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && connections.length === 0 && (
        <p className="mb-4 text-sm text-muted-foreground">No Google accounts connected yet.</p>
      )}

      {connections.length > 0 && (
        <div className="mb-4 space-y-2">
          {connections.map((conn) => (
            <div key={conn.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ background: "#4285F4" }}
                  aria-hidden
                >
                  G
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{conn.label}</div>
                  {conn.google_email && (
                    <div className="truncate text-xs text-muted-foreground">{conn.google_email}</div>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="flex items-center gap-1 text-xs text-emerald-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Connected
                </span>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
                  onClick={() => disconnectMut.mutate(conn.id)}
                  disabled={disconnectMut.isPending}
                >
                  Disconnect
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button type="button" size="sm" variant="outline" onClick={() => connectMut.mutate()} disabled={connectMut.isPending}>
        <Plus className="mr-1 h-4 w-4" />
        {connectMut.isPending ? "Redirecting…" : "Connect another Google account"}
      </Button>
    </Card>
  );
}

// One row per Pinterest connection -- collapsed by default (icon,
// label/username, status, quiet Disconnect), expandable to that specific
// connection's own publish_mode/webhook_url editor. Reuses
// CollapsibleSection (previously only used by the now-retired
// account-wide PinterestCard) and the same API/Webhook segmented-button
// pattern that card used, just scoped per-row instead of per-account.
function PinterestConnectionRow({
  connection, onDisconnect, disconnectPending,
}: {
  connection: { id: string; label: string; pinterest_username: string | null; publish_mode: "api" | "webhook"; webhook_url: string | null };
  onDisconnect: () => void;
  disconnectPending: boolean;
}) {
  const qc = useQueryClient();
  const setMode = useServerFn(setPinterestConnectionPublishMode);
  const [expanded, setExpanded] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState(connection.webhook_url ?? "");

  const modeMut = useMutation({
    mutationFn: (vars: { publish_mode: "api" | "webhook"; webhook_url?: string | null }) =>
      setMode({ data: { id: connection.id, ...vars } }),
    onSuccess: (_r, vars) => {
      toast.success(vars.publish_mode === "api" ? "Publishing via Pinterest API" : "Publishing via webhook");
      qc.invalidateQueries({ queryKey: ["pinterest-connections"] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="rounded-md border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
            style={{ background: "#E60023" }}
            aria-hidden
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{connection.label}</div>
            {connection.pinterest_username && (
              <div className="truncate text-xs text-muted-foreground">@{connection.pinterest_username}</div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="flex items-center gap-1 text-xs text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Connected
          </span>
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide settings" : "Publish settings"}
          </button>
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
            onClick={onDisconnect}
            disabled={disconnectPending}
          >
            Disconnect
          </button>
        </div>
      </div>

      <CollapsibleSection open={expanded}>
        <div className="mt-3 space-y-2 border-t pt-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Publish mode</span>
            <InfoTooltip text="API publishes directly to this connection's Pinterest account. Webhook sends each pin's data to a URL you provide instead, so you can route publishing through your own automation." />
          </div>
          <div className="inline-flex rounded-md border p-0.5">
            <Button
              type="button" size="sm"
              variant={connection.publish_mode === "api" ? "default" : "ghost"}
              className="h-7 px-3"
              disabled={modeMut.isPending}
              onClick={() => modeMut.mutate({ publish_mode: "api" })}
            >
              API
            </Button>
            <Button
              type="button" size="sm"
              variant={connection.publish_mode === "webhook" ? "default" : "ghost"}
              className="h-7 px-3"
              disabled={modeMut.isPending}
              onClick={() => modeMut.mutate({ publish_mode: "webhook", webhook_url: webhookUrl.trim() || undefined })}
            >
              Webhook
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            API publishes directly through this connection's own Pinterest account. Webhook routes this connection's pins through your own automation (e.g. Make.com, Zapier) instead.
          </p>
          {connection.publish_mode === "webhook" && (
            <>
              <div className="flex gap-2">
                <Input
                  type="url"
                  placeholder="https://hook.eu1.make.com/…"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
                <Button
                  type="button" size="sm"
                  onClick={() => modeMut.mutate({ publish_mode: "webhook", webhook_url: webhookUrl.trim() })}
                  disabled={modeMut.isPending || !webhookUrl.trim()}
                >
                  Save
                </Button>
              </div>
              <div>
                <Label className="text-xs">Payload Pinspider will POST to this URL</Label>
                <pre className="mt-1 overflow-x-auto rounded bg-muted px-3 py-2 text-xs">
                  <code>{WEBHOOK_PAYLOAD_EXAMPLE}</code>
                </pre>
              </div>
            </>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}

export function IntegrationCard(props: {
  provider: Provider;
  title: string;
  description: string;
  fields: { name: string; label: string; placeholder?: string; type: "text" | "password" }[];
  status?: { status: string; last_error?: string | null; last_used_at?: string | null; has_value?: boolean };
  onChanged: () => void;
  extra?: React.ReactNode;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const save = useServerFn(saveIntegration);
  const test = useServerFn(testIntegration);
  const del = useServerFn(deleteIntegration);

  const saveMut = useMutation({
    mutationFn: () => save({ data: { provider: props.provider, config: Object.fromEntries(Object.entries(vals).filter(([, v]) => v)) } }),
    onSuccess: () => { toast.success("Saved"); setVals({}); props.onChanged(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const testMut = useMutation({
    mutationFn: () => test({ data: { provider: props.provider } }),
    onSuccess: (r) => {
      // Test always validates whatever's already saved on the server, never
      // unsaved text in the fields above — make that explicit so a passing
      // test can't be misread as "the box's current contents are connected."
      const prefix = "Testing saved credential — ";
      r.ok ? toast.success(prefix + r.message) : toast.error(prefix + r.message);
      props.onChanged();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const delMut = useMutation({
    mutationFn: () => del({ data: { provider: props.provider } }),
    onSuccess: () => { toast.success("Cleared"); props.onChanged(); },
  });

  const status = props.status?.status ?? "unconfigured";
  const hasValue = props.status?.has_value ?? false;
  return (
    <Card className="p-6">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h3 className="text-lg font-semibold">{props.title}</h3>
        </div>
        <Badge variant={status === "ok" ? "default" : status === "error" ? "destructive" : "secondary"}>
          {status === "ok" ? <><CheckCircle2 className="mr-1 h-3 w-3" />Connected</> :
            status === "error" ? <><AlertCircle className="mr-1 h-3 w-3" />Error</> : "Not configured"}
        </Badge>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{props.description}</p>

      <form
        onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }}
        className="space-y-3"
      >
        {props.fields.map((f) => {
          // The credential (password-type) field never gets its actual value
          // sent to the client — has_value just tells us one is stored, so
          // an empty box can say "something's saved" instead of looking
          // identical to "nothing's ever been saved here."
          const placeholder = f.type === "password" && hasValue && !vals[f.name]
            ? "•••••••• (saved — leave blank to keep)"
            : f.placeholder;
          return (
            <div key={f.name}>
              <Label>{f.label}</Label>
              <Input
                type={f.type}
                placeholder={placeholder}
                value={vals[f.name] ?? ""}
                onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))}
                autoComplete="new-password"
              />
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="submit" size="sm" disabled={saveMut.isPending}>Save</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => testMut.mutate()} disabled={testMut.isPending}>
            <Beaker className="mr-1 h-4 w-4" />Test
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => delMut.mutate()}>
            <Trash2 className="mr-1 h-4 w-4" />Clear
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Test checks the credential already saved on the server — not unsaved text typed above. Click Save first to test a new value.
        </p>
        {props.status?.last_error && (
          <p className="pt-2 text-xs text-destructive">{props.status.last_error}</p>
        )}
      </form>
      {props.extra}
    </Card>
  );
}

// Visibility + control on top of the scheduling engine: current tier,
// the daily cap the nightly materializer is actually using, an auto/
// manual switch, and the account_cap_events history explaining every
// past change. Hidden entirely for accounts that haven't onboarded yet
// (no Pinterest connect -> no profile row -> nothing to show).
function AccountHealthSection() {
  const qc = useQueryClient();
  const getHealth = useServerFn(getAccountHealth);
  const setMode = useServerFn(setCapMode);
  const { data } = useQuery({ queryKey: ["account-health"], queryFn: () => getHealth() });
  const [manualDraft, setManualDraft] = useState<string>("");

  const modeMut = useMutation({
    mutationFn: (vars: { mode: "auto" | "manual"; manualCap?: number }) => setMode({ data: vars }),
    onSuccess: (r) => {
      toast.success(r.cap_mode === "manual" ? `Manual cap set to ${r.effectiveCap}/day` : "Back to automatic cap control");
      qc.invalidateQueries({ queryKey: ["account-health"] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const profile = data?.profile;
  if (!profile) return null;

  const isManual = profile.cap_mode === "manual";
  const effectiveCap = isManual ? (profile.manual_cap ?? profile.current_daily_cap) : profile.current_daily_cap;

  return (
    <Card className="p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Account health</h2>
          <p className="text-sm text-muted-foreground">
            How many pins/day the nightly auto-publisher sends to this Pinterest account, and why.
          </p>
        </div>
        <Badge variant="outline" className="capitalize">{profile.reconciled_tier} tier</Badge>
      </div>

      <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
        <div>
          <div className="text-xs uppercase text-muted-foreground">Daily cap</div>
          <div className="text-3xl font-semibold leading-tight">
            {effectiveCap}
            <span className="ml-1.5 text-sm font-normal text-muted-foreground">pins/day</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-3 sm:justify-end">
          <Label htmlFor="cap-mode-switch" className="text-sm">
            {isManual ? "Manual control" : "Automatic (weekly-adjusted)"}
          </Label>
          <Switch
            id="cap-mode-switch"
            checked={isManual}
            disabled={modeMut.isPending}
            onCheckedChange={(checked: boolean) => {
              if (checked) {
                const seed = profile.manual_cap ?? profile.current_daily_cap;
                setManualDraft(String(seed));
                modeMut.mutate({ mode: "manual", manualCap: seed });
              } else {
                modeMut.mutate({ mode: "auto" });
              }
            }}
          />
        </div>
      </div>

      {isManual && (
        <div className="mt-4 flex items-end gap-2">
          <div className="w-40">
            <Label htmlFor="manual-cap-input" className="text-xs">Manual daily cap</Label>
            <Input
              id="manual-cap-input"
              type="number"
              min={1}
              max={MAX_DAILY_CAP}
              defaultValue={effectiveCap}
              onChange={(e) => setManualDraft(e.target.value)}
              onBlur={() => {
                const n = Number(manualDraft);
                if (Number.isFinite(n) && n >= 1 && n <= MAX_DAILY_CAP && n !== effectiveCap) {
                  modeMut.mutate({ mode: "manual", manualCap: n });
                }
              }}
            />
          </div>
          <p className="pb-2 text-xs text-muted-foreground">
            The weekly auto-adjustment job leaves this alone while manual control is on.
          </p>
        </div>
      )}

      <div className="mt-6">
        <div className="mb-2 text-xs uppercase text-muted-foreground">Recent cap history</div>
        <div className="space-y-1.5">
          {!data?.events.length && <p className="text-sm text-muted-foreground">No cap changes yet.</p>}
          {data?.events.map((e) => <CapEventRow key={e.id} event={e as CapEvent & { id: string; created_at: string }} />)}
        </div>
      </div>
    </Card>
  );
}

function CapEventRow({ event }: { event: CapEvent & { id: string; created_at: string } }) {
  const warning = capEventIsWarning(event.event_type);
  const hasCapChange = event.from_cap !== null && event.to_cap !== null && event.from_cap !== event.to_cap;
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={warning ? "destructive" : "outline"} className="text-[10px] capitalize">
            {event.event_type.replace(/_/g, " ")}
          </Badge>
          {hasCapChange && (
            <span className="text-xs text-muted-foreground">{event.from_cap} → {event.to_cap} pins/day</span>
          )}
        </div>
        <p className="mt-1 text-sm">{describeCapEvent(event)}</p>
        {event.event_type === "api_error_brake" && (
          <Link to="/logs" className="mt-0.5 inline-block text-xs text-primary hover:underline">
            View the errors →
          </Link>
        )}
      </div>
      <div className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
        {new Date(event.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </div>
    </div>
  );
}
