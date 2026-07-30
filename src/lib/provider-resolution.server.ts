// Server-only. Resolves the EFFECTIVE image/copy generation provider
// for a given site: that site's own override if it has one, otherwise
// the account-level default, otherwise a hardcoded fallback for a
// brand-new account that's never configured anything (mirrors
// account-provider-defaults.functions.ts's own
// ACCOUNT_PROVIDER_DEFAULTS_FALLBACK -- kept as a literal here too
// rather than importing across the client/server boundary awkwardly,
// since this file already needs its own supabaseAdmin import anyway).
//
// Used by every real call site that used to read site.image_provider/
// copy_provider directly (image-worker.server.ts, briefs.functions.ts,
// pin-style-setup.functions.ts) -- those columns are gone; this is the
// only place "which provider does this site actually use" gets decided
// now.
import type { ImageProvider, CopyProvider } from "@/lib/sites.functions";

export async function resolveImageProvider(
  userId: string,
  siteOverride: ImageProvider | null | undefined,
): Promise<ImageProvider> {
  if (siteOverride) return siteOverride;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("account_provider_defaults")
    .select("default_image_provider")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.default_image_provider as ImageProvider | undefined) ?? "openai";
}

export async function resolveCopyProvider(
  userId: string,
  siteOverride: CopyProvider | null | undefined,
): Promise<CopyProvider> {
  if (siteOverride) return siteOverride;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("account_provider_defaults")
    .select("default_copy_provider")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.default_copy_provider as CopyProvider | undefined) ?? "openai";
}
