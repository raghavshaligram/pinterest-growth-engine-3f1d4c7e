// Server-only. Google OAuth helpers (state signing + token exchange +
// refresh) -- mirrors pinterest-oauth.server.ts's shape closely
// (signState/verifyState/buildAuthorizeUrl/exchangeCode), including the
// same returnTo-in-state mechanism Pinterest's onboarding integration
// uses, now that the onboarding wizard's Complete step also offers a
// Google Analytics connect (see routes/onboarding.tsx).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type OAuthReturnTo = "settings" | "onboarding";

// analytics.readonly is the actual data-access scope (Data + Admin API
// read access); userinfo.email is only used once, right after connect,
// to default the connection's label to the Google account's own email
// (see google.functions.ts:startGoogleOAuth) -- never stored/used again
// after that.
const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

function stateSecret(): string {
  const raw = process.env.INTEGRATIONS_ENC_KEY;
  if (!raw) throw new Error("INTEGRATIONS_ENC_KEY is not configured");
  return raw;
}

// Deployment-level Google Cloud OAuth client -- one shared client
// (like Pinspider's single shared Pinterest app), users authorize it
// against their own Google account(s) via OAuth, they never register
// their own Google Cloud project.
export function googleAppConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const missing = [
    ...(!clientId ? ["GOOGLE_CLIENT_ID"] : []),
    ...(!clientSecret ? ["GOOGLE_CLIENT_SECRET"] : []),
    ...(!redirectUri ? ["GOOGLE_REDIRECT_URI"] : []),
  ];
  if (missing.length) {
    throw new Error(`Missing Google app environment variable(s): ${missing.join(", ")}.`);
  }
  return { clientId: clientId!, clientSecret: clientSecret!, redirectUri: redirectUri! };
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function signState(userId: string, returnTo: OAuthReturnTo = "settings"): string {
  const nonce = b64url(randomBytes(12));
  const payload = `${userId}.${nonce}.${returnTo}`;
  const sig = b64url(createHmac("sha256", stateSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyState(state: string): { userId: string; returnTo: OAuthReturnTo } | null {
  const parts = state.split(".");
  // 3 parts = pre-existing state format (userId.nonce.sig, no returnTo)
  // -- still accepted so an in-flight redirect issued right before this
  // field was added doesn't fail on return; treated as "settings" since
  // that was the only place Google could be connected from before this.
  // 4 parts = current format with an explicit returnTo. Mirrors
  // pinterest-oauth.server.ts's own backward-compatible parsing.
  if (parts.length !== 3 && parts.length !== 4) return null;
  const hasReturnTo = parts.length === 4;
  const [userId, nonce, returnToRawOrSig, maybeSig] = parts;
  const sig = hasReturnTo ? maybeSig : returnToRawOrSig;
  const signedPayload = hasReturnTo ? `${userId}.${nonce}.${returnToRawOrSig}` : `${userId}.${nonce}`;
  const expected = b64url(createHmac("sha256", stateSecret()).update(signedPayload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  const returnTo: OAuthReturnTo = hasReturnTo && returnToRawOrSig === "onboarding" ? "onboarding" : "settings";
  return { userId, returnTo };
}

export function buildAuthorizeUrl(params: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: SCOPES.join(" "),
    state: params.state,
    // access_type=offline + prompt=consent guarantee a refresh_token
    // comes back on EVERY connect, not just the first -- Google only
    // issues a refresh_token by default on a user's very first consent
    // for an app; without forcing the consent screen again, connecting
    // a second Google account (or reconnecting one that was
    // disconnected) can silently come back with no refresh_token at
    // all, which would work for an hour and then start failing.
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number };

export async function exchangeCode(params: {
  clientId: string; clientSecret: string; code: string; redirectUri: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Google token exchange ${r.status}: ${text}`);
  return JSON.parse(text);
}

export async function refreshAccessToken(params: {
  clientId: string; clientSecret: string; refreshToken: string;
}): Promise<{ access_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Google token refresh ${r.status}: ${text}`);
  return JSON.parse(text);
}

export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}
