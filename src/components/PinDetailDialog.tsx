// Shared pin detail/edit modal -- used by both the Dashboard masonry
// feed and the Schedule weekly calendar so "Edit" opens the identical
// view (and every action -- replace/duplicate/publish now/queue/
// reschedule/unschedule/mark posted) in both places instead of two
// slowly-diverging copies.
import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Send, RefreshCw, Copy, ExternalLink, Link as LinkIcon, Hash, ImageIcon,
  Check, PinIcon, Undo2, CalendarOff,
} from "lucide-react";
import type { listScheduled } from "@/lib/schedule.functions";

export type PinDetailRow = Awaited<ReturnType<typeof listScheduled>>[number];

export function PinDetailDialog({
  row, onOpenChange, onUnschedule, onQueue, onReplace, onPublishNow, onDuplicate, onReschedule, onMarkPosted, onUnmarkPosted,
  unscheduling, queuing, replacing, publishing, marking,
}: {
  row: PinDetailRow | null;
  onOpenChange: (v: boolean) => void;
  onUnschedule: (id: string) => void;
  onQueue: (id: string) => void;
  onReplace: (id: string) => void;
  onPublishNow: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReschedule: (id: string, at: string) => void;
  onMarkPosted: (id: string, pinterestPinId?: string) => void;
  onUnmarkPosted: (id: string) => void;
  unscheduling: boolean;
  queuing: boolean;
  replacing: boolean;
  publishing: boolean;
  marking: boolean;
}) {
  const brief = row?.pin_briefs;
  const page = brief?.pages;
  const [manualPinId, setManualPinId] = useState("");
  const [newTime, setNewTime] = useState("");
  useEffect(() => { setManualPinId(""); setNewTime(""); }, [row?.id]);

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
                <Field label="Description"><p className="whitespace-pre-wrap text-foreground">{brief?.description}</p></Field>
                {!!brief?.hashtags?.length && (
                  <Field label="Hashtags" icon={<Hash className="h-3.5 w-3.5" />}>
                    <div className="flex flex-wrap gap-1.5">
                      {brief.hashtags.map((h) => <span key={h} className="rounded-full bg-muted px-2 py-0.5 text-xs">#{h.replace(/^#/, "")}</span>)}
                    </div>
                  </Field>
                )}
                <Field label="Destination" icon={<LinkIcon className="h-3.5 w-3.5" />}>
                  {page?.url ? (
                    <a href={page.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-primary hover:underline">
                      {page.url}<ExternalLink className="h-3 w-3" />
                    </a>
                  ) : <span className="text-muted-foreground">—</span>}
                </Field>
                <Field label="Board"><span>{row.boards?.name ?? "—"}</span></Field>
                {row.last_error && <Field label="Last error"><p className="whitespace-pre-wrap text-destructive">{row.last_error}</p></Field>}
              </dl>

              {row.status !== "published" && row.status !== "publishing" && (
                <div className="mt-6 rounded-lg border border-dashed p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <PinIcon className="h-3.5 w-3.5" />Reschedule
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input type="datetime-local" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="h-8 flex-1 min-w-[180px] text-sm" />
                    <Button size="sm" variant="secondary" onClick={() => { if (newTime) onReschedule(row.id, new Date(newTime).toISOString()); }} disabled={!newTime}>
                      Save time
                    </Button>
                  </div>
                  <p className="mt-3 mb-2 text-xs text-muted-foreground">If you pinned this to Pinterest yourself, mark it as posted.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input value={manualPinId} onChange={(e) => setManualPinId(e.target.value)} placeholder="Pinterest pin ID (optional)" className="h-8 flex-1 min-w-[180px] text-sm" />
                    <Button size="sm" variant="secondary" onClick={() => onMarkPosted(row.id, manualPinId.trim() || undefined)} disabled={marking}>
                      <Check className="mr-2 h-4 w-4" />Mark as posted
                    </Button>
                  </div>
                </div>
              )}

              {row.status === "published" && (
                <div className="mt-6 rounded-lg border border-dashed p-3">
                  <Button size="sm" variant="outline" onClick={() => onUnmarkPosted(row.id)} disabled={marking} title="Move back to the queue">
                    <Undo2 className="mr-2 h-4 w-4" />Unmark as posted
                  </Button>
                </div>
              )}

              <div className="mt-6 flex flex-wrap justify-end gap-2 border-t pt-4">
                {row.status !== "published" && row.status !== "publishing" && (
                  <Button size="sm" variant="outline" onClick={() => onReplace(row.id)} disabled={replacing} title="Swap in another ready pin, keeping this slot">
                    <RefreshCw className={`mr-2 h-4 w-4 ${replacing ? "animate-spin" : ""}`} />Replace pin
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => onDuplicate(row.id)} title="Clone to tomorrow, same time and board">
                  <Copy className="mr-2 h-4 w-4" />Duplicate
                </Button>
                {row.status !== "published" && row.status !== "publishing" && (
                  <Button
                    size="sm" variant="destructive" onClick={() => onUnschedule(row.id)} disabled={unscheduling}
                    title="Pull off the calendar and send back to Pins as a ready-to-schedule draft -- the brief and image are kept"
                  >
                    <CalendarOff className="mr-2 h-4 w-4" />Unschedule
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
      <dt className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{icon}{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
