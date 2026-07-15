import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPage, analyzePage } from "@/lib/pages.functions";
import { generateBriefs, runImageWorker, rerenderBrief } from "@/lib/briefs.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Sparkles, Wand2, ImageIcon, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/pages/$id")({
  head: () => ({ meta: [{ title: "Page — PinForge" }] }),
  component: PageDetail,
});

function PageDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const get = useServerFn(getPage);
  const analyze = useServerFn(analyzePage);
  const gen = useServerFn(generateBriefs);
  const img = useServerFn(runImageWorker);

  const { data } = useQuery({ queryKey: ["page", id], queryFn: () => get({ data: { id } }) });

  const anaMut = useMutation({ mutationFn: () => analyze({ data: { pageId: id } }),
    onSuccess: () => { toast.success("Analyzed"); qc.invalidateQueries({ queryKey: ["page", id] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)) });
  const genMut = useMutation({ mutationFn: (n: number) => gen({ data: { pageId: id, count: n } }),
    onSuccess: (r) => { toast.success(`Created ${r.created} briefs. Run image worker to render.`); qc.invalidateQueries({ queryKey: ["page", id] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)) });
  const imgMut = useMutation({ mutationFn: () => img(),
    onSuccess: (r) => { toast.success(JSON.stringify(r)); qc.invalidateQueries({ queryKey: ["page", id] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)) });

  if (!data) return <p>Loading…</p>;
  const { page, briefs } = data;
  const analysis = (page.analysis ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-8">
      <header>
        <div className="text-xs text-muted-foreground">{page.url}</div>
        <h1 className="font-display text-3xl">{page.title ?? "(no title)"}</h1>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => anaMut.mutate()} disabled={anaMut.isPending}><Sparkles className="mr-2 h-4 w-4" />Analyze</Button>
        <Button onClick={() => genMut.mutate(10)} disabled={genMut.isPending || !page.last_analyzed_at}><Wand2 className="mr-2 h-4 w-4" />Generate 10 pins</Button>
        <Button variant="outline" onClick={() => imgMut.mutate()} disabled={imgMut.isPending}><ImageIcon className="mr-2 h-4 w-4" />Render images</Button>
      </div>

      {page.last_analyzed_at && (
        <Card className="p-6">
          <h2 className="mb-2 text-lg font-semibold">Analysis</h2>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            {["topic","primary_keyword","intent","category","audience","seasonality"].map((k) => (
              <div key={k}><dt className="text-xs uppercase text-muted-foreground">{k}</dt><dd>{String(analysis[k] ?? "—")}</dd></div>
            ))}
          </dl>
          {Array.isArray(analysis.secondary_keywords) && (
            <div className="mt-4">
              <div className="mb-1 text-xs uppercase text-muted-foreground">Secondary keywords</div>
              <div className="flex flex-wrap gap-1">
                {(analysis.secondary_keywords as string[]).map((k) => <Badge key={k} variant="outline">{k}</Badge>)}
              </div>
            </div>
          )}
        </Card>
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold">Pin briefs ({briefs.length})</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {briefs.map((b) => <BriefCard key={b.id} b={b} />)}
        </div>
      </div>
    </div>
  );
}

function BriefCard({ b }: { b: { id: string; title: string; style: string; status: string; pin_images: { storage_path: string }[] } }) {
  const qc = useQueryClient();
  const rerender = useServerFn(rerenderBrief);
  const [url, setUrl] = useState<string | null>(null);
  const path = b.pin_images?.[0]?.storage_path;
  useEffect(() => {
    let ok = true;
    if (path) {
      supabase.storage.from("pins").createSignedUrl(path, 60 * 60).then((r) => { if (ok) setUrl(r.data?.signedUrl ?? null); });
    } else {
      setUrl(null);
    }
    return () => { ok = false; };
  }, [path]);
  const reMut = useMutation({
    mutationFn: () => rerender({ data: { briefId: b.id } }),
    onSuccess: () => { toast.success("Re-rendered"); qc.invalidateQueries(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-[2/3] w-full bg-muted">
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> :
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {b.status === "image_pending" ? "Waiting to render…" : "No image"}
          </div>}
        <Button
          size="sm" variant="secondary"
          className="absolute right-2 top-2 h-8 gap-1"
          onClick={() => reMut.mutate()} disabled={reMut.isPending}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${reMut.isPending ? "animate-spin" : ""}`} />
          Rerender
        </Button>
      </div>
      <div className="space-y-1 p-3">
        <div className="text-xs uppercase text-muted-foreground">{b.style}</div>
        <div className="line-clamp-2 text-sm font-medium">{b.title}</div>
        <Badge variant="outline">{b.status}</Badge>
      </div>
    </Card>
  );
}
