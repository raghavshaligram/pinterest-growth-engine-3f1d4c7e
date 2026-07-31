import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PinterestConnectionSummary } from "./pinterest-connections.server";
import type { PinterestEnvironment } from "./pinterest-environment";

// New multi-connection Pinterest surface -- separate from
// integrations.functions.ts's startPinterestOAuth (the original single-
// account flow, unchanged, still used by Settings' existing Pinterest
// publish-mode card and the onboarding wizard's Pinterest step). This
// one always signs state with mode: "connection" so the shared callback
// route (api/public/pinterest.callback.ts) INSERTs a new
// pinterest_connections row instead of upserting the legacy integrations
// row.
//
// environment defaults to "production" -- the only way to reach
// "sandbox" is an explicit input AND PINTEREST_SANDBOX_TOOLS_ENABLED
// being "true" server-side, same real gate addManualPinterestConnection
// already enforces for the manual-token path below. The client-side
// picker that lets a user choose "sandbox" here is hidden unless
// isSandboxToolsEnabled says so too, but (as with the manual path) that
// alone is a UX nicety, not the security boundary -- this handler
// re-checks the env var itself regardless of what the client sends.
export const startPinterestConnectionOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i?: { environment?: PinterestEnvironment }) =>
    z.object({ environment: z.enum(["production", "sandbox"]).default("production") }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    if (data.environment === "sandbox" && process.env.PINTEREST_SANDBOX_TOOLS_ENABLED !== "true") {
      throw new Error("Sandbox tools are not enabled in this environment.");
    }
    const { pinterestAppConfig, signState, buildAuthorizeUrl } = await import("./pinterest-oauth.server");
    const { appId, redirectUri } = pinterestAppConfig();
    const state = signState(context.userId, "settings", "connection", data.environment);
    return { authorizeUrl: buildAuthorizeUrl({ appId, redirectUri, state }) };
  });

// Never returns token_ciphertext -- same rule every credential-holding
// list function in this app follows.
export const listPinterestConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PinterestConnectionSummary[]> => {
    const { listPinterestConnectionsForUser } = await import("./pinterest-connections.server");
    return listPinterestConnectionsForUser(context.userId);
  });

export const renamePinterestConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; label: string }) =>
    z.object({ id: z.string().uuid(), label: z.string().min(1).max(80) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("pinterest_connections")
      .update({ label: data.label, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

// Publish mode lives per-connection, not per-site or account-wide (see
// the pinterest_connections_publish_mode migration's own comment for
// why) -- this is what the new per-connection UI in
// PinterestConnectionsCard saves through.
export const setPinterestConnectionPublishMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; publish_mode: "api" | "webhook"; webhook_url?: string | null }) =>
    z.object({
      id: z.string().uuid(),
      publish_mode: z.enum(["api", "webhook"]),
      webhook_url: z.string().url().nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { setPinterestConnectionPublishModeAndWebhook } = await import("./pinterest-connections.server");
    await setPinterestConnectionPublishModeAndWebhook(data.id, context.userId, data.publish_mode, data.webhook_url ?? null);
    return { ok: true };
  });

// Disconnecting a connection any site currently maps to leaves that
// site's pinterest_connection_id nulled via the FK's ON DELETE SET NULL
// (see the migration) -- the site's Connections card then reads a null
// id and shows "Not connected" / prompts to re-pick, same pattern as
// disconnecting a Google connection.
export const disconnectPinterestConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("pinterest_connections")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

// Client-side gate check for the manual sandbox-token form below --
// this alone is NOT the real gate (a direct call to
// addManualPinterestConnection re-checks the same env var server-side
// regardless of what this returns), it only controls whether the form
// renders at all so a production deployment doesn't show dev tooling
// that would just fail on submit.
export const isSandboxToolsEnabled = createServerFn({ method: "GET" })
  .handler(async () => {
    return { enabled: process.env.PINTEREST_SANDBOX_TOOLS_ENABLED === "true" };
  });

// Dev-only escape hatch: creates a sandbox Pinterest connection from a
// manually-pasted token, e.g. the 30-day quick token Pinterest's own My
// Apps page can generate directly with no OAuth redirect at all --
// https://developers.pinterest.com/docs/developer-tools/sandbox/#step-2-generate-a-sandbox-access-token.
// Real gate is server-side: PINTEREST_SANDBOX_TOOLS_ENABLED must be
// "true" or this throws outright, so it can't be reached in a real
// deployment just because someone found the client-side form.
//
// Always environment: "sandbox", token_source: "manual", and an empty
// refresh_token -- Pinterest issues no refresh_token for these tokens
// at all. getValidPinterestAccessToken and
// refreshPinterestConnectionsNearingExpiry both already know to treat
// token_source: "manual" as unrefreshable rather than assuming a
// refresh_token is ever present.
export const addManualPinterestConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { label?: string; accessToken: string; expiresInDays?: number }) =>
    z.object({
      label: z.string().min(1).max(80).optional(),
      accessToken: z.string().min(1),
      // Pinterest's own quick-token generator issues 30-day tokens --
      // allowing a shorter, explicit value covers a token the dev knows
      // expires sooner (e.g. one pulled from an OAuth sandbox exchange
      // manually) without ever allowing a wrong, longer-than-real value.
      expiresInDays: z.number().int().min(1).max(30).default(30),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    if (process.env.PINTEREST_SANDBOX_TOOLS_ENABLED !== "true") {
      throw new Error("Sandbox tools are not enabled in this environment.");
    }
    const { encrypt } = await import("./crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchPinterestUsername } = await import("./pinterest-oauth.server");

    const storedTokens = {
      access_token: data.accessToken,
      refresh_token: "", // Pinterest issues none for a manually-generated sandbox token
      access_token_expires_at: Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000,
    };
    // Best-effort label from the account itself, same courtesy the real
    // OAuth connect flow gets -- never blocks the connection if it fails
    // (a bad/expired pasted token, a network hiccup, etc.).
    const username = await fetchPinterestUsername(data.accessToken, "sandbox");
    const label = data.label || (username ? `@${username} (sandbox)` : "Sandbox connection");

    const { error } = await supabaseAdmin.from("pinterest_connections").insert({
      user_id: context.userId,
      label,
      pinterest_username: username,
      token_ciphertext: encrypt(JSON.stringify(storedTokens)),
      refresh_token_expires_at: null,
      environment: "sandbox",
      token_source: "manual",
    });
    if (error) throw error;
    return { ok: true };
  });
