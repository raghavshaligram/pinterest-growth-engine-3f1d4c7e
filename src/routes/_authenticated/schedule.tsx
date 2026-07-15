import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listScheduled, autoSchedule, runPublisher, rescheduleOrCancel, runFullPipeline } from "@/lib/schedule.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CalendarClock, Send, Wand2, X, Zap } from "lucide-react";

export const Route = createFileRoute("/_authenticated/schedule")({
  head: () => ({ meta: [{ title: "Schedule — PinForge" }] }),
  component: SchedulePage,
});

function SchedulePage() {
  const qc = useQueryClient();
  const list = useServerFn(listScheduled);
  const auto = useServerFn(autoSchedule);
  const pub = useServerFn(runPublisher);
  const resched = useServerFn(rescheduleOrCancel);
  const pipeline = useServerFn(runFullPipeline);

  const { data } = useQuery({ queryKey: ["scheduled"], queryFn: () => list() });

  const autoMut = useMutation({ mutationFn: () => auto({ data: { days: 14, perDay: 6, hoursStart: 8, hoursEnd: 22 } }),
    onSuccess: (r) => { toast.success(r.reason ?? `Scheduled ${r.scheduled} pins`); qc.invalidateQueries({ queryKey: ["scheduled"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)) });
  const pubMut = useMutation({ mutationFn: () => pub(),
    onSuccess: (r) => { toast.success(JSON.stringify(r)); qc.invalidateQueries({ queryKey: ["scheduled"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)) });
  const cancelMut = useMutation({ mutationFn: (id: string) => resched({ data: { id, cancel: true } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["scheduled"] }); toast.success("Canceled"); } });
  const pipeMut = useMutation({ mutationFn: () => pipeline({ data: {} }),
    onSuccess: (r) => { toast.success(`Analyzed ${r.analyzed} · Briefs for ${r.briefsFor} pages · Queued ${r.imagesQueued} images${r.errors.length ? ` · ${r.errors.length} errors` : ""}`); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)) });

  // Group by day
  const groups = new Map<string, typeof data>();
  (data ?? []).forEach((p) => {
    const d = new Date(p.scheduled_at).toISOString().slice(0, 10);
    const arr = groups.get(d) ?? [];
    arr.push(p);
    groups.set(d, arr as never);
  });

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-4xl">Schedule</h1>
          <p className="text-sm text-muted-foreground">Auto-fill the next two weeks and publish due pins on demand or via cron.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => pipeMut.mutate()} disabled={pipeMut.isPending}><Zap className="mr-2 h-4 w-4" />Run pipeline</Button>
          <Button variant="outline" onClick={() => autoMut.mutate()} disabled={autoMut.isPending}><Wand2 className="mr-2 h-4 w-4" />Auto-fill 14 days</Button>
          <Button onClick={() => pubMut.mutate()} disabled={pubMut.isPending}><Send className="mr-2 h-4 w-4" />Publish due</Button>
        </div>
      </header>

      <div className="space-y-6">
        {[...groups.entries()].map(([day, pins]) => (
          <div key={day}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground"><CalendarClock className="h-4 w-4" />{day}</h3>
            <div className="grid gap-2">
              {pins!.map((p) => (
                <Card key={p.id} className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="text-xs text-muted-foreground w-16">{new Date(p.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                    <div className="min-w-0">
                      <div className="line-clamp-1 text-sm font-medium">{p.pin_briefs?.title ?? "Untitled"}</div>
                      <div className="text-xs text-muted-foreground">{p.boards?.name ?? "no board"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={p.status === "published" ? "default" : p.status === "failed" ? "destructive" : "outline"}>{p.status}</Badge>
                    {p.status === "queued" && (
                      <Button size="icon" variant="ghost" onClick={() => cancelMut.mutate(p.id)}><X className="h-4 w-4" /></Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
        {!data?.length && <p className="text-sm text-muted-foreground">Nothing scheduled yet — auto-fill to spread ready pins across the next two weeks.</p>}
      </div>
    </div>
  );
}
