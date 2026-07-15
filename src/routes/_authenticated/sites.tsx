import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSites, upsertSite, deleteSite, crawlSite } from "@/lib/sites.functions";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Globe, Trash2, RefreshCcw, Palette } from "lucide-react";

export const Route = createFileRoute("/_authenticated/sites")({
  head: () => ({ meta: [{ title: "Sites — PinForge" }] }),
  component: SitesPage,
});

type Site = {
  id: string; url: string; sitemap_url: string | null;
  brand_name: string | null; brand_colors: unknown; brand_font: string | null; brand_notes: string | null;
};

function SitesPage() {
  const qc = useQueryClient();
  const list = useServerFn(listSites);
  const upsert = useServerFn(upsertSite);
  const del = useServerFn(deleteSite);
  const crawl = useServerFn(crawlSite);

  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: () => list() });
  const [url, setUrl] = useState("");
  const [sitemap, setSitemap] = useState("");

  const addMut = useMutation({
    mutationFn: () => upsert({ data: { url, sitemap_url: sitemap || undefined } }),
    onSuccess: () => { setUrl(""); setSitemap(""); toast.success("Site added"); qc.invalidateQueries({ queryKey: ["sites"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["sites"] }); },
  });
  const crawlMut = useMutation({
    mutationFn: (id: string) => crawl({ data: { siteId: id } }),
    onSuccess: (r) => toast.success(`Crawl: +${r.added} added, ${r.updated} updated, ${r.errors} errors`),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-4xl">Sites</h1>
        <p className="text-sm text-muted-foreground">Add a website and its sitemap. Set brand colors so pin images stay on-brand.</p>
      </header>

      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold">Add a site</h2>
        <form onSubmit={(e) => { e.preventDefault(); addMut.mutate(); }} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div><Label>Website URL</Label><Input placeholder="https://harvestmath.com" value={url} onChange={(e) => setUrl(e.target.value)} required /></div>
          <div><Label>Sitemap URL <span className="text-muted-foreground">(optional)</span></Label><Input placeholder="https://harvestmath.com/sitemap.xml" value={sitemap} onChange={(e) => setSitemap(e.target.value)} /></div>
          <Button type="submit" disabled={addMut.isPending}>Add site</Button>
        </form>
      </Card>

      <div className="space-y-3">
        {(sites as Site[] | undefined)?.map((s) => (
          <SiteRow key={s.id} site={s} onDelete={() => delMut.mutate(s.id)} onCrawl={() => crawlMut.mutate(s.id)} crawlPending={crawlMut.isPending} />
        ))}
        {!sites?.length && <p className="text-sm text-muted-foreground">No sites yet.</p>}
      </div>
    </div>
  );
}

function SiteRow({ site, onDelete, onCrawl, crawlPending }: { site: Site; onDelete: () => void; onCrawl: () => void; crawlPending: boolean }) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertSite);
  const [open, setOpen] = useState(false);
  const initialColors = Array.isArray(site.brand_colors) ? (site.brand_colors as string[]).join(", ") : "";
  const [brandName, setBrandName] = useState(site.brand_name ?? "");
  const [colors, setColors] = useState(initialColors);
  const [font, setFont] = useState(site.brand_font ?? "");
  const [notes, setNotes] = useState(site.brand_notes ?? "");

  const saveMut = useMutation({
    mutationFn: () => upsert({ data: {
      id: site.id, url: site.url,
      sitemap_url: site.sitemap_url ?? undefined,
      brand_name: brandName || undefined,
      brand_colors: colors.split(",").map((c) => c.trim()).filter(Boolean),
      brand_font: font || undefined,
      brand_notes: notes || undefined,
    } }),
    onSuccess: () => { toast.success("Brand saved"); qc.invalidateQueries({ queryKey: ["sites"] }); setOpen(false); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const swatches = colors.split(",").map((c) => c.trim()).filter(Boolean);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Globe className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="truncate font-medium">{site.url}</div>
            <div className="truncate text-xs text-muted-foreground">
              {site.brand_name ?? "No brand name"} · {swatches.length ? `${swatches.length} colors` : "no palette"}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden gap-1 md:flex">
            {swatches.slice(0, 4).map((c) => (
              <span key={c} className="h-5 w-5 rounded-full border border-border" style={{ background: c }} />
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}><Palette className="mr-1 h-4 w-4" />Brand</Button>
          <Button size="sm" variant="outline" onClick={onCrawl} disabled={crawlPending}><RefreshCcw className="mr-1 h-4 w-4" />Crawl</Button>
          <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      {open && (
        <div className="mt-5 grid gap-4 border-t border-border pt-5 md:grid-cols-2">
          <div><Label>Brand name</Label><Input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Harvest Math" /></div>
          <div><Label>Brand colors <span className="text-muted-foreground">(comma-separated hex)</span></Label><Input value={colors} onChange={(e) => setColors(e.target.value)} placeholder="#0f3460, #e94560, #f5f0e0" /></div>
          <div><Label>Typography direction</Label><Input value={font} onChange={(e) => setFont(e.target.value)} placeholder="Serif display + clean sans" /></div>
          <div className="md:col-span-2"><Label>Brand notes for image gen</Label><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Warm editorial photography, minimal overlays, no stock illustrations." /></div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>Save brand</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
