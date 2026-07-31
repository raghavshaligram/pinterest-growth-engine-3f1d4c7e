// Server-only. Resolves the EFFECTIVE image/copy generation CONNECTION
// (a specific api_key_connections row -- provider + decrypted key, not
// just a provider name) for a given site: that site's own override
// connection if it has one, otherwise the account-level default
// connection, otherwise this account's earliest-connected key for the
// first of a hardcoded, ORDERED list of fallback providers that's
// actually connected, for a brand-new account that's never explicitly
// set anything. If none of those exist either, there's genuinely no
// usable credential yet and callers get a clear error rather than a
// silent no-op.
//
// Used by every real call site that needs "which credential does this
// site actually generate with" (image-worker.server.ts,
// briefs.functions.ts, pages.functions.ts, pin-style-setup.functions.ts)
// -- these used to separately resolve a provider NAME and then fetch its
// (single, account-wide) `integrations` row; now that a provider can
// have several connections, resolution and credential lookup are one
// step, since "which provider" and "which specific key" are decided
// together.
import { earliestConnectionForProvider, getDecryptedConnection, type ApiKeyProvider, type ResolvedConnection } from "@/lib/api-key-connections.server";

async function resolve(
  userId: string,
  siteOverrideConnectionId: string | null | undefined,
  accountDefaultColumn: "default_image_connection_id" | "default_copy_connection_id",
  fallbackProviders: readonly ApiKeyProvider[],
): Promise<ResolvedConnection> {
  if (siteOverrideConnectionId) {
    const c = await getDecryptedConnection(siteOverrideConnectionId, userId);
    if (c) return c;
    // The FK's ON DELETE SET NULL means a site's override can't
    // normally point at a since-deleted connection -- if this ever
    // happens anyway (corrupt ciphertext, race condition), fall
    // through to the account default rather than hard-failing on
    // something that should be self-healing.
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: defaults } = await supabaseAdmin
    .from("account_provider_defaults")
    .select(accountDefaultColumn)
    .eq("user_id", userId)
    .maybeSingle();
  const defaultConnectionId = (defaults as Record<string, string | null> | null)?.[accountDefaultColumn];
  if (defaultConnectionId) {
    const c = await getDecryptedConnection(defaultConnectionId, userId);
    if (c) return c;
  }

  // Tries each fallback provider IN ORDER, first match wins -- for
  // images this list has always been a single element ("openai"), so
  // behavior there is byte-for-byte unchanged. For copy, this is what
  // actually closes the gap for an account that's connected an
  // Anthropic key but never explicitly set it as their account/site
  // default: without this, such an account would pass the
  // text_provider_connected checklist step (onboarding.functions.ts's
  // hasTextProviderCredential, which correctly checks both providers)
  // but then hit this exact function's OLD single-provider ("openai")
  // fallback and fail here anyway -- readyToGenerate would say "ready"
  // while actual generation threw. "openai" stays first in
  // COPY_PROVIDERS (sites.functions.ts) specifically so an account with
  // both connected but no explicit default keeps today's existing
  // OpenAI-first behavior, unchanged.
  for (const provider of fallbackProviders) {
    const fallback = await earliestConnectionForProvider(userId, provider);
    if (fallback) return fallback;
  }

  throw new Error(
    `No image or copy generation provider is connected yet for this account -- add one in Settings > Integrations.`,
  );
}

export async function resolveImageConnection(
  userId: string,
  siteOverrideConnectionId: string | null | undefined,
): Promise<ResolvedConnection> {
  return resolve(userId, siteOverrideConnectionId, "default_image_connection_id", ["openai"]);
}

export async function resolveCopyConnection(
  userId: string,
  siteOverrideConnectionId: string | null | undefined,
): Promise<ResolvedConnection> {
  const { COPY_PROVIDERS } = await import("./sites.functions");
  return resolve(userId, siteOverrideConnectionId, "default_copy_connection_id", COPY_PROVIDERS);
}
