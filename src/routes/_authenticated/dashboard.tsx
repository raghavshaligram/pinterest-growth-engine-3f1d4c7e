import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { dashboardStats } from "@/lib/dashboard.functions";
import { runImageWorker } from "@/lib/briefs.functions";
import { runPublisher } from "@/lib/schedule.functions";
import { runSerpSweep } from "@/lib/keywords.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Activity, ImageIcon, Send, Search, AlertCircle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — PinForge" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const qc = useQueryClient();
  const stats = useServerFn(dashboardStats);
  const imgFn = useServerFn(runImageWorker);
  const pubFn = useServerFn(runPublisher);
  const serpFn = useServerFn(runSerpSweep);

  const { data } = useQuery({ queryKey: ["dash"], queryFn: () => stats() });

  const trigger = (name: string, fn: () => Promise<unknown>) =>
    useMutation({
      mutationFn: fn,
      onSuccess: (r) => { toast.success(`${name}: ${JSON.stringify(r)}`); qc.invalidateQueries(); },
      onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
    });

  const imgM = trigger("Images", () => imgFn());
  const pubM = trigger("Publisher", () => pubFn());
  const serpM = trigger("SERP sweep", () => serpFn());

  const s = data;
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Your Pinterest growth engine at a glance.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => imgM.mutate()}><ImageIcon className="mr-2 h-4 w-4" />Generate images</Button>
          <Button variant="gradient" size="sm" onClick={() => pubM.mutate()}><Send className="mr-2 h-4 w-4" />Publish due</Button>
          <Button variant="outline" size="sm" onClick={() => serpM.mutate()}><Search className="mr-2 h-4 w-4" />SERP sweep</Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
        <Stat label="Pages" value={s?.pages ?? 0} />
        <Stat label="Pin briefs" value={s?.briefs ?? 0} />
        <Stat label="Scheduled" value={s?.scheduled ?? 0} glow />
        <Stat label="Published today" value={s?.publishedToday ?? 0} accent="text-success" glow />
        <Stat label="Failed" value={s?.failed ?? 0} accent={s?.failed ? "text-destructive" : undefined} />
        <Stat label="Queue jobs" value={s?.queuedJobs ?? 0} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Integration health</h2>
            <Link to="/settings/integrations" className="text-xs text-primary hover:underline">Manage</Link>
          </div>
          <ul className="space-y-2 text-sm">
            {(["openai","replicate","apify","pinterest"] as const).map((p) => {
              const row = s?.integrations.find((i) => i.provider === p);
              const status = row?.status ?? "unconfigured";
              return (
                <li key={p} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                  <span className="capitalize">{p}</span>
                  <Badge variant={status === "ok" ? "default" : status === "error" ? "destructive" : "secondary"}>
                    {status === "ok" ? <><CheckCircle2 className="mr-1 h-3 w-3" />Connected</> :
                      status === "error" ? <><AlertCircle className="mr-1 h-3 w-3" />Error</> : "Not configured"}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold flex items-center gap-2"><Activity className="h-4 w-4" />Recent activity</h2>
          <ul className="space-y-2 text-sm">
            {(s?.recentLogs ?? []).map((l, i) => (
              <li key={i} className="flex items-start gap-2 border-b border-border/40 py-1.5 last:border-0">
                <Badge variant={l.level === "error" ? "destructive" : "outline"} className="mt-0.5">{l.level}</Badge>
                <div className="flex-1">
                  <div>{l.message}</div>
                  <div className="text-xs text-muted-foreground">{new Date(l.at).toLocaleString()}</div>
                </div>
              </li>
            ))}
            {!s?.recentLogs.length && <li className="text-muted-foreground">No activity yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, accent, glow }: { label: string; value: number; accent?: string; glow?: boolean }) {
  return (
    <Card className={`p-4 ${glow ? "card-glow" : ""}`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-3xl ${accent ?? ""}`}>{value}</div>
    </Card>
  );
}
