// Server-only. Lane classification for the nightly materializer.
//
// This schema has no "product" concept — only crawled pages (see
// pages table / pages.functions.ts). So "lane" is inferred purely from
// existing page metadata (last_crawled_at / created_at) rather than a
// stored field: a page's age since it was first picked up (or last
// meaningfully refreshed) stands in for "how new is this content."
//
//   fresh      — page surfaced in the last FRESH_DAYS. Gets the biggest
//                per-day pin allowance so brand-new content gets an
//                initial promotion burst.
//   deep_drip  — past the fresh window but still within DEEP_DRIP_DAYS.
//                Steady, lower-frequency drip.
//   evergreen  — everything older. Lowest per-page priority, but by far
//                the largest pool, so it still fills most of the
//                schedule once fresh/deep_drip pages are covered.
export type Lane = "fresh" | "deep_drip" | "evergreen";

const FRESH_DAYS = 14;
const DEEP_DRIP_DAYS = 45;

export function classifyLane(page: { created_at?: string | null; last_crawled_at?: string | null }): Lane {
  const anchor = page.last_crawled_at ?? page.created_at;
  if (!anchor) return "evergreen";
  const ageDays = (Date.now() - new Date(anchor).getTime()) / 86_400_000;
  if (ageDays <= FRESH_DAYS) return "fresh";
  if (ageDays <= DEEP_DRIP_DAYS) return "deep_drip";
  return "evergreen";
}

// Relative share of a day's total cap each lane should try to claim
// before falling back to round-robin within the lane. Fresh pages get
// first crack at slots (burst), deep_drip next, evergreen fills
// whatever's left. Not a hard cap — just an ordering/weighting signal
// used to sort candidate briefs before the safety-gated placement loop.
export function lanePriority(lane: Lane): number {
  return lane === "fresh" ? 0 : lane === "deep_drip" ? 1 : 2;
}
