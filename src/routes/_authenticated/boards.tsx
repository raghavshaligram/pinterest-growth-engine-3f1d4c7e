import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listBoards, upsertBoard, deleteBoard, syncPinterestBoards } from "@/lib/boards.functions";
import { listSites } from "@/lib/sites.functions";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { LayoutGrid, Trash2, RefreshCw, Save } from "lucide-react";

export const Route = createFileRoute("/_authenticated/boards")({
  head: () => ({ meta: [{ title: "Boards — Pinspider" }] }),
  component: BoardsPage,
});

type BoardRow = Awaited<ReturnType<typeof listBoards>>[number];

function BoardsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listBoards);
  const listSitesFn = useServerFn(listSites);
  const up = useServerFn(upsertBoard);
  const del = useServerFn(deleteBoard);
  const sync = useServerFn(syncPinterestBoards);

  const { data: boards } = useQuery({ queryKey: ["boards"], queryFn: () => list() });
  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: () => listSitesFn() });

  const syncMut = useMutation({
    mutationFn: () => sync(),
    onSuccess: (r) => {
      toast.success(`Synced ${r.total} boards from Pinterest (${r.created} new, ${r.updated} updated)`);
      qc.invalidateQueries({ queryKey: ["boards"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const [name, setName] = useState("");
  const [pid, setPid] = useState("");
  const addMut = useMutation({
    mutationFn: () => up({ data: { name, pinterest_board_id: pid || undefined } }),
    onSuccess: () => { setName(""); setPid(""); toast.success("Board saved"); qc.invalidateQueries({ queryKey: ["boards"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Boards</h1>
          <p className="text-sm text-muted-foreground">
            Sync your Pinterest boards, then tag each one with the sites and topics it should promote.
            The scheduler enforces one URL per board per day.
          </p>
        </div>
        <Button onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>
          <RefreshCw className={`mr-2 h-4 w-4 ${syncMut.isPending ? "animate-spin" : ""}`} />
          Sync from Pinterest
        </Button>
      </header>

      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold">Add board manually</h2>
        <form onSubmit={(e) => { e.preventDefault(); addMut.mutate(); }} className="grid gap-4 md:grid-cols-3 md:items-end">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div><Label>Pinterest board ID <span className="text-muted-foreground">(optional)</span></Label><Input value={pid} onChange={(e) => setPid(e.target.value)} /></div>
          <div><Button type="submit">Save board</Button></div>
        </form>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {boards?.map((b) => (
          <BoardCard key={b.id} board={b} sites={sites ?? []} onDelete={() => del({ data: { id: b.id } }).then(() => qc.invalidateQueries({ queryKey: ["boards"] }))} onSaved={() => qc.invalidateQueries({ queryKey: ["boards"] })} />
        ))}
        {!boards?.length && (
          <p className="text-sm text-muted-foreground">No boards yet. Click <strong>Sync from Pinterest</strong> to pull them in.</p>
        )}
      </div>
    </div>
  );
}

function BoardCard({
  board, sites, onDelete, onSaved,
}: {
  board: BoardRow;
  sites: Awaited<ReturnType<typeof listSites>>;
  onDelete: () => void;
  onSaved: () => void;
}) {
  const up = useServerFn(upsertBoard);
  const [topics, setTopics] = useState((board.topics ?? []).join(", "));
  const [siteIds, setSiteIds] = useState<string[]>(board.site_ids ?? []);

  const saveMut = useMutation({
    mutationFn: () => up({ data: {
      id: board.id,
      name: board.name,
      pinterest_board_id: board.pinterest_board_id ?? undefined,
      keywords: board.keywords ?? [],
      description: board.description ?? undefined,
      topics: topics.split(",").map((s) => s.trim()).filter(Boolean),
      site_ids: siteIds,
    } }),
    onSuccess: () => { toast.success("Board updated"); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const toggleSite = (id: string) => {
    setSiteIds((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex gap-4 p-4">
        {board.image_url ? (
          <img src={board.image_url} alt="" className="h-20 w-20 flex-shrink-0 rounded object-cover" />
        ) : (
          <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded bg-muted">
            <LayoutGrid className="h-6 w-6 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{board.name}</div>
              {board.description && <div className="line-clamp-2 text-xs text-muted-foreground">{board.description}</div>}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {board.pinterest_board_id ? <Badge variant="secondary">Synced</Badge> : <Badge variant="outline">Manual</Badge>}
                <span>{board.pin_count} pins</span>
                {board.synced_at && <span>· synced {new Date(board.synced_at).toLocaleDateString()}</span>}
              </div>
            </div>
            <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      <div className="space-y-3 border-t bg-muted/30 p-4">
        <div>
          <Label className="text-xs">Topics <span className="text-muted-foreground">(comma-separated, used for auto-matching)</span></Label>
          <Input value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="rainwater, drip irrigation, garden watering" />
        </div>
        <div>
          <Label className="text-xs">Sites this board promotes</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {sites.length === 0 && <span className="text-xs text-muted-foreground">Add a site first.</span>}
            {sites.map((s) => {
              const active = siteIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleSite(s.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${active ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-muted"}`}
                >
                  {s.brand_name ?? new URL(s.url).hostname.replace(/^www\./, "")}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Empty = board can promote any site.</p>
        </div>
        <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          <Save className="mr-2 h-4 w-4" />Save mapping
        </Button>
      </div>
    </Card>
  );
}
