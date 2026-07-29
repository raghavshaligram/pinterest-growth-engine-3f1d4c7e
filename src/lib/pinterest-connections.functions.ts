import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PinterestConnectionSummary } from "./pinterest-connections.server";

// New multi-connection Pinterest surface -- separate from
// integrations.functions.ts's startPinterestOAuth (the original single-
// account flow, unchanged, still used by Settings' existing Pinterest
// publish-mode card and the onboarding wizard's Pinterest step). This
// one always signs state with mode: "connection" so the shared callback
// route (api/public/pinterest.callback.ts) INSERTs a new
// pinterest_connections row instead of upserting the legacy integrations
// row.
export const startPinterestConnectionOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { pinterestAppConfig, signState, buildAuthorizeUrl } = await import("./pinterest-oauth.server");
    const { appId, redirectUri } = pinterestAppConfig();
    const state = signState(context.userId, "settings", "connection");
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
