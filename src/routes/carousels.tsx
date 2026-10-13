// Instagram carousels: review, edit, approve and send. Drafts are written nightly from blog posts (see carousels.server.ts).
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { PinShell } from "@/components/PinShell";
import {
  buildCarouselsNow, carouselAction, editSlide, generateCarouselNow, getCarouselSettings, listCarousels, saveCaption, saveCarouselSettings,
  type CarouselRow, type CarouselSlide,
} from "@/lib/carousels.functions";

export const Route = createFileRoute("/carousels")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  head: () => ({ meta: [{ title: "Carousels — Pinspider" }] }),
  component: () => <CarouselsRoute />,
});

function CarouselsRoute() {
  const { user } = Route.useRouteContext();
  return (
    <PinShell active="carousels" userEmail={user?.email}>
      <div className="flex-1 overflow-y-auto px-8 py-6 no-scrollbar" style={{ scrollbarWidth: "none" }}>
        <CarouselsPage />
      </div>
    </PinShell>
  );
}

const STATUS_LABEL: Record<string, string> = {
  photos: "Making photos", rendering: "Rendering slides", review: "Ready for review", approved: "Approved", published: "Sent to Instagram", failed: "Failed",
};

function CarouselsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listCarousels);
  const genFn = useServerFn(generateCarouselNow);
  const buildFn = useServerFn(buildCarouselsNow);
  const { data, isLoading } = useQuery({ queryKey: ["carousels"], queryFn: () => listFn(), refetchInterval: 15000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ["carousels"] });
  const gen = useMutation({
    mutationFn: () => genFn({ data: {} }),
    onSuccess: (r) => { if (r.created) toast.success("Drafted a new carousel. Photos and slides follow within a few minutes."); else toast.message(r.reason ?? "Nothing to draft"); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const build = useMutation({
    mutationFn: () => buildFn(),
    onSuccess: (r) => { toast.message(`Build step ran: ${r.photos} slide images made, ${r.rendered} slides rendered, ${r.waiting} carousels still waiting. Any problem shows on the carousel.`); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl">Carousels</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            A listicle carousel for Instagram, written from one blog post at a time. Text is set by code so it is always aligned and spelled right; photos come from Nano Banana 2.
            Approve a carousel and it posts in the daily window through your Make scenario.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={build.isPending} onClick={() => build.mutate()}>Run build now</Button>
          <Button size="sm" disabled={gen.isPending} onClick={() => gen.mutate()}>{gen.isPending ? "Drafting..." : "Draft a carousel now"}</Button>
        </div>
      </header>
      <SettingsCard />
      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!isLoading && !data?.length && <p className="text-sm text-muted-foreground">No carousels yet. One is drafted overnight, or press Draft a carousel now.</p>}
      {data?.map((c) => <CarouselCard key={c.id} c={c} onChange={refresh} />)}
    </div>
  );
}

function SettingsCard() {
  const qc = useQueryClient();
  const getFn = useServerFn(getCarouselSettings);
  const saveFn = useServerFn(saveCarouselSettings);
  const { data } = useQuery({ queryKey: ["carousel-settings"], queryFn: () => getFn() });
  const [url, setUrl] = useState("");
  const save = useMutation({
    mutationFn: (d: { webhook_url?: string; per_day?: number; auto_approve?: boolean; paused?: boolean }) => saveFn({ data: d }),
    onSuccess: () => { toast.success("Saved"); setUrl(""); qc.invalidateQueries({ queryKey: ["carousel-settings"] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (!data) return null;
  return (
    <Card className="space-y-3 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2"><Switch checked={data.auto_approve} onCheckedChange={(v) => save.mutate({ auto_approve: v })} /> Auto-approve (skip review)</label>
        <label className="flex items-center gap-2"><Switch checked={data.paused} onCheckedChange={(v) => save.mutate({ paused: v })} /> Pause drafting and posting</label>
        <span className="text-muted-foreground">Per day: {data.per_day}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xl" placeholder={data.webhook_set ? "Make webhook saved. Paste a new URL to replace it" : "Paste the Make webhook URL for the Instagram scenario"} value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button size="sm" disabled={!url || save.isPending} onClick={() => save.mutate({ webhook_url: url.trim() })}>Save webhook</Button>
        <Badge variant={data.webhook_set ? "outline" : "destructive"}>{data.webhook_set ? "Webhook set" : "No webhook yet"}</Badge>
      </div>
    </Card>
  );
}

function CarouselCard({ c, onChange }: { c: CarouselRow; onChange: () => void }) {
  const actFn = useServerFn(carouselAction);
  const capFn = useServerFn(saveCaption);
  const [caption, setCaption] = useState(c.caption ?? "");
  const [tags, setTags] = useState(c.hashtags ?? "");
  const act = useMutation({
    mutationFn: (action: "approve" | "unapprove" | "reject" | "publish_now" | "retry") => actFn({ data: { id: c.id, action } }),
    onSuccess: (r: { scheduled_for?: string; published?: number }) => { toast.success(r?.scheduled_for ? `Scheduled for ${r.scheduled_for}` : r?.published ? "Sent to the Instagram webhook" : "Done"); onChange(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const saveCap = useMutation({ mutationFn: () => capFn({ data: { id: c.id, caption, hashtags: tags } }), onSuccess: () => { toast.success("Caption saved"); onChange(); } });
  const inProgress = c.status === "photos" || c.status === "rendering";
  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">{c.title}</div>
          <div className="text-xs text-muted-foreground">{c.page_url}</div>
          <div className="mt-1 flex gap-2">
            <Badge variant={c.status === "failed" ? "destructive" : "outline"}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
            {c.scheduled_for && <Badge variant="outline">Posts {c.scheduled_for}</Badge>}
          </div>
          {c.error && <div className="mt-1 text-xs text-destructive">{c.error}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          {c.status === "review" && <Button size="sm" onClick={() => act.mutate("approve")}>Approve</Button>}
          {c.status === "approved" && <Button size="sm" variant="outline" onClick={() => act.mutate("unapprove")}>Unapprove</Button>}
          {(c.status === "review" || c.status === "approved") && <Button size="sm" variant="outline" onClick={() => act.mutate("publish_now")}>Post now</Button>}
          {c.status === "failed" && <Button size="sm" onClick={() => act.mutate("retry")}>Retry</Button>}
          {c.status !== "published" && <Button size="sm" variant="ghost" onClick={() => act.mutate("reject")}>Reject</Button>}
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {c.slides.map((s) => <SlideTile key={s.id} s={s} locked={c.status === "published"} onChange={onChange} />)}
      </div>
      {inProgress && <p className="text-xs text-muted-foreground">Still being built. This page refreshes on its own.</p>}
      {c.status !== "published" && (
        <div className="space-y-2">
          <Textarea rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} />
          <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          <Button size="sm" variant="outline" disabled={saveCap.isPending} onClick={() => saveCap.mutate()}>Save caption</Button>
        </div>
      )}
    </Card>
  );
}

function SlideTile({ s, locked, onChange }: { s: CarouselSlide; locked: boolean; onChange: () => void }) {
  const editFn = useServerFn(editSlide);
  const [editing, setEditing] = useState(false);
  const [heading, setHeading] = useState(s.heading);
  const [body, setBody] = useState(s.body ?? "");
  const edit = useMutation({
    mutationFn: (d: { heading?: string; body?: string; regeneratePhoto?: boolean }) => editFn({ data: { id: s.id, ...d } }),
    onSuccess: () => { toast.success("Updated. The slide re-renders in a few minutes."); setEditing(false); onChange(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="w-44 shrink-0 space-y-2">
      <div className="aspect-[4/5] w-44 overflow-hidden rounded-md border bg-muted">
        {s.image_url ? <img src={s.image_url} alt={s.alt_text ?? s.heading} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">{s.error ? "Error" : "Not rendered yet"}</div>}
      </div>
      {s.error && <div className="text-[10px] text-destructive">{s.error.slice(0, 120)}</div>}
      {!locked && !editing && (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditing(true)}>Edit text</Button>
          {s.kind !== "outro" && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => edit.mutate({ regeneratePhoto: true })}>New photo</Button>}
        </div>
      )}
      {editing && (
        <div className="space-y-1">
          <Input value={heading} onChange={(e) => setHeading(e.target.value)} />
          <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex gap-1">
            <Button size="sm" className="h-7" disabled={edit.isPending} onClick={() => edit.mutate({ heading, body })}>Save</Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
