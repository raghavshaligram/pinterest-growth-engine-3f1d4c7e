// Standalone route -- opts out of the shared _authenticated layout
// (AppShell) so PinShell can go fully Pinterest-native on this page
// without restyling Sites/Pages/Pins/Boards/Keywords/Logs/Settings,
// which all still render through the untouched AppShell. beforeLoad
// duplicates _authenticated/route.tsx's auth guard -- keep both in sync
// if that check ever changes.
import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listScheduled, publishNow, rescheduleOrCancel, duplicateScheduledPin,
  unscheduleScheduledPin, queuePins, replaceScheduledPin, markPosted,
} from "@/lib/schedule.functions";
import { dashboardStats } from "@/lib/dashboard.functions";
import { SiteProvider, useSiteContext } from "@/lib/site-context";
import { PinShell } from "@/components/PinShell";
import { PinDetailDialog } from "@/components/PinDetailDialog";
import { PIN, PIN_FONT, boardColor, formatPinTimestamp, hostOf } from "@/lib/pin-shell-tokens";
import { countInRange, startOfWeek, addDays } from "@/lib/schedule-stats";
import { toast } from "sonner";
import {
  Search, SlidersHorizontal, Plus, CheckCircle2, AlertTriangle, TrendingUp,
  Pencil, CalendarOff, ImageIcon,
} from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  head: () => ({ meta: [{ title: "Dashboard — Pinspider" }] }),
  component: () => (
    <SiteProvider>
      <DashboardPage />
    </SiteProvider>
  ),
});

type ScheduledRow = Awaited<ReturnType<typeof listScheduled>>[number];
type Pill = "all" | "week" | "published" | "scheduled";

function DashboardPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { selectedSite } = useSiteContext();
  const listFn = useServerFn(listScheduled);
  const statsFn = useServerFn(dashboardStats);
  const publishNowFn = useServerFn(publishNow);
  const rescheduleFn = useServerFn(rescheduleOrCancel);
  const duplicateFn = useServerFn(duplicateScheduledPin);
  const unscheduleFn = useServerFn(unscheduleScheduledPin);
  const queueFn = useServerFn(queuePins);
  const replaceFn = useServerFn(replaceScheduledPin);
  const markPostedFn = useServerFn(markPosted);

  const { data } = useQuery({ queryKey: ["scheduled"], queryFn: () => listFn() });
  const { data: stats } = useQuery({ queryKey: ["dash-logs"], queryFn: () => statsFn({ data: { siteId: null } }) });

  const [pill, setPill] = useState<Pill>("week");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<ScheduledRow | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["scheduled"] });

  const publishNowMut = useMutation({
    mutationFn: (id: string) => publishNowFn({ data: { id } }),
    onSuccess: () => { toast.success("Published"); invalidate(); setOpen(null); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const rescheduleMut = useMutation({
    mutationFn: (v: { id: string; scheduled_at: string }) => rescheduleFn({ data: v }),
    onSuccess: () => { toast.success("Rescheduled"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const duplicateMut = useMutation({
    mutationFn: (id: string) => duplicateFn({ data: { id } }),
    onSuccess: () => { toast.success("Duplicated to tomorrow"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  // Moves the pin back to a ready-to-schedule draft rather than deleting
  // it -- see unscheduleScheduledPin for why pin_briefs.status is set to
  // "ready" (what freshly-generated drafts use) rather than a literal
  // "draft" value.
  const unscheduleMut = useMutation({
    mutationFn: (id: string) => unscheduleFn({ data: { id } }),
    onSuccess: () => { invalidate(); setOpen(null); toast.success("Unscheduled — back in Pins as a draft"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const queueMut = useMutation({
    mutationFn: (id: string) => queueFn({ data: { ids: [id] } }),
    onSuccess: (r) => { toast.success(`Queued ${r.queued} pin${r.queued === 1 ? "" : "s"}`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const replaceMut = useMutation({
    mutationFn: (id: string) => replaceFn({ data: { id } }),
    onSuccess: () => { toast.success("Pin replaced"); invalidate(); setOpen(null); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const markPostedMut = useMutation({
    mutationFn: (v: { id: string; pinterestPinId?: string; unmark?: boolean }) => markPostedFn({ data: v }),
    onSuccess: (r) => { toast.success(r.unmarked ? "Mark cleared" : "Marked as posted"); invalidate(); setOpen(null); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const rows = data ?? [];
  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 7);
  const lastWeekStart = addDays(weekStart, -7);
  const thisWeekCounts = countInRange(rows, weekStart, weekEnd);
  const lastWeekCounts = countInRange(rows, lastWeekStart, weekStart);
  const publishedDelta = thisWeekCounts.published - lastWeekCounts.published;

  const webhookErrorLogs = (stats?.recentLogs ?? []).filter(
    (l) => l.level === "error" && l.message.toLowerCase().includes("webhook"),
  );
  const lastWebhookError = webhookErrorLogs[0];

  const filtered = rows
    .filter((r) => {
      if (pill === "week") {
        const t = new Date(r.scheduled_at).getTime();
        return t >= weekStart.getTime() && t < weekEnd.getTime();
      }
      if (pill === "published") return r.status === "published";
      if (pill === "scheduled") return r.status !== "published" && r.status !== "canceled";
      return r.status !== "canceled";
    })
    .filter((r) => {
      if (!search.trim()) return true;
      const title = r.pin_briefs?.title ?? "";
      return title.toLowerCase().includes(search.trim().toLowerCase());
    })
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());

  return (
    <PinShell active="dashboard" userEmail={user?.email}>
      <TopBar search={search} onSearch={setSearch} />
      <FilterPillsRow siteLabel={selectedSite?.brand_name || (selectedSite ? hostOf(selectedSite.url) : "All sites")} siteColor={selectedSite?.accent_color} pill={pill} onPill={setPill} />
      <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 32px" }}>
        <MasonryFeed
          rows={filtered}
          publishedThisWeek={thisWeekCounts.published}
          publishedDelta={publishedDelta}
          webhookErrorCount={webhookErrorLogs.length}
          lastWebhookError={lastWebhookError ? { message: lastWebhookError.message, domain: lastWebhookError.pageUrl ? hostOf(lastWebhookError.pageUrl) : "unknown source" } : null}
          onOpen={setOpen}
          onUnschedule={(id) => unscheduleMut.mutate(id)}
        />
      </div>

      <PinDetailDialog
        row={open}
        onOpenChange={(v) => !v && setOpen(null)}
        onUnschedule={(id) => unscheduleMut.mutate(id)}
        onQueue={(id) => queueMut.mutate(id)}
        onReplace={(id) => replaceMut.mutate(id)}
        onPublishNow={(id) => publishNowMut.mutate(id)}
        onDuplicate={(id) => duplicateMut.mutate(id)}
        onReschedule={(id, at) => rescheduleMut.mutate({ id, scheduled_at: at })}
        onMarkPosted={(id, pid) => markPostedMut.mutate({ id, pinterestPinId: pid })}
        onUnmarkPosted={(id) => markPostedMut.mutate({ id, unmark: true })}
        unscheduling={unscheduleMut.isPending}
        queuing={queueMut.isPending}
        replacing={replaceMut.isPending}
        publishing={publishNowMut.isPending}
        marking={markPostedMut.isPending}
      />
    </PinShell>
  );
}

// ---------- Top bar ----------

function TopBar({ search, onSearch }: { search: string; onSearch: (v: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 24px 12px" }}>
      <div
        style={{
          flex: 1, display: "flex", alignItems: "center", gap: 8, background: PIN.fieldBg,
          borderRadius: 999, padding: "10px 16px", maxWidth: 480,
        }}
      >
        <Search size={16} style={{ color: PIN.textSecondary, flexShrink: 0 }} />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search your pins..."
          style={{ border: "none", outline: "none", background: "transparent", fontSize: 14, color: PIN.textPrimary, width: "100%" }}
        />
      </div>
      <button
        type="button"
        title="Filters"
        style={{
          width: 40, height: 40, borderRadius: 10, background: PIN.fieldBg, border: "none",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
      >
        <SlidersHorizontal size={17} style={{ color: PIN.textSecondary }} />
      </button>
      <Link
        to="/pins"
        style={{
          display: "flex", alignItems: "center", gap: 6, height: 40, padding: "0 16px", borderRadius: 999,
          background: PIN.accent, color: "#FFFFFF", fontSize: 14, fontWeight: 600, flexShrink: 0, textDecoration: "none",
        }}
      >
        <Plus size={17} />Create Pin
      </Link>
    </div>
  );
}

// ---------- Filter pills ----------

const PILLS: { key: Pill; label: string }[] = [
  { key: "all", label: "All pins" },
  { key: "week", label: "This week" },
  { key: "published", label: "Published" },
  { key: "scheduled", label: "Scheduled" },
];

function FilterPillsRow({
  siteLabel, siteColor, pill, onPill,
}: {
  siteLabel: string;
  siteColor?: string | null;
  pill: Pill;
  onPill: (p: Pill) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 24px 16px", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: PIN.textPrimary, fontWeight: 500 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: siteColor ?? PIN.textMuted, flexShrink: 0 }} />
        {siteLabel}
      </div>
      <div style={{ width: 1, height: 14, background: PIN.border }} />
      <div style={{ display: "flex", gap: 6 }}>
        {PILLS.map((p) => {
          const activePill = pill === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onPill(p.key)}
              style={{
                fontSize: 13, fontWeight: 500, padding: "6px 14px", borderRadius: 999, border: "none",
                cursor: "pointer", background: activePill ? PIN.textPrimary : "transparent",
                color: activePill ? "#FFFFFF" : PIN.textSecondary,
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Masonry feed ----------

type FeedItem =
  | { kind: "pin"; row: ScheduledRow }
  | { kind: "stat"; key: "published" | "errors" | "saves" };

function MasonryFeed({
  rows, publishedThisWeek, publishedDelta, webhookErrorCount, lastWebhookError, onOpen, onUnschedule,
}: {
  rows: ScheduledRow[];
  publishedThisWeek: number;
  publishedDelta: number;
  webhookErrorCount: number;
  lastWebhookError: { message: string; domain: string } | null;
  onOpen: (row: ScheduledRow) => void;
  onUnschedule: (id: string) => void;
}) {
  const items: FeedItem[] = [];
  const statKeys: Extract<FeedItem, { kind: "stat" }>["key"][] = ["published", "errors", "saves"];
  let statIdx = 0;
  rows.forEach((row, i) => {
    items.push({ kind: "pin", row });
    if ((i + 1) % 5 === 0 && statIdx < statKeys.length) {
      items.push({ kind: "stat", key: statKeys[statIdx++] });
    }
  });
  while (statIdx < statKeys.length) items.push({ kind: "stat", key: statKeys[statIdx++] });

  return (
    <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-3">
      {items.map((item, i) =>
        item.kind === "pin" ? (
          <div key={`pin-${item.row.id}`} className="mb-3 break-inside-avoid">
            <PinTile row={item.row} onOpen={onOpen} onUnschedule={onUnschedule} />
          </div>
        ) : (
          <div key={`stat-${item.key}-${i}`} className="mb-3 break-inside-avoid">
            {item.key === "published" && (
              <StatTile
                tone="rose" icon={CheckCircle2} value={String(publishedThisWeek)}
                label="pins published this week"
                delta={publishedDelta === 0 ? null : `${publishedDelta > 0 ? "↑" : "↓"} ${Math.abs(publishedDelta)} ${publishedDelta > 0 ? "more" : "fewer"} than last week`}
              />
            )}
            {item.key === "errors" && (
              <StatTile
                tone="amber" icon={AlertTriangle} value={String(webhookErrorCount)}
                label="webhook errors need attention"
                delta={lastWebhookError ? `Last: ${lastWebhookError.domain} — ${lastWebhookError.message.slice(0, 40)}` : null}
                to="/logs"
              />
            )}
            {item.key === "saves" && (
              <StatTile
                tone="rose" icon={TrendingUp} value="—"
                label="saves this month"
                delta="No data yet — connect Pinterest analytics"
              />
            )}
          </div>
        ),
      )}
      {!rows.length && (
        <p style={{ fontSize: 13, color: PIN.textSecondary, gridColumn: "1 / -1" }}>Nothing to show for this filter yet.</p>
      )}
    </div>
  );
}

function StatTile({
  tone, icon: Icon, value, label, delta, to,
}: {
  tone: "rose" | "amber";
  icon: typeof CheckCircle2;
  value: string;
  label: string;
  delta?: string | null;
  to?: string;
}) {
  const tint = tone === "rose" ? PIN.roseTint : PIN.amberTint;
  const iconColor = tone === "rose" ? PIN.roseIcon : PIN.amberIcon;
  const body = (
    <div
      style={{
        borderRadius: 16, border: `1px solid ${PIN.border}`, background: PIN.card, padding: 18,
        display: "flex", flexDirection: "column", gap: 10, textDecoration: "none",
      }}
    >
      <div style={{ width: 36, height: 36, borderRadius: "50%", background: tint, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={17} style={{ color: iconColor }} />
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: PIN.textPrimary, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 13, color: PIN.textSecondary }}>{label}</div>
      {delta && <div style={{ fontSize: 11.5, color: PIN.textMuted }}>{delta}</div>}
    </div>
  );
  return to ? <Link to={to} style={{ display: "block" }}>{body}</Link> : body;
}

// ---------- Pin tile ----------

// Two-action hover for anything still draft/scheduled: Edit (opens the
// shared PinDetailDialog, which holds Replace/Duplicate/Publish
// now/Reschedule/Queue/Mark posted) + Unschedule (direct quick action).
// Published tiles show performance data instead -- no hover actions,
// per the earlier no-fabrication dashboard spec.
function PinTile({
  row, onOpen, onUnschedule,
}: {
  row: ScheduledRow;
  onOpen: (row: ScheduledRow) => void;
  onUnschedule: (id: string) => void;
}) {
  const published = row.status === "published";
  const color = boardColor(row.board_id ?? row.boards?.name ?? null);
  const title = row.pin_briefs?.title ?? "Untitled";

  return (
    <div className="group" style={{ borderRadius: 16, overflow: "hidden", background: PIN.fieldBg, position: "relative" }}>
      <div style={{ position: "relative" }}>
        {row.image_url ? (
          <img src={row.image_url} alt={title} style={{ width: "100%", height: "auto", display: "block" }} loading="lazy" />
        ) : (
          <div style={{ aspectRatio: "2 / 3", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ImageIcon size={22} style={{ color: PIN.textMuted }} />
          </div>
        )}

        {!published && (
          <div
            className="pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
            style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", justifyContent: "center",
              background: "linear-gradient(to top, rgba(17,17,17,0.55), rgba(17,17,17,0) 55%)", padding: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <IconBtn title="Edit" primary onClick={() => onOpen(row)}>
                <Pencil size={14} />
              </IconBtn>
              <IconBtn title="Unschedule — back to draft" onClick={() => onUnschedule(row.id)}>
                <CalendarOff size={14} />
              </IconBtn>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "8px 2px 4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
          <span
            style={{ fontSize: 13, color: PIN.textPrimary, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
            title={title}
          >
            {title}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: PIN.textMuted, marginTop: 2 }}>
          {published ? <PerformanceLine /> : formatPinTimestamp(row.scheduled_at)}
        </div>
      </div>
    </div>
  );
}

// No live Pinterest analytics wired yet (needs Standard API access +
// pins:read scope) -- shown honestly instead of inventing save/click
// counts. Swap this for real numbers once that pipeline exists.
function PerformanceLine() {
  return <span style={{ color: PIN.textMuted }}>No data yet</span>;
}

function IconBtn({
  children, title, onClick, primary,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        width: primary ? 34 : 28, height: primary ? 34 : 28, borderRadius: "50%", border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: primary ? PIN.accent : "rgba(255,255,255,0.92)",
        color: primary ? "#FFFFFF" : PIN.textPrimary,
      }}
    >
      {children}
    </button>
  );
}
