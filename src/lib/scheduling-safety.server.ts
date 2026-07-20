// Server-only. Shared anti-ban gap/cap logic used by both the manual
// autoSchedule() tool (schedule.functions.ts) and the nightly lane-aware
// materializer (cron/materialize.ts). Both call the exact same
// buildScheduleState/findSafeSlot so a fresh/warming account never gets
// double-booked between a manual run and an automated one, and so the
// automated tier caps can only ever be *tighter* than or equal to the
// manual SAFETY ceiling, never looser.

export type SafetyLimits = {
  maxPerAccountPerDay: number;      // account-wide daily cap
  maxPerBoardPerDay: number;        // board-level daily cap
  maxPerPagePerDay: number;         // max times the same source page can be scheduled in one day
  maxSameUrlPerAccountDay: number;  // same destination URL, per day, all boards
  sameUrlBoardGapDays: number;      // >= N days between reposts of same URL to same board
  sameUrlAccountGapHours: number;   // >= N hours between any two pins to same URL
  minMinutesBetweenPins: number;    // account-wide min gap between any two pins
};

// Pinterest anti-ban limits — conservative defaults per account.
// This is the ceiling: the manual autoSchedule() tool always runs at this
// level (the user explicitly asked to fill N/day and we trust that
// input). The automated nightly materializer instead runs at tierCaps()
// below, which is this or tighter depending on how warmed-up the account
// is judged to be.
export const SAFETY: SafetyLimits = {
  maxPerAccountPerDay: 25,
  maxPerBoardPerDay: 10,
  maxPerPagePerDay: 1,
  maxSameUrlPerAccountDay: 3,
  sameUrlBoardGapDays: 2,
  sameUrlAccountGapHours: 4,
  minMinutesBetweenPins: 15,
} as const;

export type PublishingTier = "new" | "warming" | "established";

// Scaled-down caps for the automated materializer, keyed off the
// account_publishing_profiles.reconciled_tier. "established" is
// identical to the manual SAFETY ceiling; "new"/"warming" are
// deliberately much tighter since these accounts are unattended (no
// human eyeballing each batch before it goes out).
export function tierCaps(tier: PublishingTier): SafetyLimits {
  switch (tier) {
    case "new":
      return {
        maxPerAccountPerDay: 5,
        maxPerBoardPerDay: 3,
        maxPerPagePerDay: 1,
        maxSameUrlPerAccountDay: 1,
        sameUrlBoardGapDays: 5,
        sameUrlAccountGapHours: 12,
        minMinutesBetweenPins: 45,
      };
    case "warming":
      return {
        maxPerAccountPerDay: 12,
        maxPerBoardPerDay: 6,
        maxPerPagePerDay: 1,
        maxSameUrlPerAccountDay: 2,
        sameUrlBoardGapDays: 3,
        sameUrlAccountGapHours: 6,
        minMinutesBetweenPins: 25,
      };
    case "established":
      return SAFETY;
  }
}

export type ExistingRow = {
  when: number;
  boardId: string | null;
  url: string;
  imageId: string | null;
  pageId: string | null;
};

export type ScheduleState = {
  perDayAccount: Map<string, number>;
  perDayBoard: Map<string, number>;        // key: `${day}|${boardId}`
  perDayPage: Map<string, number>;         // key: `${day}|${pageId}`
  perDayUrl: Map<string, number>;          // key: `${day}|${url}`
  lastByUrlBoard: Map<string, number>;     // key: `${url}|${boardId}` -> ts
  lastByUrl: Map<string, number>;          // key: url -> ts
  accountTimestamps: number[];
  usedImageIds: Set<string>;
};

export const dayKey = (t: number): string => new Date(t).toISOString().slice(0, 10);

// Turns a flat list of existing/queued scheduled_pins rows (already
// published, queued, draft — anything live) into the lookup maps the
// safety gates need. Both callers fetch their own window of rows from
// scheduled_pins and pass them through this so the resulting state
// reflects real DB history, not just what either run has planned so far.
export function buildScheduleState(history: ExistingRow[]): ScheduleState {
  const state: ScheduleState = {
    perDayAccount: new Map(),
    perDayBoard: new Map(),
    perDayPage: new Map(),
    perDayUrl: new Map(),
    lastByUrlBoard: new Map(),
    lastByUrl: new Map(),
    accountTimestamps: [],
    usedImageIds: new Set(),
  };
  for (const h of history) {
    const dk = dayKey(h.when);
    state.perDayAccount.set(dk, (state.perDayAccount.get(dk) ?? 0) + 1);
    if (h.boardId) state.perDayBoard.set(`${dk}|${h.boardId}`, (state.perDayBoard.get(`${dk}|${h.boardId}`) ?? 0) + 1);
    if (h.pageId) state.perDayPage.set(`${dk}|${h.pageId}`, (state.perDayPage.get(`${dk}|${h.pageId}`) ?? 0) + 1);
    if (h.url) {
      state.perDayUrl.set(`${dk}|${h.url}`, (state.perDayUrl.get(`${dk}|${h.url}`) ?? 0) + 1);
      const prevUrl = state.lastByUrl.get(h.url) ?? 0;
      if (h.when > prevUrl) state.lastByUrl.set(h.url, h.when);
      if (h.boardId) {
        const k = `${h.url}|${h.boardId}`;
        const prev = state.lastByUrlBoard.get(k) ?? 0;
        if (h.when > prev) state.lastByUrlBoard.set(k, h.when);
      }
    }
    state.accountTimestamps.push(h.when);
    if (h.imageId) state.usedImageIds.add(h.imageId);
  }
  return state;
}

// Checks every safety gate for a candidate (when, pageUrl, pageId) and,
// if it passes the account/page/url gates, tries each board in
// round-robin order starting at boardIdx and returns the first board
// that also clears the per-board-day cap and same-URL/board gap.
// Returns null if no board works at this slot. Does NOT mutate state —
// call commitPlacement() separately once the caller has decided to take
// this slot (keeps the "is this safe" check side-effect-free so it can
// be probed repeatedly while walking candidate slots).
export function findSafeBoard(
  state: ScheduleState,
  limits: SafetyLimits,
  params: { when: number; pageId: string | null; pageUrl: string; boardIds: string[]; boardIdx: number },
): { boardId: string; nextBoardIdx: number } | null {
  const { when, pageId, pageUrl, boardIds, boardIdx } = params;
  if (!boardIds.length) return null;
  const dk = dayKey(when);

  if ((state.perDayAccount.get(dk) ?? 0) >= limits.maxPerAccountPerDay) return null;
  if (pageId && (state.perDayPage.get(`${dk}|${pageId}`) ?? 0) >= limits.maxPerPagePerDay) return null;
  if (state.accountTimestamps.some((t) => Math.abs(t - when) < limits.minMinutesBetweenPins * 60_000)) return null;
  if ((state.perDayUrl.get(`${dk}|${pageUrl}`) ?? 0) >= limits.maxSameUrlPerAccountDay) return null;
  const lastUrl = state.lastByUrl.get(pageUrl) ?? 0;
  if (lastUrl && Math.abs(when - lastUrl) < limits.sameUrlAccountGapHours * 3600_000) return null;

  for (let b = 0; b < boardIds.length; b++) {
    const board = boardIds[(boardIdx + b) % boardIds.length];
    if ((state.perDayBoard.get(`${dk}|${board}`) ?? 0) >= limits.maxPerBoardPerDay) continue;
    const lastOnBoard = state.lastByUrlBoard.get(`${pageUrl}|${board}`) ?? 0;
    if (lastOnBoard && Math.abs(when - lastOnBoard) < limits.sameUrlBoardGapDays * 86_400_000) continue;
    return { boardId: board, nextBoardIdx: (boardIdx + b + 1) % boardIds.length };
  }
  return null;
}

// Mutates state to reflect a pin actually placed at (when, boardId, ...).
// Call this right after findSafeBoard() returns a board and the caller
// has committed to the slot, so the next candidate sees this pin too.
export function commitPlacement(
  state: ScheduleState,
  params: { when: number; boardId: string; pageId: string | null; pageUrl: string; imageId: string },
): void {
  const { when, boardId, pageId, pageUrl, imageId } = params;
  const dk = dayKey(when);
  state.perDayAccount.set(dk, (state.perDayAccount.get(dk) ?? 0) + 1);
  state.perDayBoard.set(`${dk}|${boardId}`, (state.perDayBoard.get(`${dk}|${boardId}`) ?? 0) + 1);
  if (pageId) state.perDayPage.set(`${dk}|${pageId}`, (state.perDayPage.get(`${dk}|${pageId}`) ?? 0) + 1);
  state.perDayUrl.set(`${dk}|${pageUrl}`, (state.perDayUrl.get(`${dk}|${pageUrl}`) ?? 0) + 1);
  state.lastByUrl.set(pageUrl, when);
  state.lastByUrlBoard.set(`${pageUrl}|${boardId}`, when);
  state.accountTimestamps.push(when);
  state.usedImageIds.add(imageId);
}
