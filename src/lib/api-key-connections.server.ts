// Server-only. Multi-connection storage/resolution for the 8 API-key
// providers surfaced in the consolidated Image Generation / Copy
// Generation cards (openai, replicate, fal, gemini, ideogram, recraft,
// stability, anthropic) -- extends the same "labeled, multi-row per
// user" pattern pinterest-connections.server.ts and
// google-analytics.server.ts already established, applied to plain
// API-key credentials instead of OAuth tokens.
//
// Deliberately separate from integrations.server.ts, which still owns
// Apify + Pinterest's legacy single-account row (both explicitly out
// of scope for this table -- see the migration's own comment). Nothing
// in this file ever touches the `integrations` table.
import { decrypt } from "./crypto.server";

// The 8 providers this table covers. Kept as a plain literal union
// here (not re-exported from sites.functions.ts's ImageProvider/
// CopyProvider, which are image-only/copy-only subsets) since a
// connection's provider spans both -- e.g. an OpenAI connection is
// valid for either card.
export const API_KEY_PROVIDERS = [
  "openai", "replicate", "fal", "gemini", "ideogram", "recraft", "stability", "anthropic",
] as const;
export type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number];

// Replicate is the one provider in this set keyed on api_token instead
// of api_key (matching how its own docs refer to the credential,
// same distinction integrations.functions.ts's old CREDENTIAL_FIELD
// map made) -- every other provider here is api_key.
export const CREDENTIAL_FIELD: Record<ApiKeyProvider, "api_key" | "api_token"> = {
  openai: "api_key",
  replicate: "api_token",
  fal: "api_key",
  gemini: "api_key",
  ideogram: "api_key",
  recraft: "api_key",
  stability: "api_key",
  anthropic: "api_key",
};

export type ApiKeyConnectionSummary = {
  id: string;
  provider: ApiKeyProvider;
  label: string;
  status: "unconfigured" | "ok" | "error";
  last_error: string | null;
  connected_at: string;
};

export type ResolvedConnection = {
  connectionId: string;
  provider: ApiKeyProvider;
  apiKey: string;
};

// Never returns config_ciphertext -- same rule every credential list
// function in this app follows (listPinterestConnections,
// listGoogleConnections, the old listIntegrations).
export async function listApiKeyConnectionsForUser(userId: string): Promise<ApiKeyConnectionSummary[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("api_key_connections")
    .select("id, provider, label, status, last_error, connected_at")
    .eq("user_id", userId)
    .order("connected_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ApiKeyConnectionSummary[];
}

// Internal: decrypts one connection's credential for actual use at
// generation time. Returns null (not a throw) on any not-found/
// corrupt/missing-credential condition -- callers decide what "no
// usable connection here" means (fall through to account default,
// fall through to a last-resort provider, or a final clear error).
export async function getDecryptedConnection(
  connectionId: string,
  userId: string,
): Promise<ResolvedConnection | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("api_key_connections")
    .select("id, provider, config_ciphertext")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  try {
    const cfg = JSON.parse(decrypt(data.config_ciphertext)) as Record<string, string | undefined>;
    const field = CREDENTIAL_FIELD[data.provider as ApiKeyProvider];
    const apiKey = cfg[field];
    if (!apiKey) return null;
    return { connectionId: data.id, provider: data.provider as ApiKeyProvider, apiKey };
  } catch {
    return null; // corrupt/unreadable ciphertext -- treat as unusable, not a hard crash
  }
}

// Account-wide "give me a working key for this provider" lookup. Picks
// the EARLIEST-connected connection for that provider (i.e. whichever
// one would have been "My key" from the original single-key
// migration, if one exists) -- a stable, deterministic choice rather
// than an arbitrary one. Two callers: onboarding.functions.ts's
// hasTextProviderCredential, which needs a plain per-provider
// existence check (not a full resolution) to answer "is ANY text
// provider connected at all"; and provider-resolution.server.ts's
// resolve(), as its own last-resort fallback -- tried once per
// provider in its ordered fallback list -- when neither a site
// override nor an account default connection resolves to anything
// usable. Page analysis (pages.functions.ts), copy generation
// (briefs.functions.ts), and the SERP-pattern summarizer
// (keywords.functions.ts) no longer call this directly -- all three go
// through resolveCopyConnection (provider-resolution.server.ts) so
// they resolve to whichever text provider the account actually has
// configured, not a hardcoded one.
export async function earliestConnectionForProvider(
  userId: string,
  provider: ApiKeyProvider,
): Promise<ResolvedConnection | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("api_key_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", provider)
    .order("connected_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return getDecryptedConnection(data.id, userId);
}

// Confirms a connection id genuinely belongs to this user (and,
// optionally, is one of an allowed provider set) before it's written
// into account_provider_defaults or a site's override column. Both of
// those writes go through supabaseAdmin (RLS-scoped inserts wouldn't
// otherwise stop a request from naming a connection id the caller
// doesn't own -- the FK only checks existence, not ownership), so this
// check is what actually prevents a user pointing their default/
// override at someone else's connection.
export async function verifyConnectionOwnership(
  connectionId: string,
  userId: string,
  allowedProviders?: readonly ApiKeyProvider[],
): Promise<ApiKeyProvider> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("api_key_connections")
    .select("provider")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("That connection doesn't exist or isn't yours.");
  const provider = data.provider as ApiKeyProvider;
  if (allowedProviders && !allowedProviders.includes(provider)) {
    throw new Error(`That connection is a ${provider} key, which isn't valid here.`);
  }
  return provider;
}

// Status-tracking equivalent of integrations.server.ts's
// markIntegration, scoped to one specific connection row instead of a
// (user, provider) pair -- required now that a provider can have
// several rows, so "this generation attempt succeeded/failed" must
// record against the ONE connection actually used, not every row for
// that provider.
export async function markApiKeyConnection(
  connectionId: string,
  status: "ok" | "error",
  error?: string,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("api_key_connections")
    .update({ status, last_error: error ?? null, last_used_at: new Date().toISOString() })
    .eq("id", connectionId);
}
