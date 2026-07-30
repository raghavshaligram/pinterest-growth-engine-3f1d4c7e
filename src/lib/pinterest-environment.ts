// Server-only. Single source of truth for Pinterest's environment ->
// API host mapping (Trial-access Sandbox vs production).
//
// Confirmed directly against Pinterest's own docs before writing this
// (not assumed):
// https://developers.pinterest.com/docs/developer-tools/sandbox/
// https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/
//
// - The OAuth AUTHORIZE page (the browser redirect a user consents on)
//   is the SAME url for both environments -- https://www.pinterest.com/oauth/.
//   Pinterest's docs never describe a sandbox variant of it; only the
//   token endpoint and all subsequent API calls move to the
//   api-sandbox. subdomain. See buildAuthorizeUrl in
//   pinterest-oauth.server.ts, which is deliberately NOT routed through
//   this file for that reason.
// - The OAuth TOKEN endpoint (both the initial exchange and every
//   refresh -- Pinterest uses the same "Generate OAuth access token"
//   endpoint for both, distinguished only by grant_type) DOES differ:
//   https://api.pinterest.com/v5/oauth/token (production) vs
//   https://api-sandbox.pinterest.com/v5/oauth/token (sandbox).
// - Every other v5 API call (pins, boards, user_account, ...) follows
//   the same production/api-sandbox split.
//
// A token issued for one environment is rejected by the other --
// Pinterest's docs are explicit that Sandbox entities and tokens are
// entirely separate from production. Every call site that has a
// connection's access token MUST also carry that connection's
// environment and select its host from here, never from a hardcoded
// string -- see pinterest_connections.environment (added by
// 20260801000000_pinterest_connections_environment.sql) as the one
// place that value is actually stored per connection.
export type PinterestEnvironment = "sandbox" | "production";

const PINTEREST_API_BASE_URL: Record<PinterestEnvironment, string> = {
  production: "https://api.pinterest.com/v5",
  sandbox: "https://api-sandbox.pinterest.com/v5",
};

export function pinterestApiBaseUrl(environment: PinterestEnvironment): string {
  return PINTEREST_API_BASE_URL[environment];
}
