import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPages, analyzePage, setPageExcluded, autoExcludePages } from "@/lib/pages.functions";
import { generateBriefs, runImageWorker } from "@/lib/briefs.functions";
import { runFullPipeline } from "@/lib/schedule.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Sparkles, ImageIcon, Zap, Loader2, EyeOff, Eye, Filter } from "lucide-react";
import { useState } from "react";

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
  const setExcluded = useServerFn(setPageExcluded);
  const autoExclude = useServerFn(autoExcludePages);

  const [showExcluded, setShowExcluded] = useState(false);

  const { data } = useQuery({ queryKey: ["pages"], queryFn: () => list() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["pages"] });

  const active = (data ?? []).filter((p) => !p.excluded);
  const excluded = (data ?? []).filter((p) => p.excluded);
  const visible = showExcluded ? excluded : active;

  const pipelineM = useMutation({
    mutationFn: () => pipeline({ data: { maxAnalyze: 25, maxBriefs: 15, maxImages: 30 } }),
    onSuccess: (r) => { toast.success(`Pipeline: analyzed ${r.analyzed}, briefs for ${r.briefsFor}, queued ${r.imagesQueued} images`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const analyzeAllM = useMutation({
    mutationFn: async () => {
      const targets = active.filter((p) => !p.last_analyzed_at).slice(0, 25);
      let ok = 0, fail = 0;
      for (const p of targets) {
        try { await analyze({ data: { pageId: p.id } }); ok++; } catch { fail++; }
      }
      return { ok, fail, total: targets.length };
    },
    onSuccess: (r) => { toast.success(`Analyzed ${r.ok}/${r.total}${r.fail ? ` (${r.fail} failed)` : ""}`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const briefsAllM = useMutation({
    mutationFn: async () => {
      const targets = active.filter((p) => p.last_analyzed_at).slice(0, 25);
      let ok = 0, fail = 0;
      for (const p of targets) {
        try { await gen({ data: { pageId: p.id, count: 10 } }); ok++; } catch { fail++; }
      }
      return { ok, fail, total: targets.length };
    },
    onSuccess: (r) => { toast.success(`Briefs for ${r.ok}/${r.total}${r.fail ? ` (${r.fail} failed)` : ""}`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const renderAllM = useMutation({
    mutationFn: () => imgFn(),
    onSuccess: (r) => { toast.success(`Image worker: ${JSON.stringify(r)}`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const autoExcludeM = useMutation({
    mutationFn: () => autoExclude(),
    onSuccess: (r) => { toast.success(`Auto-excluded ${r.excluded} page${r.excluded === 1 ? "" : "s"}`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const toggleM = useMutation({
    mutationFn: (v: { pageId: string; excluded: boolean }) => setExcluded({ data: v }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const analyzedCount = active.filter((p) => p.last_analyzed_at).length;
  const pendingCount = active.filter((p) => !p.last_analyzed_at).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Pages</h1>
          <p className="text-sm text-muted-foreground">
            {active.length} active · {analyzedCount} analyzed · {pendingCount} pending · {excluded.length} excluded
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
          <Button size="sm" variant="ghost" onClick={() => autoExcludeM.mutate()} disabled={autoExcludeM.isPending}>
            {autoExcludeM.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Filter className="mr-2 h-4 w-4" />}
            Auto-exclude
          </Button>
        </div>
      </header>

      <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
        <span className="text-muted-foreground">
          Auto-exclude filters out About, Contact, Privacy, Terms, FAQ, Category, Tag and similar non-content pages so they don't waste analysis or pin budget.
        </span>
        <Button size="sm" variant="ghost" onClick={() => setShowExcluded((v) => !v)}>
          {showExcluded ? <><Eye className="mr-2 h-3 w-3" />Show active</> : <><EyeOff className="mr-2 h-3 w-3" />Show excluded ({excluded.length})</>}
        </Button>
      </div>

      <div className="space-y-2">
        {visible.map((p) => (
          <Card key={p.id} className="flex items-center justify-between gap-3 p-4 transition hover:border-primary/50">
            <Link to="/pages/$id" params={{ id: p.id }} className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{p.title ?? p.url}</div>
              <div className="truncate text-xs text-muted-foreground">{p.url}</div>
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              {p.excluded
                ? <Badge variant="secondary">Excluded</Badge>
                : p.last_analyzed_at ? <Badge variant="outline">Analyzed</Badge> : <Badge variant="secondary">Not analyzed</Badge>}
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => { e.preventDefault(); toggleM.mutate({ pageId: p.id, excluded: !p.excluded }); }}
              >
                {p.excluded ? <><Eye className="mr-1 h-3 w-3" />Include</> : <><EyeOff className="mr-1 h-3 w-3" />Exclude</>}
              </Button>
            </div>
          </Card>
        ))}
        {!visible.length && (
          <p className="text-sm text-muted-foreground">
            {showExcluded ? "Nothing excluded." : "Add a site and crawl it."}
          </p>
        )}
      </div>
    </div>
  );
}
