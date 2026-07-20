// Server-only. Onboarding + ongoing reconciliation for
// account_publishing_profiles. The nightly materializer (cron/materialize.ts)
// reads reconciled_tier from here to size its daily caps (see
// scheduling-safety.server.ts:tierCaps) — this file is what keeps that
// tier honest over time instead of frozen at whatever the user clicked
// on day one.
import { tierCaps, SAFETY, type PublishingTier, type SafetyLimits } from "./scheduling-safety.server";
import type { PinterestAccountMetrics } from "./pinterest.server";

export type ReconcileResult = {
  tier: PublishingTier;
  metrics: PinterestAccountMetrics | null;
  source: "activity" | "self_report";
};

// Pinterest's v5 API has no account-creation-date field, so there's no
// way to directly verify "I've had this account 8 months." Instead this
// reads the activity counters that DO exist and uses them as a maturity
// signal: an account with 1,000+ pins or 5,000+ followers is obviously
// not brand new no matter what was clicked at onboarding, and an account
// with almost no pins/followers/boards should be paced conservatively
// regardless of its claimed calendar age. Returns null or the middle
// ground where the counters don't clearly indicate either way — those
// stay pinned to whatever tier was already assigned.
function tierFromMetrics(m: PinterestAccountMetrics): PublishingTier | null {
  const pins = m.pinCount ?? 0;
  const followers = m.followerCount ?? 0;
  const boards = m.boardCount ?? 0;
  if (pins > 1000 || followers > 5000) return "established";
  if (pins > 100 || followers > 500 || boards > 8) return "warming";
  if (pins < 5 && followers < 20 && boards < 2) return "new";
  return null;
}

export async function reconcileTier(userId: string, fallbackTier: PublishingTier): Promise<ReconcileResult> {
  const { getIntegration } = await import("./integrations.server");
  const cfg = await getIntegration(userId, "pinterest");
  if (!cfg?.access_token) return { tier: fallbackTier, metrics: null, source: "self_report" };

  const { fetchUserAccount } = await import("./pinterest.server");
  try {
    const metrics = await fetchUserAccount(cfg.access_token);
    const activity = tierFromMetrics(metrics);
    return activity ? { tier: activity, metrics, source: "activity" } : { tier: fallbackTier, metrics, source: "self_report" };
  } catch {
    // Pinterest API hiccup — don't let a transient failure change pacing.
    return { tier: fallbackTier, metrics: null, source: "self_report" };
  }
}

// Called once from the onboarding prompt right after a user answers the
// self-reported age bucket (see publishing-profile.functions.ts). Creates
// the profile row and logs both the "onboarded" event and, if the
// activity counters immediately disagreed with the self-report, a
// "reconciled" event explaining why.
export async function createPublishingProfile(userId: string, selfReported: PublishingTier): Promise<ReconcileResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const result = await reconcileTier(userId, selfReported);

  const { error } = await supabaseAdmin.from("account_publishing_profiles").upsert(
    {
      user_id: userId,
      self_reported_age_bucket: selfReported,
      reconciled_tier: result.tier,
      pinterest_metrics: result.metrics,
      reconciled_at: result.metrics ? new Date().toISOString() : null,
      current_daily_cap: tierCaps(result.tier).maxPerAccountPerDay,
      cap_mode: "auto",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;

  await supabaseAdmin.from("account_cap_events").insert({
    user_id: userId,
    event_type: "onboarded",
    from_tier: null,
    to_tier: result.tier,
    detail: { self_reported: selfReported, metrics: result.metrics, source: result.source },
  });
  if (result.tier !== selfReported) {
    await supabaseAdmin.from("account_cap_events").insert({
      user_id: userId,
      event_type: "reconciled",
      from_tier: selfReported,
      to_tier: result.tier,
      detail: { metrics: result.metrics, reason: "self-report adjusted against Pinterest account activity at onboarding" },
    });
  }
  return result;
}

const RECONCILE_STALE_MS = 24 * 60 * 60 * 1000;

// Called by the nightly materializer before it computes caps for a user.
// Returns null if the user hasn't onboarded (no profile row) — those
// users are simply skipped by the materializer, same as any other
// feature gated behind a one-time setup step. Only hits the Pinterest
// API if the last reconciliation is missing or >24h stale, so a nightly
// run doesn't hammer /v5/user_account for every user every night.
export async function getOrRefreshTier(userId: string): Promise<PublishingTier | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profile } = await supabaseAdmin
    .from("account_publishing_profiles")
    .select("reconciled_tier, reconciled_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) return null;

  const staleAt = profile.reconciled_at ? new Date(profile.reconciled_at).getTime() : 0;
  if (Date.now() - staleAt < RECONCILE_STALE_MS) {
    return profile.reconciled_tier as PublishingTier;
  }

  const currentTier = profile.reconciled_tier as PublishingTier;
  const result = await reconcileTier(userId, currentTier);
  await supabaseAdmin
    .from("account_publishing_profiles")
    .update({
      reconciled_tier: result.tier,
      pinterest_metrics: result.metrics,
      reconciled_at: result.metrics ? new Date().toISOString() : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (result.tier !== currentTier) {
    await supabaseAdmin.from("account_cap_events").insert({
      user_id: userId,
      event_type: "tier_changed",
      from_tier: currentTier,
      to_tier: result.tier,
      detail: { metrics: result.metrics, source: result.source },
    });
  }
  return result.tier;
}


function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

// Called by the nightly materializer to get the actual SafetyLimits to
// schedule against for a user: same shape tierCaps() returns, but with
// maxPerAccountPerDay overridden by whatever's actually in effect —
// current_daily_cap (auto mode, fine-tuned weekly by
// weekly-tier-check.server.ts) or manual_cap (manual mode). Either way
// it's clamped to the SAFETY ceiling so a manual override can never
// exceed the same anti-ban ceiling the manual autoSchedule() tool
// respects. Returns null if the user hasn't onboarded.
export async function getEffectiveLimits(userId: string): Promise<{ tier: PublishingTier; limits: SafetyLimits } | null> {
  const tier = await getOrRefreshTier(userId);
  if (!tier) return null;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profile } = await supabaseAdmin
    .from("account_publishing_profiles")
    .select("current_daily_cap, cap_mode, manual_cap")
    .eq("user_id", userId)
    .maybeSingle();

  const base = tierCaps(tier);
  if (!profile) return { tier, limits: base };

  const rawCap = profile.cap_mode === "manual"
    ? (profile.manual_cap ?? profile.current_daily_cap ?? base.maxPerAccountPerDay)
    : (profile.current_daily_cap ?? base.maxPerAccountPerDay);
  const effectiveCap = clamp(rawCap, 1, SAFETY.maxPerAccountPerDay);

  return { tier, limits: { ...base, maxPerAccountPerDay: effectiveCap } };
}

// Toggling cap_mode is itself an account_cap_events row (reason:
// "manual_override") in both directions — switching to manual is an
// explicit user override worth logging, and switching back to auto is
// just as worth recording so the history reads as a complete story
// instead of having an unexplained gap.
export async function setCapMode(
  userId: string,
  mode: "auto" | "manual",
  manualCap?: number,
): Promise<{ ok: true; cap_mode: "auto" | "manual"; effectiveCap: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profile } = await supabaseAdmin
    .from("account_publishing_profiles")
    .select("cap_mode, current_daily_cap, manual_cap")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) throw new Error("Publishing profile not found — connect Pinterest and complete onboarding first.");

  const nextManualCap = mode === "manual"
    ? clamp(manualCap ?? profile.manual_cap ?? profile.current_daily_cap, 1, SAFETY.maxPerAccountPerDay)
    : profile.manual_cap;

  const fromCap = profile.cap_mode === "manual" ? (profile.manual_cap ?? profile.current_daily_cap) : profile.current_daily_cap;
  const toCap = mode === "manual" ? nextManualCap : profile.current_daily_cap;

  const { error } = await supabaseAdmin
    .from("account_publishing_profiles")
    .update({
      cap_mode: mode,
      manual_cap: nextManualCap,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw error;

  await supabaseAdmin.from("account_cap_events").insert({
    user_id: userId,
    event_type: "manual_override",
    from_cap: fromCap,
    to_cap: toCap,
    detail: { action: mode === "manual" ? "switched_to_manual" : "switched_to_auto" },
  });

  return { ok: true, cap_mode: mode, effectiveCap: toCap };
}
