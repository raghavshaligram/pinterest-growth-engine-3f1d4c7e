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
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [boardsExpanded, setBoardsExpanded] = useState(false);
  const ACTIVITY_COLLAPSED = 5;
  const BOARDS_COLLAPSED = 10;

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
  const visiblePinned = pinned.slice(0, 7);
  const moreCount = Math.max(0, (data?.publishedThisWeekTotal ?? 0) - 7);
  const providers = ["openai", "replicate", "apify", "pinterest"] as const;
  const showSiteTint = selectedSiteId === null;

  // Newest first, regardless of level. Manual-post spam still collapses
  // via the "N more manually posted" toggle so it doesn't drown the feed.
  const allLogs: LogRow[] = [...(data?.recentLogs ?? [])].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
  const isManual = (l: LogRow) => l.message.startsWith("Marked as manually posted");
  const manualLogs = allLogs.filter(isManual);
  const nonManualLogs = allLogs.filter((l) => !isManual(l));
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
        {visiblePinned.length ? (
          <div className="flex items-center gap-5 overflow-x-auto pb-2 pt-2 scrollbar-hide">
            {visiblePinned.map((p, i) => {
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




      {/* Integrations spans full width above the Activity / Pins-by-board row. */}
      <section
        className="card-glow flex min-w-0 flex-col rounded-[12px]"
        style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Integrations</h2>
          <Link to="/settings/integrations" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
            Manage
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          {providers.map((p) => {
            const row = data?.integrations.find((i) => i.provider === p);
            const ok = row?.status === "ok";
            const errored = row?.status === "error";
            return (
              <div
                key={p}
                className="rounded-[10px] p-3"
                style={{
                  border: "1px solid var(--border-subtle)",
                  backgroundImage: ok ? "var(--gradient-primary-soft)" : "none",
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: ok ? "var(--success)" : errored ? "var(--destructive)" : "var(--text-muted)",
                      boxShadow: ok ? "0 0 8px color-mix(in oklab, var(--success) 60%, transparent)" : undefined,
                    }}
                  />
                  <span className="text-sm capitalize" style={{ color: "var(--text-primary)" }}>{p}</span>
                </div>
                <div className="mt-1.5">
                  {ok ? (
                    <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>Connected</span>
                  ) : (
                    <Link
                      to="/settings/integrations"
                      className="text-[11px] hover:underline"
                      style={{ color: "var(--accent)" }}
                    >
                      {errored ? "Reconnect →" : "Connect →"}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Activity + Pins by board sit side by side on their own row. */}
      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section
          className="card-glow flex min-w-0 flex-col rounded-[12px]"
          style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Activity</h2>
              <span
                className="rounded-full px-1.5 py-0.5 font-mono text-[10px]"
                style={{ backgroundColor: "var(--surface-hover)", color: "var(--text-secondary)" }}
              >
                {allLogs.length}
              </span>
            </div>
            <Link to="/logs" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
              View all
            </Link>
          </div>
          <div className="flex-1 px-3 pb-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            {(() => {
              // Sort strictly by time, newest first. Manual-posts are
              // still folded via the manualHiddenCount button below.
              const merged: Array<{ log: LogRow; variant: "error" | "normal" | "manual" }> = [
                ...nonManualLogs.map((l) => ({
                  log: l,
                  variant: (l.level === "error" ? "error" : "normal") as "error" | "normal" | "manual",
                })),
                ...manualVisible.map((l) => ({ log: l, variant: "manual" as const })),
              ].sort((a, b) => new Date(b.log.at).getTime() - new Date(a.log.at).getTime());
              const combined = merged;
              const shown = activityExpanded ? combined : combined.slice(0, ACTIVITY_COLLAPSED);
              const hidden = combined.length - shown.length;
              return (
                <>
                  {shown.map(({ log, variant }) => (
                    <ActivityRow key={log.id} log={log} variant={variant} />
                  ))}
                  {manualHiddenCount > 0 && activityExpanded && (
                    <div className="flex justify-center pt-2 pb-1">
                      <button
                        type="button"
                        onClick={() => setManualExpanded((v) => !v)}
                        className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                        style={{ color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}
                      >
                        {manualExpanded ? (
                          <>Show fewer manual <ChevronUp className="h-3 w-3" /></>
                        ) : (
                          <>{manualHiddenCount} more manually posted <ChevronDown className="h-3 w-3" /></>
                        )}
                      </button>
                    </div>
                  )}
                  {(hidden > 0 || activityExpanded) && combined.length > ACTIVITY_COLLAPSED && (
                    <div className="flex justify-center pt-2 pb-1">
                      <button
                        type="button"
                        onClick={() => setActivityExpanded((v) => !v)}
                        className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                        style={{ color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}
                      >
                        {activityExpanded ? (
                          <>Show fewer <ChevronUp className="h-3 w-3" /></>
                        ) : (
                          <>Show {hidden} more <ChevronDown className="h-3 w-3" /></>
                        )}
                      </button>
                    </div>
                  )}
                  {!allLogs.length && (
                    <div className="px-3 py-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
                      No activity yet.
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </section>

        <section
          className="card-glow flex min-w-0 flex-col rounded-[12px]"
          style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-baseline justify-between px-5 pt-4 pb-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Pins by board</h2>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>this week</span>
            </div>
            <Link to="/boards" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
              Manage
            </Link>
          </div>
          <div className="flex flex-col gap-3 px-5 py-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            {(() => {
              const boards = data?.pinsByBoard ?? [];
              const max = Math.max(1, ...boards.map((b) => b.count));
              const shown = boardsExpanded ? boards : boards.slice(0, BOARDS_COLLAPSED);
              const hidden = boards.length - shown.length;
              return (
                <>
                  {shown.map((b) => (
                    <div key={b.name} className="flex items-center gap-3">
                      <span
                        className="min-w-0 flex-1 truncate text-sm"
                        style={{ color: "var(--text-primary)" }}
                        title={b.name}
                      >
                        {b.name}
                      </span>
                      <div
                        className="h-1.5 w-24 overflow-hidden rounded-full"
                        style={{ backgroundColor: "var(--border-subtle)" }}
                      >
                        <div
                          className="h-full rounded-full bg-gradient-primary"
                          style={{ width: `${(b.count / max) * 100}%` }}
                        />
                      </div>
                      <span
                        className="w-6 shrink-0 text-right font-mono text-xs"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {b.count}
                      </span>
                    </div>
                  ))}
                  {boards.length > BOARDS_COLLAPSED && (
                    <div className="flex justify-center pt-1">
                      <button
                        type="button"
                        onClick={() => setBoardsExpanded((v) => !v)}
                        className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                        style={{ color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}
                      >
                        {boardsExpanded ? (
                          <>Show fewer <ChevronUp className="h-3 w-3" /></>
                        ) : (
                          <>Show all {boards.length} boards <ChevronDown className="h-3 w-3" /></>
                        )}
                      </button>
                    </div>
                  )}
                </>
              );
            })()}
            {!data?.pinsByBoard?.length && (
              <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Nothing published this week yet.{" "}
                <Link to="/schedule" className="hover:underline" style={{ color: "var(--accent)" }}>
                  Schedule pins →
                </Link>
              </div>
            )}
          </div>
        </section>
      </div>


    </div>
  );
}

function ActivityRow({ log, variant }: { log: LogRow; variant: "error" | "normal" | "manual" }) {
  const isError = variant === "error";
  const dotColor =
    variant === "error"
      ? "var(--destructive)"
      : variant === "manual"
        ? "var(--accent-soft)"
        : "var(--success)";
  return (
    <div
      className="flex items-center gap-3 rounded-[8px] px-2 py-2 transition-colors hover:bg-accent"
      style={{
        backgroundColor: isError ? "color-mix(in oklab, var(--destructive) 6%, transparent)" : undefined,
      }}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: dotColor }}
        aria-hidden
      />
      {isError ? (
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]"
          style={{ backgroundColor: "color-mix(in oklab, var(--destructive) 15%, transparent)" }}
        >
          <AlertTriangle className="h-4 w-4" style={{ color: "var(--destructive)" }} />
        </span>
      ) : log.thumbUrl ? (
        <img
          src={log.thumbUrl}
          alt=""
          className="h-9 w-9 shrink-0 rounded-[8px] object-cover"
          style={{
            border: `1.5px solid ${variant === "manual" ? "color-mix(in oklab, var(--accent) 40%, transparent)" : "var(--border)"}`,
          }}
        />
      ) : (
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]"
          style={{ backgroundColor: "var(--border-subtle)" }}
        >
          <Pin className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />
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
