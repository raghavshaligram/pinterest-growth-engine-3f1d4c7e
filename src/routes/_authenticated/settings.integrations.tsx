import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listIntegrations, saveIntegration, testIntegration, deleteIntegration, startPinterestOAuth, getPinterestRedirectUri } from "@/lib/integrations.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { CheckCircle2, AlertCircle, Trash2, Beaker, KeyRound, LinkIcon, Copy } from "lucide-react";

type Provider = "openai" | "replicate" | "apify" | "pinterest";

export const Route = createFileRoute("/_authenticated/settings/integrations")({
  head: () => ({ meta: [{ title: "Integrations — PinForge" }] }),
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

  const getRedirect = useServerFn(getPinterestRedirectUri);
  const { data: redirectData } = useQuery({
    queryKey: ["pinterest-redirect-uri"],
    queryFn: () => getRedirect(),
  });
  const redirectUri = redirectData?.redirectUri ?? "";

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
        <IntegrationCard
          provider="pinterest"
          title="Pinterest"
          description="Save App ID + Secret, then click Connect Pinterest to authorize your account (scopes: boards:read, pins:read, pins:write). Access + refresh tokens are stored automatically."
          fields={[
            { name: "app_id", label: "App ID", type: "text" },
            { name: "app_secret", label: "App secret", type: "password" },
          ]}
          status={data?.find((i) => i.provider === "pinterest")}
          onChanged={() => qc.invalidateQueries({ queryKey: ["integrations"] })}
          extra={
            <div className="space-y-2 pt-3 border-t">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <Label className="text-xs">Redirect URI (paste into your Pinterest app)</Label>
                  <code className="mt-1 block truncate rounded bg-muted px-2 py-1 text-xs">{redirectUri}</code>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(redirectUri); toast.success("Copied"); }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <PinterestConnectButton />
            </div>
          }
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
