import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listBriefs, runImageWorker } from "@/lib/briefs.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pins")({
  head: () => ({ meta: [{ title: "Pins — PinForge" }] }),
  component: PinsPage,
});

function PinsPage() {
  const list = useServerFn(listBriefs);
  const worker = useServerFn(runImageWorker);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["briefs"], queryFn: () => list() });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ ok: number; fail: number }>({ ok: 0, fail: 0 });
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

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Pins</h1>
          <p className="text-sm text-muted-foreground">
            {ready} ready · {pending} pending images
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
        {data?.map((b) => <PinTile key={b.id} b={b} />)}
        {!data?.length && <p className="text-sm text-muted-foreground">No pins yet.</p>}
      </div>
    </div>
  );
}

function PinTile({ b }: { b: { id: string; title: string; status: string; style: string; page_id: string; pin_images: { storage_path: string }[] } }) {
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [ref, setRef] = useState<HTMLDivElement | null>(null);
  const path = b.pin_images?.[0]?.storage_path;

  useEffect(() => {
    if (!ref || visible) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: "400px" });
    io.observe(ref);
    return () => io.disconnect();
  }, [ref, visible]);

  useEffect(() => {
    let ok = true;
    if (visible && path) {
      supabase.storage.from("pins").createSignedUrl(path, 3600).then((r) => { if (ok) setUrl(r.data?.signedUrl ?? null); });
    }
    return () => { ok = false; };
  }, [visible, path]);

  return (
    <Link to="/pages/$id" params={{ id: b.page_id }}>
      <Card className="overflow-hidden transition hover:border-primary/50">
        <div ref={setRef} className="aspect-[2/3] bg-muted">
          {url ? <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> :
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {path ? "…" : "pending"}
            </div>}
        </div>
        <div className="p-2">
          <div className="line-clamp-2 text-xs font-medium">{b.title}</div>
          <Badge variant="outline" className="mt-1">{b.status}</Badge>
        </div>
      </Card>
    </Link>
  );
}
