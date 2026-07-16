// Server-only. Pinterest OAuth helpers (state signing + token exchange).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SCOPES = ["boards:read", "boards:write", "pins:read", "pins:write"];

function stateSecret(): string {
  const raw = process.env.INTEGRATIONS_ENC_KEY;
  if (!raw) throw new Error("INTEGRATIONS_ENC_KEY is not configured");
  return raw;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function signState(userId: string): string {
  const nonce = b64url(randomBytes(12));
  const payload = `${userId}.${nonce}`;
  const sig = b64url(createHmac("sha256", stateSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyState(state: string): { userId: string } | null {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [userId, nonce, sig] = parts;
  const expected = b64url(createHmac("sha256", stateSecret()).update(`${userId}.${nonce}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? { userId } : null;
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
