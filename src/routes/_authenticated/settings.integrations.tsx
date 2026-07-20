import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listIntegrations, saveIntegration, testIntegration, deleteIntegration, startPinterestOAuth, getPinterestSettings } from "@/lib/integrations.functions";
import { getPublishingProfile, savePublishingProfile, getAccountHealth, setCapMode } from "@/lib/publishing-profile.functions";
import { describeCapEvent, capEventIsWarning, type CapEvent } from "@/lib/cap-event-copy";

// Mirrors SAFETY.maxPerAccountPerDay in scheduling-safety.server.ts (a
// server-only module, not imported client-side) — the true clamp is
// enforced server-side in publishing-profile.functions.ts:setCapMode;
// this is just the input's UI-level max hint.
const MAX_DAILY_CAP = 25;
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { CheckCircle2, AlertCircle, Trash2, Beaker, KeyRound, LinkIcon } from "lucide-react";

type Provider = "openai" | "replicate" | "apify" | "pinterest";

export const Route = createFileRoute("/_authenticated/settings/integrations")({
  head: () => ({ meta: [{ title: "Integrations — Pinspider" }] }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listIntegrations);
  const getProfile = useServerFn(getPublishingProfile);
  const { data } = useQuery({ queryKey: ["integrations"], queryFn: () => list() });
  const [showAgePrompt, setShowAgePrompt] = useState(false);

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
  }, [qc]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-4xl">Integrations</h1>
        <p className="text-sm text-muted-foreground">Bring your own credentials. Values are encrypted at rest with AES-256-GCM. Never leaves the server.</p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <IntegrationCard
          provider="openai"
          title="OpenAI"
          description="Powers page analysis, pin copy, and competitive pattern summaries from your SERP sweeps (title formats, themes, and what's saving well) — folded into new briefs when recent."
          fields={[{ name: "api_key", label: "API key", placeholder: "sk-…", type: "password" }]}
          status={data?.find((i) => i.provider === "openai")}
          onChanged={() => qc.invalidateQueries({ queryKey: ["integrations"] })}
        />
        <IntegrationCard
          provider="replicate"
          title="Replicate"
          description="Runs Nano Banana 2 (google/nano-banana-2) to render every pin image."
          fields={[{ name: "api_token", label: "API token", placeholder: "r8_…", type: "password" }]}
          status={data?.find((i) => i.provider === "replicate")}
          onChanged={() => qc.invalidateQueries({ queryKey: ["integrations"] })}
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
        <PinterestCard
          status={data?.find((i) => i.provider === "pinterest")}
          onChanged={() => qc.invalidateQueries({ queryKey: ["integrations"] })}
        />
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
function PublishingAgePrompt({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
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
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
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

function PinterestConnectButton() {
  const start = useServerFn(startPinterestOAuth);
  const connect = useMutation({
    mutationFn: () => start(),
    onSuccess: (r) => { window.location.href = r.authorizeUrl; },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
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

function PinterestCard(props: {
  status?: { status: string; last_error?: string | null; last_used_at?: string | null };
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const getSettings = useServerFn(getPinterestSettings);
  const save = useServerFn(saveIntegration);

  const { data } = useQuery({ queryKey: ["pinterest-settings"], queryFn: () => getSettings() });
  const mode = data?.publish_mode ?? "api";

  const [webhookUrl, setWebhookUrl] = useState("");
  useEffect(() => { setWebhookUrl(data?.webhook_url ?? ""); }, [data?.webhook_url]);

  const setMode = useMutation({
    mutationFn: (next: "api" | "webhook") =>
      save({ data: { provider: "pinterest", config: { publish_mode: next } } }),
    onSuccess: (_r, next) => {
      toast.success(next === "api" ? "Publishing via Pinterest API" : "Publishing via webhook");
      qc.invalidateQueries({ queryKey: ["pinterest-settings"] });
      props.onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const saveWebhook = useMutation({
    mutationFn: () => save({ data: { provider: "pinterest", config: { webhook_url: webhookUrl.trim() } } }),
    onSuccess: () => {
      toast.success("Webhook URL saved");
      qc.invalidateQueries({ queryKey: ["pinterest-settings"] });
      props.onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const status = props.status?.status ?? "unconfigured";

  return (
    <Card className="p-6">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h3 className="text-lg font-semibold">Pinterest</h3>
        </div>
        <Badge variant={status === "ok" ? "default" : status === "error" ? "destructive" : "secondary"}>
          {status === "ok" ? <><CheckCircle2 className="mr-1 h-3 w-3" />Connected</> :
            status === "error" ? <><AlertCircle className="mr-1 h-3 w-3" />Error</> : "Not configured"}
        </Badge>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Publish pins straight to your Pinterest account, or route them through your own automation instead.
      </p>
      {props.status?.last_error && (
        <p className="mb-4 text-xs text-destructive">{props.status.last_error}</p>
      )}

      <div className="space-y-2">
        <Label className="text-xs">Publish mode</Label>
        <div className="inline-flex rounded-md border p-0.5">
          <Button
            type="button"
            size="sm"
            variant={mode === "api" ? "default" : "ghost"}
            className="h-7 px-3"
            disabled={setMode.isPending}
            onClick={() => setMode.mutate("api")}
          >
            API
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "webhook" ? "default" : "ghost"}
            className="h-7 px-3"
            disabled={setMode.isPending}
            onClick={() => setMode.mutate("webhook")}
          >
            Webhook
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          API publishes directly to your connected Pinterest account. Webhook routes through a custom automation (e.g. Make.com, Zapier) instead.
        </p>
      </div>

      <CollapsibleSection open={mode === "api"}>
        <div className="mt-4 border-t pt-4">
          <PinterestConnectButton />
        </div>
      </CollapsibleSection>

      <CollapsibleSection open={mode === "webhook"}>
        <div className="mt-4 space-y-4 border-t pt-4">
          <div>
            <Label className="text-xs">Webhook URL</Label>
            <div className="mt-1 flex gap-2">
              <Input
                type="url"
                placeholder="https://hook.eu1.make.com/…"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                onClick={() => saveWebhook.mutate()}
                disabled={saveWebhook.isPending || !webhookUrl.trim()}
              >
                Save
              </Button>
            </div>
          </div>
          <div>
            <Label className="text-xs">Payload Pinspider will POST to this URL</Label>
            <pre className="mt-1 overflow-x-auto rounded bg-muted px-3 py-2 text-xs">
              <code>{WEBHOOK_PAYLOAD_EXAMPLE}</code>
            </pre>
          </div>
        </div>
      </CollapsibleSection>
    </Card>
  );
}

function IntegrationCard(props: {
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
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
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
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
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
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
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
