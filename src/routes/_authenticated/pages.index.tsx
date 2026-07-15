import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPages } from "@/lib/pages.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/pages/")({
  head: () => ({ meta: [{ title: "Pages — PinForge" }] }),
  component: PagesPage,
});

function PagesPage() {
  const list = useServerFn(listPages);
  const { data } = useQuery({ queryKey: ["pages"], queryFn: () => list() });
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl">Pages</h1>
        <p className="text-sm text-muted-foreground">Every URL discovered from your sitemaps. Click one to analyze and generate pins.</p>
      </header>
      <div className="space-y-2">
        {data?.map((p) => (
          <Link key={p.id} to="/pages/$id" params={{ id: p.id }}>
            <Card className="flex items-center justify-between p-4 transition hover:border-primary/50">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.title ?? p.url}</div>
                <div className="truncate text-xs text-muted-foreground">{p.url}</div>
              </div>
              <div className="flex items-center gap-2">
                {p.last_analyzed_at ? <Badge variant="outline">Analyzed</Badge> : <Badge variant="secondary">Not analyzed</Badge>}
              </div>
            </Card>
          </Link>
        ))}
        {!data?.length && <p className="text-sm text-muted-foreground">Add a site and crawl it.</p>}
      </div>
    </div>
  );
}
