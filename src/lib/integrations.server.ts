// Server-only helpers to read integration configs.
import { decrypt } from "./crypto.server";

export type OpenAIConfig = { api_key: string };
export type ReplicateConfig = { api_token: string };
export type ApifyConfig = { api_token: string; actor_id?: string };
export type PinterestConfig = {
  // Populated from Pinspider's shared OAuth app (see pinterest-oauth.server.ts
  // :pinterestAppConfig) once the user authorizes via Connect Pinterest.
  // There's no per-user app_id/app_secret anymore — the app credentials are
  // deployment-level env vars (PINTEREST_APP_ID / PINTEREST_APP_SECRET /
  // PINTEREST_REDIRECT_URI), never stored per user.
  access_token?: string;
  refresh_token?: string;
  // "api" (default, direct Pinterest v5 publishing) or "webhook" (routes
  // through the user's own automation URL below). See
  // pinterest.server.ts:makePinterestClient.
  publish_mode?: "api" | "webhook";
  // Only used when publish_mode is "webhook" — the user's own automation
  // endpoint (e.g. a Make.com or Zapier catch hook).
  webhook_url?: string;
};
export type ProviderConfig = {
  openai: OpenAIConfig;
  replicate: ReplicateConfig;
  apify: ApifyConfig;
  pinterest: PinterestConfig;
};
export type Provider = keyof ProviderConfig;

export const DEFAULT_APIFY_ACTOR = "fatihtahta~pinterest-scraper-search";

export async function getIntegration<P extends Provider>(
  userId: string,
  provider: P,
): Promise<ProviderConfig[P] | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select("config_ciphertext")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return JSON.parse(decrypt(data.config_ciphertext)) as ProviderConfig[P];
}

export async function requireIntegration<P extends Provider>(
  userId: string,
  provider: P,
): Promise<ProviderConfig[P]> {
  const cfg = await getIntegration(userId, provider);
  if (!cfg) throw new Error(`Missing ${provider} integration — add it in Settings.`);
  return cfg;
}

export async function markIntegration(
  userId: string,
  provider: Provider,
  status: "ok" | "error",
  error?: string,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("integrations")
    .update({
      status,
      last_error: error ?? null,
      last_used_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", provider);
}
