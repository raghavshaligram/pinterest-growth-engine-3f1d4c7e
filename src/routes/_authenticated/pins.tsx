import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listBriefs, runImageWorker, rerenderBrief, deleteBrief } from "@/lib/briefs.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Hash, ImageIcon, Link as LinkIcon, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pins")({
  head: () => ({ meta: [{ title: "Pins — PinForge" }] }),
  component: PinsPage,
});

type Brief = Awaited<ReturnType<typeof listBriefs>>[number];

function PinsPage() {
  const list = useServerFn(listBriefs);
  const worker = useServerFn(runImageWorker);
  const rerender = useServerFn(rerenderBrief);
  const del = useServerFn(deleteBrief);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["briefs"], queryFn: () => list() });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ ok: number; fail: number }>({ ok: 0, fail: 0 });
  const [open, setOpen] = useState<Brief | null>(null);
  const stopRef = useRef(false);

  const pending = data?.filter((b) => b.status !== "ready" && !b.pin_images?.length).length ?? 0;
  const ready = data?.filter((b) => b.pin_images?.length).length ?? 0;

  async function renderAll() {
    setRunning(true);
    stopRef.current = false;
    setProgress({ ok: 0, fail: 0 });
    try {
      while (!stopRef.current) {
        const r = await worker() as { processed: number; ok?: number; fail?: number };
        setProgress((p) => ({ ok: p.ok + (r.ok ?? 0), fail: p.fail + (r.fail ?? 0) }));
        qc.invalidateQueries({ queryKey: ["briefs"] });
        if (!r.processed) break;
      }
      toast.success("Render queue drained");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Worker failed");
    } finally {
      setRunning(false);
    }
  }

  const rerenderMut = useMutation({
    mutationFn: (briefId: string) => rerender({ data: { briefId } }),
    onSuccess: () => {
      toast.success("Re-rendered");
      qc.invalidateQueries({ queryKey: ["briefs"] });
      qc.invalidateQueries({ queryKey: ["scheduled"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const deleteMut = useMutation({
    mutationFn: (briefId: string) => del({ data: { briefId } }),
    onSuccess: () => {
      toast.success("Deleted");
      setOpen(null);
      qc.invalidateQueries({ queryKey: ["briefs"] });
      qc.invalidateQueries({ queryKey: ["scheduled"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  // Batch-sign all image URLs in a single request (avoids N round-trips).
  const paths = (data ?? []).map((b) => b.pin_images?.[0]?.storage_path).filter(Boolean) as string[];
  const pathsKey = paths.join("|");
  const { data: urlMap } = useQuery({
    queryKey: ["pin-signed-urls", pathsKey],
    enabled: paths.length > 0,
    staleTime: 55 * 60 * 1000,
    queryFn: async () => {
      const map: Record<string, string> = {};
      const chunkSize = 100;
      for (let i = 0; i < paths.length; i += chunkSize) {
        const chunk = paths.slice(i, i + chunkSize);
        const { data: signed } = await supabase.storage.from("pins").createSignedUrls(chunk, 3600);
        signed?.forEach((s) => { if (s.path && s.signedUrl) map[s.path] = s.signedUrl; });
      }
      return map;
    },
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Pins</h1>
          <p className="text-sm text-muted-foreground">
            {ready} ready · {pending} pending images · {data?.length ?? 0} total
          </p>
        </div>
        <div className="flex gap-2">
          {running && (
            <Button variant="outline" onClick={() => (stopRef.current = true)}>Stop</Button>
          )}
          <Button onClick={renderAll} disabled={running || pending === 0}>
            {running ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Rendering {progress.ok}/{pending + progress.ok}</> : `Render ${pending} pending`}
          </Button>
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {data?.map((b) => {
          const p = b.pin_images?.[0]?.storage_path;
          return <PinTile key={b.id} b={b} url={p ? urlMap?.[p] ?? null : null} onOpen={() => setOpen(b)} />;
        })}
        {!data?.length && <p className="text-sm text-muted-foreground">No pins yet.</p>}
      </div>

      <PinDetail
        row={open}
        signedUrl={open?.pin_images?.[0]?.storage_path ? urlMap?.[open.pin_images[0].storage_path] ?? null : null}
        onOpenChange={(v) => !v && setOpen(null)}
        onRerender={(id) => rerenderMut.mutate(id)}
        onDelete={(id) => deleteMut.mutate(id)}
        rerendering={rerenderMut.isPending}
        deleting={deleteMut.isPending}
      />
    </div>
  );
}

function pageLabel(b: Brief): string {
  const p = (b as { pages?: { url?: string; title?: string } }).pages;
  if (!p) return "unknown page";
  if (p.title) return p.title;
  if (p.url) {
    try { return new URL(p.url).pathname.replace(/^\/+|\/+$/g, "") || new URL(p.url).hostname; }
    catch { return p.url; }
  }
  return "unknown page";
}

function PinTile({ b, url, onOpen }: { b: Brief; url: string | null; onOpen: () => void }) {
  const path = b.pin_images?.[0]?.storage_path;
  return (
    <Card
      className="cursor-pointer overflow-hidden transition hover:border-primary/50"
      onClick={onOpen}
    >
      <div className="relative aspect-[2/3] bg-muted">
        {url ? <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> :
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {path ? "…" : "pending"}
          </div>}
        <Badge
          variant="secondary"
          className="absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate bg-background/85 text-[10px] font-normal backdrop-blur"
          title={pageLabel(b)}
        >
          {pageLabel(b)}
        </Badge>
      </div>
      <div className="p-2">
        <div className="line-clamp-2 text-xs font-medium">{b.title}</div>
        <Badge variant="outline" className="mt-1">{b.status}</Badge>
      </div>
    </Card>
  );
}

function PinDetail({
  row, signedUrl, onOpenChange, onRerender, onDelete, rerendering, deleting,
}: {
  row: Brief | null;
  signedUrl: string | null;
  onOpenChange: (v: boolean) => void;
  onRerender: (id: string) => void;
  onDelete: (id: string) => void;
  rerendering: boolean;
  deleting: boolean;
}) {
  const url = signedUrl;


  const page = row ? (row as { pages?: { url?: string; title?: string } }).pages : null;

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl overflow-hidden p-0">
        {row && (
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,320px)_1fr]">
            <div className="bg-muted/40 p-4">
              {url ? (
                <img src={url} alt={row.alt_text ?? ""} className="aspect-[2/3] w-full rounded-lg object-cover shadow-md" />
              ) : (
                <div className="flex aspect-[2/3] w-full items-center justify-center rounded-lg bg-muted"><ImageIcon className="h-8 w-8 text-muted-foreground" /></div>
              )}
              {row.pin_images?.[0] && (
                <div className="mt-3 text-xs text-muted-foreground">
                  {row.pin_images[0].width}×{row.pin_images[0].height}
                </div>
              )}
            </div>
            <div className="flex max-h-[80vh] flex-col overflow-y-auto p-6">
              <DialogHeader className="text-left">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{row.status}</Badge>
                  <Badge variant="secondary">{pageLabel(row)}</Badge>
                </div>
                <DialogTitle className="text-xl leading-snug">{row.title ?? "Untitled"}</DialogTitle>
                <DialogDescription className="sr-only">Pin brief details.</DialogDescription>
              </DialogHeader>

              <dl className="mt-4 space-y-4 text-sm">
                {row.description && (
                  <Field label="Description">
                    <p className="whitespace-pre-wrap text-foreground">{row.description}</p>
                  </Field>
                )}
                {!!row.hashtags?.length && (
                  <Field label="Hashtags" icon={<Hash className="h-3.5 w-3.5" />}>
                    <div className="flex flex-wrap gap-1.5">
                      {row.hashtags.map((h) => (
                        <span key={h} className="rounded-full bg-muted px-2 py-0.5 text-xs">#{h.replace(/^#/, "")}</span>
                      ))}
                    </div>
                  </Field>
                )}
                {row.alt_text && (
                  <Field label="Alt text">
                    <p className="text-muted-foreground">{row.alt_text}</p>
                  </Field>
                )}
                {row.cta && (
                  <Field label="Call to action">
                    <p className="text-foreground">{row.cta}</p>
                  </Field>
                )}
                <Field label="Source page" icon={<LinkIcon className="h-3.5 w-3.5" />}>
                  {page?.url ? (
                    <a href={page.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-primary hover:underline">
                      {page.url}<ExternalLink className="h-3 w-3" />
                    </a>
                  ) : <span className="text-muted-foreground">—</span>}
                </Field>
                <Field label="Manage page">
                  <Link to="/pages/$id" params={{ id: row.page_id }} className="text-primary hover:underline">Open page details</Link>
                </Field>
              </dl>

              <div className="mt-6 flex justify-end gap-2 border-t pt-4">
                <Button variant="destructive" onClick={() => onDelete(row.id)} disabled={deleting}>
                  <Trash2 className="mr-2 h-4 w-4" />Delete
                </Button>
                <Button onClick={() => onRerender(row.id)} disabled={rerendering}>
                  {rerendering ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Re-render
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}{label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
