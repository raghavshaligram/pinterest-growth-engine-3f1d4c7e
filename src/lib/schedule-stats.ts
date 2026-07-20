// Framework-agnostic. Single source of truth for "how many pins fall in
// this date range, by status" -- used by the Schedule page for both its
// header stat pills (published/scheduled/this-week) and each day
// column's small "N up" badge, so there's exactly one counting
// implementation instead of two drifting in parallel. Operates on
// whatever's already been fetched client-side by listScheduled() --
// Dashboard's own weekly figures come from a separate, already-existing
// server-side COUNT query (dashboardStats' publishedThisWeekTotal) which
// this intentionally doesn't replace, since it's a different real query
// against a different (site-scoped) dataset.
export type CountableRow = { scheduled_at: string; status: string };
export type RangeCounts = { published: number; scheduled: number; total: number };

export function countInRange(rows: CountableRow[], start: Date, end: Date): RangeCounts {
  let published = 0;
  let scheduled = 0;
  let total = 0;
  const startMs = start.getTime();
  const endMs = end.getTime();
  for (const r of rows) {
    const t = new Date(r.scheduled_at).getTime();
    if (t < startMs || t >= endMs) continue;
    total++;
    if (r.status === "published") published++;
    else if (r.status !== "canceled") scheduled++; // draft/queued/publishing/failed/exported all read as "scheduled" here
  }
  return { published, scheduled, total };
}

export function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day; // back up to Monday
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}
