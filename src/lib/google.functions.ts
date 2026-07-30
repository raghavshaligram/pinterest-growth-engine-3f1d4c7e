import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Kicks off OAuth against Pinspider's single shared Google Cloud OAuth
// client (app credentials + redirect URI come from deployment env vars
// -- see google-oauth.server.ts:googleAppConfig). Every call creates a
// NEW connection row on successful return (see google.callback.ts) --
// there's no per-user cap, matching the agency use case of connecting
// several Google accounts under one Pinspider login.
export const startGoogleOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i?: { returnTo?: "settings" | "onboarding" }) =>
    z.object({ returnTo: z.enum(["settings", "onboarding"]).default("settings") }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { googleAppConfig, signState, buildAuthorizeUrl } = await import("./google-oauth.server");
    const { clientId, redirectUri } = googleAppConfig();
    const state = signState(context.userId, data.returnTo);
    return { authorizeUrl: buildAuthorizeUrl({ clientId, redirectUri, state }) };
  });

export type GoogleConnectionSummary = {
  id: string;
  label: string;
  google_email: string | null;
  connected_at: string;
};

// Never returns token_ciphertext -- same "never send the credential
// itself to the client" rule every other integration in this app
// follows (see integrations.functions.ts:listIntegrations).
export const listGoogleConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GoogleConnectionSummary[]> => {
    const { data, error } = await context.supabase
      .from("google_connections")
      .select("id, label, google_email, connected_at")
      .order("connected_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

export const renameGoogleConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; label: string }) =>
    z.object({ id: z.string().uuid(), label: z.string().min(1).max(80) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("google_connections")
      .update({ label: data.label, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

// Disconnecting a connection any site currently maps to leaves that
// site's google_connection_id/ga4_property_id in place at the DB row
// level -- ON DELETE SET NULL on the FK only fires because this DELETE
// removes the row those columns reference, which is exactly the
// intended behavior (see the migration's comment): the site's
// Connections card will read a null google_connection_id afterward and
// show "not connected" / prompt to re-pick, rather than erroring on a
// dangling reference.
export const disconnectGoogleConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("google_connections")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

// GA4 property picker's data source (site Connections section, step 2
// of "which connection -> which property"). Always goes through
// getValidAccessToken so an expired access token transparently
// refreshes rather than surfacing a raw 401 to this call.
export const listGa4PropertiesForConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { connectionId: string }) => z.object({ connectionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { getValidAccessToken, listGa4Properties } = await import("./google-analytics.server");
    const accessToken = await getValidAccessToken(data.connectionId, context.userId);
    return await listGa4Properties(accessToken);
  });
