import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPages, analyzePage } from "@/lib/pages.functions";
import { generateBriefs, runImageWorker } from "@/lib/briefs.functions";
import { runFullPipeline } from "@/lib/schedule.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Sparkles, ImageIcon, Zap, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/pages/")({
  head: () => ({ meta: [{ title: "Pages — PinForge" }] }),
  component: PagesPage,
});

function PagesPage() {
  const qc = useQueryClient();
  const list = useServerFn(listPages);
  const analyze = useServerFn(analyzePage);
  const gen = useServerFn(generateBriefs);
  const imgFn = useServerFn(runImageWorker);
  const pipeline = useServerFn(runFullPipeline);

  const { data } = useQuery({ queryKey: ["pages"], queryFn: () => list() });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["pages"] });

  const pipelineM = useMutation({
    mutationFn: () => pipeline({ data: { maxAnalyze: 25, maxBriefs: 15, maxImages: 30 } }),
    onSuccess: (r) => { toast.success(`Pipeline: analyzed ${r.analyzed}, briefs for ${r.briefsFor}, queued ${r.imagesQueued} images`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const analyzeAllM = useMutation({
    mutationFn: async () => {
      const targets = (data ?? []).filter((p) => !p.last_analyzed_at).slice(0, 25);
      let ok = 0, fail = 0;
      for (const p of targets) {
        try { await analyze({ data: { pageId: p.id } }); ok++; }
        catch { fail++; }
      }
      return { ok, fail, total: targets.length };
    },
    onSuccess: (r) => { toast.success(`Analyzed ${r.ok}/${r.total} pages${r.fail ? ` (${r.fail} failed)` : ""}`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const briefsAllM = useMutation({
    mutationFn: async () => {
      const targets = (data ?? []).filter((p) => p.last_analyzed_at).slice(0, 25);
      let ok = 0, fail = 0;
      for (const p of targets) {
        try { await gen({ data: { pageId: p.id, count: 10 } }); ok++; }
        catch { fail++; }
      }
      return { ok, fail, total: targets.length };
    },
    onSuccess: (r) => { toast.success(`Generated briefs for ${r.ok}/${r.total} pages${r.fail ? ` (${r.fail} failed)` : ""}`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const renderAllM = useMutation({
    mutationFn: () => imgFn(),
    onSuccess: (r) => { toast.success(`Image worker: ${JSON.stringify(r)}`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const analyzedCount = (data ?? []).filter((p) => p.last_analyzed_at).length;
  const pendingCount = (data ?? []).filter((p) => !p.last_analyzed_at).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Pages</h1>
          <p className="text-sm text-muted-foreground">
            {data?.length ?? 0} pages · {analyzedCount} analyzed · {pendingCount} pending
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => pipelineM.mutate()} disabled={pipelineM.isPending}>
            {pipelineM.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            Run full pipeline
          </Button>
          <Button size="sm" variant="outline" onClick={() => analyzeAllM.mutate()} disabled={analyzeAllM.isPending || pendingCount === 0}>
            {analyzeAllM.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Analyze all ({pendingCount})
          </Button>
          <Button size="sm" variant="outline" onClick={() => briefsAllM.mutate()} disabled={briefsAllM.isPending || analyzedCount === 0}>
            {briefsAllM.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Generate briefs
          </Button>
          <Button size="sm" variant="outline" onClick={() => renderAllM.mutate()} disabled={renderAllM.isPending}>
            {renderAllM.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
            Render pins
          </Button>
        </div>
      </header>

      <p className="text-xs text-muted-foreground">
        <strong>Full pipeline</strong> analyzes pending pages, drafts briefs, then queues image renders in one throttled run.
        Or trigger each stage individually.
      </p>

      <div className="space-y-2">
        {data?.map((p) => (
          <Link key={p.id} to="/pages/$id" params={{ id: p.id }}>
            <Card className="flex items-center justify-between p-4 transition hover:border-primary/50">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.title ?? p.url}</div>
                <div className="truncate text-xs text-muted-foreground">{p.url}</div>
              </div>
              <div className="flex items-center gap-2">
                {p.last_analyzed_at ? <Badge variant="outline">Analyzed</Badge> : <Badge variant="secondary">Not analyzed</Badge>}
              </div>
            </Card>
          </Link>
        ))}
        {!data?.length && <p className="text-sm text-muted-foreground">Add a site and crawl it.</p>}
      </div>
    </div>
  );
}
