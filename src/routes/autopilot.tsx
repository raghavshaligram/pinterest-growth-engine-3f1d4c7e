// Read-only view of the autopilot content calendar (public.autopilot_plan): one page and one pin theme per day for
// the next 30 days, filled in nightly by /api/public/cron/autopilot?stage=plan.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PinShell } from "@/components/PinShell";
import { PIN_THEMES } from "@/lib/pin-themes";

type PlanRow = {
  plan_date: string; theme_id: string | null; template_id: string | null; status: string; last_error: string | null;
  brief_id: string | null; pages: { url?: string; title?: string | null } | null;
};

const listPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const today = new Date().toISOString().slice(0, 10);
    // The table is newer than the generated Supabase types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (context.supabase as any).from("autopilot_plan")
      .select("plan_date, theme_id, template_id, status, last_error, brief_id, pages(url, title)")
      .eq("user_id", context.userId).gte("plan_date", today).order("plan_date", { ascending: true }).limit(60);
    return (data ?? []) as PlanRow[];
  });

export const Route = createFileRoute("/autopilot")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  head: () => ({ meta: [{ title: "Autopilot — Pinspider" }] }),
  component: () => <AutopilotRoute />,
});

function AutopilotRoute() {
  const { user } = Route.useRouteContext();
  return (
    <PinShell active="autopilot" userEmail={user?.email}>
      <div className="flex-1 overflow-y-auto px-8 py-6 no-scrollbar" style={{ scrollbarWidth: "none" }}>
        <AutopilotPage />
      </div>
    </PinShell>
  );
}

function AutopilotPage() {
  const fn = useServerFn(listPlan);
  const { data, isLoading } = useQuery({ queryKey: ["autopilot-plan"], queryFn: () => fn() });
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl">Autopilot</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One pin a day for the next 30 days. The plan is rebuilt every night, new blogs and calculators jump the queue,
          and each pin is written and published automatically.
        </p>
      </header>
      <div className="space-y-1">
        {data?.map((r) => {
          const theme = PIN_THEMES[r.theme_id ?? ""];
          const d = new Date(r.plan_date + "T00:00:00Z");
          return (
            <Card key={r.plan_date} className="flex items-start gap-3 p-3 text-sm">
              <div className="w-28 shrink-0">
                <div className="font-medium">{d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</div>
                <Badge variant={r.status === "error" ? "destructive" : "outline"} className="mt-1">{r.status}</Badge>
              </div>
              <div className="flex-1">
                <div>{r.pages?.title ?? r.pages?.url ?? "Page"}</div>
                <div className="text-xs text-muted-foreground">
                  {theme?.label ?? r.theme_id}{r.template_id ? ` · ${r.template_id.replace(/_/g, " ")}` : ""}
                </div>
                {r.last_error && <div className="text-xs text-destructive">{r.last_error}</div>}
              </div>
            </Card>
          );
        })}
        {!isLoading && !data?.length && (
          <p className="text-sm text-muted-foreground">No plan yet. It is built overnight once pages have been crawled and analyzed.</p>
        )}
      </div>
    </div>
  );
}
