import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listKeywords, setKeywordTracked, runSerpSweep } from "@/lib/keywords.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/keywords")({
  head: () => ({ meta: [{ title: "Keywords — Pinspider" }] }),
  component: KeywordsPage,
});

function KeywordsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listKeywords);
  const set = useServerFn(setKeywordTracked);
  const sweep = useServerFn(runSerpSweep);
  const { data } = useQuery({ queryKey: ["keywords"], queryFn: () => list() });
  const setMut = useMutation({ mutationFn: (v: { id: string; tracked: boolean }) => set({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["keywords"] }) });
  const sweepMut = useMutation({ mutationFn: () => sweep(),
    onSuccess: (r) => toast.success(`Swept ${r.swept ?? 0} keywords`),
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
        {data?.map((k) => (
          <Card key={k.id} className="flex items-center justify-between p-3">
            <div className="flex items-center gap-3 min-w-0">
              <Badge variant="outline">{k.kind}</Badge>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{k.keyword}</div>
                <div className="truncate text-xs text-muted-foreground">{k.pages?.url ?? ""}</div>
              </div>
            </div>
            <Switch checked={!!k.tracked} onCheckedChange={(v) => setMut.mutate({ id: k.id, tracked: v })} />
          </Card>
        ))}
        {!data?.length && <p className="text-sm text-muted-foreground">No keywords yet. Analyze a page to generate them.</p>}
      </div>
    </div>
  );
}
