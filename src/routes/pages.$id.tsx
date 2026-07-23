// Standalone route -- opts out of the shared _authenticated layout
// (AppShell) so PinShell renders the Pinterest-native chrome, matching
// Dashboard/Schedule/Boards/Sites. beforeLoad duplicates the
// _authenticated route's auth guard; keep both in sync if that check
// ever changes.
//
// Rebuilt to match the Figma "Page detail" reference: breadcrumb +
// status badges header, title/meta chip row, a left sidebar (Content
// Analysis kept exactly as previously built, plus a new "Pin angles"
// list), and a Pin Assets grid with per-pin template tags. The
// template tag is the first place in the app that surfaces
// pin_briefs.template_id -- see TEMPLATE_LABELS in briefs.functions.ts,
// read directly here rather than re-derived from the style label.
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { PinShell } from "@/components/PinShell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPage, analyzePage } from "@/lib/pages.functions";
import { generateBriefs, renderImagesForPage, rerenderBrief, deleteBrief, TEMPLATE_LABELS, type TemplateId } from "@/lib/briefs.functions";
import { toast } from "sonner";
import { ChevronLeft, Sparkles, Wand2, ImageIcon, RefreshCw, Trash2, AlertTriangle, Loader2, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SerpTraceBadge } from "@/components/SerpTraceBadge";
import { getErrorMessage } from "@/lib/error-message";
import { PIN, PIN_FONT, hostOf } from "@/lib/pin-shell-tokens";

// Figma-specified font color system for this page. Scoped here (not
// folded into the shared PIN token object in pin-shell-tokens.ts,
// which stays as-is for the rest of the app) since this was requested
// for the Page detail view specifically, unlike the PIN_FONT swap a
// few tasks back which was explicitly app-wide.
const TEXT_PRIMARY = "#111827"; // headings, values, primary text
const TEXT_LABEL = "#374151"; // labels, secondary text, button text
const TEXT_MUTED = "#9CA3AF"; // timestamps, captions, placeholders, disabled
const COLOR_ERROR = "#E60023"; // alert/error states, failed badges
const COLOR_SUCCESS = "#10B981"; // success states (Ready/Analyzed/Published-equivalents)

export const Route = createFileRoute("/pages/$id")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  head: () => ({ meta: [{ title: "Page — Pinspider" }] }),
  component: () => <PageDetailRoute />,
});

function PageDetailRoute() {
  const { user } = Route.useRouteContext();
  return (
    <PinShell active="pages" userEmail={user?.email}>
      <PageDetail />
    </PinShell>
  );
}

type PageDetailData = Awaited<ReturnType<typeof getPage>>;
type Brief = PageDetailData["briefs"][number];

const ANALYSIS_FIELDS: { key: string; label: string; color: string }[] = [
  { key: "topic", label: "Topic", color: "#2B6CB0" },
  { key: "primary_keyword", label: "Primary keyword", color: "#6B46C1" },
  { key: "seasonality", label: "Seasonality", color: "#2C7A7B" },
];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function PageDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const get = useServerFn(getPage);
  const analyze = useServerFn(analyzePage);
  const gen = useServerFn(generateBriefs);
  const renderPage = useServerFn(renderImagesForPage);

  const [tab, setTab] = useState<"all" | "ready" | "rendering" | "scheduled">("all");

  const { data } = useQuery({ queryKey: ["page", id], queryFn: () => get({ data: { id } }) });

  const anaMut = useMutation({ mutationFn: () => analyze({ data: { pageId: id } }),
    onSuccess: () => { toast.success("Analyzed"); qc.invalidateQueries({ queryKey: ["page", id] }); },
    onError: (e) => toast.error(getErrorMessage(e)) });
  const genMut = useMutation({ mutationFn: (n: number) => gen({ data: { pageId: id, count: n } }),
    onSuccess: (r) => {
      // r.created can be less than r.requested even after generateBriefs'
      // internal retry -- surface that honestly instead of only ever
      // printing the (possibly short) created count on its own.
      const msg = r.created < r.requested
        ? `Created ${r.created} of ${r.requested} requested briefs. Run image worker to render.`
        : `Created ${r.created} briefs. Run image worker to render.`;
      if (r.created < r.requested) toast.warning(msg); else toast.success(msg);
      qc.invalidateQueries({ queryKey: ["page", id] });
    },
    onError: (e) => toast.error(getErrorMessage(e)) });
  const imgMut = useMutation({
    mutationFn: async () => {
      // Loop until THIS page's image queue is actually drained, instead
      // of processing one fixed-size page of jobs per click and stopping.
      // renderImagesForPage is page-scoped, so this only ever touches
      // this page's jobs. Capped at 5 passes as a safety valve, not
      // because 5 is expected to be hit in normal use -- flag it
      // honestly if it is.
      const MAX_PASSES = 5;
      let ok = 0, fail = 0, passes = 0, drained = false;
      for (; passes < MAX_PASSES; passes++) {
        const r = (await renderPage({ data: { pageId: id, limit: 20 } })) as { processed: number; ok?: number; fail?: number };
        ok += r.ok ?? 0;
        fail += r.fail ?? 0;
        if (!r.processed) { drained = true; break; }
      }
      return { ok, fail, passes, drained };
    },
    onSuccess: (r) => {
      const base = `Rendered ${r.ok} image${r.ok === 1 ? "" : "s"}${r.fail ? ` (${r.fail} failed)` : ""}`;
      if (r.drained) {
        toast.success(base);
      } else {
        toast.warning(`${base} -- queue not fully drained after ${r.passes} passes, click again to continue`);
      }
      qc.invalidateQueries({ queryKey: ["page", id] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const angles = useMemo(() => {
    if (!data) return [];
    // "Pin angles" reuses each brief's own title -- the short angle
    // idea the classifier/generator already produced per pin, deduped
    // rather than backed by a separate angles field (none exists).
    const seen = new Set<string>();
    return data.briefs.filter((b) => {
      if (seen.has(b.title)) return false;
      seen.add(b.title);
      return true;
    });
  }, [data]);

  if (!data) return <p style={{ fontFamily: PIN_FONT, fontSize: 13, color: TEXT_MUTED, padding: 24 }}>Loading…</p>;
  const { page, briefs } = data;
  const analysis = (page.analysis ?? {}) as Record<string, unknown>;

  const analyzed = !!page.last_analyzed_at;
  const briefReady = briefs.length > 0;
  const pendingRender = briefs.filter((b) => b.status === "image_pending").length;
  const domain = hostOf(page.url);
  const contentType = typeof analysis.category === "string" ? analysis.category : null;

  const filtered = briefs.filter((b) => {
    if (tab === "all") return true;
    if (tab === "ready") return b.status === "ready" || b.status === "scheduled";
    if (tab === "rendering") return b.status === "image_pending" || b.is_rendering;
    if (tab === "scheduled") return b.status === "scheduled";
    return true;
  });

  return (
    // Root of this page's content -- fills PinShell's main-column slot
    // (PinShell itself is flex/height:100vh/overflow:hidden, sidebar
    // 64px fixed, main column flex:1/column). This div is that "main
    // column"'s only child, so it needs flex:1 + minHeight:0 to actually
    // fill the available height rather than sizing to its content, which
    // is what makes the flexShrink:0 header rows + flex:1 content row
    // below work as fixed-header/scrolling-body instead of the previous
    // single-scroll-container-for-everything approach.
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Breadcrumb + status badges -- flexShrink:0, stays fixed */}
      <div style={{ flexShrink: 0, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "20px 24px 0" }}>
        <Link
          to="/pages"
          style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: PIN_FONT, fontSize: 13, fontWeight: 600, color: TEXT_LABEL, textDecoration: "none" }}
        >
          <ChevronLeft size={15} />
          Pages
          <span style={{ color: TEXT_MUTED, fontWeight: 400 }}>· {domain}</span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusBadge done={analyzed} label="Analyzed" />
          <StatusBadge done={briefReady} label="Brief ready" />
          {pendingRender > 0 && (
            <button
              type="button"
              onClick={() => imgMut.mutate()}
              disabled={imgMut.isPending}
              style={{
                display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 14px", borderRadius: 999,
                border: "none", background: PIN.accent, color: "#fff", fontFamily: PIN_FONT, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              }}
            >
              {imgMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
              Render Images ({pendingRender})
            </button>
          )}
        </div>
      </div>

      {/* Title + meta chips -- flexShrink:0, stays fixed */}
      <div style={{ flexShrink: 0, padding: "14px 24px 0" }}>
        <h1 style={{ fontFamily: PIN_FONT, fontSize: 24, fontWeight: 700, color: TEXT_PRIMARY, letterSpacing: "-0.02em", margin: "0 0 8px" }}>
          {page.title ?? "(no title)"}
        </h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <MetaChip text={page.url} />
          <MetaChip text={`Updated ${formatDate(page.updated_at)}`} />
          {contentType && <MetaChip text={contentType} accent />}
        </div>
      </div>

      {/* Analyze / Generate actions -- flexShrink:0, stays fixed. Granular
          per-page controls live here instead of the Pages list header
          (see pages.index.tsx). */}
      <div style={{ flexShrink: 0, display: "flex", gap: 8, padding: "14px 24px 0" }}>
        <ActionButton icon={anaMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} label="Analyze" onClick={() => anaMut.mutate()} disabled={anaMut.isPending} />
        <ActionButton icon={genMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} label="Generate 10 pins" onClick={() => genMut.mutate(10)} disabled={genMut.isPending || !analyzed} />
      </div>

      {/* Content row -- flex:1, overflow:hidden. This is the only part
          of the page that scrolls, and it scrolls as two independent
          panels rather than one shared page scroll: the sidebar has its
          own overflowY:auto capped to this row's height, and so does
          the Pin Assets column. No position:sticky anywhere here --
          confirmed via the layout audit that this sidebar was the only
          sticky usage in the app, replaced now that both panels get
          their own real scroll region instead. */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", gap: 24, padding: "18px 24px 24px", minHeight: 0 }}>
        <div
          className="no-scrollbar"
          style={{
            width: 272, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16,
            overflowY: "auto", scrollbarWidth: "none",
          }}
        >
          {analyzed && (
            <SidebarCard title="Content Analysis" icon={<Zap size={12} />}>
              {/* Category + Intent as a two-pill row -- both real
                  analysis fields, styled as accent/neutral pills to
                  match the reference's category-tag treatment. (The
                  reference also shows a second, more editorial tone
                  descriptor here that isn't backed by any field this
                  analyzer produces -- not fabricated, intent fills that
                  visual slot with real data instead.) */}
              {!!(analysis.category || analysis.intent) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {!!analysis.category && (
                    <span style={{ fontFamily: PIN_FONT, fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "#FDECEC", color: PIN.accent }}>
                      {String(analysis.category)}
                    </span>
                  )}
                  {!!analysis.intent && (
                    <span style={{ fontFamily: PIN_FONT, fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: PIN.fieldBg, color: TEXT_LABEL }}>
                      {String(analysis.intent)}
                    </span>
                  )}
                </div>
              )}

              {!!analysis.audience && (
                <div style={{ fontFamily: PIN_FONT, fontSize: 12.5, color: TEXT_LABEL, lineHeight: 1.5, marginBottom: 14 }}>
                  <span style={{ fontWeight: 700, color: TEXT_PRIMARY }}>Audience: </span>
                  {String(analysis.audience)}
                </div>
              )}

              <dl style={{ display: "grid", gap: 10, marginBottom: 4 }}>
                {ANALYSIS_FIELDS.map(({ key, label, color }) => (
                  analysis[key] ? (
                    <div key={key}>
                      <dt style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: PIN_FONT, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color }}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />
                        {label}
                      </dt>
                      <dd style={{ fontFamily: PIN_FONT, fontSize: 13, fontWeight: 500, color: TEXT_PRIMARY, margin: "3px 0 0" }}>{String(analysis[key])}</dd>
                    </div>
                  ) : null
                ))}
              </dl>

              {/* "Topics" reuses analysis.lsi_keywords -- the broader
                  semantically-related terms the analyzer already
                  generates alongside the primary/secondary keywords
                  (see analyzePage in pages.functions.ts) -- rather than
                  a separate topics field, which doesn't exist. Topics
                  get the colorful hashed treatment, Keywords stay
                  neutral -- matches the reference, which visually
                  distinguishes the two groups the same way. */}
              <TagGroup label="Topics" items={analysis.lsi_keywords as string[] | undefined} tone="colorful" />
              <TagGroup label="Keywords" items={analysis.secondary_keywords as string[] | undefined} tone="neutral" />
            </SidebarCard>
          )}

          {angles.length > 0 && (
            <SidebarCard title="Pinterest Brief" icon={<Sparkles size={12} />}>
              <div style={{ fontFamily: PIN_FONT, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: TEXT_MUTED, marginBottom: 8 }}>
                Pin angles
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {angles.map((a) => (
                  <li key={a.id} style={{ display: "flex", gap: 8, fontFamily: PIN_FONT, fontSize: 12.5, color: TEXT_PRIMARY, lineHeight: 1.4 }}>
                    <span style={{ color: PIN.accent, flexShrink: 0 }}>•</span>
                    {a.title}
                  </li>
                ))}
              </ul>
            </SidebarCard>
          )}
        </div>

        {/* Main: Pin Assets -- its own independent scroll region, separate
            from the sidebar's. */}
        <div className="no-scrollbar" style={{ flex: 1, minWidth: 0, overflowY: "auto", scrollbarWidth: "none" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ fontFamily: PIN_FONT, fontSize: 16, fontWeight: 700, color: TEXT_PRIMARY, margin: 0 }}>Pin Assets</h2>
              <span style={{ fontFamily: PIN_FONT, fontSize: 12, fontWeight: 600, color: TEXT_LABEL, background: PIN.fieldBg, borderRadius: 999, padding: "2px 9px" }}>
                {briefs.length}
              </span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <TabButton label="All" active={tab === "all"} onClick={() => setTab("all")} />
              <TabButton label="Ready" active={tab === "ready"} onClick={() => setTab("ready")} />
              <TabButton label="Rendering" active={tab === "rendering"} onClick={() => setTab("rendering")} />
              <TabButton label="Scheduled" active={tab === "scheduled"} onClick={() => setTab("scheduled")} />
            </div>
          </div>

          <div className="pin-assets-masonry">
            {filtered.map((b) => <BriefCard key={b.id} b={b} />)}
          </div>
          {!filtered.length && (
            <p style={{ fontFamily: PIN_FONT, fontSize: 13, color: TEXT_MUTED, padding: "24px 4px" }}>Nothing here yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      style={{
        display: "flex", alignItems: "center", gap: 5, height: 28, padding: "0 11px", borderRadius: 999,
        background: done ? "#E3F9F1" : PIN.fieldBg, color: done ? COLOR_SUCCESS : TEXT_MUTED,
        fontFamily: PIN_FONT, fontSize: 12, fontWeight: 600,
      }}
    >
      {done ? "✓" : "—"} {label}
    </span>
  );
}

function MetaChip({ text, accent }: { text: string; accent?: boolean }) {
  return (
    <span
      style={{
        fontFamily: PIN_FONT, fontSize: 12, fontWeight: 500, padding: "5px 10px", borderRadius: 999,
        background: accent ? "#FDECEC" : PIN.fieldBg, color: accent ? PIN.accent : TEXT_LABEL,
        maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function ActionButton({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", borderRadius: 999,
        border: `1px solid ${PIN.borderStrong}`, background: PIN.card, color: TEXT_PRIMARY,
        fontFamily: PIN_FONT, fontSize: 12.5, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon}{label}
    </button>
  );
}

function SidebarCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div style={{ border: `1px solid #E4E1D9`, borderRadius: 16, padding: 16, background: PIN.card }}>
      <h3
        style={{
          display: "flex", alignItems: "center", gap: 6, fontFamily: PIN_FONT, fontSize: 11.5, fontWeight: 700,
          textTransform: "uppercase", letterSpacing: "0.06em", color: PIN.accent, margin: "0 0 14px",
        }}
      >
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

// Soft tinted-background pills for the Content Analysis sidebar's Topics
// and Keywords lists -- background at roughly 15-20% of the paired
// color's full saturation, text in the full-saturation color, no
// border. Each individual pill's color is deterministically hashed from
// its own text (same pattern as pin-shell-tokens.ts's boardColor) so a
// given topic/keyword always renders the same color, rather than
// picking randomly or using one flat color for the whole list.
const TAG_PALETTE: { bg: string; fg: string }[] = [
  { bg: "#E3EEFA", fg: "#2B6CB0" }, // blue
  { bg: "#EFE7FB", fg: "#6B46C1" }, // purple
  { bg: "#E1F5F5", fg: "#2C7A7B" }, // teal
  { bg: "#FDEDE1", fg: "#C05621" }, // orange
  { bg: "#E4F5EA", fg: "#2F8B57" }, // green
  { bg: "#FCE7F3", fg: "#B83280" }, // pink
  { bg: "#FEF3D6", fg: "#B7791F" }, // amber
  { bg: "#FCE8E8", fg: "#C53030" }, // red
];
function hashTagText(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function tagColor(s: string) {
  return TAG_PALETTE[hashTagText(s) % TAG_PALETTE.length];
}

function TagGroup({ label, items, tone }: { label: string; items: string[] | undefined; tone: "colorful" | "neutral" }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontFamily: PIN_FONT, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: TEXT_MUTED, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map((item) => {
          const c = tone === "colorful" ? tagColor(item) : { bg: PIN.fieldBg, fg: TEXT_LABEL };
          return (
            <span
              key={item}
              style={{ fontFamily: PIN_FONT, fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: c.bg, color: c.fg }}
            >
              {item}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 28, padding: "0 12px", borderRadius: 999, border: "none", cursor: "pointer",
        background: active ? PIN.accent : "transparent", color: active ? "#fff" : TEXT_LABEL,
        fontFamily: PIN_FONT, fontSize: 12, fontWeight: 600,
      }}
    >
      {label}
    </button>
  );
}

function templateTag(templateId: string | null | undefined): { label: string; color: string } {
  if (templateId && templateId in TEMPLATE_LABELS) return TEMPLATE_LABELS[templateId as TemplateId];
  // Legacy briefs generated before template_id was wired up (or any
  // future id not yet in the registry) have no stored shape decision --
  // shown as a distinct, honest "Unclassified" tag rather than guessed
  // from the style label, per the correctness requirement for this view.
  return { label: "Unclassified", color: "#9C978A" };
}

function isBriefPublished(b: Brief): boolean {
  return (b.scheduled_pins ?? []).some((s) => s.status === "published");
}

function briefStatusLine(b: Brief): { text: string; tone: "ready" | "rendering" | "scheduled" | "failed" | "pending" | "published" } {
  // Published takes priority over "scheduled" -- once a scheduled_pins
  // row actually posted, that's a more final state than "queued to
  // post," and it's the one place this page has a real isPublished
  // signal (pin_briefs itself has no "published" status -- only
  // scheduled_pins does).
  const publishedEntry = (b.scheduled_pins ?? []).find((s) => s.status === "published");
  if (publishedEntry) return { text: `Published ${formatDate(publishedEntry.scheduled_at)}`, tone: "published" };
  if (b.status === "failed") return { text: "✕ Failed", tone: "failed" };
  if (b.status === "scheduled") {
    const upcoming = (b.scheduled_pins ?? []).find((s) => s.status !== "canceled");
    return { text: upcoming ? `↑ Scheduled ${formatDate(upcoming.scheduled_at)}` : "↑ Scheduled", tone: "scheduled" };
  }
  if (b.status === "ready") return { text: "✓ Ready", tone: "ready" };
  if (b.is_rendering || b.status === "image_pending") return { text: "↻ Rendering", tone: "rendering" };
  return { text: "Draft", tone: "pending" };
}

function BriefCard({ b }: { b: Brief }) {
  const qc = useQueryClient();
  const rerender = useServerFn(rerenderBrief);
  const del = useServerFn(deleteBrief);
  const [url, setUrl] = useState<string | null>(null);
  // Reserve a "2 / 3" guess so there's no zero-height flash while the
  // signed URL and image are still loading, then correct to the real
  // proportions once known -- same self-correcting approach as
  // Dashboard's PinTile (see routes/dashboard.tsx), needed here now that
  // the grid is real CSS-columns masonry rather than a fixed grid, so
  // card heights need to actually vary with each pin's real image.
  const [aspect, setAspect] = useState("2 / 3");
  const path = b.pin_images?.[0]?.storage_path;
  useEffect(() => {
    let ok = true;
    if (path) {
      supabase.storage.from("pins").createSignedUrl(path, 60 * 60).then((r) => { if (ok) setUrl(r.data?.signedUrl ?? null); });
    } else {
      setUrl(null);
    }
    return () => { ok = false; };
  }, [path]);
  const reMut = useMutation({
    mutationFn: () => rerender({ data: { briefId: b.id } }),
    onSuccess: () => {
      toast.success("Re-rendered");
      setUrl(null); // force <img> to reload the new signed URL
      qc.invalidateQueries({ queryKey: ["page"] });
      qc.invalidateQueries({ queryKey: ["briefs"] });
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const delMut = useMutation({
    mutationFn: () => del({ data: { briefId: b.id } }),
    onSuccess: () => { toast.success("Pin deleted"); qc.invalidateQueries(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const [open, setOpen] = useState(false);
  const tag = templateTag(b.template_id);
  const statusLine = briefStatusLine(b);
  const rendering = b.is_rendering || b.status === "image_pending";
  // Exact spec: color: isPublished ? '#9CA3AF' : '#111827' on the pin
  // title/time -- the only place font color responds to data.
  const isPublished = isBriefPublished(b);

  return (
    <>
      <div style={{ borderRadius: 16, overflow: "hidden", border: `1px solid #E4E1D9`, background: PIN.card, breakInside: "avoid", marginBottom: 20 }}>
        <div style={{ position: "relative", width: "100%", background: PIN.fieldBg }}>
          {url ? (
            <button type="button" onClick={() => setOpen(true)} className="group block w-full cursor-zoom-in" aria-label="Enlarge pin" style={{ display: "block", width: "100%" }}>
              <img
                src={url}
                alt=""
                className="w-full transition group-hover:opacity-90"
                style={{ width: "100%", height: "auto", display: "block", aspectRatio: aspect, objectFit: "cover" }}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  if (el.naturalWidth && el.naturalHeight) setAspect(`${el.naturalWidth} / ${el.naturalHeight}`);
                }}
              />
            </button>
          ) : (
            <div style={{ aspectRatio: "2 / 3", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: "0 12px", textAlign: "center" }}>
              {b.status === "failed" ? (
                <>
                  <AlertTriangle size={16} color={COLOR_ERROR} />
                  <span style={{ fontFamily: PIN_FONT, fontSize: 11, color: COLOR_ERROR }}>Render failed — tap Rerender to retry</span>
                </>
              ) : rendering ? (
                <span
                  style={{
                    display: "flex", alignItems: "center", gap: 6, fontFamily: PIN_FONT, fontSize: 12, fontWeight: 600,
                    color: PIN.amberIcon, background: PIN.amberTint, borderRadius: 999, padding: "5px 12px",
                  }}
                >
                  <Loader2 size={12} className="animate-spin" />
                  Rendering…
                </span>
              ) : (
                <span style={{ fontFamily: PIN_FONT, fontSize: 11.5, color: TEXT_MUTED }}>No image</span>
              )}
            </div>
          )}
          <div style={{ position: "absolute", right: 6, top: 6, display: "flex", gap: 4, zIndex: 2 }}>
            <button
              type="button"
              title="Rerender"
              onClick={(e) => { e.stopPropagation(); reMut.mutate(); }}
              disabled={reMut.isPending}
              style={{ width: 26, height: 26, borderRadius: 8, border: "none", background: "rgba(255,255,255,0.9)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <RefreshCw size={12} className={reMut.isPending ? "animate-spin" : undefined} style={{ color: TEXT_LABEL }} />
            </button>
            <button
              type="button"
              title="Delete pin"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm("Delete this pin? This removes the brief, image, and any scheduled entries.")) delMut.mutate();
              }}
              disabled={delMut.isPending}
              style={{ width: 26, height: 26, borderRadius: 8, border: "none", background: "rgba(255,255,255,0.9)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <Trash2 size={12} style={{ color: COLOR_ERROR }} />
            </button>
          </div>
        </div>
        <div style={{ padding: "14px 14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          <span
            style={{
              alignSelf: "flex-start", fontFamily: PIN_FONT, fontSize: 11, fontWeight: 700,
              padding: "3px 9px", borderRadius: 999, background: tag.color, color: "#fff",
            }}
          >
            {tag.label}
          </span>
          <div style={{ fontFamily: PIN_FONT, fontSize: 14, fontWeight: 600, color: isPublished ? TEXT_MUTED : TEXT_PRIMARY, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {b.title}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span
              style={{
                fontFamily: PIN_FONT, fontSize: 12, fontWeight: 600,
                color: statusLine.tone === "published" ? TEXT_MUTED : statusLine.tone === "ready" ? COLOR_SUCCESS : statusLine.tone === "failed" ? COLOR_ERROR : statusLine.tone === "rendering" ? PIN.amberIcon : TEXT_LABEL,
              }}
            >
              {statusLine.text}
            </span>
            <SerpTraceBadge
              usedSerpPatterns={b.used_serp_patterns}
              serpKeyword={b.serp_keyword}
              serpPatternsCapturedAt={b.serp_patterns_captured_at}
            />
          </div>
        </div>
      </div>

      {open && url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-6 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <img src={url} alt={b.title} className="max-h-full max-w-full rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 rounded-full bg-background/80 px-3 py-1 text-sm hover:bg-background"
          >
            Close ✕
          </button>
          <a
            href={url}
            download
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-4 right-4 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
          >
            Download
          </a>
        </div>
      )}
    </>
  );
}
