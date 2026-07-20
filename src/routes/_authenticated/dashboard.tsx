import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { dashboardStats } from "@/lib/dashboard.functions";
import { runImageWorker } from "@/lib/briefs.functions";
import { runPublisher } from "@/lib/schedule.functions";
import { runSerpSweep } from "@/lib/keywords.functions";
import { toast } from "sonner";
import { Pin, Check } from "lucide-react";
import { useSiteContext } from "@/lib/site-context";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Pinspider" }] }),
  component: DashboardPage,
});

const STAGES = [
  { key: "pages", label: "Pages" },
  { key: "briefs", label: "Briefs" },
  { key: "images", label: "Images" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
] as const;

function formatClock(iso: string): string {
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function DashboardPage() {
  const qc = useQueryClient();
  const { selectedSiteId } = useSiteContext();
  const stats = useServerFn(dashboardStats);
  const imgFn = useServerFn(runImageWorker);
  const pubFn = useServerFn(runPublisher);
  const serpFn = useServerFn(runSerpSweep);

  const { data } = useQuery({
    queryKey: ["dash", selectedSiteId],
    queryFn: () => stats({ data: { siteId: selectedSiteId } }),
  });

  const imgM = useMutation({
    mutationFn: () => imgFn(),
    onSuccess: (r) => { toast.success(`Images: ${JSON.stringify(r)}`); qc.invalidateQueries(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const pubM = useMutation({
    mutationFn: () => pubFn(),
    onSuccess: (r) => { toast.success(`Publisher: ${JSON.stringify(r)}`); qc.invalidateQueries(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const serpM = useMutation({
    mutationFn: () => serpFn(),
    onSuccess: (r) => { toast.success(`SERP sweep: ${JSON.stringify(r)}`); qc.invalidateQueries(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const pipeline = data?.pipeline;
  const needsAttention = data?.needsAttention;
  const pinned = data?.publishedThisWeek ?? [];
  const moreCount = Math.max(0, (data?.publishedThisWeekTotal ?? 0) - pinned.length);
  const providers = ["openai", "replicate", "apify", "pinterest"] as const;
  const showSiteTint = selectedSiteId === null;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
          Dashboard
        </h1>
        <div className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
          {data?.lastUpdatedAt ? `updated ${formatClock(data.lastUpdatedAt)}` : "not synced yet"}
        </div>
      </header>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <ActionLink label="Generate images" pending={imgM.isPending} onClick={() => imgM.mutate()} />
          <span style={{ color: "var(--text-muted)" }}>·</span>
          <ActionLink label="Publish due" pending={pubM.isPending} onClick={() => pubM.mutate()} />
          <span style={{ color: "var(--text-muted)" }}>·</span>
          <ActionLink label="SERP sweep" pending={serpM.isPending} onClick={() => serpM.mutate()} />
        </div>
        <div className="relative flex justify-between pt-6">
          <div className="absolute left-[10%] right-[10%] top-[27px] h-px" style={{ backgroundColor: "var(--border)" }} />
          {STAGES.map((stage) => {
            const active = needsAttention === stage.key;
            const count = pipeline?.[stage.key] ?? 0;
            return (
              <div key={stage.key} className="relative z-10 flex flex-1 flex-col items-center gap-1.5">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{
                    backgroundColor: active ? "var(--accent)" : "var(--bg-card)",
                    border: `1.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  }}
                />
                <span className="text-xs" style={{ color: active ? "var(--accent)" : "var(--text-secondary)" }}>
                  {stage.label}
                </span>
                <span
                  className="font-mono text-sm font-medium"
                  style={{ color: active ? "var(--accent)" : "var(--text-primary)" }}
                >
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Pinned this week
          </h2>
          <Link to="/pins" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
            View all
          </Link>
        </div>
        {pinned.length ? (
          <div className="flex gap-5 overflow-x-auto pb-2 pt-2">
            {pinned.map((p, i) => {
              const rot = i % 2 === 0 ? -1.5 : 1.5;
              return (
                <div key={p.id} className="w-32 shrink-0" style={{ transform: `rotate(${rot}deg)` }}>
                  <div className="relative">
                    <div
                      className="absolute -top-2.5 left-1/2 z-10 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full"
                      style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border)" }}
                    >
                      <Pin className="h-3 w-3" style={{ color: "var(--accent)" }} />
                    </div>
                    <div
                      className="rounded-[8px] p-1.5"
                      style={{
                        backgroundColor: "var(--bg-card)",
                        border: showSiteTint ? `1.5px solid ${p.siteColor}` : "1px solid var(--border)",
                      }}
                    >
                      <div className="aspect-[2/3] overflow-hidden rounded-[6px]" style={{ backgroundColor: "var(--border-subtle)" }}>
                        <img src={p.thumbUrl} alt={p.pageTitle} className="h-full w-full object-cover" loading="lazy" />
                      </div>
                    </div>
                  </div>
                  <div
                    className="mt-1.5 truncate text-center text-xs"
                    style={{ color: "var(--text-secondary)" }}
                    title={p.pageTitle}
                  >
                    {p.pageTitle}
                  </div>
                </div>
              );
            })}
            {moreCount > 0 && (
              <Link to="/pins" className="w-32 shrink-0 self-start">
                <div
                  className="flex aspect-[2/3] items-center justify-center rounded-[8px] text-sm"
                  style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                >
                  +{moreCount} more
                </div>
              </Link>
            )}
          </div>
        ) : (
          <div
            className="rounded-[8px] border border-dashed px-4 py-6 text-sm"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            Nothing published this week yet.
          </div>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Activity</h2>
            <Link to="/logs" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
              View all
            </Link>
          </div>
          <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
            {(data?.recentLogs ?? []).map((l, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: l.level === "error" ? "#C68A4B" : "var(--success)" }}
                />
                <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text-primary)" }}>{l.message}</span>
                <span className="shrink-0 font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
                  {formatClock(l.at)}
                </span>
              </div>
            ))}
            {!data?.recentLogs?.length && (
              <div className="py-6 text-sm" style={{ color: "var(--text-secondary)" }}>
                No activity yet.
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Integrations</h2>
            <Link to="/settings/integrations" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
              Manage
            </Link>
          </div>
          <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
            {providers.map((p) => {
              const row = data?.integrations.find((i) => i.provider === p);
              const ok = row?.status === "ok";
              return (
                <div
                  key={p}
                  className="flex items-center justify-between py-2.5"
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <span className="text-sm capitalize" style={{ color: "var(--text-primary)" }}>{p}</span>
                  {ok ? (
                    <Check className="h-3.5 w-3.5" style={{ color: "var(--success)" }} />
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>—</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function ActionLink(props: { label: string; pending: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.pending}
      className="transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      style={{ color: "var(--text-secondary)" }}
    >
      {props.pending ? `${props.label}…` : props.label}
    </button>
  );
}
