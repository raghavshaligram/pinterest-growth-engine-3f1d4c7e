import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { dashboardStats } from "@/lib/dashboard.functions";
import { runImageWorker } from "@/lib/briefs.functions";
import { runPublisher } from "@/lib/schedule.functions";
import { runSerpSweep } from "@/lib/keywords.functions";
import { toast } from "sonner";

// Dashboard-only design tokens. Deliberately not touching the shared
// theme in styles.css (that drives every other route) — this palette is
// scoped to this page via arbitrary Tailwind values.
const TOKENS = {
  bg: "#0B0B0D",
  border: "#202024",
  textPrimary: "#F2F1ED",
  textSecondary: "#8B8A90",
  accent: "#E85D42",
  success: "#5DCAA5",
  warning: "#D9A441",
};

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Pinspider" }] }),
  component: DashboardPage,
});

function formatClock(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const min = Math.floor(diffMs / 60_000);
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
  const stats = useServerFn(dashboardStats);
  const imgFn = useServerFn(runImageWorker);
  const pubFn = useServerFn(runPublisher);
  const serpFn = useServerFn(runSerpSweep);

  const { data } = useQuery({ queryKey: ["dash"], queryFn: () => stats() });

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

  const s = data;
  const ready = s?.readyToPublish ?? [];
  const moreCount = Math.max(0, (s?.readyToPublishTotal ?? 0) - ready.length);
  const providers = ["openai", "replicate", "apify", "pinterest"] as const;

  return (
    <div
      className="space-y-8 rounded-xl p-6"
      style={{ backgroundColor: TOKENS.bg, color: TOKENS.textPrimary }}
    >
      {/* 1. Compact header: label left, monospace stat row right. */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-sm font-semibold uppercase tracking-wider" style={{ color: TOKENS.textSecondary }}>
            Dashboard
          </h1>
          <div className="font-mono text-xs" style={{ color: TOKENS.textSecondary }}>
            {s?.briefs ?? 0} briefs · {s?.pages ?? 0} pages · {s?.queuedJobs ?? 0} queued
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <ActionLink label="Generate images" pending={imgM.isPending} onClick={() => imgM.mutate()} />
          <Dot char="·" />
          <ActionLink label="Publish due" pending={pubM.isPending} onClick={() => pubM.mutate()} />
          <Dot char="·" />
          <ActionLink label="SERP sweep" pending={serpM.isPending} onClick={() => serpM.mutate()} />
        </div>
      </header>

      {/* 2. Ready to publish — thumbnail rail, the visual anchor. */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Ready to publish</h2>
          <Link to="/pins" className="text-xs hover:underline" style={{ color: TOKENS.accent }}>
            View all
          </Link>
        </div>
        {ready.length ? (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {ready.map((r) => (
              <div key={r.id} className="w-36 shrink-0">
                <div
                  className="aspect-[2/3] overflow-hidden rounded-[8px] border"
                  style={{ borderColor: TOKENS.border, backgroundColor: "#141416" }}
                >
                  <img src={r.thumbUrl} alt={r.pageTitle} className="h-full w-full object-cover" loading="lazy" />
                </div>
                <div className="mt-1.5 truncate text-xs" style={{ color: TOKENS.textSecondary }} title={r.pageTitle}>
                  {r.pageTitle}
                </div>
              </div>
            ))}
            {moreCount > 0 && (
              <Link to="/pins" className="w-36 shrink-0">
                <div
                  className="flex aspect-[2/3] items-center justify-center rounded-[8px] border text-sm"
                  style={{ borderColor: TOKENS.border, backgroundColor: "#141416", color: TOKENS.textSecondary }}
                >
                  +{moreCount} more
                </div>
              </Link>
            )}
          </div>
        ) : (
          <div
            className="rounded-[8px] border border-dashed px-4 py-6 text-sm"
            style={{ borderColor: TOKENS.border, color: TOKENS.textSecondary }}
          >
            Nothing ready yet — generate pin images for an analyzed page to fill this up.
          </div>
        )}
      </section>

      {/* 3. Activity (left, wider) + Integrations (right). */}
      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">Activity</h2>
            <Link to="/logs" className="text-xs hover:underline" style={{ color: TOKENS.accent }}>
              View all
            </Link>
          </div>
          <div className="border-t" style={{ borderColor: TOKENS.border }}>
            {(s?.recentLogs ?? []).map((l, i) => (
              <div key={i} className="flex items-center gap-3 border-b py-2.5" style={{ borderColor: TOKENS.border }}>
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: l.level === "error" ? TOKENS.warning : TOKENS.success }}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{l.message}</span>
                <span className="shrink-0 font-mono text-xs" style={{ color: TOKENS.textSecondary }}>
                  {formatClock(l.at)}
                </span>
              </div>
            ))}
            {!s?.recentLogs?.length && (
              <div className="py-6 text-sm" style={{ color: TOKENS.textSecondary }}>
                No activity yet.
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">Integrations</h2>
            <Link to="/settings/integrations" className="text-xs hover:underline" style={{ color: TOKENS.accent }}>
              Manage
            </Link>
          </div>
          <div className="border-t" style={{ borderColor: TOKENS.border }}>
            {providers.map((p) => {
              const row = s?.integrations.find((i) => i.provider === p);
              const status = row?.status ?? "unconfigured";
              const dotColor = status === "ok" ? TOKENS.success : status === "error" ? TOKENS.warning : TOKENS.textSecondary;
              return (
                <div key={p} className="flex items-center justify-between border-b py-2.5" style={{ borderColor: TOKENS.border }}>
                  <span className="text-sm capitalize">{p}</span>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />
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
      className="transition-colors hover:text-[#F2F1ED] disabled:cursor-not-allowed disabled:opacity-50"
      style={{ color: "#8B8A90" }}
    >
      {props.pending ? `${props.label}…` : props.label}
    </button>
  );
}

function Dot({ char }: { char: string }) {
  return <span style={{ color: "#3A3A3F" }}>{char}</span>;
}
