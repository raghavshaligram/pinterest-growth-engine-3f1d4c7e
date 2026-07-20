import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listIntegrations, saveIntegration, testIntegration, deleteIntegration, startPinterestOAuth, getPinterestSettings } from "@/lib/integrations.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  const { data } = useQuery({ queryKey: ["integrations"], queryFn: () => list() });

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s = p.get("pinterest");
    if (s === "connected") {
      toast.success("Pinterest connected");
      qc.invalidateQueries({ queryKey: ["integrations"] });
      window.history.replaceState({}, "", window.location.pathname);
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
          description="Powers page analysis, pin strategy, copy, and winning-pattern clustering."
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
    </div>
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

      {mode === "api" ? (
        <div className="mt-4 border-t pt-4">
          <PinterestConnectButton />
        </div>
      ) : (
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
      )}
    </Card>
  );
}

function IntegrationCard(props: {
  provider: Provider;
  title: string;
  description: string;
  fields: { name: string; label: string; placeholder?: string; type: "text" | "password" }[];
  status?: { status: string; last_error?: string | null; last_used_at?: string | null };
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
    onSuccess: (r) => { r.ok ? toast.success(r.message) : toast.error(r.message); props.onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const delMut = useMutation({
    mutationFn: () => del({ data: { provider: props.provider } }),
    onSuccess: () => { toast.success("Cleared"); props.onChanged(); },
  });

  const status = props.status?.status ?? "unconfigured";
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
        {props.fields.map((f) => (
          <div key={f.name}>
            <Label>{f.label}</Label>
            <Input
              type={f.type}
              placeholder={f.placeholder}
              value={vals[f.name] ?? ""}
              onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))}
              autoComplete="new-password"
            />
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="submit" size="sm" disabled={saveMut.isPending}>Save</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => testMut.mutate()} disabled={testMut.isPending}>
            <Beaker className="mr-1 h-4 w-4" />Test
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => delMut.mutate()}>
            <Trash2 className="mr-1 h-4 w-4" />Clear
          </Button>
        </div>
        {props.status?.last_error && (
          <p className="pt-2 text-xs text-destructive">{props.status.last_error}</p>
        )}
      </form>
      {props.extra}
    </Card>
  );
}
