import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listBriefs } from "@/lib/briefs.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/pins")({
  head: () => ({ meta: [{ title: "Pins — PinForge" }] }),
  component: PinsPage,
});

function PinsPage() {
  const list = useServerFn(listBriefs);
  const { data } = useQuery({ queryKey: ["briefs"], queryFn: () => list() });
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl">Pins</h1>
        <p className="text-sm text-muted-foreground">Every pin brief across your sites.</p>
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

  // Only mount the image once the tile scrolls near the viewport.
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
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">…</div>}
        </div>
        <div className="p-2">
          <div className="line-clamp-2 text-xs font-medium">{b.title}</div>
          <Badge variant="outline" className="mt-1">{b.status}</Badge>
        </div>
      </Card>
    </Link>
  );
}
