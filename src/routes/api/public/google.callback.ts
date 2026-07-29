// Google OAuth callback. Public route — verifies HMAC-signed `state` to
// bind the flow to the initiating user before exchanging the code.
// Unlike Pinterest's callback (one row, upserted), this always INSERTS
// a new google_connections row -- every successful connect is a
// distinct account, by design (see the 20260730100000 migration).
import { createFileRoute } from "@tanstack/react-router";
import { getErrorMessage } from "@/lib/error-message";

export const Route = createFileRoute("/api/public/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const err = url.searchParams.get("error");
        const settingsUrl = `${url.origin}/settings/integrations`;

        if (err) {
          return Response.redirect(`${settingsUrl}?google=error&reason=${encodeURIComponent(err)}`, 302);
        }
        if (!code || !state) {
          return Response.redirect(`${settingsUrl}?google=error&reason=missing_params`, 302);
        }

        try {
          const { googleAppConfig, verifyState, exchangeCode, fetchGoogleEmail } = await import("@/lib/google-oauth.server");
          const verified = verifyState(state);
          if (!verified) {
            return Response.redirect(`${settingsUrl}?google=error&reason=bad_state`, 302);
          }

          const { clientId, clientSecret, redirectUri } = googleAppConfig();
          const tokens = await exchangeCode({ clientId, clientSecret, code, redirectUri });
          if (!tokens.refresh_token) {
            // Shouldn't happen given access_type=offline + prompt=consent
            // in buildAuthorizeUrl, but a token that will silently stop
            // working in an hour is worse than a clear error asking the
            // user to try again.
            throw new Error("Google didn't return a refresh token — please try connecting again.");
          }

          const email = await fetchGoogleEmail(tokens.access_token);

          const { encrypt } = await import("@/lib/crypto.server");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const storedTokens = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Date.now() + tokens.expires_in * 1000,
          };
          const { error } = await supabaseAdmin.from("google_connections").insert({
            user_id: verified.userId,
            label: email ?? "Google account",
            google_email: email,
            token_ciphertext: encrypt(JSON.stringify(storedTokens)),
          });
          if (error) throw error;

          return Response.redirect(`${settingsUrl}?google=connected`, 302);
        } catch (e) {
          const msg = getErrorMessage(e);
          return Response.redirect(`${settingsUrl}?google=error&reason=${encodeURIComponent(msg.slice(0, 200))}`, 302);
        }
      },
    },
  },
});
