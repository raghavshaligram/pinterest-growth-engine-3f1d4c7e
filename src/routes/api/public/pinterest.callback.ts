// Pinterest OAuth callback. Public route — verifies HMAC-signed `state`
// to bind the flow to the initiating user before exchanging the code.
import { createFileRoute } from "@tanstack/react-router";
import { getErrorMessage } from "@/lib/error-message";

export const Route = createFileRoute("/api/public/pinterest/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const err = url.searchParams.get("error");
        const settingsUrl = `${url.origin}/settings/integrations`;
        // verifyState below tells us whether this flow started from the
        // onboarding wizard (see OAuthReturnTo in pinterest-oauth.server.ts)
        // -- until it's decoded, errors fall back to Settings, the same
        // page every pre-onboarding-wizard error already redirected to.
        let successUrl = settingsUrl;

        if (err) {
          return Response.redirect(`${settingsUrl}?pinterest=error&reason=${encodeURIComponent(err)}`, 302);
        }
        if (!code || !state) {
          return Response.redirect(`${settingsUrl}?pinterest=error&reason=missing_params`, 302);
        }

        try {
          const { pinterestAppConfig, verifyState, exchangeCode, fetchPinterestUsername } = await import("@/lib/pinterest-oauth.server");
          const verified = verifyState(state);
          if (!verified) {
            return Response.redirect(`${settingsUrl}?pinterest=error&reason=bad_state`, 302);
          }
          successUrl = verified.returnTo === "onboarding" ? `${url.origin}/onboarding?step=4` : settingsUrl;

          // Deployment-level app credentials — same ones startPinterestOAuth
          // used to build the authorize URL. Throws (caught below) if the
          // server isn't configured with PINTEREST_APP_ID/APP_SECRET/REDIRECT_URI.
          const { appId, appSecret, redirectUri } = pinterestAppConfig();
          // Both the legacy single-account flow and the new multi-
          // connection "Connect another Pinterest account" flow always
          // exchange against production -- sandbox connections are only
          // ever created through the separate dev-gated manual-token
          // form (addManualPinterestConnection), not this OAuth
          // redirect, so there is no environment choice to make here.
          const tokens = await exchangeCode({ appId, appSecret, code, redirectUri, environment: "production" });

          if (verified.mode === "connection") {
            // New multi-connection flow ("Connect another Pinterest
            // account" in Settings) -- always INSERTs a new
            // pinterest_connections row, never touches `integrations`.
            // Every successful connect here is a distinct account, same
            // reasoning as google_connections.
            if (!tokens.refresh_token) {
              throw new Error("Pinterest didn't return a refresh token — please try connecting again.");
            }
            const username = await fetchPinterestUsername(tokens.access_token, "production");
            const { encrypt } = await import("@/lib/crypto.server");
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const now = Date.now();
            const storedTokens = {
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              access_token_expires_at: now + (tokens.expires_in ?? 0) * 1000,
            };
            const refreshExpiresAt = tokens.refresh_token_expires_in
              ? new Date(now + tokens.refresh_token_expires_in * 1000).toISOString()
              : null;
            const { error } = await supabaseAdmin.from("pinterest_connections").insert({
              user_id: verified.userId,
              label: username ? `@${username}` : "Pinterest account",
              pinterest_username: username,
              token_ciphertext: encrypt(JSON.stringify(storedTokens)),
              refresh_token_expires_at: refreshExpiresAt,
              // Explicit, not relying on the column default -- every
              // real OAuth connect through this route is production/
              // oauth by construction (see the exchangeCode call above).
              environment: "production",
              token_source: "oauth",
            });
            if (error) throw error;
            // Distinct query param from the legacy flow's ?pinterest=connected
            // on purpose -- Settings' existing effect treats that as "maybe
            // show the publishing-age prompt," which only makes sense for the
            // original single-account flow, not for adding an Nth connection.
            return Response.redirect(`${successUrl}${successUrl.includes("?") ? "&" : "?"}pinterest_connection=connected`, 302);
          }

          // Legacy single-account flow -- unchanged from before this
          // patch. Still what publisher.server.ts/syncPinterestBoards
          // actually read at publish/sync time (see the migration's own
          // comment); this restructure is additive to that, not a
          // replacement of it yet.
          const { getIntegration } = await import("@/lib/integrations.server");
          const cfg = await getIntegration(verified.userId, "pinterest");

          const { encrypt } = await import("@/lib/crypto.server");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const merged = {
            ...cfg,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token ?? cfg?.refresh_token,
          };
          const { error } = await supabaseAdmin.from("integrations").upsert(
            {
              user_id: verified.userId,
              provider: "pinterest",
              config_ciphertext: encrypt(JSON.stringify(merged)),
              status: "ok",
              last_error: null,
              last_used_at: new Date().toISOString(),
            },
            { onConflict: "user_id,provider" },
          );
          if (error) throw error;

          return Response.redirect(`${successUrl}${successUrl.includes("?") ? "&" : "?"}pinterest=connected`, 302);
        } catch (e) {
          const msg = getErrorMessage(e);
          return Response.redirect(
            `${settingsUrl}?pinterest=error&reason=${encodeURIComponent(msg.slice(0, 200))}`,
            302,
          );
        }
      },
    },
  },
});
