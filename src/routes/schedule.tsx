// Standalone route -- see routes/dashboard.tsx for why this opts out of
// the shared _authenticated layout (AppShell) and duplicates its
// beforeLoad auth guard.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listScheduled, autoSchedule, runPublisher, rescheduleOrCancel, queuePins,
  deleteAllScheduled, replaceScheduledPin, publishNow, markPosted, duplicateScheduledPin,
  unscheduleScheduledPin,
} from "@/lib/schedule.functions";
import { SiteProvider } from "@/lib/site-context";
import { PinShell } from "@/components/PinShell";
import { PinDetailDialog } from "@/components/PinDetailDialog";
import { PIN, PIN_FONT, boardColor } from "@/lib/pin-shell-tokens";
import { countInRange, startOfWeek, addDays } from "@/lib/schedule-stats";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Plus, Star, Check, ImageIcon, ChevronDown, Pencil, CalendarOff,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/schedule")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  head: () => ({ meta: [{ title: "Schedule — Pinspider" }] }),
  component: () => (
    <SiteProvider>
      <SchedulePage />
    </SiteProvider>
  ),
});

type ScheduledRow = Awaited<ReturnType<typeof listScheduled>>[number];
const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
// Fixed rule-of-thumb "good posting hours" -- not personalized real
// analytics (no Pinterest analytics pipeline wired yet). Flagged
// wherever it's used; treat the specific "2x more saves" copy as
// placeholder until real per-slot performance data exists.
const BEST_HOURS = [12, 19];

function SchedulePage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const list = useServerFn(listScheduled);
  const auto = useServerFn(autoSchedule);
  const pub = useServerFn(runPublisher);
  const resched = useServerFn(rescheduleOrCancel);
  const queue = useServerFn(queuePins);
  const wipe = useServerFn(deleteAllScheduled);
  const replace = useServerFn(replaceScheduledPin);
  const publishNowFn = useServerFn(publishNow);
  const markPostedFn = useServerFn(markPosted);
  const duplicateFn = useServerFn(duplicateScheduledPin);
  const unscheduleFn = useServerFn(unscheduleScheduledPin);

  const { data } = useQuery({ queryKey: ["scheduled"], queryFn: () => list() });
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [open, setOpen] = useState<ScheduledRow | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["scheduled"] });

  const autoMut = useMutation({
    mutationFn: (vars: { days: number; perDay: number }) => auto({ data: { ...vars, hoursStart: 9, hoursEnd: 21 } }),
    onSuccess: (r) => { toast.success(r.reason ?? `Scheduled ${r.scheduled} pin${r.scheduled === 1 ? "" : "s"}`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const pubMut = useMutation({
    mutationFn: () => pub(),
    onSuccess: () => { toast.success("Publish run complete"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  // Moves the pin back to a ready-to-schedule draft (pin_briefs.status =
  // "ready" -- the same status freshly-generated, not-yet-scheduled pins
  // sit in) instead of deleting anything. See unscheduleScheduledPin for
  // why "ready" and not a literal "draft" value.
  const unscheduleMut = useMutation({
    mutationFn: (id: string) => unscheduleFn({ data: { id } }),
    onSuccess: () => { invalidate(); setOpen(null); toast.success("Unscheduled — back in Pins as a draft"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const rescheduleMut = useMutation({
    mutationFn: (v: { id: string; scheduled_at: string }) => resched({ data: v }),
    onSuccess: () => { toast.success("Rescheduled"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const queueMut = useMutation({
    mutationFn: (ids?: string[]) => queue({ data: ids ? { ids } : { all: true } }),
    onSuccess: (r) => { toast.success(`Queued ${r.queued} pin${r.queued === 1 ? "" : "s"}`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const wipeMut = useMutation({
    mutationFn: () => wipe({ data: {} }),
    onSuccess: (r) => { toast.success(`Deleted ${r.deleted} scheduled pin${r.deleted === 1 ? "" : "s"}`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const replaceMut = useMutation({
    mutationFn: (id: string) => replace({ data: { id } }),
    onSuccess: () => { toast.success("Pin replaced"); invalidate(); setOpen(null); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const publishNowMut = useMutation({
    mutationFn: (id: string) => publishNowFn({ data: { id } }),
    onSuccess: () => { toast.success("Published"); invalidate(); setOpen(null); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const markPostedMut = useMutation({
    mutationFn: (v: { id: string; pinterestPinId?: string; unmark?: boolean }) => markPostedFn({ data: v }),
    onSuccess: (r) => { toast.success(r.unmarked ? "Mark cleared" : "Marked as posted"); invalidate(); setOpen(null); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const duplicateMut = useMutation({
    mutationFn: (id: string) => duplicateFn({ data: { id } }),
    onSuccess: () => { toast.success("Duplicated to tomorrow"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const rows = data ?? [];
  const weekEnd = addDays(weekStart, 7);
  const weekCounts = countInRange(rows, weekStart, weekEnd);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const rangeLabel = `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { day: "numeric" })}, ${weekStart.getFullYear()}`;

  // "+ add slot" has no exact-day targeting in the underlying
  // autoSchedule() (it fills a rolling window starting today, respecting
  // the same anti-ban safety gaps the manual tool always has) -- so this
  // is real scheduling, not a mock, but the new pin may land on a nearby
  // safe day rather than exactly the clicked column if that day's caps
  // are already full.
  function addSlot() {
    autoMut.mutate({ days: 7, perDay: 3 });
  }

  return (
    <PinShell active="schedule" userEmail={user?.email}>
      <div style={{ padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} style={navBtnStyle}><ChevronLeft size={16} /></button>
          <span style={{ fontSize: 15, fontWeight: 600, fontFamily: PIN_FONT }}>{rangeLabel}</span>
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} style={navBtnStyle}><ChevronRight size={16} /></button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatPill tone="success" label={`${weekCounts.published} published`} />
          <StatPill tone="rose" label={`${weekCounts.scheduled} scheduled`} />
          <StatPill tone="neutral" label={`${weekCounts.total} this week`} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" style={scheduleBtnStyle}>
                <Plus size={15} />Schedule<ChevronDown size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => autoMut.mutate({ days: 14, perDay: 5 })}>Auto-fill next 14 days</DropdownMenuItem>
              <DropdownMenuItem onClick={() => pubMut.mutate()}>Publish everything due now</DropdownMenuItem>
              <DropdownMenuItem onClick={() => queueMut.mutate(undefined)}>Queue all drafts</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { if (window.confirm(`Delete all ${rows.length} scheduled pins? Published pins are kept.`)) wipeMut.mutate(); }}>
                Delete all scheduled
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "0 24px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(150px, 1fr))", gap: 12, minWidth: 900 }}>
          {days.map((day, i) => (
            <DayColumn
              key={day.toISOString()}
              label={DAY_LABELS[i]}
              day={day}
              isLast={i === 6}
              rows={rows}
              onOpen={setOpen}
              onUnschedule={(id) => unscheduleMut.mutate(id)}
              onAddSlot={addSlot}
              addingSlot={autoMut.isPending}
            />
          ))}
        </div>
      </div>

      <PinDetailDialog
        row={open}
        onOpenChange={(v) => !v && setOpen(null)}
        onUnschedule={(id) => unscheduleMut.mutate(id)}
        onQueue={(id) => queueMut.mutate([id])}
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

const navBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 8, border: `1px solid ${PIN.border}`, background: PIN.card,
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: PIN.textSecondary,
};
const scheduleBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", borderRadius: 999,
  background: PIN.accent, color: "#FFFFFF", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
};

function StatPill({ tone, label }: { tone: "success" | "rose" | "neutral"; label: string }) {
  const colors = {
    success: { bg: "#E6F4EA", fg: "#1E7B3D" },
    rose: { bg: PIN.roseTint, fg: PIN.roseIcon },
    neutral: { bg: PIN.fieldBg, fg: PIN.textSecondary },
  }[tone];
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 999, background: colors.bg, color: colors.fg, display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: colors.fg }} />
      {label}
    </span>
  );
}

function DayColumn({
  label, day, isLast, rows, onOpen, onUnschedule, onAddSlot, addingSlot,
}: {
  label: string;
  day: Date;
  isLast: boolean;
  rows: ScheduledRow[];
  onOpen: (r: ScheduledRow) => void;
  onUnschedule: (id: string) => void;
  onAddSlot: () => void;
  addingSlot: boolean;
}) {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = addDays(dayStart, 1);
  const dayRows = rows
    .filter((r) => {
      const t = new Date(r.scheduled_at).getTime();
      return t >= dayStart.getTime() && t < dayEnd.getTime();
    })
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  const counts = countInRange(dayRows, dayStart, dayEnd);
  const isToday = dayStart.getTime() === new Date(new Date().setHours(0, 0, 0, 0)).getTime();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: PIN.textMuted }}>{label}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <span
            style={{
              width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 15, fontWeight: 700, color: isToday ? "#FFFFFF" : PIN.textPrimary,
              background: isToday ? PIN.accent : "transparent",
            }}
          >
            {day.getDate()}
          </span>
          <span style={{ fontSize: 11, color: PIN.textMuted }}>
            {counts.published > 0 && <span style={{ color: "#1E7B3D", fontWeight: 600 }}>{counts.published} done  </span>}
            {counts.scheduled > 0 && `${counts.scheduled} up`}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {dayRows.map((r) => (
          <DayPinCard key={r.id} row={r} onOpen={() => onOpen(r)} onUnschedule={() => onUnschedule(r.id)} />
        ))}
        <button
          type="button"
          onClick={onAddSlot}
          disabled={addingSlot}
          style={{
            border: `1px dashed ${PIN.border}`, borderRadius: 10, padding: "8px 0", background: "transparent",
            color: PIN.textMuted, fontSize: 12, cursor: "pointer",
          }}
        >
          + add slot
        </button>
        {isLast && (
          <div style={{ background: "#FBEEDD", border: "1px solid #F2D9AE", borderRadius: 10, padding: "8px 10px", fontSize: 11.5, color: "#8A5A15", display: "flex", gap: 6 }}>
            <Star size={13} style={{ flexShrink: 0, marginTop: 1, color: PIN.accent }} fill={PIN.accent} />
            {/* Placeholder copy pending real per-slot analytics -- see BEST_HOURS. */}
            <span><strong>Best times:</strong> 12 PM &amp; 7 PM get 2x more saves</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Expand-on-hover: Edit (opens the shared detail modal) + Unschedule (a
// direct quick action, no modal needed) for anything not yet published --
// same two-action pattern as the Dashboard's masonry tiles.
function DayPinCard({ row, onOpen, onUnschedule }: { row: ScheduledRow; onOpen: () => void; onUnschedule: () => void }) {
  const color = boardColor(row.board_id ?? row.boards?.name ?? null);
  const hour = new Date(row.scheduled_at).getHours();
  const editable = row.status !== "published" && row.status !== "publishing";
  const isBestTime = editable && BEST_HOURS.includes(hour);
  const time = new Date(row.scheduled_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpen(); }}
      className="group"
      style={{
        position: "relative", textAlign: "left", background: PIN.card, border: `1px solid ${PIN.border}`, borderLeft: `4px solid ${color}`,
        borderRadius: 10, padding: "8px 10px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span style={{ fontSize: 11, color: PIN.textMuted }}>{time}</span>
        {row.status === "published" ? (
          <span style={{ fontSize: 10, fontWeight: 700, color: "#1E7B3D", display: "flex", alignItems: "center", gap: 3 }}>
            <Check size={11} />Published
          </span>
        ) : isBestTime ? (
          <span style={{ fontSize: 10, fontWeight: 700, color: PIN.accent, display: "flex", alignItems: "center", gap: 3 }}>
            <Star size={10} fill={PIN.accent} />Best time
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        {row.image_url ? (
          <img src={row.image_url} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: 6, background: PIN.fieldBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <ImageIcon size={13} style={{ color: PIN.textMuted }} />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: PIN.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.pin_briefs?.title ?? "Untitled"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 10.5, color: PIN.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.boards?.name ?? "No board"}
            </span>
          </div>
        </div>
      </div>

      {editable && (
        <div
          className="pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
          style={{ position: "absolute", top: 6, right: 6, display: "flex", alignItems: "center", gap: 4 }}
        >
          <button
            type="button"
            title="Edit"
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            style={dayCardIconBtnStyle}
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            title="Unschedule — back to draft"
            onClick={(e) => { e.stopPropagation(); onUnschedule(); }}
            style={dayCardIconBtnStyle}
          >
            <CalendarOff size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

const dayCardIconBtnStyle: React.CSSProperties = {
  width: 22, height: 22, borderRadius: "50%", border: `1px solid ${PIN.border}`, background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: PIN.textSecondary,
  boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
};
