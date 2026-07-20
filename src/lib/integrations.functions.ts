import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Kicks off OAuth against Pinspider's single shared Pinterest app (app
// credentials + redirect URI come from deployment env vars — see
// pinterest-oauth.server.ts:pinterestAppConfig). No per-user setup needed
// beyond clicking Connect.
export const startPinterestOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { pinterestAppConfig, signState, buildAuthorizeUrl } = await import("./pinterest-oauth.server");
    const { appId, redirectUri } = pinterestAppConfig();
    const state = signState(context.userId);
    return {
      authorizeUrl: buildAuthorizeUrl({ appId, redirectUri, state }),
      redirectUri,
    };
  });

const providerSchema = z.enum(["openai", "replicate", "apify", "pinterest"]);
type ProviderName = z.infer<typeof providerSchema>;

// Credential fields are optional at the schema level for every provider —
// this lets a partial save go through (e.g. just updating Apify's actor_id,
// or flipping Pinterest's publish_mode) without forcing the caller to
// resupply a field that's already stored. saveIntegration enforces "must
// have SOME value, from this request or the existing config" itself, at
// the merge step below, using CREDENTIAL_FIELD.
const configShapes = {
  openai: z.object({ api_key: z.string().min(10).optional() }),
  replicate: z.object({ api_token: z.string().min(10).optional() }),
  apify: z.object({ api_token: z.string().min(10).optional(), actor_id: z.string().optional() }),
  pinterest: z.object({
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    publish_mode: z.enum(["api", "webhook"]).optional(),
    webhook_url: z.string().url().optional(),
  }),
} as const;

// The one field per provider that represents "a credential is actually
// configured" — used both to reject a save that would leave the provider
// with no credential at all, and (in listIntegrations) to tell the client
// whether a value exists without ever sending the value itself. Pinterest
// is null here because its access_token is never submitted through this
// form — it's written by the OAuth callback route directly.
const CREDENTIAL_FIELD: Record<ProviderName, string | null> = {
  openai: "api_key",
  replicate: "api_token",
  apify: "api_token",
  pinterest: null,
};

// Returns has_value alongside the usual status metadata — never the
// credential itself. config_ciphertext is decrypted in-process to compute
// the boolean and then discarded; it's not part of the returned shape.
export const listIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("integrations")
      .select("provider, status, last_used_at, last_error, updated_at, config_ciphertext");
    if (error) throw error;
    const { decrypt } = await import("./crypto.server");
    return (data ?? []).map((row) => {
      const { config_ciphertext, provider, ...rest } = row;
      const field = CREDENTIAL_FIELD[provider as ProviderName];
      let has_value = false;
      if (field) {
        try {
          const cfg = JSON.parse(decrypt(config_ciphertext)) as Record<string, unknown>;
          has_value = Boolean(cfg[field]);
        } catch {
          has_value = false;
        }
      }
      return { provider, ...rest, has_value };
    });
  });

export const saveIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { provider: string; config: unknown }) => ({
    provider: providerSchema.parse(input.provider),
    config: input.config as Record<string, unknown>,
  }))
  .handler(async ({ data, context }) => {
    const shape = configShapes[data.provider];
    const parsed = shape.parse(data.config);
    const { encrypt, decrypt } = await import("./crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Merge onto whatever's already stored instead of replacing the whole
    // config. The client never gets secret values back (e.g. access_token,
    // app_secret aren't returned by listIntegrations), so a partial save —
    // like just flipping publish_mode, or fixing one field — must not wipe
    // fields the caller didn't send.
    const { data: existingRow } = await supabaseAdmin
      .from("integrations")
      .select("config_ciphertext")
      .eq("user_id", context.userId)
      .eq("provider", data.provider)
      .maybeSingle();
    const existing = existingRow ? (JSON.parse(decrypt(existingRow.config_ciphertext)) as Record<string, unknown>) : {};
    const merged: Record<string, unknown> = { ...existing, ...parsed };

    // Now that credential fields are optional at the schema level (so a
    // partial save can go through at all), enforce here that the provider
    // ends up with SOME credential — either just-submitted or already
    // stored — instead of silently persisting a config with no usable key.
    const requiredField = CREDENTIAL_FIELD[data.provider];
    if (requiredField && !merged[requiredField]) {
      throw new Error(`${requiredField} is required — enter a value before saving.`);
    }

    const ciphertext = encrypt(JSON.stringify(merged));
    const { error } = await supabaseAdmin.from("integrations").upsert(
      {
        user_id: context.userId,
        provider: data.provider,
        config_ciphertext: ciphertext,
        status: "unconfigured",
        last_error: null,
      },
      { onConflict: "user_id,provider" },
    );
    if (error) throw error;
    return { ok: true };
  });

// Non-secret read of the Pinterest publish mode + webhook URL, safe to
// expose to the client (unlike access_token, which never leaves the
// server — webhook_url is just a URL the user typed in themselves, so
// showing it back to them is fine). Used by the Integrations page to
// render the current API/Webhook selection and prefill the webhook field.
export const getPinterestSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getIntegration } = await import("./integrations.server");
    const cfg = await getIntegration(context.userId, "pinterest");
    return {
      publish_mode: (cfg?.publish_mode === "webhook" ? "webhook" : "api") as "api" | "webhook",
      webhook_url: cfg?.webhook_url ?? null,
    };
  });

export const deleteIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { provider: string }) => ({ provider: providerSchema.parse(input.provider) }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("integrations")
      .delete()
      .eq("user_id", context.userId)
      .eq("provider", data.provider);
    if (error) throw error;
    return { ok: true };
  });

export const testIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { provider: string }) => ({ provider: providerSchema.parse(input.provider) }))
  .handler(async ({ data, context }) => {
    const { getIntegration, markIntegration } = await import("./integrations.server");
    const cfg = await getIntegration(context.userId, data.provider);
    if (!cfg) return { ok: false, message: "Not configured" };

    try {
      if (data.provider === "openai") {
        const r = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${(cfg as { api_key: string }).api_key}` },
        });
        if (!r.ok) throw new Error(`OpenAI: HTTP ${r.status}`);
      } else if (data.provider === "replicate") {
        const r = await fetch("https://api.replicate.com/v1/account", {
          headers: { Authorization: `Bearer ${(cfg as { api_token: string }).api_token}` },
        });
        if (!r.ok) throw new Error(`Replicate: HTTP ${r.status}`);
      } else if (data.provider === "apify") {
        const r = await fetch(`https://api.apify.com/v2/users/me?token=${encodeURIComponent((cfg as { api_token: string }).api_token)}`);
        if (!r.ok) throw new Error(`Apify: HTTP ${r.status}`);
      } else if (data.provider === "pinterest") {
        const token = (cfg as { access_token?: string }).access_token;
        if (!token) throw new Error("No access token set");
        const r = await fetch("https://api.pinterest.com/v5/user_account", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`Pinterest: HTTP ${r.status}`);
      }
      await markIntegration(context.userId, data.provider, "ok");
      return { ok: true, message: "Connected" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markIntegration(context.userId, data.provider, "error", msg);
      return { ok: false, message: msg };
    }
  });
