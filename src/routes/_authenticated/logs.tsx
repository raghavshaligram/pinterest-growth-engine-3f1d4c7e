import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const listLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("publish_logs")
      .select("at, level, message, payload")
      .order("at", { ascending: false })
      .limit(200);
    return data ?? [];
  });

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({ meta: [{ title: "Logs — Pinspider" }] }),
  component: LogsPage,
});

function LogsPage() {
  const fn = useServerFn(listLogs);
  const { data } = useQuery({ queryKey: ["logs"], queryFn: () => fn() });
  return (
    <div className="space-y-6">
      <header><h1 className="font-display text-4xl">Logs</h1></header>
      <div className="space-y-1">
        {data?.map((l, i) => (
          <Card key={i} className="flex items-start gap-3 p-3 text-sm">
            <Badge variant={l.level === "error" ? "destructive" : "outline"}>{l.level}</Badge>
            <div className="flex-1">
              <div>{l.message}</div>
              <div className="text-xs text-muted-foreground">{new Date(l.at).toLocaleString()}</div>
            </div>
          </Card>
        ))}
        {!data?.length && <p className="text-sm text-muted-foreground">No logs yet.</p>}
      </div>
    </div>
  );
}
