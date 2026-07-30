import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getErrorMessage } from "@/lib/error-message";
import {
  API_KEY_PROVIDERS, CREDENTIAL_FIELD, type ApiKeyProvider, type ApiKeyConnectionSummary,
} from "./api-key-connections.server";

const providerSchema = z.enum(API_KEY_PROVIDERS);

// Never returns config_ciphertext -- same rule every credential list
// function in this app follows.
export const listApiKeyConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ApiKeyConnectionSummary[]> => {
    const { listApiKeyConnectionsForUser } = await import("./api-key-connections.server");
    return listApiKeyConnectionsForUser(context.userId);
  });

// Creates a NEW, separate connection for this provider -- this is what
// "+ Add another key" (and, for a brand-new account, the very first
// key) calls. Distinct from updateApiKeyConnection below, which edits
// an EXISTING row's credential in place.
export const addApiKeyConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { provider: string; label?: string; config: Record<string, unknown> }) => ({
    provider: providerSchema.parse(i.provider),
    label: (i.label ?? "My key").trim().slice(0, 80) || "My key",
    config: i.config,
  }))
  .handler(async ({ data, context }) => {
    const field = CREDENTIAL_FIELD[data.provider];
    const value = data.config[field];
    if (typeof value !== "string" || value.trim().length < 10) {
      throw new Error(`${field} is required — enter a value before saving.`);
    }
    const { encrypt } = await import("./crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ciphertext = encrypt(JSON.stringify({ [field]: value.trim() }));
    const { data: inserted, error } = await supabaseAdmin
      .from("api_key_connections")
      .insert({ user_id: context.userId, provider: data.provider, label: data.label, config_ciphertext: ciphertext })
      .select("id")
      .single();
    if (error || !inserted) throw error ?? new Error("Could not save this key.");
    return { id: inserted.id as string };
  });

// Rotates ONE specific existing connection's credential. Blank input
// keeps the existing value -- same "partial save allowed" convention
// the old saveIntegration used, since the client never gets the
// current value back to prefill.
export const updateApiKeyConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; config: Record<string, unknown> }) =>
    z.object({ id: z.string().uuid(), config: z.record(z.string(), z.unknown()) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encrypt } = await import("./crypto.server");
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("api_key_connections")
      .select("provider")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing) throw new Error("Connection not found");
    const field = CREDENTIAL_FIELD[existing.provider as ApiKeyProvider];
    const value = data.config[field];
    if (typeof value !== "string" || !value.trim()) {
      return { ok: true }; // nothing submitted -- keep the existing key as-is
    }
    const ciphertext = encrypt(JSON.stringify({ [field]: value.trim() }));
    const { error } = await supabaseAdmin
      .from("api_key_connections")
      .update({ config_ciphertext: ciphertext, status: "unconfigured", last_error: null, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const renameApiKeyConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; label: string }) =>
    z.object({ id: z.string().uuid(), label: z.string().min(1).max(80) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("api_key_connections")
      .update({ label: data.label, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

// Disconnecting a connection any site/account-default currently points
// at leaves that reference null via ON DELETE SET NULL (see the
// migration) -- same pattern disconnecting a Pinterest/Google
// connection already follows.
export const deleteApiKeyConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("api_key_connections")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

// Real per-provider connectivity checks -- moved here verbatim from
// integrations.functions.ts's old testIntegration (see that file's
// trimmed-down providerSchema for why: these 8 providers no longer
// live in the `integrations` table at all). Same evidence-based
// distinction as before: openai/replicate/gemini/anthropic/stability
// have a confirmed free/zero-cost endpoint to really ping; fal/
// ideogram/recraft don't (per this app's provider research), so those
// three only confirm a key is saved, same as before.
export const testApiKeyConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { getDecryptedConnection, markApiKeyConnection } = await import("./api-key-connections.server");
    const conn = await getDecryptedConnection(data.id, context.userId);
    if (!conn) return { ok: false, message: "Not configured" };

    try {
      if (conn.provider === "openai") {
        const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${conn.apiKey}` } });
        if (!r.ok) throw new Error(`OpenAI: HTTP ${r.status}`);
      } else if (conn.provider === "replicate") {
        const r = await fetch("https://api.replicate.com/v1/account", { headers: { Authorization: `Bearer ${conn.apiKey}` } });
        if (!r.ok) throw new Error(`Replicate: HTTP ${r.status}`);
      } else if (conn.provider === "gemini") {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(conn.apiKey)}`);
        if (!r.ok) throw new Error(`Gemini: HTTP ${r.status}`);
      } else if (conn.provider === "anthropic") {
        const r = await fetch("https://api.anthropic.com/v1/models", {
          headers: { "x-api-key": conn.apiKey, "anthropic-version": "2023-06-01" },
        });
        if (!r.ok) throw new Error(`Anthropic: HTTP ${r.status}`);
      } else if (conn.provider === "stability") {
        const r = await fetch("https://api.stability.ai/v1/user/account", { headers: { Authorization: `Bearer ${conn.apiKey}` } });
        if (!r.ok) throw new Error(`Stability AI: HTTP ${r.status}`);
      } else {
        // fal / ideogram / recraft -- no confirmed zero-cost account/
        // whoami endpoint found during integration research; confirming
        // real connectivity risks either guessing a wrong endpoint or
        // triggering a paid generation call. Real connectivity is
        // confirmed the first time a pin actually generates through it.
        if (conn.apiKey.length < 10) throw new Error("No API key saved");
        await markApiKeyConnection(conn.connectionId, "ok");
        return { ok: true, message: "Key saved -- full connectivity confirmed on first use" };
      }
      await markApiKeyConnection(conn.connectionId, "ok");
      return { ok: true, message: "Connected" };
    } catch (e) {
      const msg = getErrorMessage(e);
      await markApiKeyConnection(conn.connectionId, "error", msg);
      return { ok: false, message: msg };
    }
  });
