// Account-wide default image/copy generation CONNECTIONS -- read by
// resolveImageConnection/resolveCopyConnection (provider-resolution
// .server.ts) whenever a specific site has no override connection set
// (sites.image_connection_override_id / copy_connection_override_id is
// null).
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
//
// As of the multi-connection pass, this now stores a specific
// api_key_connections row id per kind, not a provider name -- "account
// default: OpenAI" is really "account default: this ONE OpenAI
// connection," since a provider can now have several. There's no
// hardcoded fallback constant here anymore (unlike the old
// ACCOUNT_PROVIDER_DEFAULTS_FALLBACK): a brand-new account with no row,
// or a row whose connection id is null, genuinely has no default set
// yet -- provider-resolution.server.ts is what decides what happens
// next (this account's earliest-connected key for a last-resort
// provider), not this file.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { IMAGE_PROVIDERS, COPY_PROVIDERS } from "@/lib/sites.functions";

export type AccountProviderDefaults = {
  default_image_connection_id: string | null;
  default_copy_connection_id: string | null;
};

export const getAccountProviderDefaults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccountProviderDefaults> => {
    const { data, error } = await context.supabase
      .from("account_provider_defaults")
      .select("default_image_connection_id, default_copy_connection_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { default_image_connection_id: null, default_copy_connection_id: null };
    return data as AccountProviderDefaults;
  });

export const setAccountProviderDefault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { kind: "image" | "copy"; connectionId: string }) =>
    z.object({ kind: z.enum(["image", "copy"]), connectionId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    // A default must be a connection this account actually owns --
    // the FK on account_provider_defaults only checks that the row
    // exists somewhere, not that it belongs to this user, since this
    // write goes through the service-role client. verifyConnectionOwnership
    // is the actual gate.
    const { verifyConnectionOwnership } = await import("@/lib/api-key-connections.server");
    const allowedProviders = data.kind === "image" ? IMAGE_PROVIDERS : COPY_PROVIDERS;
    await verifyConnectionOwnership(data.connectionId, context.userId, allowedProviders);

    const column = data.kind === "image" ? "default_image_connection_id" : "default_copy_connection_id";
    // RLS-scoped (context.supabase), not supabaseAdmin -- the table's
    // own "own row" policy already permits this upsert, same pattern
    // upsertSite uses for sites.
    const { error } = await context.supabase
      .from("account_provider_defaults")
      .upsert({ user_id: context.userId, [column]: data.connectionId }, { onConflict: "user_id" });
    if (error) throw error;
    return { ok: true };
  });
