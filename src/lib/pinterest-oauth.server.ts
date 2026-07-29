// Server-only. Pinterest OAuth helpers (state signing + token exchange).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SCOPES = ["boards:read", "boards:write", "pins:read", "pins:write"];

function stateSecret(): string {
  const raw = process.env.INTEGRATIONS_ENC_KEY;
  if (!raw) throw new Error("INTEGRATIONS_ENC_KEY is not configured");
  return raw;
}

// Pinspider ships as a single Pinterest developer app shared by every
// tenant — users authorize *this* app against *their* Pinterest account via
// OAuth, they never create their own Pinterest app. These three are set
// once at the deployment level (never per-user, never sent to the client).
export function pinterestAppConfig(): { appId: string; appSecret: string; redirectUri: string } {
  const appId = process.env.PINTEREST_APP_ID;
  const appSecret = process.env.PINTEREST_APP_SECRET;
  const redirectUri = process.env.PINTEREST_REDIRECT_URI;
  const missing = [
    ...(!appId ? ["PINTEREST_APP_ID"] : []),
    ...(!appSecret ? ["PINTEREST_APP_SECRET"] : []),
    ...(!redirectUri ? ["PINTEREST_REDIRECT_URI"] : []),
  ];
  if (missing.length) {
    throw new Error(`Missing Pinterest app environment variable(s): ${missing.join(", ")}.`);
  }
  return { appId: appId!, appSecret: appSecret!, redirectUri: redirectUri! };
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// returnTo carries where the OAuth callback should send the browser back
// to on success -- "onboarding" when the connect was started from the
// onboarding wizard's Pinterest step (so finishing OAuth doesn't strand
// the user on the standalone Settings page, losing their place in the
// wizard), "settings" (the default) otherwise. Folded into the signed
// state itself, not a separate query param, so it can't be tampered with
// independently of the HMAC that already protects userId.
export type OAuthReturnTo = "settings" | "onboarding";

// "legacy" is the original single-account flow (Settings' existing
// Pinterest card / onboarding step) -- upserts the one integrations row,
// completely unchanged. "connection" is the new multi-account flow
// (Settings' new "Connect another Pinterest account" button) -- INSERTs
// a new pinterest_connections row instead, never touching integrations.
// Reusing this one callback route + state-signing scheme for both
// (rather than a second registered redirect_uri/callback route) avoids
// needing anything new registered in Pinterest's own developer app
// settings. Defaults to "legacy" so any state string issued before this
// field existed (an in-flight OAuth redirect mid-deploy) still verifies
// and behaves exactly as before.
export type OAuthMode = "legacy" | "connection";

export function signState(userId: string, returnTo: OAuthReturnTo = "settings", mode: OAuthMode = "legacy"): string {
  const nonce = b64url(randomBytes(12));
  const payload = `${userId}.${nonce}.${returnTo}.${mode}`;
  const sig = b64url(createHmac("sha256", stateSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyState(state: string): { userId: string; returnTo: OAuthReturnTo; mode: OAuthMode } | null {
  const parts = state.split(".");
  // 4 parts = pre-existing state format (userId.nonce.returnTo.sig),
  // still accepted so an in-flight redirect issued right before this
  // field was added doesn't fail on return. 5 parts = current format
  // with an explicit mode.
  if (parts.length !== 4 && parts.length !== 5) return null;
  const hasMode = parts.length === 5;
  const [userId, nonce, returnToRaw, modeRawOrSig, maybeSig] = parts;
  const sig = hasMode ? maybeSig : modeRawOrSig;
  const signedPayload = hasMode
    ? `${userId}.${nonce}.${returnToRaw}.${modeRawOrSig}`
    : `${userId}.${nonce}.${returnToRaw}`;
  const expected = b64url(createHmac("sha256", stateSecret()).update(signedPayload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  const returnTo: OAuthReturnTo = returnToRaw === "onboarding" ? "onboarding" : "settings";
  const mode: OAuthMode = hasMode && modeRawOrSig === "connection" ? "connection" : "legacy";
  return { userId, returnTo, mode };
}

export function buildAuthorizeUrl(params: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: params.appId,
    redirect_uri: params.redirectUri,
    scope: SCOPES.join(","),
    state: params.state,
  });
  return `https://www.pinterest.com/oauth/?${q.toString()}`;
}

export async function exchangeCode(params: {
  appId: string;
  appSecret: string;
  code: string;
  redirectUri: string;
}): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  // Pinterest's own token response includes this alongside expires_in --
  // how long the refresh_token itself stays valid (~60 days), separate
  // from the access_token's much shorter expiry. Only used by the new
  // multi-connection flow (to populate pinterest_connections.
  // refresh_token_expires_at); the original single-integration flow
  // never tracked this at all.
  refresh_token_expires_in?: number;
}> {
  const basic = Buffer.from(`${params.appId}:${params.appSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  const r = await fetch("https://api.pinterest.com/v5/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Pinterest token exchange ${r.status}: ${text}`);
  return JSON.parse(text);
}

// Mints a fresh access_token (and, per Pinterest's own behavior, a
// refreshed refresh_token validity window) from a stored refresh_token --
// used by both the on-connect flow's future needs and, primarily, the
// proactive background refresh job (pinterest-connections.server.ts),
// which calls this for every connection nearing its
// refresh_token_expires_at rather than waiting for an access_token to
// actually expire first.
export async function refreshPinterestToken(params: {
  appId: string;
  appSecret: string;
  refreshToken: string;
}): Promise<{ access_token: string; expires_in: number; refresh_token_expires_in?: number }> {
  const basic = Buffer.from(`${params.appId}:${params.appSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
  });
  const r = await fetch("https://api.pinterest.com/v5/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Pinterest token refresh ${r.status}: ${text}`);
  return JSON.parse(text);
}

// Best-effort only -- used to default a new connection's label to
// something more useful than "Pinterest account" right after connect.
// Never blocks/fails the connect flow itself if this call errors.
export async function fetchPinterestUsername(accessToken: string): Promise<string | null> {
  try {
    const r = await fetch("https://api.pinterest.com/v5/user_account", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { username?: string };
    return j.username ?? null;
  } catch {
    return null;
  }
}
