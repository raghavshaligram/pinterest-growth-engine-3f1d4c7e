// Standalone route -- opts out of the shared _authenticated layout
// (AppShell) so PinShell renders the Pinterest-native chrome, matching
// Dashboard/Schedule/Boards/Sites. beforeLoad duplicates the
// _authenticated route's auth guard; keep both in sync if that check
// ever changes.
//
// Rebuilt to match the Figma "Pages list" reference: header with
// site-scoped subtitle + Crawl now/Generate All actions, a filter-pill
// row, and a row-based list with 4 stage-status columns
// (Analyze/Brief/Images/Pins) instead of the previous card grid. The
// previous header also exposed granular "Analyze all" / "Generate
// briefs" / "Render pins" / "Auto-exclude" buttons that the Figma
// header doesn't show -- rather than delete that functionality, Auto-
// exclude moved into the excluded-pages banner below the filters, and
// the granular per-page Analyze/Generate/Render actions now live on the
// page detail view (src/routes/pages.$id.tsx), which already has its
// own Analyze/Generate/Render buttons. "Generate All" here maps to the
// existing runFullPipeline server fn (analyze + briefs + images in one
// pass), which is what "Generate All" means in the reference.
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { PinShell } from "@/components/PinShell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPages, setPageExcluded, autoExcludePages } from "@/lib/pages.functions";
import { crawlSite } from "@/lib/sites.functions";
import { useSiteContext } from "@/lib/site-context";
import { TopBar } from "@/components/PinTopBar";
import { runFullPipeline } from "@/lib/schedule.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ChevronRight, RefreshCw, Zap, Loader2, EyeOff, Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { getErrorMessage } from "@/lib/error-message";
import { PIN, PIN_FONT, hostOf } from "@/lib/pin-shell-tokens";

export const Route = createFileRoute("/pages/")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  head: () => ({ meta: [{ title: "Pages — Pinspider" }] }),
  component: () => <PagesRoute />,
});

function PagesRoute() {
  const { user } = Route.useRouteContext();
  const [search, setSearch] = useState("");
  return (
    <PinShell active="pages" userEmail={user?.email}>
      <TopBar search={search} onSearch={setSearch} placeholder="Search pages..." />
      <div className="flex-1 overflow-y-auto" style={{ padding: "8px 24px 32px" }}>
        <PagesPage search={search} />
      </div>
    </PinShell>
  );
}

type PageRow = Awaited<ReturnType<typeof listPages>>[number];
type PipelineStatus = "images_ready" | "in_progress" | "not_started" | "error";
type FilterKey = "all" | PipelineStatus;

function PagesPage({ search }: { search: string }) {
  const qc = useQueryClient();
  const { selectedSiteId, selectedSite } = useSiteContext();
  const list = useServerFn(listPages);
  const crawl = useServerFn(crawlSite);
  const pipeline = useServerFn(runFullPipeline);
  const setExcluded = useServerFn(setPageExcluded);
  const autoExclude = useServerFn(autoExcludePages);

  const [showExcluded, setShowExcluded] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");

  const { data } = useQuery({ queryKey: ["pages", selectedSiteId], queryFn: () => list({ data: { siteId: selectedSiteId } }) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["pages"] });

  const rows = (data ?? []) as PageRow[];
  const active = rows.filter((p) => !p.excluded);
  const excluded = rows.filter((p) => p.excluded);

  const crawlM = useMutation({
    mutationFn: () => {
      if (!selectedSiteId) throw new Error("Select a site first");
      return crawl({ data: { siteId: selectedSiteId } });
    },
    onSuccess: (r: { discovered: number; added: number; updated: number; errors: number }) => {
      toast.success(`Crawled: ${r.added} added, ${r.updated} updated (${r.discovered} discovered)`);
      invalidate();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  // "Generate All" -- the batch mutation whose in-flight state also
  // drives the Analyze/Brief stage pills' blinking dot below, since
  // those two stages are synchronous server calls with no jobs-table
  // row of their own to poll (see listPages in pages.functions.ts for
  // why Images is different). While this is running, any page that
  // hasn't reached that stage yet is genuinely being worked through by
  // this exact call, even though the client can't see which one it's on
  // at a given instant -- an honest batch-level signal, not a
  // decorative animation.
  const pipelineM = useMutation({
    mutationFn: () => pipeline({ data: { maxAnalyze: 25, maxBriefs: 15, maxImages: 30 } }),
    onSuccess: (r: { analyzed: number; briefsFor: number; imagesQueued: number }) => {
      toast.success(`Generated: analyzed ${r.analyzed}, briefs for ${r.briefsFor}, queued ${r.imagesQueued} images`);
      invalidate();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const autoExcludeM = useMutation({
    mutationFn: () => autoExclude(),
    onSuccess: (r) => { toast.success(`Auto-excluded ${r.excluded} page${r.excluded === 1 ? "" : "s"}`); invalidate(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const toggleM = useMutation({
    mutationFn: (v: { pageId: string; excluded: boolean }) => setExcluded({ data: v }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const counts: Record<FilterKey, number> = {
    all: active.length,
    images_ready: active.filter((p) => p.pipeline_status === "images_ready").length,
    in_progress: active.filter((p) => p.pipeline_status === "in_progress").length,
    not_started: active.filter((p) => p.pipeline_status === "not_started").length,
    error: active.filter((p) => p.pipeline_status === "error").length,
  };

  const base = showExcluded ? excluded : active;
  const visible = base
    .filter((p) => filter === "all" || p.pipeline_status === filter)
    .filter((p) => !search.trim() || (p.title ?? p.url).toLowerCase().includes(search.trim().toLowerCase()));

  const withImages = active.filter((p) => p.images_ready > 0).length;
  const siteDomain = selectedSite ? hostOf(selectedSite.url) : "All sites";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 10 }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: PIN_FONT, fontSize: 28, fontWeight: 700, color: PIN.textPrimary, letterSpacing: "-0.02em", margin: 0 }}>
            Pages
          </h1>
          <p style={{ fontFamily: PIN_FONT, fontSize: 13, color: PIN.textSecondary, margin: "4px 0 0" }}>
            {active.length} page{active.length === 1 ? "" : "s"} · {withImages} with images · {siteDomain}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            title={selectedSiteId ? undefined : "Select a site to crawl"}
            onClick={() => crawlM.mutate()}
            disabled={crawlM.isPending || !selectedSiteId}
            style={{
              display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 16px", borderRadius: 999,
              border: `1px solid ${PIN.borderStrong}`, background: PIN.card, color: PIN.textPrimary,
              fontFamily: PIN_FONT, fontSize: 13, fontWeight: 600, cursor: selectedSiteId ? "pointer" : "not-allowed",
              opacity: !selectedSiteId ? 0.5 : 1,
            }}
          >
            {crawlM.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Crawl now
          </button>
          <button
            type="button"
            onClick={() => pipelineM.mutate()}
            disabled={pipelineM.isPending}
            style={{
              display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 16px", borderRadius: 999,
              border: "none", background: PIN.accent, color: "#fff",
              fontFamily: PIN_FONT, fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            {pipelineM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            Generate All
          </button>
        </div>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <FilterPill label="All" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterPill label="Images ready" count={counts.images_ready} active={filter === "images_ready"} onClick={() => setFilter("images_ready")} />
        <FilterPill label="In progress" count={counts.in_progress} active={filter === "in_progress"} onClick={() => setFilter("in_progress")} />
        <FilterPill label="Not started" count={counts.not_started} active={filter === "not_started"} onClick={() => setFilter("not_started")} />
        <FilterPill label="Error" count={counts.error} active={filter === "error"} onClick={() => setFilter("error")} tone={counts.error > 0 ? "error" : undefined} />
      </div>

      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          border: `1px solid ${PIN.border}`, borderRadius: 12, padding: "8px 12px", background: "#FBFBFA",
        }}
      >
        <span style={{ fontFamily: PIN_FONT, fontSize: 12, color: PIN.textSecondary }}>
          Auto-exclude filters out About, Contact, Privacy, Terms, FAQ and similar non-content pages.
        </span>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => autoExcludeM.mutate()}
            disabled={autoExcludeM.isPending}
            style={{ fontFamily: PIN_FONT, fontSize: 12, fontWeight: 600, color: PIN.textSecondary, background: "none", border: "none", cursor: "pointer" }}
          >
            {autoExcludeM.isPending ? "Excluding…" : "Auto-exclude"}
          </button>
          <span style={{ color: PIN.border }}>|</span>
          <button
            type="button"
            onClick={() => setShowExcluded((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: PIN_FONT, fontSize: 12, fontWeight: 600, color: PIN.textSecondary, background: "none", border: "none", cursor: "pointer" }}
          >
            {showExcluded ? <Eye size={12} /> : <EyeOff size={12} />}
            {showExcluded ? "Show active" : `Show excluded (${excluded.length})`}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {visible.map((p, i) => (
          <PageRowItem
            key={p.id}
            page={p}
            showIncludeAction={showExcluded}
            onInclude={() => toggleM.mutate({ pageId: p.id, excluded: false })}
            pipelineRunning={pipelineM.isPending}
            isFirst={i === 0}
          />
        ))}
        {!visible.length && (
          <p style={{ fontFamily: PIN_FONT, fontSize: 13, color: PIN.textMuted, padding: "24px 4px" }}>
            {showExcluded ? "Nothing excluded." : "No pages match this filter yet."}
          </p>
        )}
      </div>
    </div>
  );
}

function FilterPill({
  label, count, active, onClick, tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: "error";
}) {
  const errorActive = tone === "error";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: 999,
        border: `1px solid ${active ? PIN.accent : PIN.border}`,
        background: active ? (errorActive ? PIN.roseTint : "#FDECEC") : "#fff",
        color: active ? (errorActive ? PIN.roseIcon : PIN.accent) : errorActive ? PIN.roseIcon : PIN.textSecondary,
        fontFamily: PIN_FONT, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
      }}
    >
      {label}
      <span style={{ opacity: 0.7 }}>({count})</span>
    </button>
  );
}

// -- Stage-status pill -------------------------------------------------
// state precedence per column is computed by the caller (see
// stageStatuses() below); this component only renders whatever state
// it's handed. Only "in_progress" ever gets the pulsing dot.
type StageState = "done" | "in_progress" | "not_started" | "error" | "partial";

function StagePill({ state, text }: { state: StageState; text: string }) {
  const tone = {
    done: { bg: "#E6F4EA", fg: "#1E7B3D" },
    in_progress: { bg: PIN.amberTint, fg: PIN.amberIcon },
    not_started: { bg: PIN.fieldBg, fg: PIN.textMuted },
    error: { bg: PIN.roseTint, fg: PIN.roseIcon },
    // Some images rendered, none currently in flight -- distinct from
    // both "done" (green, all rendered) and "not_started" (dash, none
    // rendered) so a partially-rendered page doesn't misleadingly read
    // as either finished or untouched.
    partial: { bg: PIN.fieldBg, fg: PIN.textSecondary },
  }[state];
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, height: 24, padding: "0 8px", borderRadius: 999,
        background: tone.bg, color: tone.fg, fontFamily: PIN_FONT, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap",
      }}
    >
      {state === "not_started" ? (
        "—"
      ) : (
        <span
          className={state === "in_progress" ? "stage-dot-pulse" : undefined}
          style={{ width: 5, height: 5, borderRadius: "50%", background: tone.fg, flexShrink: 0 }}
        />
      )}
      {state !== "not_started" && text}
    </span>
  );
}

function stageStatuses(p: PageRow, pipelineRunning: boolean) {
  const analyzed = !!p.last_analyzed_at;
  const hasBriefs = p.briefs_total > 0;

  // Analyze/Brief: no jobs-table row exists for either stage (both are
  // synchronous server calls -- see pages.functions.ts/briefs.functions.ts).
  // The only real signal available is "is the batch Generate All mutation
  // currently in flight, and has this page not reached that stage yet."
  const analyzeState: StageState = analyzed ? "done" : pipelineRunning ? "in_progress" : "not_started";
  const briefState: StageState = hasBriefs
    ? "done"
    : analyzed && pipelineRunning
    ? "in_progress"
    : "not_started";

  // Images: real backend signal (jobs table, kind=generate_image,
  // status queued/running) via listPages' images_active field.
  let imageState: StageState;
  let imageText: string;
  if (p.images_error > 0) {
    imageState = "error";
    imageText = `${p.images_error} error${p.images_error === 1 ? "" : "s"}`;
  } else if (p.images_active > 0) {
    imageState = "in_progress";
    imageText = "Images";
  } else if (!hasBriefs) {
    imageState = "not_started";
    imageText = "";
  } else if (p.images_ready === p.briefs_total) {
    imageState = "done";
    imageText = `✓${p.images_ready}`;
  } else if (p.images_ready > 0) {
    imageState = "partial";
    imageText = `✓${p.images_ready}`;
  } else {
    imageState = "not_started";
    imageText = "";
  }

  const pinsState: StageState = p.scheduled_count > 0 ? "done" : "not_started";
  const pinsText = p.scheduled_count > 0 ? `${p.scheduled_count} sched.` : "";

  return {
    analyze: { state: analyzeState, text: "Analyze" },
    brief: { state: briefState, text: "Brief" },
    images: { state: imageState, text: imageText },
    pins: { state: pinsState, text: pinsText },
  };
}

function PageRowItem({
  page, showIncludeAction, onInclude, pipelineRunning, isFirst,
}: {
  page: PageRow;
  showIncludeAction: boolean;
  onInclude: () => void;
  pipelineRunning: boolean;
  isFirst: boolean;
}) {
  const stages = stageStatuses(page, pipelineRunning);
  return (
    <Link
      to="/pages/$id"
      params={{ id: page.id }}
      style={{
        display: "flex", alignItems: "center", gap: 14, padding: "12px 8px",
        borderTop: isFirst ? "none" : `1px solid ${PIN.border}`,
        textDecoration: "none", color: "inherit",
      }}
      className="pages-row-hover"
    >
      <Thumb path={page.thumb} />
      <div style={{ minWidth: 0, flex: "1 1 240px" }}>
        <div style={{ fontFamily: PIN_FONT, fontSize: 13.5, fontWeight: 600, color: PIN.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {page.title ?? page.url}
        </div>
        <div style={{ fontFamily: PIN_FONT, fontSize: 12, color: PIN.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {page.url}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <StagePill state={stages.analyze.state} text={stages.analyze.text} />
        <StagePill state={stages.brief.state} text={stages.brief.text} />
        <StagePill state={stages.images.state} text={stages.images.text} />
        <StagePill state={stages.pins.state} text={stages.pins.text} />
      </div>

      {showIncludeAction ? (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onInclude(); }}
          style={{
            fontFamily: PIN_FONT, fontSize: 12, fontWeight: 600, color: PIN.textSecondary,
            background: "none", border: `1px solid ${PIN.border}`, borderRadius: 999, padding: "4px 10px", cursor: "pointer", flexShrink: 0,
          }}
        >
          Include
        </button>
      ) : (
        <ChevronRight size={16} style={{ color: PIN.textMuted, flexShrink: 0 }} />
      )}
    </Link>
  );
}

function Thumb({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let ok = true;
    if (path) {
      supabase.storage.from("pins").createSignedUrl(path, 3600).then((r) => { if (ok) setUrl(r.data?.signedUrl ?? null); });
    } else {
      setUrl(null);
    }
    return () => { ok = false; };
  }, [path]);
  return (
    <div style={{ width: 40, height: 56, flexShrink: 0, borderRadius: 8, overflow: "hidden", background: PIN.fieldBg }}>
      {url ? <img src={url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
    </div>
  );
}
