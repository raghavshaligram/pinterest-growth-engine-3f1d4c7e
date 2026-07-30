// Account-wide default image/copy generation providers -- read by
// resolveImageProvider/resolveCopyProvider (provider-resolution.server.ts)
// whenever a specific site has no override set (sites.image_provider_override
// / copy_provider_override is null).
//
// Deliberately its own small table (account_provider_defaults), NOT a
// couple of extra columns bolted onto account_publishing_profiles.
// That table's other columns (reconciled_tier, cap_mode, onboarded_at,
// current_daily_cap) are all part of the Pinterest-publishing-cadence/
// cap-reconciliation system -- setCapMode explicitly refuses to run
// before that row exists ("connect Pinterest and complete onboarding
// first"), and the weekly tier-check job assumes every row in that
// table represents a real, Pinterest-active account. Generation
// provider defaults are a genuinely separate concern (a user should be
// able to set which model renders their pins before ever touching
// Pinterest), so tying it to that row's existence/lifecycle would
// either block this feature on an unrelated flow or risk a stray row
// confusing the cap-reconciliation jobs. A dedicated table has no such
// coupling.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { IMAGE_PROVIDERS, COPY_PROVIDERS, type ImageProvider, type CopyProvider } from "@/lib/sites.functions";

export type AccountProviderDefaults = {
  default_image_provider: ImageProvider;
  default_copy_provider: CopyProvider;
};

// Used both when no row exists yet (brand-new account, never explicitly
// set anything) and as provider-resolution.server.ts's own last-resort
// fallback -- kept in sync with the DB columns' own DEFAULT 'openai' so
// there's exactly one "what does a totally fresh account get" answer.
export const ACCOUNT_PROVIDER_DEFAULTS_FALLBACK: AccountProviderDefaults = {
  default_image_provider: "openai",
  default_copy_provider: "openai",
};

export const getAccountProviderDefaults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccountProviderDefaults> => {
    const { data, error } = await context.supabase
      .from("account_provider_defaults")
      .select("default_image_provider, default_copy_provider")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return ACCOUNT_PROVIDER_DEFAULTS_FALLBACK;
    return data as AccountProviderDefaults;
  });

export const setAccountProviderDefault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { kind: "image" | "copy"; provider: string }) => {
    const kind = z.enum(["image", "copy"]).parse(i.kind);
    const provider = kind === "image" ? z.enum(IMAGE_PROVIDERS).parse(i.provider) : z.enum(COPY_PROVIDERS).parse(i.provider);
    return { kind, provider };
  })
  .handler(async ({ data, context }) => {
    const column = data.kind === "image" ? "default_image_provider" : "default_copy_provider";
    // RLS-scoped (context.supabase), not supabaseAdmin -- the table's
    // own "own row" policy already permits this upsert, same pattern
    // upsertSite uses for sites.
    const { error } = await context.supabase
      .from("account_provider_defaults")
      .upsert({ user_id: context.userId, [column]: data.provider }, { onConflict: "user_id" });
    if (error) throw error;
    return { ok: true };
  });
