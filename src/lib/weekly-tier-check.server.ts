// Server-only. Weekly current_daily_cap fine-tuning (see
// cron/tier-check.ts). Distinct from reconcileTier()/getOrRefreshTier()
// (publishing-profile.server.ts), which is the nightly, activity-based
// *tier* reconciliation (new/warming/established) deciding which
// SafetyLimits shape applies. This job instead nudges the numeric
// current_daily_cap the materializer actually uses, inside whatever
// ceiling the current tier allows, based on three independent weekly
// signals. Every adjustment — up or down — writes its own
// account_cap_events row with from_cap/to_cap and a reason; nothing here
// overwrites current_daily_cap silently. Entirely skipped for accounts
// in cap_mode: 'manual' — those are left exactly as the user set them.
import { tierCaps, SAFETY, type PublishingTier } from "./scheduling-safety.server";

// One-time bumps the first time each threshold is crossed since
// onboarding — a standard warm-up schedule independent of the
// activity-based tier reconciliation. Increases never push
// current_daily_cap past the account's current tier ceiling (an account
// still heuristically "new" doesn't get ramped to 25/day just because
// 90 days passed with little activity).
const AGE_THRESHOLDS: { days: number; bump: number }[] = [
  { days: 30, bump: 3 },
  { days: 90, bump: 5 },
];

const CONSISTENCY_WINDOW_DAYS = 30;
const CONSISTENCY_GAP_THRESHOLD_DAYS = 7;
const CONSISTENCY_PENALTY = 2;
const CONSISTENCY_FLOOR = 4;

const ERROR_WINDOW_DAYS = 7;
const ERROR_THRESHOLD = 3;
const ERROR_PENALTY = 4;
const ERROR_FLOOR = 3;

export type CapCheckEvent = {
  event_type: "age_growth" | "consistency_gap" | "api_error_brake";
  from_cap: number;
  to_cap: number;
  detail: Record<string, unknown>;
};

export async function runWeeklyCapCheck(userId: string): Promise<{ applied: CapCheckEvent[]; skipped?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: profile } = await supabaseAdmin
    .from("account_publishing_profiles")
    .select("reconciled_tier, current_daily_cap, cap_mode, onboarded_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) return { applied: [], skipped: "not onboarded" };
  if (profile.cap_mode !== "auto") return { applied: [], skipped: "cap_mode is manual" };

  const tier = profile.reconciled_tier as PublishingTier;
  const ceiling = Math.min(tierCaps(tier).maxPerAccountPerDay, SAFETY.maxPerAccountPerDay);
  let cap = profile.current_daily_cap as number;
  const applied: CapCheckEvent[] = [];

  // 1) age_growth — only re-fires per threshold if it hasn't already
  // been logged for this user (so it's a one-time step, not a weekly
  // repeat once past 30/90 days).
  const onboardedAt = new Date(profile.onboarded_at as string).getTime();
  const daysSinceOnboarding = Math.floor((Date.now() - onboardedAt) / 86_400_000);
  const { data: pastAgeEvents } = await supabaseAdmin
    .from("account_cap_events")
    .select("detail")
    .eq("user_id", userId)
    .eq("event_type", "age_growth");
  const alreadyAppliedThresholds = new Set(
    (pastAgeEvents ?? [])
      .map((e) => (e.detail as { threshold?: number } | null)?.threshold)
      .filter((t): t is number => typeof t === "number"),
  );
  for (const { days, bump } of AGE_THRESHOLDS) {
    if (daysSinceOnboarding < days) continue;
    if (alreadyAppliedThresholds.has(days)) continue;
    const from = cap;
    const to = Math.min(cap + bump, ceiling);
    if (to > from) {
      applied.push({ event_type: "age_growth", from_cap: from, to_cap: to, detail: { threshold: days, daysSinceOnboarding } });
      cap = to;
    }
  }

  // 2) consistency_gap — recurring: re-evaluated every run against a
  // trailing 30-day window of real published activity.
  const consistencyWindowStart = new Date(Date.now() - CONSISTENCY_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: publishedRows } = await supabaseAdmin
    .from("scheduled_pins")
    .select("published_at")
    .eq("user_id", userId)
    .eq("status", "published")
    .gte("published_at", consistencyWindowStart);
  const activeDays = new Set(
    (publishedRows ?? [])
      .map((r) => (r.published_at as string | null))
      .filter((v): v is string => Boolean(v))
      .map((v) => v.slice(0, 10)),
  );
  const daysWithoutActivity = CONSISTENCY_WINDOW_DAYS - activeDays.size;
  if (daysWithoutActivity > CONSISTENCY_GAP_THRESHOLD_DAYS) {
    const from = cap;
    const to = Math.max(cap - CONSISTENCY_PENALTY, CONSISTENCY_FLOOR);
    if (to !== from) {
      applied.push({
        event_type: "consistency_gap",
        from_cap: from,
        to_cap: to,
        detail: { daysWithoutActivity, windowDays: CONSISTENCY_WINDOW_DAYS },
      });
      cap = to;
    }
  }

  // 3) api_error_brake — pulled straight from existing publish_logs
  // error-level rows, no new tracking added.
  const errorWindowStart = new Date(Date.now() - ERROR_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: errorLogs } = await supabaseAdmin
    .from("publish_logs")
    .select("id, message, scheduled_pin_id")
    .eq("user_id", userId)
    .eq("level", "error")
    .gte("at", errorWindowStart)
    .limit(50);
  const errorCount = errorLogs?.length ?? 0;
  if (errorCount > ERROR_THRESHOLD) {
    const from = cap;
    const to = Math.max(cap - ERROR_PENALTY, ERROR_FLOOR);
    if (to !== from) {
      applied.push({
        event_type: "api_error_brake",
        from_cap: from,
        to_cap: to,
        detail: {
          errorCount,
          windowDays: ERROR_WINDOW_DAYS,
          sampleLogIds: (errorLogs ?? []).slice(0, 5).map((l) => l.id),
        },
      });
      cap = to;
    }
  }

  if (applied.length) {
    const { error: updErr } = await supabaseAdmin
      .from("account_publishing_profiles")
      .update({ current_daily_cap: cap, last_cap_check_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (updErr) throw updErr;

    const { error: insErr } = await supabaseAdmin.from("account_cap_events").insert(
      applied.map((e) => ({
        user_id: userId,
        event_type: e.event_type,
        from_cap: e.from_cap,
        to_cap: e.to_cap,
        detail: e.detail,
      })),
    );
    if (insErr) throw insErr;
  } else {
    await supabaseAdmin
      .from("account_publishing_profiles")
      .update({ last_cap_check_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  return { applied };
}
