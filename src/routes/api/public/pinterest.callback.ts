// Pinterest OAuth callback. Public route — verifies HMAC-signed `state`
// to bind the flow to the initiating user before exchanging the code.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/pinterest/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const err = url.searchParams.get("error");
        const settingsUrl = `${url.origin}/settings/integrations`;

        if (err) {
          return Response.redirect(`${settingsUrl}?pinterest=error&reason=${encodeURIComponent(err)}`, 302);
        }
        if (!code || !state) {
          return Response.redirect(`${settingsUrl}?pinterest=error&reason=missing_params`, 302);
        }

        try {
          const { pinterestAppConfig, verifyState, exchangeCode } = await import("@/lib/pinterest-oauth.server");
          const verified = verifyState(state);
          if (!verified) {
            return Response.redirect(`${settingsUrl}?pinterest=error&reason=bad_state`, 302);
          }

          // Deployment-level app credentials — same ones startPinterestOAuth
          // used to build the authorize URL. Throws (caught below) if the
          // server isn't configured with PINTEREST_APP_ID/APP_SECRET/REDIRECT_URI.
          const { appId, appSecret, redirectUri } = pinterestAppConfig();
          const tokens = await exchangeCode({ appId, appSecret, code, redirectUri });

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

          return Response.redirect(`${settingsUrl}?pinterest=connected`, 302);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.redirect(
            `${settingsUrl}?pinterest=error&reason=${encodeURIComponent(msg.slice(0, 200))}`,
            302,
          );
        }
      },
    },
  },
});
