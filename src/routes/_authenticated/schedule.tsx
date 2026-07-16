import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listScheduled, autoSchedule, runPublisher, rescheduleOrCancel, runFullPipeline, queuePins, deleteAllScheduled, replaceScheduledPin, publishNow } from "@/lib/schedule.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CalendarClock, Send, Wand2, Trash2, Zap, ExternalLink, Link as LinkIcon, Hash, ImageIcon, Check, CheckCheck, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/schedule")({
  head: () => ({ meta: [{ title: "Schedule — PinForge" }] }),
  component: SchedulePage,
});

type ScheduledRow = Awaited<ReturnType<typeof listScheduled>>[number];

function SchedulePage() {
  const qc = useQueryClient();
  const list = useServerFn(listScheduled);
  const auto = useServerFn(autoSchedule);
  const pub = useServerFn(runPublisher);
  const resched = useServerFn(rescheduleOrCancel);
  const pipeline = useServerFn(runFullPipeline);

  const queue = useServerFn(queuePins);
  const wipe = useServerFn(deleteAllScheduled);
  const replace = useServerFn(replaceScheduledPin);
  const publishNowFn = useServerFn(publishNow);

  const { data, isLoading, isFetching } = useQuery({ queryKey: ["scheduled"], queryFn: () => list() });
  const [open, setOpen] = useState<ScheduledRow | null>(null);
  // Persist the per-day cadence across visits. This subtree is ssr:false so
  // reading localStorage in the lazy initializer is safe and avoids the race
  // where the save-effect overwrites storage before the load-effect fires.
  const [perDay, setPerDay] = useState<number>(() => {
    if (typeof window === "undefined") return 5;
    const saved = window.localStorage.getItem("pf:perDay");
    const n = saved ? parseInt(saved, 10) : NaN;
    return Number.isFinite(n) ? Math.max(1, Math.min(25, n)) : 5;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("pf:perDay", String(perDay));
  }, [perDay]);

  const autoMut = useMutation({ mutationFn: () => auto({ data: { days: 14, perDay, hoursStart: 9, hoursEnd: 21 } }),
    onSuccess: (r) => { toast.success(r.reason ?? `Drafted ${r.scheduled} pins — review, then queue`); qc.invalidateQueries({ queryKey: ["scheduled"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)) });
  const pubMut = useMutation({ mutationFn: () => pub(),
    onSuccess: (r) => { toast.success(JSON.stringify(r)); qc.invalidateQueries({ queryKey: ["scheduled"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)) });
  const delMut = useMutation({ mutationFn: (id: string) => resched({ data: { id, cancel: true } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["scheduled"] }); setOpen(null); toast.success("Deleted"); } });
  const queueMut = useMutation({ mutationFn: (ids?: string[]) => queue({ data: ids ? { ids } : { all: true } }),
    onSuccess: (r) => { toast.success(`Queued ${r.queued} pin${r.queued === 1 ? "" : "s"}`); qc.invalidateQueries({ queryKey: ["scheduled"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)) });
  const wipeMut = useMutation({ mutationFn: () => wipe({ data: {} }),
    onSuccess: (r) => { toast.success(`Deleted ${r.deleted} scheduled pin${r.deleted === 1 ? "" : "s"}`); qc.invalidateQueries({ queryKey: ["scheduled"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)) });
  const pipeMut = useMutation({ mutationFn: () => pipeline({ data: {} }),
    onSuccess: (r) => { toast.success(`Analyzed ${r.analyzed} · Briefs for ${r.briefsFor} pages · Queued ${r.imagesQueued} images${r.errors.length ? ` · ${r.errors.length} errors` : ""}`); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)) });
  const replaceMut = useMutation({ mutationFn: (id: string) => replace({ data: { id } }),
    onSuccess: async () => { toast.success("Pin replaced"); await qc.invalidateQueries({ queryKey: ["scheduled"] }); setOpen(null); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)) });
  const publishNowMut = useMutation({ mutationFn: (id: string) => publishNowFn({ data: { id } }),
    onSuccess: async (r) => { toast.success(r.processed ? `Published (${r.ok ?? r.exported ?? 0})` : "Nothing published — check integration"); await qc.invalidateQueries({ queryKey: ["scheduled"] }); setOpen(null); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)) });

  const groups = new Map<string, ScheduledRow[]>();
  (data ?? []).forEach((p) => {
    const d = new Date(p.scheduled_at).toISOString().slice(0, 10);
    const arr = groups.get(d) ?? [];
    arr.push(p);
    groups.set(d, arr);
  });

  const draftCount = (data ?? []).filter((p) => p.status === "draft").length;

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-4xl">Schedule</h1>
          <p className="text-sm text-muted-foreground">Auto-fill drafts across the next 14 days. Review each pin, then queue it — the publisher only picks up queued pins.</p>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="per-day" className="text-xs text-muted-foreground">Per day</Label>
            <Input id="per-day" type="number" min={1} max={25} value={perDay} onChange={(e) => setPerDay(Math.max(1, Math.min(25, parseInt(e.target.value || "1", 10))))} className="h-9 w-20 text-sm" />
          </div>
          <Button variant="outline" onClick={() => pipeMut.mutate()} disabled={pipeMut.isPending}><Zap className="mr-2 h-4 w-4" />Run pipeline</Button>
          <Button variant="outline" onClick={() => autoMut.mutate()} disabled={autoMut.isPending}><Wand2 className="mr-2 h-4 w-4" />Auto-fill 14 days</Button>
          <Button variant="outline" onClick={() => queueMut.mutate(undefined)} disabled={queueMut.isPending || draftCount === 0}>
            <CheckCheck className="mr-2 h-4 w-4" />Queue all drafts{draftCount ? ` (${draftCount})` : ""}
          </Button>
          <Button
            variant="outline"
            onClick={() => { if (window.confirm(`Delete all ${data?.length ?? 0} scheduled pins? Published pins are kept.`)) wipeMut.mutate(); }}
            disabled={wipeMut.isPending || !(data?.length)}
          >
            <Trash2 className="mr-2 h-4 w-4" />Delete all
          </Button>
          <Button onClick={() => pubMut.mutate()} disabled={pubMut.isPending}><Send className="mr-2 h-4 w-4" />Publish due</Button>
        </div>
      </header>

      <div className="space-y-6">
        {[...groups.entries()].map(([day, pins]) => (
          <div key={day}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <CalendarClock className="h-4 w-4" />{day}
              <span className="ml-1 text-xs font-normal">· {pins.length} pin{pins.length === 1 ? "" : "s"}</span>
            </h3>
            <div className="grid gap-2">
              {pins.map((p) => (
                <Card
                  key={p.id}
                  className="flex cursor-pointer items-center justify-between p-3 transition hover:bg-muted/40"
                  onClick={() => setOpen(p)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="text-xs text-muted-foreground w-16 tabular-nums">
                      {new Date(p.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    {p.image_url ? (
                      <img src={p.image_url} alt="" className="h-12 w-9 rounded object-cover" />
                    ) : (
                      <div className="flex h-12 w-9 items-center justify-center rounded bg-muted"><ImageIcon className="h-4 w-4 text-muted-foreground" /></div>
                    )}
                    <div className="min-w-0">
                      <div className="line-clamp-1 text-sm font-medium">{p.pin_briefs?.title ?? "Untitled"}</div>
                      <div className="text-xs text-muted-foreground">{p.boards?.name ?? "no board"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <StatusBadge status={p.status} />
                    {p.status === "draft" && (
                      <Button size="sm" variant="secondary" onClick={() => queueMut.mutate([p.id])} disabled={queueMut.isPending} title="Queue for publishing">
                        <Check className="mr-1 h-3.5 w-3.5" />Queue
                      </Button>
                    )}
                    {p.status !== "published" && p.status !== "publishing" && (
                      <Button size="icon" variant="ghost" onClick={() => delMut.mutate(p.id)} title="Delete scheduled pin">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
        {(isLoading || isFetching) && !data?.length && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />Loading schedule…
          </div>
        )}
        {!isLoading && !isFetching && !data?.length && <p className="text-sm text-muted-foreground">Nothing scheduled yet — auto-fill to spread ready pins across the next two weeks.</p>}
      </div>

      <PinDetail
        row={open}
        onOpenChange={(v) => !v && setOpen(null)}
        onDelete={(id) => delMut.mutate(id)}
        onQueue={(id) => queueMut.mutate([id])}
        onReplace={(id) => replaceMut.mutate(id)}
        onPublishNow={(id) => publishNowMut.mutate(id)}
        deleting={delMut.isPending}
        queuing={queueMut.isPending}
        replacing={replaceMut.isPending}
        publishing={publishNowMut.isPending}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: ScheduledRow["status"] }) {
  const v = status === "published" ? "default" : status === "failed" ? "destructive" : "outline";
  const label = status === "draft" ? "draft — review" : status;
  return <Badge variant={v}>{label}</Badge>;
}

function PinDetail({ row, onOpenChange, onDelete, onQueue, onReplace, onPublishNow, deleting, queuing, replacing, publishing }: { row: ScheduledRow | null; onOpenChange: (v: boolean) => void; onDelete: (id: string) => void; onQueue: (id: string) => void; onReplace: (id: string) => void; onPublishNow: (id: string) => void; deleting: boolean; queuing: boolean; replacing: boolean; publishing: boolean }) {
  const brief = row?.pin_briefs;
  const page = brief?.pages;
  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl overflow-hidden p-0">
        {row && (
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,320px)_1fr]">
            <div className="bg-muted/40 p-4">
              {row.image_url ? (
                <img src={row.image_url} alt={brief?.alt_text ?? ""} className="aspect-[2/3] w-full rounded-lg object-cover shadow-md" />
              ) : (
                <div className="flex aspect-[2/3] w-full items-center justify-center rounded-lg bg-muted"><ImageIcon className="h-8 w-8 text-muted-foreground" /></div>
              )}
              <div className="mt-3 text-xs text-muted-foreground">
                {row.pin_images?.width}×{row.pin_images?.height}
              </div>
            </div>
            <div className="flex max-h-[80vh] flex-col overflow-y-auto p-6">
              <DialogHeader className="text-left">
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant={row.status === "published" ? "default" : row.status === "failed" ? "destructive" : "outline"}>{row.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(row.scheduled_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </div>
                <DialogTitle className="text-xl leading-snug">{brief?.title ?? "Untitled"}</DialogTitle>
                <DialogDescription className="sr-only">Pin details that will publish to Pinterest.</DialogDescription>
              </DialogHeader>

              <dl className="mt-4 space-y-4 text-sm">
                <Field label="Description">
                  <p className="whitespace-pre-wrap text-foreground">{brief?.description}</p>
                </Field>
                {!!brief?.hashtags?.length && (
                  <Field label="Hashtags" icon={<Hash className="h-3.5 w-3.5" />}>
                    <div className="flex flex-wrap gap-1.5">
                      {brief.hashtags.map((h) => (
                        <span key={h} className="rounded-full bg-muted px-2 py-0.5 text-xs">#{h.replace(/^#/, "")}</span>
                      ))}
                    </div>
                  </Field>
                )}
                {brief?.alt_text && (
                  <Field label="Alt text">
                    <p className="text-muted-foreground">{brief.alt_text}</p>
                  </Field>
                )}
                {brief?.cta && (
                  <Field label="Call to action">
                    <p className="text-foreground">{brief.cta}</p>
                  </Field>
                )}
                <Field label="Destination" icon={<LinkIcon className="h-3.5 w-3.5" />}>
                  {page?.url ? (
                    <a href={page.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-primary hover:underline">
                      {page.url}<ExternalLink className="h-3 w-3" />
                    </a>
                  ) : <span className="text-muted-foreground">—</span>}
                </Field>
                <Field label="Board">
                  <span>{row.boards?.name ?? "—"}</span>
                </Field>
                {row.pinterest_pin_id && (
                  <Field label="Pinterest pin id">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{row.pinterest_pin_id}</code>
                  </Field>
                )}
                {row.last_error && (
                  <Field label="Last error">
                    <p className="whitespace-pre-wrap text-destructive">{row.last_error}</p>
                  </Field>
                )}
              </dl>

              <div className="mt-6 flex flex-wrap justify-end gap-2 border-t pt-4">
                {row.status !== "published" && row.status !== "publishing" && (
                  <Button size="sm" variant="outline" onClick={() => onReplace(row.id)} disabled={replacing} title="Swap in another ready pin, keeping this slot">
                    <RefreshCw className={`mr-2 h-4 w-4 ${replacing ? "animate-spin" : ""}`} />Replace pin
                  </Button>
                )}
                {row.status !== "published" && row.status !== "publishing" && (
                  <Button size="sm" variant="destructive" onClick={() => onDelete(row.id)} disabled={deleting}>
                    <Trash2 className="mr-2 h-4 w-4" />Delete
                  </Button>
                )}
                {row.status === "draft" && (
                  <Button size="sm" variant="secondary" onClick={() => onQueue(row.id)} disabled={queuing}>
                    <Check className="mr-2 h-4 w-4" />Queue for publishing
                  </Button>
                )}
                {row.status !== "published" && row.status !== "publishing" && (
                  <Button size="sm" onClick={() => onPublishNow(row.id)} disabled={publishing} title="Publish this pin immediately, ignoring the scheduled time">
                    <Send className={`mr-2 h-4 w-4 ${publishing ? "animate-pulse" : ""}`} />Publish now
                  </Button>
                )}
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
