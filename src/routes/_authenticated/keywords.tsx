import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listKeywords, setKeywordTracked, runSerpSweep, getSerpSnapshot } from "@/lib/keywords.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Search, ChevronDown, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/keywords")({
  head: () => ({ meta: [{ title: "Keywords — Pinspider" }] }),
  component: KeywordsPage,
});

type Keyword = Awaited<ReturnType<typeof listKeywords>>[number];

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function formatSwept(iso: string): string {
  const d = daysAgo(iso);
  if (d <= 0) return "swept today";
  if (d === 1) return "last swept 1d ago";
  return `last swept ${d}d ago`;
}

function KeywordsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listKeywords);
  const set = useServerFn(setKeywordTracked);
  const sweep = useServerFn(runSerpSweep);
  const { data } = useQuery({ queryKey: ["keywords"], queryFn: () => list() });
  const setMut = useMutation({ mutationFn: (v: { id: string; tracked: boolean }) => set({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["keywords"] }) });
  const sweepMut = useMutation({ mutationFn: () => sweep(),
    onSuccess: (r) => { toast.success(`Swept ${r.swept ?? 0} keywords`); qc.invalidateQueries({ queryKey: ["keywords"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)) });

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-4xl">Keywords</h1>
          <p className="text-sm text-muted-foreground">Toggle keywords to include them in daily Pinterest SERP tracking (via Apify).</p>
        </div>
        <Button onClick={() => sweepMut.mutate()} disabled={sweepMut.isPending}><Search className="mr-2 h-4 w-4" />Run SERP sweep</Button>
      </header>
      <div className="space-y-2">
        {data?.map((k) => <KeywordRow key={k.id} k={k} onToggle={(v) => setMut.mutate({ id: k.id, tracked: v })} />)}
        {!data?.length && <p className="text-sm text-muted-foreground">No keywords yet. Analyze a page to generate them.</p>}
      </div>
    </div>
  );
}

function KeywordRow({ k, onToggle }: { k: Keyword; onToggle: (v: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const getSnap = useServerFn(getSerpSnapshot);
  const { data: snap, isLoading } = useQuery({
    queryKey: ["serp-snapshot", k.keyword],
    queryFn: () => getSnap({ data: { keyword: k.keyword } }),
    enabled: open,
    staleTime: 60 * 1000,
  });

  return (
    <Card className="overflow-hidden p-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between gap-3 p-3">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
              <Badge variant="outline" className="shrink-0">{k.kind}</Badge>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{k.keyword}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {k.pages?.url ?? ""}
                  {k.pages?.url && k.lastSweptAt ? " · " : ""}
                  {k.lastSweptAt ? formatSwept(k.lastSweptAt) : (k.pages?.url ? "" : "never swept")}
                </div>
              </div>
            </button>
          </CollapsibleTrigger>
          <Switch checked={!!k.tracked} onCheckedChange={onToggle} onClick={(e) => e.stopPropagation()} />
        </div>
        <CollapsibleContent>
          <div className="border-t bg-muted/30 p-4">
            {isLoading && <p className="text-sm text-muted-foreground">Loading results…</p>}
            {!isLoading && !snap && (
              <p className="text-sm text-muted-foreground">Never swept — run a SERP sweep with this keyword tracked to see results here.</p>
            )}
            {!isLoading && snap && (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Last swept {formatSwept(snap.captured_at)} · {(snap.top_pins as unknown[])?.length ?? 0} pins found
                </p>

                {snap.patterns ? (
                  <PatternsSummary patterns={snap.patterns as SerpPatterns} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Patterns not summarized yet for this sweep (needs OpenAI configured — raw results below).
                  </p>
                )}

                <TopPinsGrid pins={(snap.top_pins as TopPin[]) ?? []} />
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

type TopPin = { url?: string; title?: string; description?: string; image?: string; board?: string; saves?: number };
type SerpPatterns = { title_patterns?: string[]; themes?: string[]; high_performers?: { title: string; saves: number | null }[]; summary?: string };

function PatternsSummary({ patterns }: { patterns: SerpPatterns }) {
  if (!patterns.summary && !patterns.title_patterns?.length && !patterns.themes?.length) return null;
  return (
    <div className="space-y-2 rounded-lg border bg-background p-3">
      {patterns.summary && <p className="text-sm">{patterns.summary}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {!!patterns.title_patterns?.length && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Title patterns</div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {patterns.title_patterns.map((t, i) => <li key={i}>· {t}</li>)}
            </ul>
          </div>
        )}
        {!!patterns.themes?.length && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Recurring themes</div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {patterns.themes.map((t, i) => <li key={i}>· {t}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function TopPinsGrid({ pins }: { pins: TopPin[] }) {
  if (!pins.length) return <p className="text-xs text-muted-foreground">No pins in this snapshot.</p>;
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
      {pins.slice(0, 18).map((p, i) => (
        <a
          key={i}
          href={p.url}
          target="_blank"
          rel="noreferrer"
          className="group block overflow-hidden rounded-lg border bg-background"
        >
          <div className="relative aspect-[2/3] bg-muted">
            {p.image ? (
              <img src={p.image} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">no image</div>
            )}
            {typeof p.saves === "number" && (
              <Badge variant="secondary" className="absolute bottom-1 right-1 bg-background/85 text-[10px] font-normal backdrop-blur">
                {p.saves} saves
              </Badge>
            )}
          </div>
          <div className="flex items-start gap-1 p-1.5">
            <span className="line-clamp-2 flex-1 text-[10px] leading-snug">{p.title || "Untitled pin"}</span>
            <ExternalLink className="mt-0.5 h-2.5 w-2.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </div>
        </a>
      ))}
    </div>
  );
}
