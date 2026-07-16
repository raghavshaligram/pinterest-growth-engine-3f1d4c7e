import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const startPinterestOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getIntegration } = await import("./integrations.server");
    const cfg = await getIntegration(context.userId, "pinterest");
    if (!cfg?.app_id || !cfg?.app_secret) {
      throw new Error("Save your Pinterest App ID and App Secret first, then click Connect.");
    }
    const { signState, buildAuthorizeUrl } = await import("./pinterest-oauth.server");
    const req = getRequest();
    const origin = new URL(req.url).origin;
    const redirectUri = `${origin}/api/public/pinterest/callback`;
    const state = signState(context.userId);
    return {
      authorizeUrl: buildAuthorizeUrl({ appId: cfg.app_id, redirectUri, state }),
      redirectUri,
    };
  });

export const getPinterestRedirectUri = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const req = getRequest();
    const origin = new URL(req.url).origin;
    return { redirectUri: `${origin}/api/public/pinterest/callback` };
  });

const providerSchema = z.enum(["openai", "replicate", "apify", "pinterest"]);

const configShapes = {
  openai: z.object({ api_key: z.string().min(10) }),
  replicate: z.object({ api_token: z.string().min(10) }),
  apify: z.object({ api_token: z.string().min(10), actor_id: z.string().optional() }),
  pinterest: z.object({
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    app_id: z.string().optional(),
    app_secret: z.string().optional(),
  }),
} as const;

export const listIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("integrations")
      .select("provider, status, last_used_at, last_error, updated_at");
    if (error) throw error;
    return data ?? [];
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
    const { encrypt } = await import("./crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ciphertext = encrypt(JSON.stringify(parsed));
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
