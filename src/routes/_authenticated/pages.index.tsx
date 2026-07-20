import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPages, analyzePage, setPageExcluded, autoExcludePages } from "@/lib/pages.functions";
import { generateBriefs, runImageWorker, renderImagesForPage } from "@/lib/briefs.functions";
import { runFullPipeline } from "@/lib/schedule.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Sparkles, ImageIcon, Zap, Loader2, EyeOff, Eye, Filter, Check, Clock } from "lucide-react";
import { useEffect, useState } from "react";


export const Route = createFileRoute("/_authenticated/pages/")({
  head: () => ({ meta: [{ title: "Pages — Pinspider" }] }),
  component: PagesPage,
});

function PagesPage() {
  const qc = useQueryClient();
  const list = useServerFn(listPages);
  const analyze = useServerFn(analyzePage);
  const gen = useServerFn(generateBriefs);
  const imgFn = useServerFn(runImageWorker);
  const renderPage = useServerFn(renderImagesForPage);
  const pipeline = useServerFn(runFullPipeline);
  const setExcluded = useServerFn(setPageExcluded);
  const autoExclude = useServerFn(autoExcludePages);

  const [showExcluded, setShowExcluded] = useState(false);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const [renderAllRunning, setRenderAllRunning] = useState(false);
  const stopRef = useState({ v: false })[0];


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
      const targets = active.filter((p) => p.last_analyzed_at && p.briefs_total === 0).slice(0, 25);
      if (!targets.length) return { ok: 0, fail: 0, total: 0, skipped: true as const };
      let ok = 0, fail = 0;
      const errors: string[] = [];
      for (const p of targets) {
        try { await gen({ data: { pageId: p.id, count: 10 } }); ok++; invalidate(); }
        catch (e) { fail++; errors.push(e instanceof Error ? e.message : String(e)); }
      }
      return { ok, fail, total: targets.length, skipped: false as const, errors };
    },
    onSuccess: (r) => {
      if (r.skipped) { toast.info("No pages need briefs. Analyze pages first, or all analyzed pages already have briefs."); return; }
      if (r.fail && r.errors?.length) toast.error(r.errors[0]);
      toast.success(`Briefs for ${r.ok}/${r.total}${r.fail ? ` (${r.fail} failed)` : ""}`);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const renderAllM = useMutation({
    mutationFn: async () => {
      setRenderAllRunning(true);
      stopRef.v = false;
      let ok = 0, fail = 0, pagesDone = 0;
      const targets = active.filter((p) => p.briefs_total > 0 && p.images_ready < p.briefs_total);
      try {
        for (const p of targets) {
          if (stopRef.v) break;
          setCurrentPageId(p.id);
          // Drain this page's queue
          while (!stopRef.v) {
            const r = await renderPage({ data: { pageId: p.id, limit: 8 } }) as { processed: number; ok?: number; fail?: number };
            ok += r.ok ?? 0; fail += r.fail ?? 0;
            invalidate();
            if (!r.processed) break;
          }
          pagesDone++;
        }
      } finally {
        setCurrentPageId(null);
        setRenderAllRunning(false);
      }
      return { ok, fail, pagesDone, totalPages: targets.length };
    },
    onSuccess: (r) => toast.success(`Rendered ${r.ok} images across ${r.pagesDone}/${r.totalPages} pages${r.fail ? ` (${r.fail} failed)` : ""}`),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const renderOneM = useMutation({
    mutationFn: async (pageId: string) => {
      setCurrentPageId(pageId);
      let ok = 0, fail = 0;
      try {
        while (true) {
          const r = await renderPage({ data: { pageId, limit: 8 } }) as { processed: number; ok?: number; fail?: number };
          ok += r.ok ?? 0; fail += r.fail ?? 0;
          invalidate();
          if (!r.processed) break;
        }
      } finally { setCurrentPageId(null); }
      return { ok, fail };
    },
    onSuccess: (r) => toast.success(`Rendered ${r.ok} image${r.ok === 1 ? "" : "s"}${r.fail ? ` (${r.fail} failed)` : ""}`),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  // Keep imgFn referenced (fallback global worker button hidden below)
  void imgFn;


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
  const briefsNeededCount = active.filter((p) => p.last_analyzed_at && p.briefs_total === 0).length;

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
          <Button size="sm" variant="outline" onClick={() => briefsAllM.mutate()} disabled={briefsAllM.isPending || briefsNeededCount === 0}>
            {briefsAllM.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Generate briefs ({briefsNeededCount})
          </Button>
          <Button size="sm" variant="outline" onClick={() => renderAllRunning ? (stopRef.v = true) : renderAllM.mutate()} disabled={!renderAllRunning && active.every((p) => p.images_ready >= p.briefs_total)}>
            {renderAllRunning ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Stop</> : <><ImageIcon className="mr-2 h-4 w-4" />Render pins</>}
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
        {visible.map((p) => {
          const isRendering = currentPageId === p.id;
          const pendingImgs = p.briefs_total - p.images_ready;
          return (
            <Card key={p.id} className={`flex items-center gap-4 p-3 transition ${isRendering ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}>
              <Thumb path={p.thumb} />
              <Link to="/pages/$id" params={{ id: p.id }} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate text-sm font-medium">{p.title ?? p.url}</div>
                  {isRendering && (
                    <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      <Loader2 className="h-3 w-3 animate-spin" />Rendering
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">{p.url}</div>
              </Link>
              <div className="hidden shrink-0 items-center gap-1.5 md:flex">
                <StatusPill label="Analysis" done={!!p.last_analyzed_at} text={p.last_analyzed_at ? "Analyzed" : "Pending"} />
                <StatusPill label="Pins" done={p.briefs_total > 0} text={p.briefs_total > 0 ? `${p.briefs_total} briefs` : "None"} />
                <StatusPill
                  label="Images"
                  done={p.briefs_total > 0 && p.images_ready === p.briefs_total}
                  partial={p.images_ready > 0 && p.images_ready < p.briefs_total}
                  text={p.briefs_total > 0 ? `${p.images_ready}/${p.briefs_total}` : "—"}
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {p.excluded && <Badge variant="secondary">Excluded</Badge>}
                {pendingImgs > 0 && !p.excluded && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={renderOneM.isPending || renderAllRunning}
                    onClick={(e) => { e.preventDefault(); renderOneM.mutate(p.id); }}
                  >
                    {isRendering ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ImageIcon className="mr-1 h-3 w-3" />}
                    Render {pendingImgs}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => { e.preventDefault(); toggleM.mutate({ pageId: p.id, excluded: !p.excluded }); }}
                >
                  {p.excluded ? <><Eye className="mr-1 h-3 w-3" />Include</> : <><EyeOff className="mr-1 h-3 w-3" />Exclude</>}
                </Button>
              </div>
            </Card>
          );
        })}

        {!visible.length && (
          <p className="text-sm text-muted-foreground">
            {showExcluded ? "Nothing excluded." : "Add a site and crawl it."}
          </p>
        )}
      </div>
    </div>
  );
}

function StatusPill({ label, done, partial, text }: { label: string; done: boolean; partial?: boolean; text: string }) {
  const cls = done
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : partial
    ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
    : "border-border bg-muted/40 text-muted-foreground";
  const Icon = done ? Check : Clock;
  return (
    <div className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${cls}`}>
      <Icon className="h-3 w-3" />
      <span className="font-medium">{label}</span>
      <span className="opacity-80">{text}</span>
    </div>
  );
}

function Thumb({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let ok = true;
    if (path) {
      supabase.storage.from("pins").createSignedUrl(path, 3600).then((r) => { if (ok) setUrl(r.data?.signedUrl ?? null); });
    } else {
      setUrl(null);
    }
    return () => { ok = false; };
  }, [path]);
  return (
    <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-muted">
      {url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
    </div>
  );
}

