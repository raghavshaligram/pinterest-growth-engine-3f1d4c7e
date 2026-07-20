import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { dashboardStats } from "@/lib/dashboard.functions";
import { runImageWorker } from "@/lib/briefs.functions";
import { runPublisher } from "@/lib/schedule.functions";
import { runSerpSweep } from "@/lib/keywords.functions";
import { toast } from "sonner";
import { Pin, Check, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
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

// How many "marked as manually posted" rows show inline before the rest
// collapse under a "N more" expandable row.
const MANUAL_INLINE_LIMIT = 2;


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

type LogRow = {
  id: string;
  at: string;
  level: string;
  message: string;
  pinTitle: string | null;
  boardName: string | null;
  thumbUrl: string | null;
};

// Turn a raw publish_logs message into a short "what happened" suffix
// shown next to the board reference. Falls back to the raw message for
// anything that doesn't match a known pattern, so nothing gets silently
// hidden.
function eventSuffix(message: string): string {
  if (message.startsWith("Marked as manually posted")) return "manually posted";
  if (message.startsWith("Manual post mark cleared")) return "manual mark cleared";
  if (message.startsWith("Published via api")) return "auto-published";
  if (message.startsWith("Published via webhook")) return "published via your automation";
  return message;
}

function DashboardPage() {
  const qc = useQueryClient();
  const { selectedSiteId } = useSiteContext();
  const stats = useServerFn(dashboardStats);
  const imgFn = useServerFn(runImageWorker);
  const pubFn = useServerFn(runPublisher);
  const serpFn = useServerFn(runSerpSweep);
  const [manualExpanded, setManualExpanded] = useState(false);

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

  // Errors sort to the top (distinct treatment); routine "manually
  // posted" entries beyond the first couple collapse into one row so a
  // busy week doesn't bury the errors and real publish events under a
  // wall of identical manual-mark lines.
  const allLogs: LogRow[] = data?.recentLogs ?? [];
  const errorLogs = allLogs.filter((l) => l.level === "error");
  const rest = allLogs.filter((l) => l.level !== "error");
  const manualLogs = rest.filter((l) => l.message.startsWith("Marked as manually posted"));
  const normalLogs = rest.filter((l) => !l.message.startsWith("Marked as manually posted"));
  const manualVisible = manualExpanded ? manualLogs : manualLogs.slice(0, MANUAL_INLINE_LIMIT);
  const manualHiddenCount = manualLogs.length - manualVisible.length;

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
          <div className="flex items-center gap-5 overflow-x-auto pb-2 pt-2 scrollbar-hide">
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
              <Link
                to="/pins"
                className="shrink-0 self-center rounded-full border px-2.5 py-1 text-xs whitespace-nowrap hover:bg-accent"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                +{moreCount}
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

      {/* minmax(0, Nfr) instead of a bare Nfr is required here: bare fr
          tracks default to min-width: auto, so an oversized Activity feed
          (long messages, many rows) blows the column out to its content's
          intrinsic width instead of respecting the 1.3fr/1fr split -- and
          on top of that, min-w-0 on the grid items themselves is needed
          too, since a grid item's own default min-width: auto can still
          force the track wider even when the track itself is constrained. */}
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section
          className="flex min-w-0 flex-col rounded-[8px]"
          style={{ border: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <h2 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Activity</h2>
            <Link to="/logs" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
              View all
            </Link>
          </div>
          <div className="px-4 pb-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            {errorLogs.map((l) => (
              <ActivityRow key={l.id} log={l} variant="error" />
            ))}
            {normalLogs.map((l) => (
              <ActivityRow key={l.id} log={l} variant="normal" />
            ))}
            {manualVisible.map((l) => (
              <ActivityRow key={l.id} log={l} variant="normal" />
            ))}
            {manualHiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setManualExpanded((v) => !v)}
                className="flex w-full items-center justify-center gap-1 py-2.5 text-xs"
                style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)" }}
              >
                {manualExpanded ? (
                  <>Show fewer <ChevronUp className="h-3 w-3" /></>
                ) : (
                  <>{manualHiddenCount} more manually posted this week <ChevronDown className="h-3 w-3" /></>
                )}
              </button>
            )}
            {!allLogs.length && (
              <div className="py-6 text-sm" style={{ color: "var(--text-secondary)" }}>
                No activity yet.
              </div>
            )}
          </div>
        </section>

        <div className="flex min-w-0 flex-col gap-6">
          <section
            className="flex min-w-0 flex-col rounded-[8px]"
            style={{ border: "1px solid var(--border-subtle)" }}
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <h2 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Integrations</h2>
              <Link to="/settings/integrations" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
                Manage
              </Link>
            </div>
            <div className="px-4 pb-1" style={{ borderTop: "1px solid var(--border-subtle)" }}>
              {providers.map((p, idx) => {
                const row = data?.integrations.find((i) => i.provider === p);
                const ok = row?.status === "ok";
                return (
                  <div
                    key={p}
                    className="flex items-center justify-between py-2.5"
                    style={{ borderBottom: idx === providers.length - 1 ? undefined : "1px solid var(--border-subtle)" }}
                  >
                    <span className="text-sm capitalize" style={{ color: "var(--text-primary)" }}>{p}</span>
                    {ok ? (
                      <Check className="h-3.5 w-3.5" style={{ color: "var(--success)" }} />
                    ) : (
                      <Link
                        to="/settings/integrations"
                        className="text-xs hover:underline"
                        style={{ color: "var(--accent)" }}
                      >
                        {row?.status === "error" ? "Reconnect" : "Connect"}
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section
            className="flex min-w-0 flex-col rounded-[8px]"
            style={{ border: "1px solid var(--border-subtle)" }}
          >
            <div className="flex items-baseline gap-2 px-4 pt-3 pb-2">
              <h2 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Pins by board</h2>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>this week</span>
            </div>
            <div className="px-4 pb-1" style={{ borderTop: "1px solid var(--border-subtle)" }}>
              {(data?.pinsByBoard ?? []).map((b, idx, arr) => (
                <div
                  key={b.name}
                  className="flex items-center justify-between py-2.5"
                  style={{ borderBottom: idx === arr.length - 1 ? undefined : "1px solid var(--border-subtle)" }}
                >
                  <span className="truncate text-sm" style={{ color: "var(--text-primary)" }}>{b.name}</span>
                  <span className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>{b.count}</span>
                </div>
              ))}
              {!data?.pinsByBoard?.length && (
                <div className="py-4 text-sm" style={{ color: "var(--text-secondary)" }}>
                  Nothing published this week yet.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

    </div>
  );
}

function ActivityRow({ log, variant }: { log: LogRow; variant: "error" | "normal" }) {
  const isError = variant === "error";
  return (
    <div
      className="flex items-center gap-3 rounded-[6px] py-2.5"
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        backgroundColor: isError ? "color-mix(in oklab, var(--destructive) 8%, transparent)" : undefined,
        paddingLeft: isError ? 8 : 0,
        paddingRight: isError ? 8 : 0,
        marginLeft: isError ? -8 : 0,
        marginRight: isError ? -8 : 0,
      }}
    >
      {isError ? (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]"
          style={{ backgroundColor: "color-mix(in oklab, var(--destructive) 15%, transparent)" }}
        >
          <AlertTriangle className="h-3.5 w-3.5" style={{ color: "var(--destructive)" }} />
        </span>
      ) : log.thumbUrl ? (
        <img src={log.thumbUrl} alt="" className="h-7 w-7 shrink-0 rounded-[6px] object-cover" style={{ border: "1px solid var(--border)" }} />
      ) : (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]"
          style={{ backgroundColor: "var(--border-subtle)" }}
        >
          <Pin className="h-3 w-3" style={{ color: "var(--text-muted)" }} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {isError ? (
          <div className="truncate text-sm" style={{ color: "var(--destructive)" }}>{log.message}</div>
        ) : (
          <>
            <div className="truncate text-sm" style={{ color: "var(--text-primary)" }}>
              {log.pinTitle ?? eventSuffix(log.message)}
            </div>
            {log.pinTitle && (
              <div className="truncate text-xs" style={{ color: "var(--text-secondary)" }}>
                {log.boardName ? `→ ${log.boardName} board · ${eventSuffix(log.message)}` : eventSuffix(log.message)}
              </div>
            )}
          </>
        )}
      </div>
      <span className="shrink-0 font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
        {formatClock(log.at)}
      </span>
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
