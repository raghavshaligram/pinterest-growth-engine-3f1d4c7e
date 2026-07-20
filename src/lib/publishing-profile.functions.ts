import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SAFETY } from "./scheduling-safety.server";

// Whether the current user has answered the post-connect onboarding
// prompt yet. Used by settings.integrations.tsx to decide whether to
// show it after a successful Pinterest OAuth connect.
export const getPublishingProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("account_publishing_profiles")
      .select("self_reported_age_bucket, reconciled_tier, onboarded_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  });

// Saves the user's answer to the 3-option onboarding prompt and
// immediately reconciles it against Pinterest account activity (see
// publishing-profile.server.ts:createPublishingProfile). The nightly
// materializer reads the resulting reconciled_tier, not the raw
// self-report, to size daily caps.
export const savePublishingProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { ageBucket: "new" | "warming" | "established" }) =>
    z.object({ ageBucket: z.enum(["new", "warming", "established"]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { createPublishingProfile } = await import("./publishing-profile.server");
    const result = await createPublishingProfile(context.userId, data.ageBucket);
    return { tier: result.tier, adjusted: result.tier !== data.ageBucket };
  });

// Powers the Account Health card in settings.integrations.tsx: current
// tier/cap/mode plus a reverse-chronological history of every
// account_cap_events row (onboarding, tier drift, weekly age/consistency/
// error adjustments, manual toggles).
export const getAccountHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile, error: profileErr } = await context.supabase
      .from("account_publishing_profiles")
      .select("reconciled_tier, current_daily_cap, cap_mode, manual_cap, onboarded_at, reconciled_at, last_cap_check_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (profileErr) throw profileErr;

    const { data: events, error: eventsErr } = await context.supabase
      .from("account_cap_events")
      .select("id, event_type, from_tier, to_tier, from_cap, to_cap, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(25);
    if (eventsErr) throw eventsErr;

    return { profile: profile ?? null, events: events ?? [] };
  });

// Flips cap_mode between "auto" (weekly-tier-check.server.ts adjusts
// current_daily_cap) and "manual" (user-set manual_cap is used instead,
// and the weekly job leaves current_daily_cap untouched). Either
// direction logs its own account_cap_events row — see
// publishing-profile.server.ts:setCapMode.
export const setCapMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { mode: "auto" | "manual"; manualCap?: number }) =>
    z.object({
      mode: z.enum(["auto", "manual"]),
      manualCap: z.number().int().min(1).max(SAFETY.maxPerAccountPerDay).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { setCapMode: setCapModeImpl } = await import("./publishing-profile.server");
    return await setCapModeImpl(context.userId, data.mode, data.manualCap);
  });
