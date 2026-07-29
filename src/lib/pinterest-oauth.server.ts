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

export function signState(userId: string, returnTo: OAuthReturnTo = "settings"): string {
  const nonce = b64url(randomBytes(12));
  const payload = `${userId}.${nonce}.${returnTo}`;
  const sig = b64url(createHmac("sha256", stateSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyState(state: string): { userId: string; returnTo: OAuthReturnTo } | null {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [userId, nonce, returnToRaw, sig] = parts;
  const expected = b64url(createHmac("sha256", stateSecret()).update(`${userId}.${nonce}.${returnToRaw}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  const returnTo: OAuthReturnTo = returnToRaw === "onboarding" ? "onboarding" : "settings";
  return { userId, returnTo };
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
}): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
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
